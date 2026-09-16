// `@mask` からだけ使う、作業場所内のファイル道具。
//
// **外部の道具をそのまま渡さない。** 道具の出力にはファイル本文が入り、生の値をモデルへ
// 戻し得る。ここで管理する道具だけを公開し、読み取り結果は必ず伏せてから返す。
//
// **書く内容は既定で戻さない。** モデルが知っているのは伏せ字なので、そのまま書けば
// ファイルにも生の値は出ない。Write Restore モードが入のときだけ、書く直前にローカルで
// 戻す。戻した本文はモデルへ送り返さない。

import * as vscode from "vscode"

import type { TaskPiiMasker } from "./pii/TaskPiiMasker"

const DEFAULT_GLOB = "**/*"
const DEFAULT_RESULTS = 50
const MAX_RESULTS = 200
const MAX_READ_BYTES = 2 * 1024 * 1024

/** 提示と実行の両方で使う正準の権限グループ。未登録の名前は許可しない。 */
export const FILE_TOOL_ACCESS = {
	pii_guard_list_files: "read",
	pii_guard_search_files: "read",
	pii_guard_read_file: "read",
	pii_guard_write_file: "write",
} as const

export function fileToolAccess(name: string): "read" | "write" | undefined {
	return FILE_TOOL_ACCESS[name as keyof typeof FILE_TOOL_ACCESS]
}

export const FILE_TOOLS: readonly vscode.LanguageModelChatTool[] = [
	{
		name: "pii_guard_list_files",
		description: "開いている作業場所のファイル名を一覧にする。結果はPII Guardが伏せてから返す。",
		inputSchema: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "glob。省略時は **/*" },
				maxResults: { type: "integer", minimum: 1, maximum: MAX_RESULTS },
			},
			additionalProperties: false,
		},
	},
	{
		name: "pii_guard_search_files",
		description: "作業場所のテキストファイルを文字列で検索する。結果はPII Guardが伏せてから返す。",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "探す文字列。大文字と小文字は区別しない。" },
				pattern: { type: "string", description: "対象ファイルのglob。省略時は **/*" },
				maxResults: { type: "integer", minimum: 1, maximum: MAX_RESULTS },
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
	{
		name: "pii_guard_read_file",
		description: "作業場所内のテキストファイルを読む。本文はPII Guardが伏せてからモデルへ返す。",
		inputSchema: {
			type: "object",
			properties: { path: { type: "string", description: "作業場所からの相対パス" } },
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "pii_guard_write_file",
		description: "作業場所内のファイルを作成または置換する。既定では伏せ字のまま書き、実行前に確認する。",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "作業場所からの相対パス" },
				content: { type: "string", description: "ファイルへ書く完全な内容" },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
	},
]

export type FileSearchMatch = { path: string; line: number; text: string }
export type FileWriteResult = { saved: boolean }

/** VS Codeへの入出力を試験で差し替えるための細い境界。 */
export type FileToolHost = {
	listFiles: (pattern: string, maxResults: number, token: vscode.CancellationToken) => Promise<string[]>
	searchFiles: (
		query: string,
		pattern: string,
		maxResults: number,
		token: vscode.CancellationToken,
	) => Promise<FileSearchMatch[]>
	readFile: (path: string) => Promise<string>
	writeFile: (path: string, content: string) => Promise<FileWriteResult | void>
	confirmWrite: (path: string, restored: boolean) => Promise<boolean>
}

function stringInput(input: object, key: string, required = true): string {
	const value = (input as Record<string, unknown>)[key]
	if (typeof value === "string" && value.trim()) return value
	if (!required && value === undefined) return ""
	throw new Error(`${key} は空でない文字列で指定してください。`)
}

function resultLimit(input: object): number {
	const value = (input as Record<string, unknown>).maxResults
	if (value === undefined) return DEFAULT_RESULTS
	if (!Number.isInteger(value) || Number(value) < 1) throw new Error("maxResults は1以上の整数で指定してください。")
	return Math.min(Number(value), MAX_RESULTS)
}

