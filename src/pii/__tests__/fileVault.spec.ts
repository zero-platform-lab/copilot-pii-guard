import * as vscode from "vscode"

const mocks = vi.hoisted(() => {
	const files = new Map<string, Uint8Array>()
	const secrets = new Map<string, string>()
	return {
		files,
		secrets,
		activeTextEditor: undefined as unknown,
		workspaceFolder: undefined as unknown,
		workspaceFolders: [] as { index: number; uri: { path: string } }[],
		renameListener: undefined as unknown,
		deleteListener: undefined as unknown,
		showInformationMessage: vi.fn(async (..._args: unknown[]) => undefined as unknown),
		showWarningMessage: vi.fn(async (..._args: unknown[]) => undefined as unknown),
		showErrorMessage: vi.fn(async (..._args: unknown[]) => undefined as unknown),
		showQuickPick: vi.fn(async (..._args: unknown[]) => undefined as unknown),
	}
})

vi.mock("vscode", () => ({
	window: {
		get activeTextEditor() {
			return mocks.activeTextEditor
		},
		showInformationMessage: mocks.showInformationMessage,
		showWarningMessage: mocks.showWarningMessage,
		showErrorMessage: mocks.showErrorMessage,
		showQuickPick: mocks.showQuickPick,
	},
	workspace: {
		getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
		getWorkspaceFolder: () => mocks.workspaceFolder,
		get workspaceFolders() {
			return mocks.workspaceFolders
		},
		onDidRenameFiles(listener: unknown) {
			mocks.renameListener = listener
			return { dispose() {} }
		},
		onDidDeleteFiles(listener: unknown) {
			mocks.deleteListener = listener
			return { dispose() {} }
		},
		asRelativePath: (uri: { path: string }) => uri.path.replace(/^\/w\//, ""),
		fs: {
			async stat(uri: { path: string }) {
				if (uri.path.startsWith("/w/")) return { type: 1 }
				const error = new Error(uri.path)
				error.name = "FileNotFound"
				throw error
			},
			async readFile(uri: { path: string }) {
				const value = mocks.files.get(uri.path)
				if (value) return value
				const error = new Error(uri.path)
				error.name = "FileNotFound"
				throw error
			},
			async writeFile(uri: { path: string }, value: Uint8Array) {
				mocks.files.set(uri.path, Uint8Array.from(value))
			},
			async createDirectory() {},
			async rename(from: { path: string }, to: { path: string }) {
				const value = mocks.files.get(from.path)
				if (!value) throw new Error("missing temporary file")
				mocks.files.set(to.path, value)
				mocks.files.delete(from.path)
			},
			async delete(uri: { path: string }) {
				mocks.files.delete(uri.path)
			},
		},
	},
	Uri: {
		joinPath(base: { path: string }, ...parts: string[]) {
			return { path: [base.path.replace(/\/$/, ""), ...parts].join("/") }
		},
	},
}))

vi.mock("../../messages", () => ({
	t: (key: string, args?: Record<string, unknown>) => (args ? `${key}:${JSON.stringify(args)}` : key),
}))

import { FileVaultController, fileVaultIdentity } from "../fileVault"
import { PiiVault } from "../maskConversation"

const uri = (path: string) => ({ path }) as vscode.Uri
const context = () => ({
	storageUri: uri("/state"),
	secrets: {
		get: async (key: string) => mocks.secrets.get(key),
		store: async (key: string, value: string) => {
			mocks.secrets.set(key, value)
		},
	},
})

beforeEach(() => {
	vi.clearAllMocks()
	mocks.files.clear()
	mocks.secrets.clear()
	mocks.workspaceFolder = { index: 0, uri: uri("/w") }
	mocks.workspaceFolders = [mocks.workspaceFolder as never]
	mocks.renameListener = undefined
	mocks.deleteListener = undefined
	mocks.activeTextEditor = {
		document: { uri: uri("/w/note.md"), getText: () => "連絡先は {{email-005}}" },
	}
})

describe("fileVaultIdentity", () => {
	it("ワークスペース内では相対パスだけを識別情報にする", () => {
		expect(fileVaultIdentity(uri("/w/docs/note.md"))).toBe("0:docs/note.md")
	})

	it("ワークスペース外とワークスペース自体は扱わない", () => {
		expect(fileVaultIdentity(uri("/outside/note.md"))).toBeUndefined()
		expect(fileVaultIdentity(uri("/w"))).toBeUndefined()
	})
})

describe("FileVaultController", () => {
	it("ファイル道具の相対パスから読み、衝突した番号を直す", async () => {
		const stored = new PiiVault()
		stored.importEntries([["{{email-005}}", "alice@corp.example"]])
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.fileVault.enable")
		const controller = new FileVaultController(context())
		await controller.enable(stored)

		const session = new PiiVault()
		session.importEntries([["{{email-005}}", "bob@corp.example"]])
		const remap = await controller.prepareToolPath("note.md", session)

		expect(remap("連絡先は {{email-005}}")).toBe("連絡先は {{email-006}}")
		expect(session.restore("{{email-006}}")).toBe("alice@corp.example")
	})

	it("有効化した対応を次のセッションへ取り込み、復元する", async () => {
		const first = new PiiVault()
		first.importEntries([["{{email-005}}", "alice@corp.example"]])
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.fileVault.enable")

		await new FileVaultController(context()).enable(first)

		const second = new PiiVault()
		const controller = new FileVaultController(context())
		expect(await controller.prepare(uri("/w/note.md"), second)).toBe(true)
		expect(second.restore("{{email-005}}")).toBe("alice@corp.example")
		expect(await controller.restore(uri("/w/note.md"), "{{email-005}}", (text) => text)).toBe(
			"alice@corp.example",
		)
	})

	it("消去すると対象ファイルへの追記を再び有効化しない", async () => {
		const vault = new PiiVault()
		vault.importEntries([["{{email-005}}", "alice@corp.example"]])
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.fileVault.enable")
		const controller = new FileVaultController(context())
		await controller.enable(vault)
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.clearVault")

		await controller.disable()
		await controller.record(uri("/w/note.md"), [["{{email-006}}", "bob@corp.example"]])

		await controller.status()
		expect(mocks.showInformationMessage).toHaveBeenLastCalledWith(
			'common:pii.fileVault.notEnabled:{"file":"note.md"}',
		)
	})

	it("暗号文が壊れていれば伏せ字化を止めて理由を表示する", async () => {
		const vault = new PiiVault()
		vault.importEntries([["{{email-005}}", "alice@corp.example"]])
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.fileVault.enable")
		const controller = new FileVaultController(context())
		await controller.enable(vault)
		mocks.files.set("/state/file-vault.v1.json", new TextEncoder().encode("broken"))

		expect(await controller.prepare(uri("/w/note.md"), new PiiVault())).toBe(false)
		expect(mocks.showErrorMessage).toHaveBeenLastCalledWith("common:pii.fileVault.corrupt")
	})

	it("VS Codeの名前変更と削除通知へ追従する", async () => {
		const vault = new PiiVault()
		vault.importEntries([["{{email-005}}", "alice@corp.example"]])
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.fileVault.enable")
		const controller = new FileVaultController(context())
		await controller.enable(vault)
		controller.start()

		await (mocks.renameListener as (event: unknown) => Promise<void>)({
			files: [{ oldUri: uri("/w/note.md"), newUri: uri("/w/moved.md") }],
		})
		await vi.waitFor(async () => {
			expect(await controller.restore(uri("/w/moved.md"), "{{email-005}}", (text) => text)).toBe(
				"alice@corp.example",
			)
		})

		await (mocks.deleteListener as (event: unknown) => Promise<void>)({ files: [uri("/w/moved.md")] })
		await vi.waitFor(async () => {
			expect(await controller.restore(uri("/w/moved.md"), "{{email-005}}", (text) => text)).toBe(
				"{{email-005}}",
			)
		})
	})

	it("一覧から選んだFile Vaultだけを確認後に消去する", async () => {
		const controller = new FileVaultController(context())
		const first = new PiiVault()
		first.importEntries([["{{email-005}}", "alice@corp.example"]])
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.fileVault.enable")
		await controller.enable(first)

		mocks.activeTextEditor = {
			document: { uri: uri("/w/other.md"), getText: () => "{{email-006}}" },
		}
		const second = new PiiVault()
		second.importEntries([["{{email-006}}", "bob@corp.example"]])
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.fileVault.enable")
		await controller.enable(second)

		mocks.showQuickPick.mockImplementationOnce(async (value: unknown) => {
			const items = value as { label: string }[]
			return items.filter((item) => item.label === "note.md")
		})
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.clearVault")
		await controller.clearSelected()

		expect(await controller.restore(uri("/w/note.md"), "{{email-005}}", (text) => text)).toBe(
			"{{email-005}}",
		)
		expect(await controller.restore(uri("/w/other.md"), "{{email-006}}", (text) => text)).toBe(
			"bob@corp.example",
		)
	})
})
