// VS Code の設定から、伏せ字の設定を読む。
//
// **本体と違い、画面は持たない。** 本体は webview の設定の画面を持つが、この拡張は
// `contributes.configuration` だけで足りる。設定の画面を自前で持つと、VS Code の
// 設定の検索から外れて見つけてもらえない。

import * as vscode from "vscode"

import type { PiiMasking } from "./types"

/** 設定の根。`package.json` の `contributes.configuration` と揃える。 */
const ROOT = "piiGuard"

/**
 * いまの設定を読む。
 *
 * **呼ばれるたびに読む。** 起動時に 1 度だけ読むと、設定を変えても効かない。VS Code の
 * 設定は利用者がいつでも変えられる。
 */
export function readSettings(): PiiMasking {
	const config = vscode.workspace.getConfiguration(ROOT)

	return {
		enabled: config.get<boolean>("enabled"),
		restore: config.get<boolean>("restore"),
		kinds: config.get<PiiMasking["kinds"]>("kinds"),
		terms: config.get<PiiMasking["terms"]>("terms"),
		dictionaryPaths: config.get<string[]>("dictionaryPaths"),
		secretLabels: config.get<string[]>("secretLabels"),
		properNouns: {
			enabled: config.get<boolean>("properNouns.enabled"),
			modelPath: config.get<string>("properNouns.modelPath"),
			modelUrl: config.get<string>("properNouns.modelUrl"),
			minScore: config.get<number>("properNouns.minScore"),
			entities: config.get<PiiMasking["properNouns"]>("properNouns.entities") as never,
			timeBudgetMs: config.get<number>("properNouns.timeBudgetMs"),
		},
	}
}
