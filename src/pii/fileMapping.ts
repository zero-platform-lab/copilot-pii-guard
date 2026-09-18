import { createHash } from "node:crypto"
import * as path from "node:path"

import * as vscode from "vscode"

import { t } from "../messages"

import {
	DEFAULT_FILE_MAPPING_LIMITS,
	FileMappingError,
	FileMappingStore,
	type FileMappingEntry,
	type FileMappingLimits,
} from "./fileMappingStore"
import { PiiMapping, PiiMappingLimitError } from "./maskConversation"
import { unmaskText } from "./maskText"

type FileTarget = {
	identity: string
	label: string
	uri: vscode.Uri
	text: string
}

const DEFAULT_RETENTION_DAYS = 30

export function fileMappingIdentity(uri: vscode.Uri): string | undefined {
	const folder = vscode.workspace.getWorkspaceFolder(uri)
	if (!folder) return undefined
	const relative = path.posix.relative(folder.uri.path, uri.path)
	if (!relative || relative === ".." || relative.startsWith("../")) return undefined
	return `${folder.index}:${relative}`
}

function errorMessage(error: unknown): string {
	if (error instanceof PiiMappingLimitError) return t("common:pii.sessionMapping.maxEntries")
	if (error instanceof FileMappingError) return t(`common:pii.fileMapping.${error.code}`)
	return t("common:pii.fileMapping.failed")
}

function isNotFound(error: unknown): boolean {
	return error instanceof Error && /FileNotFound|EntryNotFound/i.test(error.name)
}

function retentionDays(): number {
	const value = vscode.workspace
		.getConfiguration("piiGuard")
		.get<number>("fileMapping.retentionDays", DEFAULT_RETENTION_DAYS)
	return Number.isInteger(value) && value >= 0 ? value : DEFAULT_RETENTION_DAYS
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback
}

function fileMappingLimits(): FileMappingLimits {
	const config = vscode.workspace.getConfiguration("piiGuard")
	return {
		maxFiles: nonNegativeInteger(config.get("fileMapping.maxFiles"), DEFAULT_FILE_MAPPING_LIMITS.maxFiles),
		maxEntriesPerFile: nonNegativeInteger(
			config.get("fileMapping.maxEntriesPerFile"),
			DEFAULT_FILE_MAPPING_LIMITS.maxEntriesPerFile,
		),
		maxBytes: nonNegativeInteger(config.get("fileMapping.maxBytes"), DEFAULT_FILE_MAPPING_LIMITS.maxBytes),
	}
}

function mappingRootSetting(): string {
	const value = vscode.workspace.getConfiguration("piiGuard").get<string>("fileMapping.root", "")
	return typeof value === "string" ? value.trim() : ""
}

function hasWorkspace(): boolean {
	return (vscode.workspace.workspaceFolders?.length ?? 0) > 0 || vscode.workspace.workspaceFile !== undefined
}

/** ルート配下でワークスペースごとに区画を分ける鍵。同じルートを複数ワークスペースで共有しても衝突しない。 */
function workspaceKey(): string {
	const identity = vscode.workspace.workspaceFile?.path ?? vscode.workspace.workspaceFolders?.[0]?.uri.path ?? ""
	return createHash("sha256").update(identity).digest("hex").slice(0, 16)
}

/** ルートがワークスペースフォルダの中を指すか。中だとエージェントが読み取ってLLMへ送る恐れがある。 */
function rootInsideWorkspace(target: vscode.Uri): boolean {
	return (vscode.workspace.workspaceFolders ?? []).some((folder) => {
		const base = folder.uri.path
		return target.path === base || target.path.startsWith(base.endsWith("/") ? base : `${base}/`)
	})
}

type MappingRootWarning = "rootInsideWorkspace" | "rootNotAbsolute"

/**
 * 保管ルートを決める。設定が空、またはワークスペースが無ければ拡張機能専用領域（`storageUri`）。
 * 絶対パスならその下にワークスペースごとの区画を作る。相対パスは使わず既定へ戻して警告する。
 */
function resolveMappingRoot(storageUri: vscode.Uri | undefined): {
	root: vscode.Uri | undefined
	warning?: MappingRootWarning
} {
	const setting = mappingRootSetting()
	if (!setting || !hasWorkspace()) return { root: storageUri }
	if (!path.isAbsolute(setting)) return { root: storageUri, warning: "rootNotAbsolute" }
	const base = vscode.Uri.file(setting)
	const warning = rootInsideWorkspace(base) ? "rootInsideWorkspace" : undefined
	return { root: vscode.Uri.joinPath(base, workspaceKey()), warning }
}

function uriForIdentity(identity: string): vscode.Uri | undefined {
	const match = /^(\d+):(.+)$/.exec(identity)
	if (!match) return undefined
	const folder = vscode.workspace.workspaceFolders?.[Number(match[1])]
	return folder ? vscode.Uri.joinPath(folder.uri, ...match[2].split("/")) : undefined
}

