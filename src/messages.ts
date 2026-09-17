// 画面へ出す文。本体の i18n を置き換える。
//
// **日本語だけを持つ。** 本体は 2 言語だが、この拡張は日本語の固有名詞を対象にしている。
// 英語の利用者に向けた機能ではない。

const MESSAGES: Record<string, string> = {
	"common:pii.noEditor": "開いているファイルがありません。",
	"common:pii.noMapping": "戻せる伏せ字がありません。",
	"common:pii.sessionMapping": "セッション対応表全体",
	"common:pii.confirmClearMapping":
		"{{scope}}の対応 {{count}} 件を消去します。消去後、この対応を使った伏せ字は元の値へ戻せません。",
	"common:pii.clearMapping": "消去する",
	"common:pii.mappingCleared": "セッション対応表から {{count}} 件を消去しました。",
	"common:pii.sessionMapping.maxEntries":
		"セッション対応表の対応数が設定上限に達したため、伏せ字化を停止しました。上限を増やすか、セッション対応表を消去してください。",
	"common:pii.fileMapping.enable": "有効にする",
	"common:pii.fileMapping.confirmEnable":
		"{{file}}のファイル対応表を有効にします。対応 {{count}} 件をワークスペース専用領域へ保存します。",
	"common:pii.fileMapping.enabled": "{{file}}のファイル対応表を有効にしました（対応 {{count}} 件）。",
	"common:pii.fileMapping.alreadyEnabled": "{{file}}のファイル対応表はすでに有効です（対応 {{count}} 件）。",
	"common:pii.fileMapping.confirmDisable":
		"{{file}}のファイル対応表と対応 {{count}} 件を消去します。消去後、この対応を使った伏せ字は元の値へ戻せません。",
	"common:pii.fileMapping.disabled": "{{file}}のファイル対応表を消去し、永続化を無効にしました。",
	"common:pii.fileMapping.notEnabled": "{{file}}のファイル対応表は無効です。",
	"common:pii.fileMapping.statusEnabled": "{{file}}のファイル対応表は有効です（対応 {{count}} 件）。",
	"common:pii.fileMapping.workspaceRequired": "ファイル対応表には、ワークスペース内の保存済みファイルが必要です。",
	"common:pii.fileMapping.corrupt": "ファイル対応表の破損を検出したため、読込も上書きも停止しました。",
	"common:pii.fileMapping.unsupported": "未対応形式のファイル対応表は読込も上書きもしません。",
	"common:pii.fileMapping.failed": "ファイル対応表を読み込めませんでした。既存データは変更していません。",
	"common:pii.fileMapping.saveFailed": "ファイルは伏せましたが、ファイル対応表を更新できませんでした。",
	"common:pii.fileMapping.rootInsideWorkspace": "対応表は元の値を含みます。保管ルートがワークスペース内にあると、エージェントが読み取ってLLMへ送る恐れがあります。ワークスペースの外のパスを指してください。",
	"common:pii.fileMapping.rootNotAbsolute": "保管ルートには絶対パスを指してください。相対パスは無視し、既定の保管場所を使います。",
	"common:pii.fileMapping.maxFiles": "ファイル対応表のファイル数が設定上限に達したため、保存しませんでした。",
	"common:pii.fileMapping.maxEntries": "このファイルの対応数が設定上限に達したため、保存しませんでした。",
	"common:pii.fileMapping.maxBytes": "ファイル対応表全体の容量が設定上限に達したため、保存しませんでした。",
	"common:pii.fileMapping.none": "消去できるファイル対応表がありません。",
	"common:pii.fileMapping.entryCount": "対応 {{count}} 件",
	"common:pii.fileMapping.pickClear": "消去するファイル対応表を選んでください。",
	"common:pii.fileMapping.confirmClearMany":
		"ファイル対応表 {{files}} ファイル、対応 {{count}} 件を消去します。消去後は元の値へ戻せません。",
	"common:pii.fileMapping.clearedMany": "ファイル対応表 {{files}} ファイル、対応 {{count}} 件を消去しました。",
	"common:pii.fileMapping.confirmClearAll":
		"ファイル対応表 {{files}} ファイル（対応 {{fileCount}} 件）とセッション対応表（対応 {{sessionCount}} 件）をすべて消去します。消去後は元の値へ戻せません。",
	"common:pii.fileMapping.clearedAll":
		"ファイル対応表 {{files}} ファイル（対応 {{fileCount}} 件）とセッション対応表（対応 {{sessionCount}} 件）を消去しました。",
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

	return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
}
