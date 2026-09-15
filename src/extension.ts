// 拡張の入口。
//
// **持つのは 2 つだけ。** Copilot Chat の `@mask` と、エディタの右クリックの置き換えで
// ある。本体のような会話の仕組みは持たない。

import * as vscode from "vscode"

import { TaskPiiMasker } from "./pii/TaskPiiMasker"
import { maskSecretsInActiveEditor, restoreSecretsInActiveEditor } from "./pii/maskEditor"
import { addSelectionToDictionary, exportDictionary } from "./pii/dictionaryEditor"
import { sessionVault } from "./pii/maskConversation"
import { createHandler } from "./participant"
import { readSettings } from "./settings"
import { t } from "./messages"

/**
 * 伏せる仕掛けを 1 つだけ作って使い回す。
 *
 * **作り直さない。** 呼ぶたびに作ると、辞書のファイルを毎回全部読み直すことになる。
 * 設定は読む関数を渡してあるので、作り直さなくても変更は効く。
 */
let masker: TaskPiiMasker | undefined

function piiMasker(): TaskPiiMasker {
	if (!masker) masker = new TaskPiiMasker(readSettings)
	return masker
}

export function activate(context: vscode.ExtensionContext): void {
	const participant = vscode.chat.createChatParticipant(
		"pii-guard.mask",
		createHandler({ masker: piiMasker }),
	)
	participant.iconPath = new vscode.ThemeIcon("shield")

	context.subscriptions.push(
		participant,
		vscode.commands.registerCommand("piiGuard.maskFile", () =>
			maskSecretsInActiveEditor(readSettings(), sessionVault(), (texts) =>
				piiMasker().properNounsFor(texts),
			),
		),
		vscode.commands.registerCommand("piiGuard.restoreFile", () =>
			restoreSecretsInActiveEditor((text) => sessionVault().restore(text)),
		),
		vscode.commands.registerCommand("piiGuard.addToDictionary", () =>
			addSelectionToDictionary(readSettings()),
		),
		vscode.commands.registerCommand("piiGuard.exportDictionary", () =>
			exportDictionary(readSettings()),
		),
	)

	// **理由は黙らせない。** 辞書が読めない、第 2 層が動かない、といったことは画面が
	// 変わらないので、出さないと伏せているつもりで送り続ける。
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (event) => {
			if (!event.affectsConfiguration("piiGuard")) return
			for (const trouble of piiMasker().takeDictionaryTroubles()) {
				await vscode.window.showWarningMessage(t("common:pii.maskingTrouble", { detail: trouble }))
			}
		}),
	)
}

export function deactivate(): void {
	masker = undefined
}
