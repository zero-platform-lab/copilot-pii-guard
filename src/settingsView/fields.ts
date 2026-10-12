// 設定の画面に並べる項目と、値の確かめ方。
//
// **項目は `package.json` の `contributes.configuration` から作る。** 画面のために別の一覧を
// 持つと、設定を足したのに画面に出ない、型を変えたのに画面が古い型で書く、といった食い違いが
// 生まれる。持つのは、画面の区分けと短い見出しだけにする（どちらも全項目にあることを試験で固定）。
//
// **値の置き場所は VS Code の設定のまま。** この画面は同じ設定を読み書きするだけなので、VS Code
// の設定の検索からも、これまでどおり見つかる。

import packageJson from "../../package.json"

type JsonSchema = {
	type?: string
	description?: string
	markdownDescription?: string
	default?: unknown
	enum?: string[]
	enumDescriptions?: string[]
	minimum?: number
	maximum?: number
	properties?: Record<string, JsonSchema>
	items?: JsonSchema
}

export type FieldOption = { value: string; description: string }

export type Field =
	| { kind: "boolean"; key: string; label: string; description: string; default: boolean }
	| { kind: "enum"; key: string; label: string; description: string; default: string; options: FieldOption[] }
	| {
			kind: "integer" | "number"
			key: string
			label: string
			description: string
			default: number
			min?: number
			max?: number
	  }
	| { kind: "string"; key: string; label: string; description: string; default: string }
	/** 名前ごとのオン・オフ（`piiGuard.kinds` など）。 */
	| {
			kind: "checks"
			key: string
			label: string
			description: string
			default: Record<string, boolean>
			options: FieldOption[]
	  }
	/** 文字列の一覧（`piiGuard.dictionaryPaths` など）。 */
	| { kind: "strings"; key: string; label: string; description: string; default: string[] }
	/** 必ず伏せる語の一覧（`piiGuard.terms`）。 */
	| { kind: "terms"; key: string; label: string; description: string; default: unknown[]; termKinds: string[] }

export type Section = { id: string; title: string; keys: string[] }

/** 画面の区分け。並べる順もここで決める。 */
export const SECTIONS: readonly Section[] = [
	{ id: "basic", title: "基本", keys: ["piiGuard.enabled", "piiGuard.restore"] },
	{ id: "kinds", title: "伏せる種類", keys: ["piiGuard.kinds"] },
	{
		id: "terms",
		title: "辞書と語",
		keys: ["piiGuard.terms", "piiGuard.dictionaryPaths", "piiGuard.secretLabels"],
	},
	{
		id: "properNouns",
		title: "固有名詞検出",
		keys: [
			"piiGuard.properNouns.enabled",
			"piiGuard.properNouns.entities",
			"piiGuard.properNouns.minScore",
			"piiGuard.properNouns.timeBudgetMs",
			"piiGuard.properNouns.retryCount",
			"piiGuard.properNouns.modelPath",
			"piiGuard.properNouns.modelUrl",
		],
	},
	{ id: "fileTools", title: "ファイル道具", keys: ["piiGuard.fileTools.mode", "piiGuard.fileWrites.restore"] },
	{
		id: "mapping",
		title: "対応表",
		keys: [
			"piiGuard.sessionMapping.maxEntries",
			"piiGuard.fileMapping.root",
			"piiGuard.fileMapping.retentionDays",
			"piiGuard.fileMapping.maxFiles",
			"piiGuard.fileMapping.maxEntriesPerFile",
			"piiGuard.fileMapping.maxBytes",
		],
	},
]

