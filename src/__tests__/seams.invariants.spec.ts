// npx vitest run src/__tests__/seams.invariants.spec.ts
//
// モデルへ送る箇所と、応答を画面へ出す箇所の数を固定する。
//
// **この試験を書いた理由。** 本体では伏せ字の挟み忘れを 4 回のうち 3 回繰り返した。送る
// 箇所が 3 つあり、毎回 1 つずつ残していた。単体の試験では見つからない。直した箇所の
// 試験は通り、残った箇所の試験も（伏せ字を知らないので）通る。**ほかにも箇所があることは、
// 数えないと分からない。**
//
// この拡張の送る箇所はいまのところ 1 つである。増やすなら、伏せてから送ることを確かめた
// うえで下の数を上げる。

import * as path from "path"
import { promises as fs } from "fs"

const SRC = path.resolve(__dirname, "..")

async function sourceFiles(dir: string): Promise<string[]> {
	const found: string[] = []

	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === "__tests__" || entry.name === "__mocks__") continue
			found.push(...(await sourceFiles(full)))
			continue
		}
		if (entry.name.endsWith(".ts")) found.push(full)
	}

	return found
}

/** `pattern` に当たる行を、`src` からの相対パスつきで集める。 */
async function callSites(pattern: RegExp): Promise<{ file: string; line: number }[]> {
	const sites: { file: string; line: number }[] = []

	for (const file of await sourceFiles(SRC)) {
		const lines = (await fs.readFile(file, "utf8")).split("\n")
		lines.forEach((line, index) => {
			if (pattern.test(line)) sites.push({ file: path.relative(SRC, file), line: index + 1 })
		})
	}

	return sites
}

describe("モデルへ送る箇所", () => {
	it("送るのは 1 箇所だけで、伏せた文を送っている", async () => {
		const sites = await callSites(/\.sendRequest\(/)

		expect(sites.map((one) => one.file)).toEqual(["participant.ts"])

		// **生の文を送らない。** `request.prompt` をそのまま渡す枝があれば、伏せ字は
		// 素通りする。画面には何も出ないので、気づく手がかりが 1 つも無い。
		const source = await fs.readFile(path.join(SRC, "participant.ts"), "utf8")
		expect(source).toContain("LanguageModelChatMessage.User(masked.text)")
		expect(source).not.toMatch(/User\(request\.prompt\)/)
	})

	it("伏せる処理を経ない送り方が無い", async () => {
		// `fetch` や `https.request` で自前に送る経路を作ると、この継ぎ目を回避できる。
		const direct = await callSites(/\b(fetch|https?\.request)\(/)

		// **外へ出る口は 1 つだけ。** モデルのファイルの取得もここを通る。増えたら、
		// そこが proxy を無視し、伏せ字も通らない経路になっていないかを見ること。
		expect(direct.map((one) => one.file).sort()).toEqual(["proxy.ts"])
	})
})

describe("応答を画面へ出す箇所", () => {
	it("モデルの応答は、必ず戻してから出す", async () => {
		const source = await fs.readFile(path.join(SRC, "participant.ts"), "utf8")

		// **断片をそのまま出さない。** 出すと、割れて届いた伏せ字が戻らないまま画面に
		// 並ぶ。`{{person-001}}` を読まされる。
		expect(source).not.toMatch(/stream\.markdown\(fragment\)/)
		expect(source).toContain("restorer.push(fragment)")
		// 握っているぶんを出し忘れると、応答の末尾が消える。
		expect(source).toContain("restorer.flush()")
	})
})
