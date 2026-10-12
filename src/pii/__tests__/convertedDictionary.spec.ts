// npx vitest run src/pii/__tests__/convertedDictionary.spec.ts
//
// 変換した値を、辞書として書き出す。
//
// **書き出した辞書を読み戻すと、元の語を同じように伏せること**が要点である。書式の都合で
// 別の意味に読まれる値（`#` で始まる、`/…/`、前後の空白）があると、伏せたつもりの語が
// 素通りするか、関係の無い語を伏せる。

import * as os from "os"
import * as path from "path"
import { promises as fs } from "fs"

const mocks = vi.hoisted(() => ({
	showInformationMessage: vi.fn(async (..._args: unknown[]) => undefined as unknown),
	showWarningMessage: vi.fn(async (..._args: unknown[]) => undefined as unknown),
	showSaveDialog: vi.fn(async (..._args: unknown[]) => undefined as unknown),
	workspaceFolders: undefined as unknown,
	globalAgentDirectory: "/w/.agent",
}))

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: mocks.showInformationMessage,
		showWarningMessage: mocks.showWarningMessage,
		showSaveDialog: mocks.showSaveDialog,
	},
	workspace: {
		get workspaceFolders() {
			return mocks.workspaceFolders
		},
	},
	Uri: { file: (fsPath: string) => ({ fsPath, path: fsPath }) },
}))

vi.mock("../../messages", () => ({
	t: (key: string, args?: Record<string, unknown>) => (args ? `${key}:${JSON.stringify(args)}` : key),
}))

vi.mock("../../paths", () => ({
	getGlobalAgentDirectory: () => mocks.globalAgentDirectory,
}))

import { parseDictionaryLines } from "../dictionary"
import { maskText } from "../maskText"
import {
	convertedTerms,
	defaultConvertedDictionaryPath,
	exportConvertedDictionary,
	formatConvertedDictionary,
} from "../convertedDictionary"

let dir: string

beforeEach(async () => {
	vi.clearAllMocks()
	mocks.workspaceFolders = undefined
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "pii-converted-"))
	mocks.globalAgentDirectory = dir
})

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true })
})

const uriOf = (fsPath: string) => ({ fsPath, path: fsPath })

describe("convertedTerms", () => {
	it("氏名・社名・その他の語だけを取り出し、種類は伏せ字から読む", () => {
		const { terms, skipped } = convertedTerms([
			["{{email-001}}", "a@example.com"],
			["{{org-001}}", "サンプル商事"],
			["{{person-001}}", "田中"],
			["{{term-001}}", "PRJ-42"],
			["{{phone-001}}", "090-1234-5678"],
		])

		// 種類ごとに並べる（氏名 → 社名 → その他）。
		expect(terms).toEqual([
			{ value: "田中", kind: "person" },
			{ value: "サンプル商事", kind: "org" },
			{ value: "PRJ-42", kind: "term" },
		])
		expect(skipped).toBe(0)
	})

	it("同じ種類と値は 1 つにまとめ、種類が違えば別に残す", () => {
		const { terms } = convertedTerms([
			["{{person-001}}", "森"],
			["{{person-002}}", "森"],
			["{{org-001}}", "森"],
		])

		expect(terms).toEqual([
			{ value: "森", kind: "person" },
			{ value: "森", kind: "org" },
		])
	})

	it("伏せ字の形でないもの・空の値は飛ばす", () => {
		expect(convertedTerms([["person-001", "田中"], ["{{person-x}}", "林"], ["{{person-002}}", ""]]).terms).toEqual([])
	})

	it("改行やタブを含む値は 1 行に書けないので、数えて飛ばす", () => {
		const { terms, skipped } = convertedTerms([
			["{{org-001}}", "サンプル\n商事"],
			["{{org-002}}", "サンプル\t商事"],
			["{{org-003}}", "サンプル\r商事"],
			["{{org-004}}", "正しい社名"],
		])

		expect(terms).toEqual([{ value: "正しい社名", kind: "org" }])
		expect(skipped).toBe(3)
	})

	it("別の意味に読まれる値は、文字そのものに一致する正規表現にする", () => {
		const { terms } = convertedTerms([
			["{{term-001}}", "#社外秘"],
			["{{term-002}}", "/opt/data/"],
			["{{person-001}}", " 田中 "],
		])

		expect(terms).toEqual([
			{ value: " 田中 ", kind: "person", regex: true },
			{ value: "#社外秘", kind: "term", regex: true },
			{ value: "\\/opt\\/data\\/", kind: "term", regex: true },
		])
	})
})

