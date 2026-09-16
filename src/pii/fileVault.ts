import * as path from "node:path"

import * as vscode from "vscode"

import { t } from "../messages"

import { FileVaultError, FileVaultStore, type FileVaultEntry } from "./fileVaultStore"
import { PiiVault } from "./maskConversation"
import { unmaskText } from "./maskText"

type FileTarget = { identity: string; label: string; uri: vscode.Uri; text: string }

export function fileVaultIdentity(uri: vscode.Uri): string | undefined {
	const folder = vscode.workspace.getWorkspaceFolder(uri)
	if (!folder) return undefined
	const relative = path.posix.relative(folder.uri.path, uri.path)
	if (!relative || relative === ".." || relative.startsWith("../")) return undefined
	return `${folder.index}:${relative}`
}

function errorMessage(error: unknown): string {
	if (error instanceof FileVaultError) return t(`common:pii.fileVault.${error.code}`)
	return t("common:pii.fileVault.failed")
}

/** 利用者操作と暗号化ストアの境界。モデルからは呼ばない。 */
export class FileVaultController {
	private readonly store: FileVaultStore | undefined

	constructor(
		context: Pick<vscode.ExtensionContext, "storageUri"> & {
			secrets: Pick<vscode.SecretStorage, "get" | "store">
		},
	) {
		this.store = context.storageUri ? new FileVaultStore(context.storageUri, context.secrets) : undefined
	}

	private activeTarget(): FileTarget | undefined {
		const document = vscode.window.activeTextEditor?.document
		if (!document) return undefined
		const uri = document.uri
		const identity = fileVaultIdentity(uri)
		if (!identity) return undefined
		return { identity, label: vscode.workspace.asRelativePath(uri, true), uri, text: document.getText() }
	}

	private async requireTarget(): Promise<FileTarget | undefined> {
		const target = this.activeTarget()
		if (!vscode.window.activeTextEditor) {
			await vscode.window.showInformationMessage(t("common:pii.noEditor"))
			return undefined
		}
		if (!target || !this.store) {
			await vscode.window.showWarningMessage(t("common:pii.fileVault.workspaceRequired"))
			return undefined
		}
		return target
	}

	async enable(vault: PiiVault): Promise<void> {
		const target = await this.requireTarget()
		if (!target || !this.store) return
		try {
			const existing = await this.store.inspect(target.identity)
			if (existing) {
				vault.importEntries(existing.entries)
				await vscode.window.showInformationMessage(
					t("common:pii.fileVault.alreadyEnabled", { file: target.label, count: existing.entries.length }),
				)
				return
			}
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
			return
		}
		const entries = [...vault.entries].filter(([placeholder]) => target.text.includes(placeholder))
		const confirm = t("common:pii.fileVault.enable")
		const answer = await vscode.window.showWarningMessage(
			t("common:pii.fileVault.confirmEnable", { file: target.label, count: entries.length }),
			{ modal: true },
			confirm,
		)
		if (answer !== confirm) return

		try {
			const record = await this.store.enable(target.identity, entries)
			await vscode.window.showInformationMessage(
				t("common:pii.fileVault.enabled", { file: target.label, count: record.entries.length }),
			)
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
		}
	}

	async disable(): Promise<void> {
		const target = await this.requireTarget()
		if (!target || !this.store) return
		try {
			const record = await this.store.inspect(target.identity)
			if (!record) {
				await vscode.window.showInformationMessage(t("common:pii.fileVault.notEnabled", { file: target.label }))
				return
			}
			const confirm = t("common:pii.clearVault")
			const answer = await vscode.window.showWarningMessage(
				t("common:pii.fileVault.confirmDisable", { file: target.label, count: record.entries.length }),
				{ modal: true },
				confirm,
			)
			if (answer !== confirm) return
			await this.store.delete(target.identity)
			await vscode.window.showInformationMessage(t("common:pii.fileVault.disabled", { file: target.label }))
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
		}
	}

	async status(): Promise<void> {
		const target = await this.requireTarget()
		if (!target || !this.store) return
		try {
			const record = await this.store.inspect(target.identity)
			await vscode.window.showInformationMessage(
				record
					? t("common:pii.fileVault.statusEnabled", { file: target.label, count: record.entries.length })
					: t("common:pii.fileVault.notEnabled", { file: target.label }),
			)
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
		}
	}

	async record(uri: vscode.Uri, entries: readonly FileVaultEntry[]): Promise<void> {
		const identity = fileVaultIdentity(uri)
		if (!identity || !this.store) return
		await this.store.appendIfEnabled(identity, entries)
	}

	/** 伏せ字を新しく割り当てる前に、保存済み番号をSession Vaultへ予約する。 */
	async prepare(uri: vscode.Uri, vault: PiiVault): Promise<boolean> {
		const identity = fileVaultIdentity(uri)
		if (!identity || !this.store) return true
		try {
			const record = await this.store.load(identity)
			if (record) vault.importEntries(record.entries)
			return true
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
			return false
		}
	}

	async restore(uri: vscode.Uri, text: string, restoreSession: (text: string) => string): Promise<string> {
		const identity = fileVaultIdentity(uri)
		if (!identity || !this.store) return restoreSession(text)
		const record = await this.store.load(identity)
		return restoreSession(record ? unmaskText(text, new Map(record.entries)) : text)
	}
}
