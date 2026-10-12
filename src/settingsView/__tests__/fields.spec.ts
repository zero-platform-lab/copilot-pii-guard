// npx vitest run src/settingsView/__tests__/fields.spec.ts
//
// 設定の画面の項目と、値の確かめ方。
//
// **package.json の設定が、画面にすべて 1 回ずつ出ること**を固定する。設定を足した人は、
// 区分けと見出しを足すまでここで赤になる。

import packageJson from "../../../package.json"
import { check, configurationProperties, fieldFor, LABELS, SECTIONS, sectionsWithFields, type Field } from "../fields"

const keys = Object.keys(packageJson.contributes.configuration.properties)

describe("画面に出す項目", () => {
	it("package.json の設定は、どれもちょうど 1 つの区分に入っている", () => {
		const placed = SECTIONS.flatMap((section) => section.keys)

		expect([...placed].sort()).toEqual([...keys].sort())
		expect(new Set(placed).size).toBe(placed.length)
	})

	it("どの設定にも見出しがある（見出しだけ残った設定も無い）", () => {
		expect(Object.keys(LABELS).sort()).toEqual([...keys].sort())
	})

	it("どの設定も、画面の項目にできる", () => {
		const fields = sectionsWithFields().flatMap((section) => section.fields)

		expect(fields.map((field) => field.key).sort()).toEqual([...keys].sort())
	})

	it("型ごとに、入力の種類と、package.json の既定・範囲・説明を引き継ぐ", () => {
		const byKey = new Map(sectionsWithFields().flatMap((section) => section.fields.map((field) => [field.key, field])))

		expect(byKey.get("piiGuard.enabled")).toMatchObject({ kind: "boolean", default: true, label: "伏せ字化" })
		expect(byKey.get("piiGuard.fileTools.mode")).toMatchObject({
			kind: "enum",
			default: "confirmEdit",
			options: [
				{ value: "off", description: "ファイル道具を使いません。" },
				{ value: "readOnly", description: expect.any(String) },
				{ value: "confirmEdit", description: expect.any(String) },
			],
		})
		expect(byKey.get("piiGuard.properNouns.minScore")).toMatchObject({ kind: "number", default: 0.9, min: 0, max: 1 })
		expect(byKey.get("piiGuard.properNouns.retryCount")).toMatchObject({ kind: "integer", min: 0, max: 10 })
		expect(byKey.get("piiGuard.properNouns.modelPath")).toMatchObject({ kind: "string", default: "" })
		expect(byKey.get("piiGuard.kinds")).toMatchObject({ kind: "checks", default: expect.objectContaining({ person: true }) })
		expect((byKey.get("piiGuard.kinds") as Extract<Field, { kind: "checks" }>).options).toHaveLength(12)
		expect(byKey.get("piiGuard.dictionaryPaths")).toMatchObject({ kind: "strings", default: [] })
		expect(byKey.get("piiGuard.terms")).toMatchObject({ kind: "terms", termKinds: ["person", "org", "term"] })
		expect(byKey.get("piiGuard.restore")?.description).toContain("応答の伏せ字")
	})

	it("package.json に無い設定を区分に書くと、作るときに止める", () => {
		const properties = { ...configurationProperties() }
		delete properties["piiGuard.enabled"]

		expect(() => sectionsWithFields(properties)).toThrow("package.json に無い設定: piiGuard.enabled")
	})
})

describe("fieldFor", () => {
	it("見出しが無い設定は止める", () => {
		expect(() => fieldFor("piiGuard.unknown", { type: "boolean" })).toThrow("見出しが無い設定: piiGuard.unknown")
	})

	it("画面に出せない型は止める（黙って出さない設定を作らない）", () => {
		for (const schema of [
			{ type: "null" },
			{ type: "object" },
			{ type: "array", items: { type: "number" } },
			{ type: "array", items: { type: "object", properties: {} } },
			{ type: "array" },
		]) {
			expect(() => fieldFor("piiGuard.enabled", schema)).toThrow("画面に出せない型の設定: piiGuard.enabled")
		}
	})

	it("既定や説明が無い設定は、型に合った空の値にする", () => {
		expect(fieldFor("piiGuard.enabled", { type: "boolean" })).toMatchObject({ default: false, description: "" })
		expect(fieldFor("piiGuard.fileTools.mode", { type: "string", enum: ["a", "b"] })).toMatchObject({
			default: "a",
			options: [
				{ value: "a", description: "" },
				{ value: "b", description: "" },
			],
		})
		expect(fieldFor("piiGuard.properNouns.modelPath", { type: "string" })).toMatchObject({ default: "" })
		expect(fieldFor("piiGuard.properNouns.retryCount", { type: "integer" })).toMatchObject({ default: 0 })
		expect(fieldFor("piiGuard.kinds", { type: "object", properties: { a: { type: "boolean" } } })).toMatchObject({
			default: {},
			options: [{ value: "a", description: "" }],
		})
		expect(fieldFor("piiGuard.dictionaryPaths", { type: "array", items: { type: "string" } })).toMatchObject({
			default: [],
		})
		expect(
			fieldFor("piiGuard.terms", {
				type: "array",
				items: { type: "object", properties: { kind: { type: "string", enum: ["person"] } } },
			}),
		).toMatchObject({ default: [], termKinds: ["person"] })
		expect(fieldFor("piiGuard.restore", { type: "boolean", description: "説明" }).description).toBe("説明")
	})
})