function uriForToolPath(value: string): vscode.Uri | undefined {
	const folders = vscode.workspace.workspaceFolders ?? []
	const parts = value.trim().replace(/\\/g, "/").split("/")
	if (folders.length === 0 || parts.some((part) => !part || part === "." || part === "..")) return undefined
	let folder = folders[0]
	if (folders.length > 1) {
		folder = folders.find((candidate) => candidate.name === parts[0]) ?? folder
		if (folder.name !== parts[0]) return undefined
		parts.shift()
	}
	return vscode.Uri.joinPath(folder.uri, ...parts)
}

function labelForIdentity(identity: string): string {
	const match = /^(\d+):(.+)$/.exec(identity)
	if (!match) return identity
	const folders = vscode.workspace.workspaceFolders ?? []
	const folder = folders[Number(match[1])]
	return folders.length > 1 && folder ? `${folder.name}/${match[2]}` : match[2]
}

/** 利用者操作と平文ストアの境界。モデルからは呼ばない。 */
export class FileMappingController {
	private readonly store: FileMappingStore | undefined
	/** 保管ルートの設定に問題があれば、`start()` で一度だけ知らせる語。 */
	private readonly rootWarning: MappingRootWarning | undefined
	/** 対応表の保管ルート。この配下はエージェントのファイルツールから隠す。 */
	private readonly root: vscode.Uri | undefined

	constructor(context: Pick<vscode.ExtensionContext, "storageUri">) {
		const resolved = resolveMappingRoot(context.storageUri)
		this.rootWarning = resolved.warning
		this.root = resolved.root
		this.store = resolved.root
			? new FileMappingStore(resolved.root, undefined, undefined, fileMappingLimits)
			: undefined
	}

	/** 対応表の保管ルート。ファイルツールの除外に使う。 */
	get storageRoot(): vscode.Uri | undefined {
		return this.root
	}

