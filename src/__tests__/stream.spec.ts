// npx vitest run src/__tests__/stream.spec.ts
//
// **この試験を書いた理由。** 断片ごとに戻すと、区切りをまたいだ伏せ字が戻らない。画面に
// `{{person-001}}` がそのまま出る。本体でも同じ取りこぼしを 1 度やっている。

import { createStreamRestorer } from "../stream"

/** 番号 001 を「森」へ戻すだけの、試験のための戻し方。 */
const restore = (text: string) => text.replace(/\{\{person-001\}\}/g, "森")

function run(fragments: string[]): string {
	const restorer = createStreamRestorer(restore)
	return fragments.map((one) => restorer.push(one)).join("") + restorer.flush()
}

describe("区切りをまたいで戻す", () => {
	it("1 つの断片に収まっていれば、そのまま戻す", () => {
		expect(run(["担当は {{person-001}} です"])).toBe("担当は 森 です")
	})

	it("伏せ字が 2 つの断片に割れても戻す", () => {
		// ここが本題。握らずに戻すと、どちらの断片でも一致しない。
		expect(run(["担当は {{person-", "001}} です"])).toBe("担当は 森 です")
	})

	it("1 文字ずつ届いても戻す", () => {
		expect(run([..."担当は {{person-001}} です"])).toBe("担当は 森 です")
	})

	it("括弧が 1 つだけの末尾も握る", () => {
		// `{` は次の断片で `{{` になり得る。握らずに出すと、そのあと戻せない。
		expect(run(["担当は {", "{person-001}} です"])).toBe("担当は 森 です")
	})

	it("伏せ字でない波括弧は、そのまま出す", () => {
		expect(run(["const a = {", " b: 1 }"])).toBe("const a = { b: 1 }")
	})

	it("閉じない括弧でも、応答を止めない", () => {
		// **いつまでも握らない。** 握り続けると、応答が 1 文字も出ないまま終わる。
		const long = "{{" + "あ".repeat(100)
		expect(run([long])).toBe(long)
	})

	it("握っているものは、終わりに必ず出す", () => {
		const restorer = createStreamRestorer(restore)
		expect(restorer.push("終わりに {")).toBe("終わりに ")
		expect(restorer.flush()).toBe("{")
	})
})
