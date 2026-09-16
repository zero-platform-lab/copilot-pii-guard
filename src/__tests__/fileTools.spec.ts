// npx vitest run src/__tests__/fileTools.spec.ts

import * as vscode from "vscode"

import { FILE_TOOLS, FILE_TOOL_ACCESS, runFileTool, writeRevisionMatches, type FileToolHost } from "../fileTools"
import { TaskPiiMasker } from "../pii/TaskPiiMasker"
import { resetSessionVault } from "../pii/maskConversation"
import { unmaskText } from "../pii/maskText"

vi.mock("../paths", () => ({ getGlobalAgentDirectory: () => "/w/存在しない" }))

const token = { isCancellationRequested: false } as never

function fakeHost(overrides: Partial<FileToolHost> = {}): FileToolHost {
	return {
		listFiles: async () => [],
		searchFiles: async () => [],
		readFile: async () => "",
		writeFile: async () => {},
		confirmWrite: async () => true,
		...overrides,
	}
}

beforeEach(() => resetSessionVault())

/** 偽物の作業場所を差し替える。実物では読み取り専用なので、型を外して書き換える。 */
const setFolders = (value: unknown) => {
	(vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = value
}

describe("道筋の検査（作業場所の外を触らせない）", () => {
	// **モデルが指す道筋をそのまま受ける場所である。** ここが緩いと、作業場所の外の
	// ファイルを読ませたり書かせたりできる。**画面には何も出ない。**
	const folders = (...names: string[]) => {
		setFolders(
			names.map((name, index) => ({ index, name, uri: { path: `/${name}`, fsPath: `/${name}` } })),
		)
	}

	const read = (path: string) =>
		runFileTool("pii_guard_read_file", { path }, new TaskPiiMasker({ enabled: true } as never), {
			restoreWrites: false,
			token,
			// **本物の実装を使う。** 偽物を渡すと、検査そのものを飛ばしてしまう。
		})

	afterEach(() => setFolders(undefined))

	it("作業場所が開かれていなければ、何もしない", async () => {
		setFolders(undefined)

		await expect(read("note.md")).rejects.toThrow("作業場所が開かれていません")
	})

	it.each([
		["絶対パス", "/etc/passwd"],
		["Windows のドライブ", "C:/Windows/system.ini"],
		["区切り文字だけ", "\\"],
	])("%s は断る", async (_name, path) => {
		folders("w")

		await expect(read(path)).rejects.toThrow("相対パス")
	})

	it("空の道筋は、道具の入り口で断る", async () => {
		// 検査へ届く前に、引数の形として弾かれる。どちらで弾いても構わないが、
		// **どこかで必ず弾く**ことを固定しておく。
		folders("w")

		await expect(read("   ")).rejects.toThrow("空でない文字列")
	})

	it.each([
		["遡る", "../外.md"],
		["途中で遡る", "a/../../外.md"],
		["現在位置", "./note.md"],
		["空の区切り", "a//b.md"],
	])("%s 道筋は断る", async (_name, path) => {
		folders("w")

		await expect(read(path)).rejects.toThrow("`.`、`..`、空の区切り")
	})

	it("作業場所が 2 つ以上なら、先頭に名前を求める", async () => {
		// 求めないと、どちらの作業場所のファイルか決められない。黙って片方を選ぶと、
		// 別の作業場所のファイルを読むことになる。
		folders("w", "x")

		await expect(read("note.md")).rejects.toThrow("作業場所名")
	})

	it("作業場所名だけでは、ファイルを指したことにならない", async () => {
		folders("w", "x")

		await expect(read("w")).rejects.toThrow("ファイルの相対パス")
	})
})

describe("PII Guardのファイル道具", () => {
	it("提示する道具と権限グループの定義が一致する", () => {
		expect(FILE_TOOLS.map((tool) => tool.name).sort()).toEqual(Object.keys(FILE_TOOL_ACCESS).sort())
	})

	it("伏せ字化が切なら読取も書込も実行しない", async () => {
		const readFile = vi.fn(async () => "秘密")
		const writeFile = vi.fn(async () => {})
		const masker = new TaskPiiMasker({ enabled: false } as never)

		await expect(
			runFileTool("pii_guard_read_file", { path: "customer.txt" }, masker, {
				restoreWrites: false,
				token,
				host: fakeHost({ readFile, writeFile }),
			}),
		).rejects.toThrow("伏せ字化が切")
		expect(readFile).not.toHaveBeenCalled()
		expect(writeFile).not.toHaveBeenCalled()
	})

	it("読んだ本文は伏せてからモデルへ返す", async () => {
		const masker = new TaskPiiMasker({ enabled: true } as never)
		const result = await runFileTool("pii_guard_read_file", { path: "customer.txt" }, masker, {
			restoreWrites: false,
			token,
			host: fakeHost({ readFile: async () => "連絡先は taro@corp.example" }),
		})

		expect(result).toBe("連絡先は {{email-001}}")
		expect(result).not.toContain("taro@corp.example")
	})

	it("File Vaultの伏せ字衝突を今回のSession Vault番号へ直して返す", async () => {
		const masker = new TaskPiiMasker({ enabled: true } as never)
		await masker.maskPrompt("bob@corp.example") // 今回の {{email-001}}
		const prepareFile = vi.fn(async () => {
			const remapped = masker.allocator.importEntries([["{{email-001}}", "alice@corp.example"]])
			return (text: string) => unmaskText(text, remapped)
		})

		const result = await runFileTool("pii_guard_read_file", { path: "customer.txt" }, masker, {
			restoreWrites: false,
			token,
			prepareFile,
			host: fakeHost({ readFile: async () => "連絡先は {{email-001}}" }),
		})

		expect(prepareFile).toHaveBeenCalledExactlyOnceWith("customer.txt")
		expect(result).toBe("連絡先は {{email-002}}")
		expect(masker.restoreExplicitly(result)).toBe("連絡先は alice@corp.example")
	})

	it("通常モードでは書く本文を伏せ字のままにする", async () => {
		const written: string[] = []
		const masker = new TaskPiiMasker({ enabled: true } as never)
		const host = fakeHost({ writeFile: async (_path, content) => void written.push(content) })

		const result = await runFileTool(
			"pii_guard_write_file",
			{ path: "answer.txt", content: "連絡先は taro@corp.example" },
			masker,
			{ restoreWrites: false, token, host },
		)

		expect(written).toEqual(["連絡先は {{email-001}}"])
		expect(result).toContain("伏せ字のまま変更を適用しました")
		expect(result).toContain("保存してください")
	})

	it("伏せ字のまま書いた対応を対象ファイルのFile Vaultへ渡す", async () => {
		const masker = new TaskPiiMasker({ enabled: true } as never)
		const recordFile = vi.fn(async () => true)

		await runFileTool(
			"pii_guard_write_file",
			{ path: "answer.txt", content: "連絡先は taro@corp.example" },
			masker,
			{ restoreWrites: false, token, recordFile, host: fakeHost() },
		)

		expect(recordFile).toHaveBeenCalledExactlyOnceWith("answer.txt", [
			["{{email-001}}", "taro@corp.example"],
		])
	})

	it("書込成功後にFile Vaultだけ失敗した場合は復元不能になることを返す", async () => {
		const masker = new TaskPiiMasker({ enabled: true } as never)

		const result = await runFileTool(
			"pii_guard_write_file",
			{ path: "answer.txt", content: "連絡先は taro@corp.example" },
			masker,
			{ restoreWrites: false, token, recordFile: async () => false, host: fakeHost() },
		)

		expect(result).toContain("変更を適用しました")
		expect(result).toContain("セッション終了後に復元できません")
	})

	it("Write Restoreモードでは書く直前だけ元の値へ戻す", async () => {
		const written: string[] = []
		const confirmations: boolean[] = []
		const masker = new TaskPiiMasker({ enabled: true } as never)
		const host = fakeHost({
			writeFile: async (_path, content) => void written.push(content),
			confirmWrite: async (_path, restored) => {
				confirmations.push(restored)
				return true
			},
		})

		const result = await runFileTool(
			"pii_guard_write_file",
			{ path: "answer.txt", content: "連絡先は taro@corp.example" },
			masker,
			{ restoreWrites: true, token, host },
		)

		expect(confirmations).toEqual([true])
		expect(written).toEqual(["連絡先は taro@corp.example"])
		// モデルへ返す完了文に、復元した本文そのものは含めない。
		expect(result).toBe(
			"answer.txt へ元の値を復元して変更を適用しました。未保存の場合はVS Codeで保存してください。",
		)
	})

	it("元の値を書いた場合はFile Vaultへ不要な対応を追加しない", async () => {
		const masker = new TaskPiiMasker({ enabled: true } as never)
		const recordFile = vi.fn(async () => true)

		await runFileTool(
			"pii_guard_write_file",
			{ path: "answer.txt", content: "連絡先は taro@corp.example" },
			masker,
			{ restoreWrites: true, token, recordFile, host: fakeHost() },
		)

		expect(recordFile).not.toHaveBeenCalled()
	})

	it("書込前にもFile Vaultを取り込み、衝突した伏せ字を正しく復元する", async () => {
		const written: string[] = []
		const masker = new TaskPiiMasker({ enabled: true } as never)
		await masker.maskPrompt("bob@corp.example")
		const prepareFile = async () => {
			const remapped = masker.allocator.importEntries([["{{email-001}}", "alice@corp.example"]])
			return (text: string) => unmaskText(text, remapped)
		}

		await runFileTool(
			"pii_guard_write_file",
			{ path: "customer.txt", content: "連絡先は {{email-001}}" },
			masker,
			{
				restoreWrites: true,
				token,
				prepareFile,
				host: fakeHost({ writeFile: async (_path, content) => void written.push(content) }),
			},
		)

		expect(written).toEqual(["連絡先は alice@corp.example"])
	})

	it("保存済みと確認できた場合だけディスクへ保存したと返す", async () => {
		const masker = new TaskPiiMasker({ enabled: true } as never)
		const result = await runFileTool(
			"pii_guard_write_file",
			{ path: "answer.txt", content: "本文" },
			masker,
			{
				restoreWrites: false,
				token,
				host: fakeHost({ writeFile: async () => ({ saved: true }) }),
			},
		)

		expect(result).toBe("answer.txt を伏せ字のままディスクへ保存しました。")
	})

	it("空のファイルも書ける", async () => {
		const written: string[] = []
		const masker = new TaskPiiMasker({ enabled: true } as never)

		await runFileTool("pii_guard_write_file", { path: "empty.txt", content: "" }, masker, {
			restoreWrites: false,
			token,
			host: fakeHost({ writeFile: async (_path, content) => void written.push(content) }),
		})

		expect(written).toEqual([""])
	})

	it("確認を断ったら書き込まない", async () => {
		const writeFile = vi.fn(async () => {})
		const masker = new TaskPiiMasker({ enabled: true } as never)

		const result = await runFileTool(
			"pii_guard_write_file",
			{ path: "answer.txt", content: "本文" },
			masker,
			{ restoreWrites: true, token, host: fakeHost({ writeFile, confirmWrite: async () => false }) },
		)

		expect(writeFile).not.toHaveBeenCalled()
		expect(result).toContain("取り消しました")
	})

	it("確認した差分の識別情報を、同じ書込へ渡す", async () => {
		const approval = { revision: { existed: true, version: 3, text: "旧本文" } }
		const confirmWrite = vi.fn(async () => approval)
		const writeFile = vi.fn(async () => {})
		const masker = new TaskPiiMasker({ enabled: true } as never)

		await runFileTool(
			"pii_guard_write_file",
			{ path: "answer.txt", content: "新本文" },
			masker,
			{ restoreWrites: false, token, host: fakeHost({ confirmWrite, writeFile }) },
		)

		expect(confirmWrite).toHaveBeenCalledExactlyOnceWith("answer.txt", false, "新本文")
		expect(writeFile).toHaveBeenCalledExactlyOnceWith("answer.txt", "新本文", approval)
	})

	it("確認後に既存本文・文書版・新規ファイル状態が変わったら競合と判定する", () => {
		const same = { version: 3, getText: () => "旧本文" }
		const revision = { existed: true, version: 3, text: "旧本文", stamp: "10:20" }
		expect(writeRevisionMatches(revision, same as never, "10:20")).toBe(true)
		expect(writeRevisionMatches({ ...revision, version: 2 }, same as never, "10:20")).toBe(false)
		expect(writeRevisionMatches({ ...revision, text: "別本文" }, same as never, "10:20")).toBe(false)
		expect(writeRevisionMatches(revision, same as never, "11:20")).toBe(false)
		expect(writeRevisionMatches({ existed: false }, undefined)).toBe(true)
		expect(writeRevisionMatches({ existed: false }, same as never)).toBe(false)
	})

	it("検索結果も伏せて返す", async () => {
		const masker = new TaskPiiMasker({ enabled: true } as never)
		const result = await runFileTool("pii_guard_search_files", { query: "担当" }, masker, {
			restoreWrites: false,
			token,
			host: fakeHost({
				searchFiles: async () => [{ path: "memo.txt", line: 3, text: "担当 taro@corp.example" }],
			}),
		})

		expect(result).toBe("memo.txt:3: 担当 {{email-001}}")
	})
})
