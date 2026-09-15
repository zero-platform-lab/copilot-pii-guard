// 画面へ出す文。本体の i18n を置き換える。
//
// **日本語だけを持つ。** 本体は 2 言語だが、この拡張は日本語の固有名詞を対象にしている。
// 英語の利用者に向けた機能ではない。

const MESSAGES: Record<string, string> = {
	"common:pii.noEditor": "開いているファイルがありません。",
	"common:pii.noVault": "戻せる伏せ字がありません。",
	"common:pii.nothingToRestore": "このファイルに伏せ字はありません。",
	"common:pii.replaceFailed": "置き換えられませんでした。",
	"common:pii.restored": "元の値へ戻しました。",
	"common:pii.masked": "{{count}} 件を伏せました。",
	"common:pii.confirmMask": "{{detail}}\n置き換えますか。取り消しの操作で元へ戻せます。",
	"common:pii.replace": "置き換える",
	"common:pii.dictionaryFailed": "辞書を読めませんでした: {{paths}}",
	"common:pii.maskingTrouble": "伏せ字を最後まで実行できませんでした: {{detail}}",
	"common:pii.noModelUrl":
		"取得先が設定されていません。設定の `piiGuard.properNouns.modelUrl` に URL を書くか、置き場所へ手でファイルを置いてください。",
	"common:pii.fetchingModel": "固有名詞の検出のモデルを取得しています",
	"common:pii.fetchFailed": "モデルを取得できませんでした: {{error}}",
	"common:pii.modelIncomplete": "モデルが揃っていません: {{detail}}",
	"common:pii.modelReady": "モデルを置きました: {{path}}",
	"common:pii.addedToDictionary": "辞書へ足しました: {{value}}",
	"common:pii.nothingSelected": "選んでいる範囲がありません。",
	"common:pii.dictionaryWriteFailed": "辞書へ書けませんでした: {{error}}",
	"common:pii.exported": "辞書を書き出しました: {{path}}",
}

/**
 * 文を引く。`{{name}}` を差し替える。
 *
 * **知らない鍵はそのまま返す。** 空文字を返すと、画面に何も出ないまま処理だけが進み、
 * 何が起きたのか分からなくなる。
 */
export function t(key: string, values: Record<string, unknown> = {}): string {
	const template = MESSAGES[key]
	if (template === undefined) return key

	return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
		name in values ? String(values[name]) : whole,
	)
}
