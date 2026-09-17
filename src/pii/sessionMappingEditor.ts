import * as vscode from "vscode"

import { t } from "../messages"

import { sessionMapping, type PiiMapping } from "./maskConversation"

const clearButton = () => t("common:pii.clearMapping")

/** 確認を開いた時点のセッション対応表全件を消す。確認中に増えた対応は対象外にする。 */
export async function clearSessionMapping(mapping: PiiMapping = sessionMapping()): Promise<void> {
	const targets = [...mapping.entries.keys()]
	if (targets.length === 0) {
		await vscode.window.showInformationMessage(t("common:pii.noMapping"))
		return
	}

	const confirm = clearButton()
	const answer = await vscode.window.showWarningMessage(
		t("common:pii.confirmClearMapping", { scope: t("common:pii.sessionMapping"), count: targets.length }),
		{ modal: true },
		confirm,
	)
	if (answer !== confirm) return

	const cleared = mapping.clearSnapshot(targets)
	await vscode.window.showInformationMessage(t("common:pii.mappingCleared", { count: cleared }))
}