describe("書き出した辞書を読み戻す", () => {
	it("読み戻した辞書で、元の語をすべて伏せる（書式の都合で落ちる語が無い）", () => {
		const values = ["田中", "サンプル商事", "#社外秘", "/opt/data/", "a.b*c", " 森 ", "(株)テスト"]
		const { terms } = convertedTerms(values.map((value, i) => [`{{term-${String(i + 1).padStart(3, "0")}}}`, value]))

		const parsed = parseDictionaryLines(formatConvertedDictionary(terms))

		expect(parsed.problems).toEqual([])
		for (const value of values) {
			const masked = maskText(`前${value}後`, { terms: parsed.terms, kinds: ["term"] })
			expect(masked.text, value).toBe("前{{term-001}}後")
		}
	})

	it("正規表現の特殊な文字を含む普通の値は、ほかの語に当たらない", () => {
		const parsed = parseDictionaryLines(formatConvertedDictionary(convertedTerms([["{{term-001}}", "#a.b"]]).terms))

		expect(maskText("#axb", { terms: parsed.terms }).text).toBe("#axb")
	})

	it("種類を保つ", () => {
		const parsed = parseDictionaryLines(
			formatConvertedDictionary(convertedTerms([["{{person-001}}", "田中"], ["{{org-001}}", "サンプル"]]).terms),
		)

		expect(parsed.terms).toEqual([
			{ value: "田中", kind: "person" },
			{ value: "サンプル", kind: "org" },
		])
	})

	it("見出しに件数を書く", () => {
		expect(formatConvertedDictionary(convertedTerms([["{{person-001}}", "田中"]]).terms)).toContain(
			"# PII Guard が変換した値から書き出した（1 件）。",
		)
	})
})