	/** 起動時の掃除と、VS Codeが通知する移動・削除への追従を開始する。 */
	start(): vscode.Disposable[] {
		if (this.rootWarning) {
			void vscode.window.showWarningMessage(t(`common:pii.fileMapping.${this.rootWarning}`))
		}
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
			const from = fileMappingIdentity(oldUri)
			const to = fileMappingIdentity(newUri)
			if (from && to) await this.store.movePath(from, to)
			else if (from) await this.store.deletePath(from)
		}
	}

	private async followDeletes(files: readonly vscode.Uri[]): Promise<void> {
		if (!this.store) return
		for (const uri of files) {
			const identity = fileMappingIdentity(uri)
			if (identity) await this.store.deletePath(identity)
		}
	}

	private activeTarget(): FileTarget | undefined {
		const document = vscode.window.activeTextEditor?.document
		if (!document) return undefined
		const uri = document.uri
		const identity = fileMappingIdentity(uri)
		if (!identity) return undefined
		return {
			identity,
			label: vscode.workspace.asRelativePath(uri, true),
			uri,
			text: document.getText(),
		}
	}

	private async requireTarget(): Promise<FileTarget | undefined> {
		const target = this.activeTarget()
		if (!vscode.window.activeTextEditor) {
			await vscode.window.showInformationMessage(t("common:pii.noEditor"))
			return undefined
		}
		if (!target || !this.store) {
			await vscode.window.showWarningMessage(t("common:pii.fileMapping.workspaceRequired"))
			return undefined
		}
		return target
	}

	async enable(mapping: PiiMapping): Promise<void> {
		const target = await this.requireTarget()
		if (!target || !this.store) return
		try {
			await this.cleanup()
			const existing = await this.store.inspect(target.identity)
			if (existing) {
				mapping.importEntries(existing.entries)
				await vscode.window.showInformationMessage(
					t("common:pii.fileMapping.alreadyEnabled", {
						file: target.label,
						count: existing.entries.length,
					}),
				)
				return
			}
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
			return
		}
		const entries = [...mapping.entries].filter(([placeholder]) => target.text.includes(placeholder))
		const confirm = t("common:pii.fileMapping.enable")
		const answer = await vscode.window.showWarningMessage(
			t("common:pii.fileMapping.confirmEnable", {
				file: target.label,
				count: entries.length,
			}),
			{ modal: true },
			confirm,
		)
		if (answer !== confirm) return

		try {
			const record = await this.store.enable(target.identity, entries)
			await vscode.window.showInformationMessage(
				t("common:pii.fileMapping.enabled", {
					file: target.label,
					count: record.entries.length,
				}),
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
				await vscode.window.showInformationMessage(t("common:pii.fileMapping.notEnabled", { file: target.label }))
				return
			}
			const confirm = t("common:pii.clearMapping")
			const answer = await vscode.window.showWarningMessage(
				t("common:pii.fileMapping.confirmDisable", {
					file: target.label,
					count: record.entries.length,
				}),
				{ modal: true },
				confirm,
			)
			if (answer !== confirm) return
			await this.store.delete(target.identity)
			await vscode.window.showInformationMessage(t("common:pii.fileMapping.disabled", { file: target.label }))
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
					? t("common:pii.fileMapping.statusEnabled", {
							file: target.label,
							count: record.entries.length,
						})
					: t("common:pii.fileMapping.notEnabled", { file: target.label }),
			)
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
		}
	}

	async clearSelected(): Promise<void> {
		if (!this.store) {
			await vscode.window.showWarningMessage(t("common:pii.fileMapping.workspaceRequired"))
			return
		}
		try {
			await this.cleanup()
			const records = await this.store.list()
			if (records.length === 0) {
				await vscode.window.showInformationMessage(t("common:pii.fileMapping.none"))
				return
			}
			const items = records.map((record) => ({
				label: labelForIdentity(record.identity),
				description: t("common:pii.fileMapping.entryCount", {
					count: record.entries.length,
				}),
				identity: record.identity,
				count: record.entries.length,
			}))
			const selected = await vscode.window.showQuickPick(items, {
				canPickMany: true,
				placeHolder: t("common:pii.fileMapping.pickClear"),
			})
			if (!selected || selected.length === 0) return
			await this.confirmAndDelete(selected)
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
		}
	}

	async clearAll(mapping?: PiiMapping): Promise<void> {
		if (!this.store) {
			await vscode.window.showWarningMessage(t("common:pii.fileMapping.workspaceRequired"))
			return
		}
		try {
			await this.cleanup()
			const records = await this.store.list()
			if (records.length === 0 && (!mapping || mapping.size === 0)) {
				await vscode.window.showInformationMessage(t("common:pii.fileMapping.none"))
				return
			}
			const fileEntries = records.reduce((sum, record) => sum + record.entries.length, 0)
			const sessionEntries = mapping?.size ?? 0
			const confirm = t("common:pii.clearMapping")
			const answer = await vscode.window.showWarningMessage(
				t("common:pii.fileMapping.confirmClearAll", {
					files: records.length,
					fileCount: fileEntries,
					sessionCount: sessionEntries,
				}),
				{ modal: true },
				confirm,
			)
			if (answer !== confirm) return
			const removed = await this.store.deleteMany(records.map((record) => record.identity))
			const clearedSession = mapping?.clearSnapshot([...mapping.entries.keys()]) ?? 0
			await vscode.window.showInformationMessage(
				t("common:pii.fileMapping.clearedAll", {
					files: removed.files,
					fileCount: removed.entries,
					sessionCount: clearedSession,
				}),
			)
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
		}
	}

	private async confirmAndDelete(selected: readonly { identity: string; count: number }[]): Promise<void> {
		if (!this.store) return
		const entries = selected.reduce((sum, item) => sum + item.count, 0)
		const confirm = t("common:pii.clearMapping")
		const answer = await vscode.window.showWarningMessage(
			t("common:pii.fileMapping.confirmClearMany", {
				files: selected.length,
				count: entries,
			}),
			{ modal: true },
			confirm,
		)
		if (answer !== confirm) return
		const removed = await this.store.deleteMany(selected.map((item) => item.identity))
		await vscode.window.showInformationMessage(
			t("common:pii.fileMapping.clearedMany", {
				files: removed.files,
				count: removed.entries,
			}),
		)
	}

	async record(uri: vscode.Uri, entries: readonly FileMappingEntry[]): Promise<boolean> {
		const identity = fileMappingIdentity(uri)
		if (!identity || !this.store) return true
		try {
			await this.cleanup()
			await this.store.appendIfEnabled(identity, entries)
			return true
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
			return false
		}
	}

	async recordToolPath(path: string, entries: readonly FileMappingEntry[]): Promise<boolean> {
		const uri = uriForToolPath(path)
		return uri ? this.record(uri, entries) : true
	}

	/** 伏せ字を新しく割り当てる前に、保存済み番号をセッション対応表へ予約する。 */
	async prepare(uri: vscode.Uri, mapping: PiiMapping): Promise<boolean> {
		const identity = fileMappingIdentity(uri)
		if (!identity || !this.store) return true
		try {
			await this.cleanup()
			const record = await this.store.load(identity)
			if (record) mapping.importEntries(record.entries)
			return true
		} catch (error) {
			await vscode.window.showErrorMessage(errorMessage(error))
			return false
		}
	}

	/** ファイル道具向け。衝突した保存済み伏せ字を今回の番号へ置き換える関数を返す。 */
	async prepareToolPath(path: string, mapping: PiiMapping): Promise<(text: string) => string> {
		const uri = uriForToolPath(path)
		return uri ? this.prepareReference(uri, mapping) : (text) => text
	}

	/** 添付ファイルや選択範囲向け。保存済み対応を取り込み、番号衝突を置き換える。 */
	async prepareReference(uri: vscode.Uri, mapping: PiiMapping): Promise<(text: string) => string> {
		const identity = fileMappingIdentity(uri)
		if (!identity || !this.store) return (text) => text
		await this.cleanup()
		const record = await this.store.load(identity)
		if (!record) return (text) => text
		const remapped = mapping.importEntries(record.entries)
		return (text) => unmaskText(text, remapped)
	}

	async restore(uri: vscode.Uri, text: string, restoreSession: (text: string) => string): Promise<string> {
		const identity = fileMappingIdentity(uri)
		if (!identity || !this.store) return restoreSession(text)
		await this.cleanup()
		const record = await this.store.load(identity)
		return restoreSession(record ? unmaskText(text, new Map(record.entries)) : text)
	}
}