/** モデルが返した道具呼び出しを実行し、モデルへ返してよい伏せた文字列を作る。 */
export async function runFileTool(
	name: string,
	input: object,
	masker: TaskPiiMasker,
	options: {
		restoreWrites: boolean
		token: vscode.CancellationToken
		host?: FileToolHost
		/** File VaultをSession Vaultへ取り込み、保存済み伏せ字を今回の番号へ直す。 */
		prepareFile?: (path: string) => Promise<(text: string) => string>
	},
): Promise<string> {
	// 呼び出し側の提示制御だけに頼らない。モデルが名前を直接返しても、生の結果を扱わない。
	if (!masker.enabled) throw new Error("伏せ字化が切のため、ファイル道具は使えません。")

	const host = options.host ?? defaultFileToolHost
	let result: string

	if (name === "pii_guard_list_files") {
		const pattern = masker.restoreExplicitly(stringInput(input, "pattern", false) || DEFAULT_GLOB)
		const files = await host.listFiles(pattern, resultLimit(input), options.token)
		result = files.length ? files.join("\n") : "該当するファイルはありません。"
	} else if (name === "pii_guard_search_files") {
		const query = masker.restoreExplicitly(stringInput(input, "query"))
		const pattern = masker.restoreExplicitly(stringInput(input, "pattern", false) || DEFAULT_GLOB)
		const matches = await host.searchFiles(query, pattern, resultLimit(input), options.token)
		const prepared = new Map<string, (text: string) => string>()
		const lines: string[] = []
		for (const match of matches) {
			let remap = prepared.get(match.path)
			if (!remap) {
				remap = (await options.prepareFile?.(match.path)) ?? ((text) => text)
				prepared.set(match.path, remap)
			}
			lines.push(`${match.path}:${match.line}: ${remap(match.text)}`)
		}
		result = lines.length ? lines.join("\n") : "一致する箇所はありません。"
	} else if (name === "pii_guard_read_file") {
		const path = masker.restoreExplicitly(stringInput(input, "path"))
		const content = await host.readFile(path)
		const remap = await options.prepareFile?.(path)
		result = remap ? remap(content) : content
	} else if (name === "pii_guard_write_file") {
		const path = masker.restoreExplicitly(stringInput(input, "path"))
		const rawContent = (input as Record<string, unknown>).content
		if (typeof rawContent !== "string") throw new Error("content は文字列で指定してください。")
		let content = rawContent
		const remap = await options.prepareFile?.(path)
		if (remap) content = remap(content)
		const safeContent = (await masker.maskPrompt(content)).text
		const written = options.restoreWrites ? masker.restoreExplicitly(safeContent) : safeContent

		if (!(await host.confirmWrite(path, options.restoreWrites))) return "利用者がファイルの書き込みを取り消しました。"
		const writeResult = await host.writeFile(path, written)
		const contentMode = options.restoreWrites ? "元の値を復元して" : "伏せ字のまま"
		result = writeResult?.saved
			? `${path} を${contentMode}ディスクへ保存しました。`
			: `${path} へ${contentMode}変更を適用しました。未保存の場合はVS Codeで保存してください。`
	} else {
		throw new Error(`利用できない道具です: ${name}`)
	}

	// ファイル名、検索結果、エラーでない完了文にも辞書の語が入り得る。道具の返り値は
	// 例外なくもう一度伏せてからモデルへ戻す。
	return (await masker.maskPrompt(result)).text
}

