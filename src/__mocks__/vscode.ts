// 試験のための `vscode` の偽物。
//
// **実物と同じ形だけを持つ。** 実物に無い関数を足すと、拡張ホストでだけ落ちる試験が
// 書けてしまう。足すときは実物の API を確かめてから足す。

import { vi } from "vitest"

export const window = {
	showInformationMessage: vi.fn(async () => undefined),
	showWarningMessage: vi.fn(async () => undefined),
	showErrorMessage: vi.fn(async () => undefined),
	activeTextEditor: undefined as unknown,
	withProgress: vi.fn(async (_options: unknown, task: (progress: unknown) => unknown) =>
		task({ report: () => {} }),
	),
}

export const workspace = {
	getConfiguration: vi.fn(() => ({ get: () => undefined })),
	getWorkspaceFolder: vi.fn(),
	workspaceFolders: undefined as unknown,
	onDidRenameFiles: vi.fn(() => ({ dispose: vi.fn() })),
	onDidDeleteFiles: vi.fn(() => ({ dispose: vi.fn() })),
	asRelativePath: vi.fn((uri: { path?: string; fsPath?: string }) => uri.path ?? uri.fsPath ?? ""),
	openTextDocument: vi.fn(),
	applyEdit: vi.fn(async () => true),
	fs: {
		stat: vi.fn(),
		writeFile: vi.fn(async () => undefined),
		readFile: vi.fn(async () => new Uint8Array()),
		createDirectory: vi.fn(async () => undefined),
		rename: vi.fn(async () => undefined),
		delete: vi.fn(async () => undefined),
	},
}

export const commands = { registerCommand: vi.fn(), executeCommand: vi.fn() }
export const chat = { createChatParticipant: vi.fn() }
export const lm = { selectChatModels: vi.fn(async () => []) }

export class Range {
	constructor(
		public start: unknown,
		public end: unknown,
	) {}
}
export class Position {
	constructor(
		public line: number,
		public character: number,
	) {}
}
export class WorkspaceEdit {
	replace = vi.fn()
}
export class Uri {
	static file = (path: string) => ({ fsPath: path, path })
	static joinPath = (base: { path: string; fsPath?: string }, ...parts: string[]) => {
		const path = [base.path.replace(/\/$/, ""), ...parts].join("/")
		return { path, fsPath: path }
	}
}
export const ProgressLocation = { Notification: 15 }
export class LanguageModelTextPart {
	constructor(public value: string) {}
}
export class LanguageModelToolCallPart {
	constructor(
		public callId: string,
		public name: string,
		public input: object,
	) {}
}
export class LanguageModelToolResultPart {
	constructor(
		public callId: string,
		public content: unknown[],
	) {}
}
export const LanguageModelChatMessage = {
	User: (content: unknown) => ({ role: 1, content }),
	Assistant: (content: unknown) => ({ role: 2, content }),
}
export class MarkdownString {
	value = ""
	appendMarkdown(text: string) {
		this.value += text
		return this
	}
}
