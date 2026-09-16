# PII Guard for Copilot

Copilot に送る前に、氏名・社名・連絡先などを伏せ字へ置き換える VS Code 拡張です。

```
あなた:   @mask 株式会社サンプルの田中さんへ送る案内を書いて
Copilot へ: {{org-001}} の {{person-001}} へ送る案内を書いて
画面:      株式会社サンプルの田中さんへ、以下のとおりご案内します…
```

この拡張が受け取った入力欄の文章、添付ファイル、選択範囲などの参照本文を伏せてから
Copilot に送ります。応答は元の値へ戻して表示します。

## できないこと

**通常の Copilot Chat と補完は対象外です。** VS Code API では Copilot 自身の送信処理へ
介入できません。伏せたい内容は `@mask` に送ってください。

**すべてを検出できるわけではありません。** 固有名詞の推定では、短い姓（`森`、`林`）などを
見落とすことがあります。実際に扱う氏名や社名は辞書へ登録してください。辞書に登録した語は
完全一致で検出します。

## 検出のしくみ

| 方式 | 何を見るか | モデル |
| --- | --- | --- |
| 基本検出 | 形と検査数字と辞書（メールアドレス、電話、住所、番号、鍵、辞書の語） | 要らない |
| 固有名詞検出 | 前後の文から氏名、社名、地名、施設名を判定する | 要る |

**基本検出に人名の推測規則はありません。** 敬称から当てる規則は誤検出が多いためです。
辞書にない氏名を伏せるには、固有名詞検出を有効にします。

## 開発

必要なもの: Node 20 以上、VS Code 1.95 以上。

```sh
cd ~/copilot-pii-guard
npm install
npm run check-types   # 型チェック
npm test              # テスト
npm run vsix          # VSIX を bin/ に生成
```

`npm run vsix` は3種類の VSIX を生成します。固有名詞検出で使う native モジュールはOSごとに異なるためです。

| 出来るもの | 対象 | 固有名詞検出 |
| --- | --- | --- |
| `copilot-pii-guard-linux-x64-0.2.5.vsix` | Linux (x64) | 動く |
| `copilot-pii-guard-win32-x64-0.2.5.vsix` | Windows (x64) | 動く |
| `copilot-pii-guard-0.2.5.vsix` | それ以外 | 動かない（基本検出は動く） |

## 入れ方

```sh
code --install-extension bin/copilot-pii-guard-linux-x64-0.2.5.vsix
```

VS Code の画面からは、拡張機能ビューの右上にある `…` から **VSIX からのインストール** を選びます。

インストール後に VS Code を再起動し、Copilot Chat で `@mask` と入力してください。候補に
**PII Guard** が表示されれば利用できます。

## 使い方

### Copilot Chat

`@mask` に続けて普通に書く。

```
@mask この議事録を要約して
```

同じチャットで `@mask` を続けて使うと、それまでの `@mask` との会話も伏せて引き継ぎます。
VS Codeが拡張機能へ渡すのは同じ参加者の履歴だけなので、通常のCopilotとの会話から途中で
`@mask` へ切り替えた場合、それ以前の会話は引き継げません。

添付したファイルや選択範囲も、`@mask` が受け取れた本文は同じように伏せます。読み込めない
参照は Copilot へ送らず、チャットに警告を表示します。

`@mask` は、開いている作業場所のファイルを一覧・検索・読取・書込できる専用の道具を
Copilotへ渡します。読んだ本文、検索結果、ファイル名は、道具からCopilotへ戻す前にも
伏せます。ほかの拡張機能が登録した道具は、伏せ字化の経路を保証できないため渡しません。

ファイル道具には `off`、`readOnly`、`confirmEdit` の3つの権限があります。既定の
`confirmEdit` では、一覧・検索・読取をその依頼で初めて使う前に確認し、書込は毎回確認します。
`readOnly` は書込道具をCopilotへ渡さず、`off` はすべてのファイル道具を渡しません。
伏せ字化がオフの場合は、設定にかかわらずファイル道具を停止します。
1回のモデル応答では最大8件、1つの依頼では合計24件、うち書込は8件までに制限します。

