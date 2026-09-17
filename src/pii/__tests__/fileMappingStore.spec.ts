import * as vscode from "vscode"

import { FileMappingError, FileMappingStore } from "../fileMappingStore"

function memoryFileSystem() {
	const files = new Map<string, Uint8Array>()
	const renames: [string, string][] = []
	return {
		files,
		renames,
		fs: {
			readFile: vi.fn(async (uri: vscode.Uri) => {
				const found = files.get(uri.path)
				if (!found) {
					const error = new Error(uri.path)
					error.name = "FileNotFound"
					throw error
				}
				return found
			}),
			writeFile: vi.fn(async (uri: vscode.Uri, value: Uint8Array) => {
				files.set(uri.path, Uint8Array.from(value))
			}),
			createDirectory: vi.fn(async () => undefined),
			rename: vi.fn(async (from: vscode.Uri, to: vscode.Uri) => {
				const value = files.get(from.path)
				if (!value) throw new Error("missing temporary file")
				files.set(to.path, value)
				files.delete(from.path)
				renames.push([from.path, to.path])
			}),
			delete: vi.fn(async (uri: vscode.Uri) => {
				files.delete(uri.path)
			}),
		},
	}
}

const root = () => vscode.Uri.file("/private/workspace")
const target = "/private/workspace/file-mapping.v1.json"

