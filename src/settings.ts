// VS Code の設定から、伏せ字の設定を読む。
//
// **本体と違い、画面は持たない。** 本体は webview の設定の画面を持つが、この拡張は
// `contributes.configuration` だけで足りる。設定の画面を自前で持つと、VS Code の
// 設定の検索から外れて見つけてもらえない。

import * as vscode from "vscode"

import { fileToolModes, type FileToolMode, type PiiMasking } from "./types"

/**
 * チェックの入っている名前だけを並べる。
 *
 * **設定はチェックの形で持つ。** 配列だと、設定の画面では 1 行ずつ足す形になり、何を
 * 書けるのかも、その種類が何を指すのかも画面に出ない。真偽値を並べれば、種類ごとに
 * 説明が付く。読むほうは名前の並びが要るので、ここで変える。
 *
 * **読めなければ `undefined` を返す。** 空の配列を返すと「1 つも伏せない」という意思に
 * なり、設定を読めていないだけなのに伏せずに送ってしまう。
 */
function checkedNames<T extends string>(value: Record<string, boolean> | undefined): T[] | undefined {
	if (!value || typeof value !== "object") return undefined

	return Object.entries(value)
		.filter(([, on]) => on === true)
		.map(([name]) => name as T)
}

/** 設定の根。`package.json` の `contributes.configuration` と揃える。 */
const ROOT = "piiGuard"

/** 未知の値は権限を広げず `off` へ倒す。未設定だけは現行互換の既定を使う。 */
function fileToolMode(value: unknown): FileToolMode {
	if (value === undefined) return "confirmEdit"
	return fileToolModes.includes(value as FileToolMode) ? (value as FileToolMode) : "off"
}

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
		fileWrites: {
			restore: config.get<boolean>("fileWrites.restore"),
		},
		fileTools: {
			mode: fileToolMode(config.get<unknown>("fileTools.mode")),
		},
		fileVault: {
			retentionDays: config.get<number>("fileVault.retentionDays"),
		},
		kinds: checkedNames<NonNullable<PiiMasking["kinds"]>[number]>(
			config.get<Record<string, boolean>>("kinds"),
		),
		terms: config.get<PiiMasking["terms"]>("terms"),
		dictionaryPaths: config.get<string[]>("dictionaryPaths"),
		secretLabels: config.get<string[]>("secretLabels"),
		properNouns: {
			enabled: config.get<boolean>("properNouns.enabled"),
			modelPath: config.get<string>("properNouns.modelPath"),
			modelUrl: config.get<string>("properNouns.modelUrl"),
			minScore: config.get<number>("properNouns.minScore"),
			entities: checkedNames<NonNullable<NonNullable<PiiMasking["properNouns"]>["entities"]>[number]>(
				config.get<Record<string, boolean>>("properNouns.entities"),
			),
			timeBudgetMs: config.get<number>("properNouns.timeBudgetMs"),
			retryCount: config.get<number>("properNouns.retryCount"),
		},
	}
}