async function workspaceFile(path: string, allowMissingFile = false): Promise<vscode.Uri> {
	const folders = vscode.workspace.workspaceFolders ?? []
	if (folders.length === 0) throw new Error("作業場所が開かれていません。")

	const normalized = path.trim().replace(/\\/g, "/")
	if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
		throw new Error("作業場所からの相対パスを指定してください。")
	}
	const parts = normalized.split("/")
	if (parts.some((part) => !part || part === "." || part === "..")) {
		throw new Error("`.`、`..`、空の区切りを含むパスは指定できません。")
	}

	let folder = folders[0]
	if (folders.length > 1) {
		folder = folders.find((candidate) => candidate.name === parts[0]) ?? folder
		if (folder.name !== parts[0]) throw new Error("複数の作業場所では、先頭に作業場所名を指定してください。")
		parts.shift()
		if (parts.length === 0) throw new Error("ファイルの相対パスを指定してください。")
	}

	// 作業場所内のリンクが外を指している場合、文字列の `..` 検査だけでは抜けられる。
	// 最後の新規ファイル以外は各階層を調べ、シンボリックリンクを通さない。
	let current = folder.uri
	for (const [index, part] of parts.entries()) {
		current = vscode.Uri.joinPath(current, part)
		let stat: vscode.FileStat
		try {
			stat = await vscode.workspace.fs.stat(current)
		} catch (error) {
			if (allowMissingFile && index === parts.length - 1) continue
			throw error
		}
		if ((stat.type & vscode.FileType.SymbolicLink) !== 0) {
			throw new Error(`シンボリックリンクは扱えません: ${path}`)
		}
	}
	return current
}

function relativePath(uri: vscode.Uri): string {
	return vscode.workspace.asRelativePath(uri, (vscode.workspace.workspaceFolders?.length ?? 0) > 1)
}

async function textFromFile(uri: vscode.Uri): Promise<string> {
	const bytes = await vscode.workspace.fs.readFile(uri)
	if (bytes.byteLength > MAX_READ_BYTES) throw new Error(`2 MiBを超えるため読めません: ${relativePath(uri)}`)
	if (bytes.includes(0)) throw new Error(`テキストファイルではありません: ${relativePath(uri)}`)
	return new TextDecoder().decode(bytes)
}

const defaultFileToolHost: FileToolHost = {
	async listFiles(pattern, maxResults, token) {
		const files = await vscode.workspace.findFiles(pattern, "**/{node_modules,.git}/**", maxResults, token)
		return files.map(relativePath)
	},

	async searchFiles(query, pattern, maxResults, token) {
		const files = await vscode.workspace.findFiles(pattern, "**/{node_modules,.git}/**", MAX_RESULTS, token)
		const wanted = query.toLocaleLowerCase()
		const matches: FileSearchMatch[] = []
		for (const uri of files) {
			if (token.isCancellationRequested) break
			let text: string
			try {
				text = await textFromFile(uri)
			} catch {
				continue
			}
			for (const [index, line] of text.split(/\r?\n/).entries()) {
				if (!line.toLocaleLowerCase().includes(wanted)) continue
				matches.push({ path: relativePath(uri), line: index + 1, text: line })
				if (matches.length >= maxResults) return matches
			}
		}
		return matches
	},

	async readFile(path) {
		return textFromFile(await workspaceFile(path))
	},

	async writeFile(path, content) {
		const uri = await workspaceFile(path, true)
		const edit = new vscode.WorkspaceEdit()
		let document: vscode.TextDocument | undefined
		try {
			document = await vscode.workspace.openTextDocument(uri)
			const end = document.positionAt(document.getText().length)
			edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), end), content)
		} catch {
			edit.createFile(uri, { overwrite: false })
			edit.insert(uri, new vscode.Position(0, 0), content)
		}
		if (!(await vscode.workspace.applyEdit(edit))) throw new Error(`書き込めませんでした: ${path}`)
		document ??= await vscode.workspace.openTextDocument(uri)
		return { saved: !document.isDirty }
	},

	async confirmWrite(path, restored) {
		const mode = restored ? "元の値へ復元して" : "伏せ字のまま"
		const choice = await vscode.window.showWarningMessage(
			`権限: confirmEdit。${path} へ${mode}書き込みます。既存の内容は置き換えられます。`,
			{ modal: true },
			"書き込む",
		)
		return choice === "書き込む"
	},
}