describe("exportConvertedDictionary", () => {
	const session = (entries: [string, string][]) => () => entries
	const noFiles = async () => []

	it("セッション対応表とファイル対応表の両方から書き出す", async () => {
		const out = path.join(dir, "out.txt")
		mocks.showSaveDialog.mockResolvedValueOnce(uriOf(out))

		await exportConvertedDictionary({
			sessionEntries: session([["{{person-001}}", "田中"]]),
			fileEntries: async () => [["{{org-001}}", "サンプル商事"]],
		})

		const written = await fs.readFile(out, "utf8")
		expect(written).toContain("田中\tperson\n")
		expect(written).toContain("サンプル商事\torg\n")
		expect(mocks.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('"count":2'))
	})

	it("既定の保存先は、使っている辞書とは別のファイル", async () => {
		await exportConvertedDictionary({ sessionEntries: session([["{{person-001}}", "田中"]]), fileEntries: noFiles })

		expect(defaultConvertedDictionaryPath()).toBe(path.join(dir, "pii-dictionary-converted.txt"))
		expect(mocks.showSaveDialog).toHaveBeenCalledWith(
			expect.objectContaining({ defaultUri: { fsPath: defaultConvertedDictionaryPath(), path: defaultConvertedDictionaryPath() } }),
		)
	})

	it("書き出せる値が無ければ、保存先を聞かずに知らせる", async () => {
		await exportConvertedDictionary({ sessionEntries: session([["{{email-001}}", "a@example.com"]]), fileEntries: noFiles })

		expect(mocks.showSaveDialog).not.toHaveBeenCalled()
		expect(mocks.showInformationMessage).toHaveBeenCalledWith("common:pii.converted.nothing")
	})

	it("保存先を選ばなければ、何も書かない", async () => {
		await exportConvertedDictionary({ sessionEntries: session([["{{person-001}}", "田中"]]), fileEntries: noFiles })

		expect(await fs.readdir(dir)).toEqual([])
		expect(mocks.showInformationMessage).not.toHaveBeenCalled()
	})

	it("ファイル対応表が読めなくても、セッションの分は書き出し、欠けたことを知らせる", async () => {
		const out = path.join(dir, "out.txt")
		mocks.showSaveDialog.mockResolvedValueOnce(uriOf(out))

		await exportConvertedDictionary({
			sessionEntries: session([["{{person-001}}", "田中"]]),
			fileEntries: async () => {
				throw new Error("壊れている")
			},
		})

		expect(mocks.showWarningMessage).toHaveBeenCalledWith("common:pii.converted.fileMappingFailed")
		expect(await fs.readFile(out, "utf8")).toContain("田中\tperson\n")
	})

	it("ワークスペースの中へ保存するなら確かめ、断れば書かない", async () => {
		const workspace = path.join(dir, "ws")
		mocks.workspaceFolders = [{ uri: uriOf(workspace) }]
		const out = path.join(workspace, "dict.txt")
		mocks.showSaveDialog.mockResolvedValueOnce(uriOf(out))

		await exportConvertedDictionary({ sessionEntries: session([["{{person-001}}", "田中"]]), fileEntries: noFiles })

		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			"common:pii.converted.insideWorkspace",
			{ modal: true },
			"common:pii.converted.saveAnyway",
		)
		await expect(fs.access(out)).rejects.toThrow()
	})

	it("ワークスペースの中でも、承知すれば書く（無い親ディレクトリも作る）", async () => {
		const workspace = path.join(dir, "ws")
		mocks.workspaceFolders = [{ uri: uriOf(workspace) }]
		const out = path.join(workspace, "sub", "dict.txt")
		mocks.showSaveDialog.mockResolvedValueOnce(uriOf(out))
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.converted.saveAnyway")

		await exportConvertedDictionary({ sessionEntries: session([["{{person-001}}", "田中"]]), fileEntries: noFiles })

		expect(await fs.readFile(out, "utf8")).toContain("田中\tperson\n")
	})

	it("ワークスペースの外なら確かめずに書く", async () => {
		mocks.workspaceFolders = [{ uri: uriOf(path.join(dir, "ws")) }]
		const out = path.join(dir, "outside.txt")
		mocks.showSaveDialog.mockResolvedValueOnce(uriOf(out))

		await exportConvertedDictionary({ sessionEntries: session([["{{person-001}}", "田中"]]), fileEntries: noFiles })

		expect(mocks.showWarningMessage).not.toHaveBeenCalled()
		expect(await fs.readFile(out, "utf8")).toContain("田中\tperson\n")
	})

	it("飛ばした値があれば、その数も知らせる。ホームの下の場所は ~ で短く出す", async () => {
		vi.stubEnv("HOME", dir)
		vi.stubEnv("USERPROFILE", dir)
		try {
			const out = path.join(dir, "out.txt")
			mocks.showSaveDialog.mockResolvedValueOnce(uriOf(out))

			await exportConvertedDictionary({
				sessionEntries: session([
					["{{person-001}}", "田中"],
					["{{org-001}}", "改行\nあり"],
				]),
				fileEntries: noFiles,
			})

			expect(mocks.showInformationMessage).toHaveBeenCalledWith(
				`common:pii.converted.exportedWithSkipped:${JSON.stringify({ count: 1, skipped: 1, path: "~/out.txt" })}`,
			)
		} finally {
			vi.unstubAllEnvs()
		}
	})
})
