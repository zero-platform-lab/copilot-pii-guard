// npx vitest run src/__tests__/commands.invariants.spec.ts
//
// `package.json` が並べたコマンドと、実際に登録しているコマンドが一致することを固定する。
//
// **この試験を書いた理由。** README に「`PII Guard: モデルを取得する` を実行する」と
// 書いておきながら、そのコマンドを登録していなかった。**型でも試験でも気づけない。**
// 登録していないコマンドは、`package.json` に並べれば一覧には出る。押した人には
// 「command 'piiGuard.fetchModel' not found」とだけ出る。
//
// 逆も同じである。登録しても `package.json` に並べなければ、一覧にも右クリックにも
// 出ない。あるのに誰にも見つけられないコマンドになる。

import * as path from "path"
import { promises as fs } from "fs"

const ROOT = path.resolve(__dirname, "../..")

/** `package.json` が並べたコマンド。 */
async function declared(): Promise<string[]> {
	const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"))
	return manifest.contributes.commands.map((one: { command: string }) => one.command)
}

/** `extension.ts` が登録しているコマンド。 */
async function registered(): Promise<string[]> {
	const source = await fs.readFile(path.join(ROOT, "src/extension.ts"), "utf8")
	return [...source.matchAll(/registerCommand\(\s*"([^"]+)"/g)].map((one) => one[1])
}

describe("コマンドの並びと登録が一致する", () => {
	it("並べたものは、全部登録している", async () => {
		const [names, actual] = await Promise.all([declared(), registered()])
		const missing = names.filter((one) => !actual.includes(one))

		expect(missing, `登録していない: ${missing.join(", ")}`).toEqual([])
	})

	it("登録したものは、全部並べている", async () => {
		const [names, actual] = await Promise.all([declared(), registered()])
		const hidden = actual.filter((one) => !names.includes(one))

		expect(hidden, `一覧に出ない: ${hidden.join(", ")}`).toEqual([])
	})

	it("右クリックに並べたものが、コマンドとして存在する", async () => {
		const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"))
		const names = await declared()
		const inMenu = manifest.contributes.menus["editor/context"].map((one: { command: string }) => one.command)

		expect(inMenu.filter((one: string) => !names.includes(one))).toEqual([])
	})

	it("読み取り自体が空振りしていない", async () => {
		// 書き方が変わると、上の 3 つがいつでも通ってしまう。
		expect((await declared()).length).toBeGreaterThan(4)
		expect((await registered()).length).toBeGreaterThan(4)
	})
})
