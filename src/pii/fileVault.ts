import * as path from "node:path"

import * as vscode from "vscode"

import { t } from "../messages"

import { FileVaultError, FileVaultStore, type FileVaultEntry } from "./fileVaultStore"
import { PiiVault } from "./maskConversation"
import { unmaskText } from "./maskText"

type FileTarget = { identity: string; label: string; uri: vscode.Uri; text: string }

const DEFAULT_RETENTION_DAYS = 30

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

function isNotFound(error: unknown): boolean {
	return error instanceof Error && /FileNotFound|EntryNotFound/i.test(error.name)
}

function retentionDays(): number {
	const value = vscode.workspace
		.getConfiguration("piiGuard")
		.get<number>("fileVault.retentionDays", DEFAULT_RETENTION_DAYS)
	return Number.isInteger(value) && value >= 0 ? value : DEFAULT_RETENTION_DAYS
}

function uriForIdentity(identity: string): vscode.Uri | undefined {
	const match = /^(\d+):(.+)$/.exec(identity)
	if (!match) return undefined
	const folder = vscode.workspace.workspaceFolders?.[Number(match[1])]
	return folder ? vscode.Uri.joinPath(folder.uri, ...match[2].split("/")) : undefined
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

	/** 起動時の掃除と、VS Codeが通知する移動・削除への追従を開始する。 */
	start(): vscode.Disposable[] {
		if (!this.store) return []
		void this.cleanup().catch((error) => vscode.window.showErrorMessage(errorMessage(error)))
		return [
			vscode.workspace.onDidRenameFiles((event) => {
				void this.followRenames(event.files).catch((error) =>
					vscode.window.showErrorMessage(errorMessage(error)),
				)
			}),
			vscode.workspace.onDidDeleteFiles((event) => {
				void this.followDeletes(event.files).catch((error) =>
					vscode.window.showErrorMessage(errorMessage(error)),
				)
			}),
		]
	}

	private async identityExists(identity: string): Promise<boolean | undefined> {
		const uri = uriForIdentity(identity)
		if (!uri) return undefined
		try {
			await vscode.workspace.fs.stat(uri)
			return true
		} catch (error) {
			return isNotFound(error) ? false : undefined
		}
	}

	async cleanup(): Promise<void> {
		await this.store?.prune(retentionDays(), (identity) => this.identityExists(identity))
	}

	private async followRenames(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<void> {
		if (!this.store) return
		for (const { oldUri, newUri } of files) {
			const from = fileVaultIdentity(oldUri)
			const to = fileVaultIdentity(newUri)
			if (from && to) await this.store.movePath(from, to)
			else if (from) await this.store.deletePath(from)
		}
	}

	private async followDeletes(files: readonly vscode.Uri[]): Promise<void> {
		if (!this.store) return
		for (const uri of files) {
			const identity = fileVaultIdentity(uri)
			if (identity) await this.store.deletePath(identity)
		}
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
			await this.cleanup()
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
			await this.cleanup()
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
			await this.cleanup()
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
		await this.cleanup()
		await this.store.appendIfEnabled(identity, entries)
	}

	/** 伏せ字を新しく割り当てる前に、保存済み番号をSession Vaultへ予約する。 */
	async prepare(uri: vscode.Uri, vault: PiiVault): Promise<boolean> {
		const identity = fileVaultIdentity(uri)
		if (!identity || !this.store) return true
		try {
			await this.cleanup()
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
		await this.cleanup()
		const record = await this.store.load(identity)
		return restoreSession(record ? unmaskText(text, new Map(record.entries)) : text)
	}
}
