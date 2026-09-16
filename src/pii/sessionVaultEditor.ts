import * as vscode from "vscode"

import { t } from "../messages"

import { sessionVault, type PiiVault } from "./maskConversation"

const clearButton = () => t("common:pii.clearVault")

/** 確認を開いた時点のSession Vault全件を消す。確認中に増えた対応は対象外にする。 */
export async function clearSessionVault(vault: PiiVault = sessionVault()): Promise<void> {
	const targets = [...vault.entries.keys()]
	if (targets.length === 0) {
		await vscode.window.showInformationMessage(t("common:pii.noVault"))
		return
	}

	const confirm = clearButton()
	const answer = await vscode.window.showWarningMessage(
		t("common:pii.confirmClearVault", { scope: t("common:pii.sessionVault"), count: targets.length }),
		{ modal: true },
		confirm,
	)
	if (answer !== confirm) return

	const cleared = vault.clearSnapshot(targets)
	await vscode.window.showInformationMessage(t("common:pii.vaultCleared", { count: cleared }))
}
