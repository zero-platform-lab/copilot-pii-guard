// npx vitest run src/__tests__/fileTools.spec.ts

import { FILE_TOOLS, FILE_TOOL_ACCESS, runFileTool, type FileToolHost } from "../fileTools"
import { TaskPiiMasker } from "../pii/TaskPiiMasker"
import { resetSessionVault } from "../pii/maskConversation"

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