/** 項目の短い見出し。説明は `package.json` の文をそのまま使う。 */
export const LABELS: Readonly<Record<string, string>> = {
	"piiGuard.enabled": "伏せ字化",
	"piiGuard.restore": "応答の伏せ字を戻して表示",
	"piiGuard.kinds": "伏せる種類",
	"piiGuard.terms": "必ず伏せる語",
	"piiGuard.dictionaryPaths": "辞書ファイル",
	"piiGuard.secretLabels": "秘密情報のラベル",
	"piiGuard.properNouns.enabled": "固有名詞検出",
	"piiGuard.properNouns.entities": "採用する区分",
	"piiGuard.properNouns.minScore": "確度の下限",
	"piiGuard.properNouns.timeBudgetMs": "判定の上限時間（ミリ秒）",
	"piiGuard.properNouns.retryCount": "再試行の回数",
	"piiGuard.properNouns.modelPath": "モデルの置き場所",
	"piiGuard.properNouns.modelUrl": "モデルの取得先",
	"piiGuard.fileTools.mode": "ファイル道具の権限",
	"piiGuard.fileWrites.restore": "書き込むときに元の値へ戻す（Write Restore）",
	"piiGuard.sessionMapping.maxEntries": "セッション対応表の上限（件）",
	"piiGuard.fileMapping.root": "ファイル対応表の保管ルート",
	"piiGuard.fileMapping.retentionDays": "ファイル対応表の保持日数",
	"piiGuard.fileMapping.maxFiles": "ファイル対応表のファイル数の上限",
	"piiGuard.fileMapping.maxEntriesPerFile": "1 ファイルの対応数の上限",
	"piiGuard.fileMapping.maxBytes": "ファイル対応表全体の容量の上限（バイト）",
}

/** `package.json` の設定の一覧。 */
export function configurationProperties(): Record<string, JsonSchema> {
	const configuration = packageJson.contributes.configuration as { properties: Record<string, JsonSchema> }
	return configuration.properties
}

function describe(schema: JsonSchema): string {
	return schema.markdownDescription ?? schema.description ?? ""
}

/** 設定 1 つを、画面の項目にする。知らない型は投げる（画面に出ない設定を作らない）。 */
export function fieldFor(key: string, schema: JsonSchema): Field {
	const label = LABELS[key]
	if (!label) throw new Error(`見出しが無い設定: ${key}`)
	const description = describe(schema)

	switch (schema.type) {
		case "boolean":
			return { kind: "boolean", key, label, description, default: schema.default === true }
		case "string":
			if (schema.enum) {
				return {
					kind: "enum",
					key,
					label,
					description,
					default: String(schema.default ?? schema.enum[0]),
					options: schema.enum.map((value, index) => ({
						value,
						description: schema.enumDescriptions?.[index] ?? "",
					})),
				}
			}
			return { kind: "string", key, label, description, default: String(schema.default ?? "") }
		case "integer":
		case "number":
			return {
				kind: schema.type,
				key,
				label,
				description,
				default: Number(schema.default ?? 0),
				min: schema.minimum,
				max: schema.maximum,
			}
		case "object":
			if (schema.properties) {
				return {
					kind: "checks",
					key,
					label,
					description,
					default: (schema.default ?? {}) as Record<string, boolean>,
					options: Object.entries(schema.properties).map(([value, one]) => ({ value, description: describe(one) })),
				}
			}
			break
		case "array":
			if (schema.items?.type === "string") {
				return { kind: "strings", key, label, description, default: (schema.default ?? []) as string[] }
			}
			if (schema.items?.type === "object" && schema.items.properties?.kind?.enum) {
				return {
					kind: "terms",
					key,
					label,
					description,
					default: (schema.default ?? []) as unknown[],
					termKinds: schema.items.properties.kind.enum,
				}
			}
			break
	}
	throw new Error(`画面に出せない型の設定: ${key}`)
}

/** 画面に出す区分と項目。 */
export function sectionsWithFields(
	properties: Record<string, JsonSchema> = configurationProperties(),
): { id: string; title: string; fields: Field[] }[] {
	return SECTIONS.map((section) => ({
		id: section.id,
		title: section.title,
		fields: section.keys.map((key) => {
			const schema = properties[key]
			if (!schema) throw new Error(`package.json に無い設定: ${key}`)
			return fieldFor(key, schema)
		}),
	}))
}