describe("check", () => {
	const field = (key: string) => sectionsWithFields().flatMap((section) => section.fields).find((one) => one.key === key)!

	it("真偽", () => {
		expect(check(field("piiGuard.enabled"), false)).toEqual({ ok: true, value: false })
		expect(check(field("piiGuard.enabled"), "false")).toEqual({ ok: false, error: "オンかオフを選んでください" })
	})

	it("選択肢", () => {
		expect(check(field("piiGuard.fileTools.mode"), "readOnly")).toEqual({ ok: true, value: "readOnly" })
		expect(check(field("piiGuard.fileTools.mode"), "admin")).toEqual({ ok: false, error: "選べる値ではありません" })
		expect(check(field("piiGuard.fileTools.mode"), 1)).toMatchObject({ ok: false })
	})

	it("数: 範囲と整数を確かめる", () => {
		const score = field("piiGuard.properNouns.minScore")
		expect(check(score, 0.5)).toEqual({ ok: true, value: 0.5 })
		expect(check(score, -0.1)).toEqual({ ok: false, error: "0 以上にしてください" })
		expect(check(score, 1.5)).toEqual({ ok: false, error: "1 以下にしてください" })
		expect(check(score, null)).toEqual({ ok: false, error: "数を入れてください" })
		expect(check(score, Number.NaN)).toEqual({ ok: false, error: "数を入れてください" })

		const retry = field("piiGuard.properNouns.retryCount")
		expect(check(retry, 2)).toEqual({ ok: true, value: 2 })
		expect(check(retry, 2.5)).toEqual({ ok: false, error: "整数を入れてください" })
		// 上限の無い数は、下限だけを見る。
		expect(check(field("piiGuard.properNouns.timeBudgetMs"), 10 ** 9)).toEqual({ ok: true, value: 10 ** 9 })
	})

	it("上限も下限も無い数は、数であれば受ける", () => {
		const free = fieldFor("piiGuard.properNouns.retryCount", { type: "number" })
		expect(check(free, -5)).toEqual({ ok: true, value: -5 })
	})

	it("文字: 前後の空白を落とす", () => {
		expect(check(field("piiGuard.properNouns.modelPath"), "  ~/m  ")).toEqual({ ok: true, value: "~/m" })
		expect(check(field("piiGuard.properNouns.modelPath"), 3)).toEqual({ ok: false, error: "文字を入れてください" })
	})

	it("オン・オフの組: 外した項目も false として残し、知らない名前は受けない", () => {
		const kinds = field("piiGuard.kinds") as Extract<Field, { kind: "checks" }>
		const result = check(kinds, { person: false, email: true })

		expect(result.ok).toBe(true)
		const value = (result as { value: Record<string, boolean> }).value
		expect(Object.keys(value)).toHaveLength(12)
		expect(value).toMatchObject({ person: false, email: true, phone: false })
		expect(check(kinds, { nope: true })).toEqual({ ok: false, error: "選べない項目が含まれています" })
		expect(check(kinds, { person: "yes" })).toEqual({ ok: false, error: "選べない項目が含まれています" })
		expect(check(kinds, ["person"])).toEqual({ ok: false, error: "選び方が読めません" })
		expect(check(kinds, null)).toEqual({ ok: false, error: "選び方が読めません" })
	})

	it("文字の一覧: 前後の空白を落とし、空の行は捨てる", () => {
		const paths = field("piiGuard.dictionaryPaths")
		expect(check(paths, [" ~/a.txt ", "", "  "])).toEqual({ ok: true, value: ["~/a.txt"] })
		expect(check(paths, "~/a.txt")).toEqual({ ok: false, error: "一覧が読めません" })
		expect(check(paths, [1])).toEqual({ ok: false, error: "一覧が読めません" })
	})

	describe("語の一覧", () => {
		const terms = () => field("piiGuard.terms")

		it("値・種類・正規表現を整え、値の空の行は捨てる", () => {
			expect(
				check(terms(), [
					{ value: " 田中 ", kind: "person" },
					{ value: "PRJ-\\d+", regex: true },
					{ value: "", kind: "org" },
					{ value: "サンプル", kind: "", regex: false },
				]),
			).toEqual({
				ok: true,
				value: [{ value: "田中", kind: "person" }, { value: "PRJ-\\d+", regex: true }, { value: "サンプル" }],
			})
		})

		it("読めない行・選べない種類・読めない正規表現は、何行目かを添えて受けない", () => {
			expect(check(terms(), "田中")).toEqual({ ok: false, error: "一覧が読めません" })
			expect(check(terms(), [null])).toEqual({ ok: false, error: "1 行目が読めません" })
			expect(check(terms(), [{ value: "a" }, { value: "b", kind: "email" }])).toEqual({
				ok: false,
				error: "2 行目: 種類が選べる値ではありません",
			})
			expect(check(terms(), [{ value: "a", kind: 1 }])).toEqual({ ok: false, error: "1 行目: 種類が選べる値ではありません" })
			expect(check(terms(), [{ value: "a", regex: "yes" }])).toEqual({
				ok: false,
				error: "1 行目: 正規表現の指定が読めません",
			})
			expect(check(terms(), [{ value: "(", regex: true }])).toMatchObject({
				ok: false,
				error: expect.stringContaining("1 行目: 正規表現として読めません"),
			})
			expect(check(terms(), [{ value: "a*", regex: true }])).toEqual({
				ok: false,
				error: "1 行目: 空の文字列に一致する正規表現は使えません（すべての位置に当たります）",
			})
			// 値が文字でない行は、書きかけの空の行として捨てる。
			expect(check(terms(), [{ value: 1 }])).toEqual({ ok: true, value: [] })
		})
	})
})