ファイルへ書く内容は、既定では伏せ字のままです。設定 `piiGuard.fileWrites.restore` をオンに
すると、書き込む直前だけ、この拡張の中で元の値へ戻します。どちらのモードでも書込前に
VS Codeの差分エディタと確認画面を出し、復元した本文をCopilotへ返すことはありません。
確認中に文書やディスク上のファイルが変わった場合は、古い差分を適用せず停止します。書込は
VS Code上の文書へ変更を適用します。未保存の場合はそのことを結果へ表示するため、内容を確認して
保存してください。

応答の先頭には、伏せ字化の状態と件数を表示します。

```
🛡 伏せました。 氏名 2 / 社名 1 / メールアドレス 1
🛡 ファイル道具: confirmEdit 読取は依頼ごと、書込は毎回確認します。
🛡 Write Restore: 切 ファイル道具は伏せ字のまま書きます。
```

```
⚠️ 伏せていません。設定 piiGuard.enabled が切になっています。
```

### エディタ

右クリックの **PII Guard** メニューに、伏せ字化、辞書、File Vaultの操作を追加します。

| 項目 | 何をするか |
| --- | --- |
| このファイルの個人情報を確認する | 検出した種類と件数だけを表示する（ファイルは変更しない） |
| このファイルの個人情報を伏せる | ファイルの中身を伏せ字へ置き換える（取り消しで戻せる） |
| 伏せ字を元の値へ戻す | 置き換えたものを戻す |
| 選んだ語を辞書へ足す | 選んだ語を、必ず伏せる語として覚える |
| このファイルのFile Vaultを有効にする | このファイルの対応表を暗号化してセッション間で保持する |
| このファイルのFile Vaultを消去する | 暗号化した対応表を消去し、永続化を無効にする |
| このファイルのFile Vault状態を確かめる | 有効・無効と保存している対応数を表示する |

`Ctrl+Shift+P` からは、さらにFile Vaultの一括消去を含む操作を実行できる。

| 項目 | 何をするか |
| --- | --- |
| PII Guard: Session Vaultを消去する | 現在のセッションで保持している伏せ字対応を、確認後にすべて消去する |
| PII Guard: 選んだFile Vaultを消去する | 一覧から選んだ複数ファイルの対応を確認後に消去する |
| PII Guard: すべてのFile Vaultを消去する | ワークスペースの全File Vaultを確認後に消去する |
| PII Guard: 辞書を書き出す | 設定と辞書に散らばった語を 1 つにまとめて書き出す |
| PII Guard: モデルの置き場所を確かめる | どこを見ていて、置かれているかを出す |
| PII Guard: モデルを取得する | 取得先からモデルを取る（取得先を書いていなければ断る） |

Session Vaultは、元の値と伏せ字の対応を拡張機能ホストのメモリ内だけに保持し、`@mask`の
会話とエディタ操作で共有します。VS Codeの再読み込みまたは終了で破棄されます。コマンドで
消去した対応は復元できないため、消去前に対応数を表示して確認します。

File Vaultはファイルごとの明示的なオプトインです。対応表は認証付き暗号で暗号化して
ワークスペース固有の拡張機能専用領域へ保存し、暗号鍵はVS CodeのSecretStorageへ分離します。
ファイル本文、リポジトリ、Settings Syncには保存しません。既定では最終利用から30日後に
消去します。VS Codeから行った名前変更・移動には追従し、起動時と利用前には対象ファイルが
残っていることを確認します。対象ファイルを`@mask`へ添付、選択範囲として参照、または
ファイル道具で扱うときに対応を読み込み、別ファイルの伏せ字番号と衝突した場合は再割当します。

## 設定

VS Code の設定で `piiGuard` を検索する。