describe("FileMappingStore", () => {
	it("平文の JSON で残し、.gitignore を置く", async () => {
		const memory = memoryFileSystem()
		const store = new FileMappingStore(root(), memory.fs as never)

		await store.enable("0:docs/customer.md", [["{{email-001}}", "alice@corp.example"]])

		const persisted = Buffer.from(memory.files.get(target) ?? []).toString("utf8")
		// 同じ PII は元のファイルやタスク履歴にも平文である。ここも平文で置く。
		expect(persisted).toContain("alice@corp.example")
		expect(JSON.parse(persisted).formatVersion).toBe(1)
		expect(Buffer.from(memory.files.get("/private/workspace/.gitignore") ?? []).toString("utf8")).toBe("*\n")
		expect(await store.inspect("0:docs/customer.md")).toMatchObject({
			entries: [["{{email-001}}", "alice@corp.example"]],
		})
	})

	it("壊れた JSON を読まず、上書きもしない", async () => {
		const memory = memoryFileSystem()
		const store = new FileMappingStore(root(), memory.fs as never)
		await store.enable("0:a.md", [["{{email-001}}", "alice@corp.example"]])
		memory.files.set(target, Buffer.from("これは JSON ではない"))
		const before = memory.files.get(target)

		await expect(store.enable("0:b.md")).rejects.toMatchObject({
			code: "corrupt",
		} satisfies Partial<FileMappingError>)
		expect(memory.files.get(target)).toEqual(before)
	})

	it("同時更新を直列化して両方の対応を残す", async () => {
		const memory = memoryFileSystem()
		const store = new FileMappingStore(root(), memory.fs as never)
		await store.enable("0:a.md")

		await Promise.all([
			store.appendIfEnabled("0:a.md", [["{{email-001}}", "alice@corp.example"]]),
			store.appendIfEnabled("0:a.md", [["{{email-002}}", "bob@corp.example"]]),
		])

		expect((await store.inspect("0:a.md"))?.entries).toEqual([
			["{{email-001}}", "alice@corp.example"],
			["{{email-002}}", "bob@corp.example"],
		])
	})

	it("指定ファイルだけを消去して永続化を無効にする", async () => {
		const memory = memoryFileSystem()
		const store = new FileMappingStore(root(), memory.fs as never)
		await store.enable("0:a.md", [["{{email-001}}", "alice@corp.example"]])
		await store.enable("0:b.md", [["{{email-002}}", "bob@corp.example"]])

		expect(await store.delete("0:a.md")).toBe(1)
		expect(await store.inspect("0:a.md")).toBeUndefined()
		expect(await store.inspect("0:b.md")).toBeDefined()
		expect(await store.appendIfEnabled("0:a.md", [["{{email-003}}", "new@corp.example"]])).toBe(false)
	})

	it("ディレクトリ移動では配下だけを新しい関連付けへ移す", async () => {
		const memory = memoryFileSystem()
		const store = new FileMappingStore(root(), memory.fs as never)
		await store.enable("0:old/a.md", [["{{email-001}}", "alice@corp.example"]])
		await store.enable("0:old/nested/b.md", [["{{email-002}}", "bob@corp.example"]])
		await store.enable("0:other.md", [["{{email-003}}", "carol@corp.example"]])

		expect(await store.movePath("0:old", "0:new")).toBe(2)
		expect(await store.inspect("0:old/a.md")).toBeUndefined()
		expect(await store.inspect("0:new/a.md")).toBeDefined()
		expect(await store.inspect("0:new/nested/b.md")).toBeDefined()
		expect(await store.inspect("0:other.md")).toBeDefined()
	})

	it("ディレクトリ削除では配下だけを消去する", async () => {
		const memory = memoryFileSystem()
		const store = new FileMappingStore(root(), memory.fs as never)
		await store.enable("0:old/a.md", [["{{email-001}}", "alice@corp.example"]])
		await store.enable("0:old/b.md", [["{{email-002}}", "bob@corp.example"]])
		await store.enable("0:other.md", [["{{email-003}}", "carol@corp.example"]])

		expect(await store.deletePath("0:old")).toEqual({ files: 2, entries: 2 })
		expect(await store.inspect("0:old/a.md")).toBeUndefined()
		expect(await store.inspect("0:other.md")).toBeDefined()
	})

	it("最終利用から保持日数が経過した対応だけを消去する", async () => {
		const memory = memoryFileSystem()
		let current = new Date("2026-01-01T00:00:00.000Z")
		const store = new FileMappingStore(root(), memory.fs as never, () => current)
		await store.enable("0:expired.md")
		current = new Date("2026-01-20T00:00:00.000Z")
		await store.enable("0:current.md")
		current = new Date("2026-02-01T00:00:00.000Z")

		expect(await store.prune(30, async () => true)).toEqual({
			expired: 1,
			missing: 0,
		})
		expect(await store.inspect("0:expired.md")).toBeUndefined()
		expect(await store.inspect("0:current.md")).toBeDefined()
	})

	it("0日では期限削除せず、消失確認済みだけを消去する", async () => {
		const memory = memoryFileSystem()
		let current = new Date("2020-01-01T00:00:00.000Z")
		const store = new FileMappingStore(root(), memory.fs as never, () => current)
		await store.enable("0:exists.md")
		await store.enable("0:missing.md")
		await store.enable("0:unknown.md")
		current = new Date("2030-01-01T00:00:00.000Z")

		const result = await store.prune(0, async (identity) => {
			if (identity === "0:missing.md") return false
			if (identity === "0:unknown.md") return undefined
			return true
		})

		expect(result).toEqual({ expired: 0, missing: 1 })
		expect(await store.inspect("0:exists.md")).toBeDefined()
		expect(await store.inspect("0:missing.md")).toBeUndefined()
		expect(await store.inspect("0:unknown.md")).toBeDefined()
	})

	it("選んだ複数ファイルだけを1回の更新で消去する", async () => {
		const memory = memoryFileSystem()
		const store = new FileMappingStore(root(), memory.fs as never)
		await store.enable("0:a.md", [["{{email-001}}", "a@corp.example"]])
		await store.enable("0:b.md", [["{{email-002}}", "b@corp.example"]])
		await store.enable("0:c.md", [["{{email-003}}", "c@corp.example"]])

		expect(await store.deleteMany(["0:a.md", "0:c.md"])).toEqual({
			files: 2,
			entries: 2,
		})
		expect(await store.inspect("0:a.md")).toBeUndefined()
		expect(await store.inspect("0:b.md")).toBeDefined()
		expect(await store.inspect("0:c.md")).toBeUndefined()
	})

	it("ファイル数と1ファイルの対応数の上限を越えて既存データを上書きしない", async () => {
		const memory = memoryFileSystem()
		let limits = { maxFiles: 1, maxEntriesPerFile: 2, maxBytes: 100_000 }
		const store = new FileMappingStore(root(), memory.fs as never, undefined, () => limits)
		await store.enable("0:a.md", [["{{email-001}}", "a@corp.example"]])
		const beforeFileLimit = memory.files.get(target)

		await expect(store.enable("0:b.md")).rejects.toMatchObject({
			code: "maxFiles",
		})
		expect(memory.files.get(target)).toEqual(beforeFileLimit)

		limits = { ...limits, maxFiles: 2 }
		await store.appendIfEnabled("0:a.md", [["{{email-002}}", "b@corp.example"]])
		const beforeEntryLimit = memory.files.get(target)
		await expect(store.appendIfEnabled("0:a.md", [["{{email-003}}", "c@corp.example"]])).rejects.toMatchObject({
			code: "maxEntries",
		})
		expect(memory.files.get(target)).toEqual(beforeEntryLimit)
	})

	it("全体容量の上限を越えて既存データを上書きしない", async () => {
		const memory = memoryFileSystem()
		const store = new FileMappingStore(root(), memory.fs as never, undefined, () => ({
			maxFiles: 10,
			maxEntriesPerFile: 10,
			maxBytes: 200,
		}))

		await expect(store.enable("0:a.md", [["{{email-001}}", "a".repeat(300)]])).rejects.toMatchObject({
			code: "maxBytes",
		})
		expect(memory.files.has(target)).toBe(false)
	})

	it("上限が0ならファイル数・対応数・全体容量を制限しない", async () => {
		const memory = memoryFileSystem()
		const store = new FileMappingStore(root(), memory.fs as never, undefined, () => ({
			maxFiles: 0,
			maxEntriesPerFile: 0,
			maxBytes: 0,
		}))

		await store.enable("0:a.md", [
			["{{email-001}}", "a".repeat(300)],
			["{{email-002}}", "b".repeat(300)],
		])
		await store.enable("0:b.md", [["{{email-003}}", "c".repeat(300)]])

		expect((await store.inspect("0:a.md"))?.entries).toHaveLength(2)
		expect(await store.inspect("0:b.md")).toBeDefined()
	})
})