export type Checked = { ok: true; value: unknown } | { ok: false; error: string }

/** 正規表現として使えるか。使えないなら理由を返す（辞書の読み込みと同じ基準）。 */
function regexProblem(source: string): string | undefined {
	let pattern: RegExp
	try {
		pattern = new RegExp(source)
	} catch (error) {
		return `正規表現として読めません: ${(error as Error).message}`
	}
	return pattern.test("") ? "空の文字列に一致する正規表現は使えません（すべての位置に当たります）" : undefined
}

/**
 * 画面から届いた値を確かめ、保存する形にする。
 *
 * **確かめるのは拡張の側。** 画面（webview）の中の検査は手助けにすぎない。届いた値は、型・範囲・
 * 選べる値を必ずここで見る。
 */
export function check(field: Field, value: unknown): Checked {
	switch (field.kind) {
		case "boolean":
			return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: "オンかオフを選んでください" }
		case "enum":
			return typeof value === "string" && field.options.some((option) => option.value === value)
				? { ok: true, value }
				: { ok: false, error: "選べる値ではありません" }
		case "integer":
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: "数を入れてください" }
			if (field.kind === "integer" && !Number.isInteger(value)) return { ok: false, error: "整数を入れてください" }
			if (field.min !== undefined && value < field.min) return { ok: false, error: `${field.min} 以上にしてください` }
			if (field.max !== undefined && value > field.max) return { ok: false, error: `${field.max} 以下にしてください` }
			return { ok: true, value }
		}
		case "string":
			return typeof value === "string" ? { ok: true, value: value.trim() } : { ok: false, error: "文字を入れてください" }
		case "checks": {
			if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "選び方が読めません" }
			const known = new Set(field.options.map((option) => option.value))
			const entries = Object.entries(value as Record<string, unknown>)
			if (entries.some(([name, on]) => !known.has(name) || typeof on !== "boolean")) {
				return { ok: false, error: "選べない項目が含まれています" }
			}
			// 画面に出した項目は、外したものも false として残す（既定のオンに戻らないように）。
			return { ok: true, value: Object.fromEntries(field.options.map((option) => [option.value, value[option.value as never] === true])) }
		}
		case "strings": {
			if (!Array.isArray(value) || value.some((one) => typeof one !== "string")) {
				return { ok: false, error: "一覧が読めません" }
			}
			// 空の行は捨てる。空のパスを辞書として読むと、毎回「読めません」と出る。
			return { ok: true, value: (value as string[]).map((one) => one.trim()).filter((one) => one.length > 0) }
		}
		case "terms": {
			if (!Array.isArray(value)) return { ok: false, error: "一覧が読めません" }
			const terms: { value: string; kind?: string; regex?: boolean }[] = []
			for (const [index, raw] of value.entries()) {
				const row = `${index + 1} 行目`
				if (!raw || typeof raw !== "object") return { ok: false, error: `${row}が読めません` }
				const one = raw as Record<string, unknown>
				const text = typeof one.value === "string" ? one.value.trim() : ""
				// 値が空の行は、足しかけて書かなかった行として捨てる。
				if (text.length === 0) continue
				const kind = one.kind === undefined || one.kind === "" ? undefined : one.kind
				if (kind !== undefined && (typeof kind !== "string" || !field.termKinds.includes(kind))) {
					return { ok: false, error: `${row}: 種類が選べる値ではありません` }
				}
				if (one.regex !== undefined && typeof one.regex !== "boolean") {
					return { ok: false, error: `${row}: 正規表現の指定が読めません` }
				}
				if (one.regex === true) {
					const problem = regexProblem(text)
					if (problem) return { ok: false, error: `${row}: ${problem}` }
				}
				terms.push({ value: text, ...(kind ? { kind } : {}), ...(one.regex === true ? { regex: true } : {}) })
			}
			return { ok: true, value: terms }
		}
	}
}