| 設定 | 既定 | 何を決めるか |
| --- | --- | --- |
| `piiGuard.enabled` | オン | 伏せ字化の有効・無効 |
| `piiGuard.restore` | オン | Copilotの応答にある伏せ字を、画面へ出すとき元の値へ戻すか |
| `piiGuard.fileWrites.restore` | オフ | Write Restoreモード。ファイル道具が書く直前に元の値へ戻すか |
| `piiGuard.fileTools.mode` | `confirmEdit` | ファイル道具を使わない、読取専用、確認付き編集のどれにするか |
| `piiGuard.sessionVault.maxEntries` | `10000` | Session Vaultへ登録できる対応数の上限。`0` は無制限 |
| `piiGuard.fileVault.retentionDays` | `30` | File Vaultを最終利用から保持する日数。`0` は時間による期限なし |
| `piiGuard.fileVault.maxFiles` | `100` | File Vaultを有効にできるファイル数の上限。`0` は無制限 |
| `piiGuard.fileVault.maxEntriesPerFile` | `1000` | 1ファイルに保存できる対応数の上限。`0` は無制限 |
| `piiGuard.fileVault.maxBytes` | `5242880` | File Vault全体の暗号化前データ量の上限（バイト）。`0` は無制限 |
| `piiGuard.terms` | 空 | 必ず伏せたい語。登録した語は完全一致で検出します |
| `piiGuard.dictionaryPaths` | 空 | 辞書ファイルの場所。空なら `~/.agent/pii-dictionary.txt` |
| `piiGuard.properNouns.enabled` | オフ | 固有名詞検出を使うか |
| `piiGuard.properNouns.timeBudgetMs` | 10000 | 検出に使う上限時間（ミリ秒）。`0` は時間制限なし |
| `piiGuard.properNouns.retryCount` | 3 | 時間切れまたは一時的な失敗後の再試行回数。`0` は再試行なし |
| `piiGuard.properNouns.modelPath` | 空 | モデルの場所。空なら `~/.agent/pii-ner` |
| `piiGuard.properNouns.modelUrl` | 空 | モデルの取得先URL。既定の取得先はありません |
| `piiGuard.kinds` | すべてオン | 伏せ字化する種類（12種類） |
| `piiGuard.properNouns.entities` | 6種類オン | 固有名詞検出の区分。製品名とイベント名は既定で除外 |

### 伏せる種類（`piiGuard.kinds`）

基本検出・辞書・固有名詞検出に共通する、最終的な伏せ字の種類です。オフにした種類は、
どの方式で見つけても伏せずに送ります。

| 種類 | 伏せるもの |
| --- | --- |
| `person` | 辞書に人名として登録した語と、固有名詞検出の `PER` |
| `org` | 辞書に組織名として登録した語と、固有名詞検出の `ORG`・`ORG-P`・`ORG-O`・`INS` |
| `term` | 種類を指定せず辞書へ登録した語と、固有名詞検出の `PRD`・`EVT` |
| `email` | メールアドレス |
| `phone` | 日本の形式の電話番号 |
| `host` | `.local`・`.internal` などで終わる社内向けのホスト名 |
| `ip` | 外向けのIPアドレス。プライベートIPと `localhost` は対象外 |
| `card` | 検査数字が一致するクレジットカード番号 |
| `secret` | APIキー、token、パスワードなどの秘密情報 |
| `zip` | `〒` または「郵便番号」の後ろにある郵便番号 |
| `address` | 都道府県か市区町村から始まり、番地を含む住所と、固有名詞検出の `LOC` |
| `mynumber` | 検査数字が一致するマイナンバー |

### 固有名詞の区分（`piiGuard.properNouns.entities`）

固有名詞検出モデルが返す区分のうち、どれを採用するかを選びます。この設定は
`piiGuard.properNouns.enabled` がオンのときだけ使われます。

| 区分 | 意味 | 伏せ字の種類 | 既定 |
| --- | --- | --- | --- |
| `PER` | 人名 | `person` | オン |
| `ORG` | 会社・団体などの一般的な組織名 | `org` | オン |
| `ORG-P` | 政党・政府などの政治的な組織名 | `org` | オン |
| `ORG-O` | ほかの区分に当てはまらない組織名 | `org` | オン |
| `LOC` | 国、都道府県、市区町村などの地名 | `address` | オン |
| `INS` | 駅、学校、病院、建物などの施設名 | `org` | オン |
| `PRD` | 製品名 | `term` | オフ |
| `EVT` | 大会、会議、祭典などのイベント名 | `term` | オフ |

`entities`で採用しても、対応する`kinds`がオフなら伏せません。例えば `PER` がオンでも
`person` がオフなら、推定した人名はそのまま送ります。`PRD` と `EVT` は、ReactやDocker
など会話の主題まで伏せてしまう可能性があるため、既定ではオフです。

