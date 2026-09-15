// Copilot Chat の `@mask` の受け口。
//
// **仕組み。** 利用者の文を伏せてから Copilot のモデルへ送り、返ってきた文の伏せ字を
// 元の値へ戻して画面へ出す。送るのはこの拡張が組み立てた文だけなので、**伏せ忘れた
// ものが混ざる経路が無い。**
//
// **普通の Copilot Chat は素通りする。** Copilot 自身の要求へ割り込む口は VS Code の
// API に無い。伏せたいときは `@mask` と書いてもらう必要がある。この制限は README にも
// 書く。書かないと、入れただけで守られていると思われる。

import * as vscode from "vscode"

import type { TaskPiiMasker } from "./pii/TaskPiiMasker"
import { createStreamRestorer } from "./stream"
import { t } from "./messages"

/** 伏せた件数を、種類ごとに 1 行で書く。 */
export function describeCounts(counts: Record<string, number>): string {
	const entries = Object.entries(counts).filter(([, count]) => count > 0)
	if (entries.length === 0) return ""

	return entries.map(([kind, count]) => `${kind} ${count}`).join(" / ")
}

export type ParticipantDeps = {
	/** いまの設定で伏せる仕掛け。呼ばれるたびに設定を読み直す。 */
	masker: () => TaskPiiMasker
	/** 使うモデルを選ぶ。既定は Copilot のもの。 */
	selectModel?: () => Promise<vscode.LanguageModelChat | undefined>
}

async function defaultModel(): Promise<vscode.LanguageModelChat | undefined> {
	const [model] = await vscode.lm.selectChatModels({ vendor: "copilot" })
	return model
}

/**
 * `@mask` に話しかけられたときの処理。
 *
 * **伏せてから送る。** 伏せた結果を組み立てて送るので、生の文が出ていく経路が無い。
 * **戻してから出す。** 戻さないと、画面に `{{person-001}}` が並んで読めない。
 */
export function createHandler(deps: ParticipantDeps): vscode.ChatRequestHandler {
	const selectModel = deps.selectModel ?? defaultModel

	return async (request, _context, stream, token) => {
		const masker = deps.masker()
		const masked = await masker.maskPrompt(request.prompt)

		// **何を伏せたかを出す。** 出さないと、伏せたのか素通りしたのかが分からない。
		// 伏せているつもりで送るのが、いちばん気づけない失敗である。
		for (const trouble of masker.takeDictionaryTroubles()) {
			stream.markdown(`> ⚠️ ${t("common:pii.maskingTrouble", { detail: trouble })}\n\n`)
		}

		const model = await selectModel()
		if (!model) {
			// **理由を名指しで出す。** 「使えません」だけだと、入っていないのか、
			// サインインしていないのかが分からない。
			stream.markdown(
				"Copilot のモデルを使えません。**GitHub Copilot Chat** を入れて、" +
					"サインインしているか確かめてください。\n\n" +
					"右クリックの「このファイルの個人情報を伏せる」は、Copilot が無くても使えます。",
			)
			return
		}

		const response = await model.sendRequest(
			[vscode.LanguageModelChatMessage.User(masked.text)],
			{},
			token,
		)

		// **区切りをまたいで戻す。** 断片ごとに戻すと、割れて届いた伏せ字が戻らない。
		const restorer = createStreamRestorer(masked.restore)
		for await (const fragment of response.text) {
			stream.markdown(restorer.push(fragment))
		}
		stream.markdown(restorer.flush())
	}
}
