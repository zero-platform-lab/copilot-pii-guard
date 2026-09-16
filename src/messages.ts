// 画面へ出す文。本体の i18n を置き換える。
//
// **日本語だけを持つ。** 本体は 2 言語だが、この拡張は日本語の固有名詞を対象にしている。
// 英語の利用者に向けた機能ではない。

const MESSAGES: Record<string, string> = {
	"common:pii.noEditor": "開いているファイルがありません。",
	"common:pii.noVault": "戻せる伏せ字がありません。",
	"common:pii.sessionVault": "Session Vault全体",
	"common:pii.confirmClearVault":
		"{{scope}}の対応 {{count}} 件を消去します。消去後、この対応を使った伏せ字は元の値へ戻せません。",
	"common:pii.clearVault": "消去する",
	"common:pii.vaultCleared": "Session Vaultから {{count}} 件を消去しました。",
	"common:pii.fileVault.enable": "有効にする",
	"common:pii.fileVault.confirmEnable":
		"{{file}}のFile Vaultを有効にします。対応 {{count}} 件を暗号化し、ワークスペース専用領域へ保存します。暗号鍵は別の安全な領域へ保存します。",
	"common:pii.fileVault.enabled": "{{file}}のFile Vaultを有効にしました（対応 {{count}} 件）。",
	"common:pii.fileVault.alreadyEnabled": "{{file}}のFile Vaultはすでに有効です（対応 {{count}} 件）。",
	"common:pii.fileVault.confirmDisable":
		"{{file}}のFile Vaultと対応 {{count}} 件を消去します。消去後、この対応を使った伏せ字は元の値へ戻せません。",
	"common:pii.fileVault.disabled": "{{file}}のFile Vaultを消去し、永続化を無効にしました。",
	"common:pii.fileVault.notEnabled": "{{file}}のFile Vaultは無効です。",
	"common:pii.fileVault.statusEnabled": "{{file}}のFile Vaultは有効です（対応 {{count}} 件）。",
	"common:pii.fileVault.workspaceRequired": "File Vaultには、ワークスペース内の保存済みファイルが必要です。",
	"common:pii.fileVault.missingKey": "File Vaultの暗号鍵が見つからないため、読込も上書きも停止しました。",
	"common:pii.fileVault.corrupt": "File Vaultの改ざんまたは破損を検出したため、読込も上書きも停止しました。",
	"common:pii.fileVault.unsupported": "未対応形式のFile Vaultは読込も上書きもしません。",
	"common:pii.fileVault.failed": "File Vaultを安全に読み込めませんでした。既存データは変更していません。",
	"common:pii.fileVault.saveFailed": "ファイルは伏せましたが、File Vaultを更新できませんでした。",
	"common:pii.nothingToRestore": "このファイルに伏せ字はありません。",
	"common:pii.nothingFound": "伏せる個人情報は見つかりませんでした。",
	"common:pii.found": "{{summary}} が見つかりました。ファイルは変更していません。",
	"common:pii.replaceFailed": "置き換えられませんでした。",
	"common:pii.restored": "元の値へ戻しました。",
	"common:pii.replaced": "{{summary}} を伏せました。",
	"common:pii.documentChanged": "確認中にファイルが変わりました。もう一度実行してください。",
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
	"common:pii.termAdded": "辞書へ足しました: {{value}}（{{path}}）",
	"common:pii.nothingSelected": "選んでいる範囲がありません。",
	"common:pii.noSelection": "選んでいる範囲がありません。",
	"common:pii.selectionNotOneTerm": "改行やタブを含む語は辞書へ足せません。",
	"common:pii.dictionaryNotUtf8": "辞書が UTF-8 ではないため書き足せません: {{path}}",
	"common:pii.dictionaryWriteFailed": "辞書へ書けませんでした: {{error}}",
	"common:pii.exported": "辞書を書き出しました: {{path}}",
	"common:pii.nothingToExport": "書き出す辞書の語がありません。",
	"common:pii.pickDictionary": "追加先の辞書を選んでください。",
	"common:pii.pickKind": "語の種類を選んでください。",
	"common:pii.kind.person": "人名",
	"common:pii.kind.org": "組織名",
	"common:pii.kind.term": "指定語",
	"common:pii.kind.email": "メールアドレス",
	"common:pii.kind.phone": "電話番号",
	"common:pii.kind.host": "ホスト名",
	"common:pii.kind.ip": "IP アドレス",
	"common:pii.kind.card": "カード番号",
	"common:pii.kind.secret": "秘密情報",
	"common:pii.kind.zip": "郵便番号",
	"common:pii.kind.address": "住所",
	"common:pii.kind.mynumber": "マイナンバー",
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
