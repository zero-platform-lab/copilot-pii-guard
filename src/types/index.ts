// 写した伏せ字の中身が要る型だけを置く。
//
// **本体の `@openai-agent/types` は持ち込まない。** あちらは会話の型から設定の検証まで
// 抱えていて、この拡張には要らないものが大半である。要るものだけを写す。

export type { AgentMessage, AgentMessageItem, AgentMessageMeta } from "./agent-message"
export { piiKinds, nerEntities } from "./pii"
export type { PiiKind, PiiTerm, NerEntity } from "./pii"

import type { PiiKind, PiiTerm, NerEntity } from "./pii"

/**
 * 伏せ字の設定（`FR-PII-01b` ほか）。
 *
 * **本体は zod で検証している。** こちらは VS Code の設定から読むので、`package.json` の
 * `contributes.configuration` が形を決める。ここでは型だけを持つ。
 */
export type PiiMasking = {
	/** 伏せるかどうか。 */
	enabled?: boolean
	/** 応答の伏せ字を元の値へ戻すか。既定は戻す。 */
	restore?: boolean
	/** 伏せる種類。省略すると全部。 */
	kinds?: PiiKind[]
	/** 利用者が挙げた語。 */
	terms?: PiiTerm[]
	/** 辞書のファイル。 */
	dictionaryPaths?: string[]
	/** 鍵のラベルに足す語。 */
	secretLabels?: string[]
	/** 固有名詞の検出（第 2 層）。 */
	properNouns?: {
		enabled?: boolean
		modelPath?: string
		modelUrl?: string
		minScore?: number
		entities?: NerEntity[]
		/** 判定にかけてよい時間（ミリ秒）。0 なら切らずに待つ。 */
		timeBudgetMs?: number
	}
}
