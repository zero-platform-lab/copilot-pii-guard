// npx vitest run src/__tests__/model.spec.ts
//
// モデルの取得と、置き場所の確認。
//
// **ここは外へ出る唯一の操作である。** 282 MB を取りに行く。誰の指示も無く出ないこと、
// 取れたつもりで欠けた状態を作らないことを確かめる。

import * as vscode from "vscode"

const mocks = vi.hoisted(() => ({
	config: {} as Record<string, unknown>,
	fetchModel: vi.fn(async (..._args: unknown[]) => ({ ok: true, missing: [], mismatched: [] }) as unknown),
	locateModel: vi.fn(
		async (..._args: unknown[]) =>
			({ present: true, bytes: 282 * 1024 * 1024, missing: [] as string[] }) as unknown,
	),
}))

vi.mock("../settings", () => ({
	readSettings: () => mocks.config,
}))

// **取りに行く段だけを偽物にする。** `resolveBase` は本物のまま使う。偽物にすると
// 「取得先が無ければ外へ出ない」という判断まで偽物になり、その試験が何も確かめなくなる。
vi.mock("../pii/nerFetch", async (importOriginal) => ({
	...(await importOriginal<typeof import("../pii/nerFetch")>()),
	fetchModel: mocks.fetchModel,
}))

vi.mock("../pii/nerModel", async (importOriginal) => ({
	...(await importOriginal<typeof import("../pii/nerModel")>()),
	locateModel: mocks.locateModel,
}))

import { fetchModelCommand, modelDirectory, showModelStatus } from "../model"

beforeEach(() => {
	vi.clearAllMocks()
	mocks.config = { properNouns: { modelUrl: "https://例/v1" } }
})

describe("取得（FR-PII-23c / FR-PII-23h）", () => {
	it("取得先が書かれていなければ、1 度も外へ出ない", async () => {
		// **既定の取得先を持たない。** 持つと、誰の指示も無く 282 MB を取りに行く経路を
		// 抱えることになる。
		mocks.config = { properNouns: {} }

		await fetchModelCommand()

		expect(mocks.fetchModel).not.toHaveBeenCalled()
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("取得先"))
	})

	it("空白だけの取得先も、書いていないものとして扱う", async () => {
		// 空白を取得先にすると `/SHA256SUMS` という場所へ取りに行き、理由の分からない
		// 失敗になる。
		mocks.config = { properNouns: { modelUrl: "   " } }

		await fetchModelCommand()

		expect(mocks.fetchModel).not.toHaveBeenCalled()
	})

	it("書かれていれば、その取得先から取る", async () => {
		await fetchModelCommand()

		expect(mocks.fetchModel).toHaveBeenCalledWith(
			expect.stringContaining("pii-ner"),
			expect.objectContaining({ baseUrl: "https://例/v1" }),
		)
		expect(vscode.window.showInformationMessage).toHaveBeenCalled()
	})

	it("取れなければ、その旨を出す", async () => {
		mocks.fetchModel.mockRejectedValueOnce(new Error("404"))

		await fetchModelCommand()

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("404"))
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
	})

	it("取れても揃っていなければ、揃った扱いにしない", async () => {
		// **欠けたまま使わせない。** 欠けたまま入にすると、第 2 層が静かに動かず、
		// 画面の見た目も変わらない。
		mocks.fetchModel.mockResolvedValueOnce({ ok: false, missing: ["tokenizer.json"], mismatched: [] })

		await fetchModelCommand()

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("揃っていません"))
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
	})
})

describe("置き場所（FR-PII-23a）", () => {
	it("書かれていなければ既定の場所を見る", () => {
		mocks.config = { properNouns: {} }

		expect(modelDirectory()).toContain("pii-ner")
	})

	it("書かれていれば、その場所を見る（`~` は開く）", () => {
		mocks.config = { properNouns: { modelPath: "~/models/ner" } }

		const directory = modelDirectory()
		expect(directory).not.toContain("~")
		expect(directory).toContain("models/ner")
	})

	it("置かれていれば、大きさとともに出す", async () => {
		// **閉鎖環境ではこれが唯一の手がかりである。** どこへ運べばよいかが分からない。
		await showModelStatus()

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining("置かれています"),
		)
	})

	it("置かれていなければ、足りない数を出す", async () => {
		mocks.locateModel.mockResolvedValueOnce({ present: false, bytes: 0, missing: ["a", "b"] })

		await showModelStatus()

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("2 ファイル"))
	})
})