### 辞書の書き方

1 行に 1 つ。種類はタブで区切る。`/.../` と書くと正規表現になる。

```
株式会社サンプル	org
田中太郎	person
/案件[0-9]{4}/	term
```

## 固有名詞検出を使うには

1. 設定で `piiGuard.properNouns.enabled` をオンにする
2. 配布された `model-ner-ja-v1` の6ファイルを `~/.agent/pii-ner` に配置する
3. VS Code を再起動する

置き方は次のとおり。**`model_quantized.onnx` だけ `onnx/` の下**へ置く。

```
~/.agent/pii-ner/
  ├ onnx/
  │   └ model_quantized.onnx
  ├ config.json
  ├ tokenizer.json
  ├ tokenizer_config.json
  ├ special_tokens_map.json
  └ SHA256SUMS
```

閉鎖環境でも使えます。別の端末でダウンロードしたファイルを媒体で運び、上記の場所へ配置してください。

インターネットに接続できる環境では、`piiGuard.properNouns.modelUrl` に次のURLを設定してから
`PII Guard: モデルを取得する` を実行します。

```
https://example.invalid/model-ner-ja-v1
```

既定の取得先はありません。明示的な設定なしに大容量のモデルをダウンロードしないためです。

### モデルの由来

`model-ner-ja-v1` は、MITライセンスの
[tsmatz/xlm-roberta-ner-japanese](https://huggingface.co/tsmatz/xlm-roberta-ner-japanese) を
ONNXへ変換し、int8へ量子化したものです。元モデルは、日本語Wikipediaから作られた
[stockmark/ner-wikipedia-dataset](https://huggingface.co/datasets/stockmark/ner-wikipedia-dataset)
（CC BY-SA 3.0）で固有表現抽出向けに学習されています。元のモデルとデータセットは、それぞれの
配布ページから確認できます。

### モデルを作り直す

変換用のスクリプトと依存一覧はVSIXにも入っています。VSIXだけを受け取った場合は、まず
VSIXをZIPとして展開します。

Linux:

```sh
unzip copilot-pii-guard-linux-x64-0.2.5.vsix -d pii-guard-model-builder
cd pii-guard-model-builder/extension
```

Windows（PowerShell）:

```powershell
Copy-Item .\copilot-pii-guard-win32-x64-0.2.5.vsix .\copilot-pii-guard.zip
Expand-Archive .\copilot-pii-guard.zip -DestinationPath .\pii-guard-model-builder
Set-Location .\pii-guard-model-builder\extension
```

リポジトリを取得済みの場合は、展開せずリポジトリのルートで次へ進みます。

必要なものはPython 3.11と、モデルを取得できるネットワーク接続です。DockerとNode.jsは
使いません。

Linux:

```sh
python3.11 -m venv .venv-model
.venv-model/bin/python -m pip install -r scripts/model-requirements.txt
.venv-model/bin/python scripts/build_ner_model.py
```

Windows（PowerShell）:

```powershell
py -3.11 -m venv .venv-model
.venv-model\Scripts\python.exe -m pip install -r scripts\model-requirements.txt
.venv-model\Scripts\python.exe scripts\build_ner_model.py
```

`build/ner-model/upload` に、個別配布用のモデルファイル、`SHA256SUMS`、手動搬送用の
`ner-ja.tar.gz` が作られます。別の出力先を指定する場合は、スクリプトの末尾へパスを渡します。

```sh
.venv-model/bin/python scripts/build_ner_model.py build/another-model
```

個別配布用ファイルは同じディレクトリへ平らに置き、そのURLを
`piiGuard.properNouns.modelUrl` に設定します。READMEに記載しているURLは例示用です。

## 中身

```
src/
  extension.ts    入口。参加者とコマンドを登録する
  participant.ts  @mask の受け口。伏せて送り、戻して出す
  fileTools.ts    @mask専用のファイル一覧・検索・読取・書込
  stream.ts       区切りをまたいだ伏せ字を戻す
  settings.ts     VS Code の設定を読む
  pii/            伏せる処理そのもの
```

今後のエージェント機能は、[Masked Code Agent 要求仕様・機能設計](docs/masked-agent-requirements.md)
にまとめています。
