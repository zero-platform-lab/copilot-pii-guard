// npx vitest run src/__tests__/settings.spec.ts
//
// 設定の読み取りを確かめる。
//
// **チェックの形と、伏せる処理が要る形は違う。** 設定はチェック（真偽値の並び）で持ち、
// 伏せる処理は名前の並びを受け取る。変換を間違えると、チェックを入れた種類が伏せられない、
// あるいは外した種類まで伏せられる。どちらも画面には何も出ない。

import * as path from "path"
import { promises as fs } from "fs"

import * as vscode from "vscode"

import { readSettings } from "../settings"
import { piiKinds, nerEntities } from "../types"

/** `package.json` の設定の定義を読む。 */
async function manifestProperties(): Promise<Record<string, { properties: Record<string, unknown> }>> {
	const raw = await fs.readFile(path.resolve(__dirname, "../../package.json"), "utf8")
	return JSON.parse(raw).contributes.configuration.properties
}

/** 設定の値を決めて `readSettings` を実行する。 */
function withConfig(values: Record<string, unknown>) {
	vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
		get: (key: string) => values[key],
	} as never)

	return readSettings()
}

beforeEach(() => vi.mocked(vscode.workspace.getConfiguration).mockReset())

describe("チェックの形を、名前の並びへ変える", () => {
	it("入っているものだけを並べる", () => {
		const settings = withConfig({ kinds: { email: true, phone: false, card: true } })

		expect(settings.kinds).toEqual(["email", "card"])
	})

	it("1 つも入っていなければ、空の並びになる", () => {
		// **これは「1 つも伏せない」という意思である。** 既定へ落としてはいけない。
		expect(withConfig({ kinds: { email: false, phone: false } }).kinds).toEqual([])
	})

	it("設定が読めなければ undefined を返す", () => {
		// **空の並びを返さない。** 返すと「1 つも伏せない」になり、読めていないだけなのに
		// 伏せずに送ってしまう。`undefined` なら伏せる処理が既定（全部）を使う。
		expect(withConfig({}).kinds).toBeUndefined()
	})

	it("第 2 層の区分も同じように変える", () => {
		const settings = withConfig({
			"properNouns.entities": { PER: true, ORG: true, PRD: false, EVT: false },
		})

		expect(settings.properNouns?.entities).toEqual(["PER", "ORG"])
	})
})

describe("package.json と食い違わない", () => {
	it("並べた種類は、伏せる処理が知っているものだけ", async () => {
		// **実在しない種類を並べない。** 並べると、設定の画面には出るのに何も起きない。
		// 実際に `postal` `url` `path` を並べていて、どれも効かなかった。
		const declared = Object.keys((await manifestProperties())["piiGuard.kinds"].properties)

		expect(declared.sort()).toEqual([...piiKinds].sort())
	})

	it("並べた区分は、モデルが返すものだけ", async () => {
		const declared = Object.keys((await manifestProperties())["piiGuard.properNouns.entities"].properties)

		expect(declared.sort()).toEqual([...nerEntities].sort())
	})
})
