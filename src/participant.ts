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

/** 画面へ出す種類の名前。設定の説明と揃える。 */
const LABELS: Record<string, string> = {
	person: "氏名",
	org: "社名",
	term: "辞書の語",
	email: "メールアドレス",
	phone: "電話番号",
	host: "社内の宛先",
	ip: "IP アドレス",
	card: "カード番号",
	secret: "鍵",
	zip: "郵便番号",
	address: "住所",
	mynumber: "マイナンバー",
}

/** 伏せ字を数える。`{{email-001}}` の `email` を種類として拾う。 */
export function countPlaceholders(text: string): Record<string, number> {
	const counts: Record<string, number> = {}
	for (const found of text.matchAll(/\{\{([a-z]+)-\d+\}\}/g)) {
		const kind = found[1]
		counts[kind] = (counts[kind] ?? 0) + 1
	}
	return counts
}

/** 伏せた件数を、種類ごとに 1 行で書く。 */
export function describeCounts(counts: Record<string, number>): string {
	const entries = Object.entries(counts).filter(([, count]) => count > 0)
	if (entries.length === 0) return ""

	return entries.map(([kind, count]) => `${LABELS[kind] ?? kind} ${count}`).join(" / ")
}

/**
 * いまの状態を 1 行で書く。
 *
 * **必ず出す。** 出さないと、切れているのか、伏せるものが無かったのかが分からない。
 * 切れているまま話しかけると、生の文がそのまま Copilot へ渡る。**画面は何も変わらない
 * ので、これがいちばん気づけない失敗である。**
 */
export function describeState(enabled: boolean, maskedText: string): string {
	if (!enabled) {
		return (
			"> ⚠️ **伏せていません。** 設定 `piiGuard.enabled` が切になっています。" +
			"このまま送ると、書いた内容はそのまま Copilot へ渡ります。\n\n"
		)
	}

	const detail = describeCounts(countPlaceholders(maskedText))
	return detail
		? `> 🛡 **伏せました。** ${detail}\n\n`
		: "> 🛡 伏せるものは見つかりませんでした。\n\n"
}

export type ParticipantDeps = {
	/** いまの設定で伏せる仕掛け。呼ばれるたびに設定を読み直す。 */
	masker: () => TaskPiiMasker
	/** 伏せる設定が入っているか。切なら、そのことを画面へ出す。 */
	isEnabled: () => boolean
	/** 使うモデルを選ぶ。既定は Copilot のもの。 */
	selectModel?: () => Promise<vscode.LanguageModelChat | undefined>
	/** 参照した文書を読む。試験では、実ファイルを開かずに差し替える。 */
	openTextDocument?: (uri: vscode.Uri) => Thenable<vscode.TextDocument>
}

type ReferenceText = { label: string; text: string }

/** `Uri` は実装が増えても、この 2 つの値を持つ。`Location` はここに当てはまらない。 */
function isUri(value: unknown): value is vscode.Uri {
	return (
		typeof value === "object" &&
		value !== null &&
		"scheme" in value &&
		typeof value.scheme === "string" &&
		"path" in value &&
		typeof value.path === "string"
	)
}

/** ファイル全体、または選択範囲（Location）を、モデルへ送る前の本文として取り出す。 */
export async function readReferences(
	references: readonly vscode.ChatPromptReference[],
	openTextDocument: (uri: vscode.Uri) => Thenable<vscode.TextDocument> = vscode.workspace.openTextDocument,
): Promise<{ texts: ReferenceText[]; failures: string[] }> {
	const texts: ReferenceText[] = []
	const failures: string[] = []

	for (const reference of references) {
		const { value } = reference
		if (typeof value === "string") {
			texts.push({ label: reference.modelDescription ?? "参照", text: value })
			continue
		}

		const location =
			typeof value === "object" && value !== null && "uri" in value && "range" in value && isUri(value.uri)
				? (value as vscode.Location)
				: undefined
		const uri = isUri(value) ? value : location?.uri
		if (!uri) continue

		try {
			const document = await openTextDocument(uri)
			texts.push({ label: uri.path, text: document.getText(location?.range) })
		} catch {
			failures.push(uri.path)
		}
	}

	return { texts, failures }
}

/** 参照した本文を、出どころが分かる形で依頼文へ加える。ここで加えた全体を伏せる。 */
export function promptWithReferences(prompt: string, references: readonly ReferenceText[]): string {
	return [
		prompt,
		...references.map((reference) => `\n\n--- 参照: ${reference.label} ---\n${reference.text}`),
	].join("")
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
	const openTextDocument = deps.openTextDocument ?? vscode.workspace.openTextDocument

	return async (request, _context, stream, token) => {
		const masker = deps.masker()
		const references = await readReferences(request.references ?? [], openTextDocument)
		const masked = await masker.maskPrompt(promptWithReferences(request.prompt, references.texts))

		// **状態を必ず出す。** 切れているのか、伏せるものが無かったのかを、利用者が
		// 見分けられるようにする。
		stream.markdown(describeState(deps.isEnabled(), masked.text))
		if (references.texts.length > 0) {
			stream.markdown(`> 🛡 参照した本文 ${references.texts.length} 件も伏せて送ります。\n\n`)
		}
		if (references.failures.length > 0) {
			stream.markdown(`> ⚠️ 読み込めなかった参照は送信しませんでした: ${references.failures.join("、")}\n\n`)
		}

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
