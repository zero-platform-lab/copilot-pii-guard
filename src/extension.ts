// 拡張の入口。
//
// **持つのは 2 つだけ。** Copilot Chat の `@mask` と、エディタの右クリックの置き換えで
// ある。本体のような会話の仕組みは持たない。

import * as vscode from "vscode"

import { TaskPiiMasker } from "./pii/TaskPiiMasker"
import { checkSecretsInActiveEditor, maskSecretsInActiveEditor, restoreSecretsInActiveEditor } from "./pii/maskEditor"
import { addSelectionToDictionary, exportDictionary } from "./pii/dictionaryEditor"
import { PiiVaultLimitError, sessionVault } from "./pii/maskConversation"
import { clearSessionVault } from "./pii/sessionVaultEditor"
import { FileVaultController } from "./pii/fileVault"
import { createHandler } from "./participant"
import { disposeFileToolPreviews } from "./fileTools"
import { readSettings } from "./settings"
import { fetchModelCommand, showModelStatus } from "./model"
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
	context.subscriptions.push({ dispose: disposeFileToolPreviews })
	const fileVault = new FileVaultController(context)
	context.subscriptions.push(...fileVault.start())
	const participant = vscode.chat.createChatParticipant(
		"pii-guard.mask",
		createHandler({
			masker: piiMasker,
			isEnabled: () => readSettings().enabled !== false,
			restoreFileWrites: () => readSettings().fileWrites?.restore === true,
			fileToolMode: () => readSettings().fileTools?.mode ?? "confirmEdit",
			prepareFileVault: (path, masker) => fileVault.prepareToolPath(path, masker.allocator),
			prepareReferenceVault: (uri, masker) => fileVault.prepareReference(uri, masker.allocator),
			recordFileVault: (path, entries) => fileVault.recordToolPath(path, entries),
		}),
	)
	participant.iconPath = new vscode.ThemeIcon("shield")

	context.subscriptions.push(
		participant,
		vscode.commands.registerCommand("piiGuard.checkFile", () =>
			checkSecretsInActiveEditor(readSettings(), (texts) => piiMasker().properNounsFor(texts)),
		),
		vscode.commands.registerCommand("piiGuard.maskFile", async () => {
			const vault = sessionVault()
			vault.setMaxEntries(readSettings().sessionVault?.maxEntries)
			const checkpoint = vault.checkpoint()
			const uri = vscode.window.activeTextEditor?.document.uri
			if (uri && !(await fileVault.prepare(uri, vault))) return
			try {
				await maskSecretsInActiveEditor(
					readSettings(),
					vault,
					(texts) => piiMasker().properNounsFor(texts),
					async (uri, entries) => {
						await fileVault.record(uri, entries)
					},
				)
			} catch (error) {
				if (!(error instanceof PiiVaultLimitError)) throw error
				vault.rollback(checkpoint)
				await vscode.window.showErrorMessage(t("common:pii.sessionVault.maxEntries"))
			}
		}),
		vscode.commands.registerCommand("piiGuard.restoreFile", () =>
			restoreSecretsInActiveEditor((text, uri) => fileVault.restore(uri, text, (one) => sessionVault().restore(one))),
		),
		vscode.commands.registerCommand("piiGuard.clearSessionVault", clearSessionVault),
		vscode.commands.registerCommand("piiGuard.enableFileVault", () => fileVault.enable(sessionVault())),
		vscode.commands.registerCommand("piiGuard.disableFileVault", () => fileVault.disable()),
		vscode.commands.registerCommand("piiGuard.fileVaultStatus", () => fileVault.status()),
		vscode.commands.registerCommand("piiGuard.clearSelectedFileVaults", () => fileVault.clearSelected()),
		vscode.commands.registerCommand("piiGuard.clearAllFileVaults", () => fileVault.clearAll(sessionVault())),
		vscode.commands.registerCommand("piiGuard.addToDictionary", () =>
			addSelectionToDictionary(readSettings()),
		),
		vscode.commands.registerCommand("piiGuard.exportDictionary", () =>
			exportDictionary(readSettings()),
		),
		vscode.commands.registerCommand("piiGuard.fetchModel", fetchModelCommand),
		vscode.commands.registerCommand("piiGuard.modelStatus", showModelStatus),
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
