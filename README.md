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
| `copilot-pii-guard-linux-x64-0.2.3.vsix` | Linux (x64) | 動く |
| `copilot-pii-guard-win32-x64-0.2.3.vsix` | Windows (x64) | 動く |
| `copilot-pii-guard-0.2.3.vsix` | それ以外 | 動かない（基本検出は動く） |

## 入れ方

```sh
code --install-extension bin/copilot-pii-guard-linux-x64-0.2.3.vsix
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

添付したファイルや選択範囲も、`@mask` が受け取れた本文は同じように伏せます。読み込めない
参照は Copilot へ送らず、チャットに警告を表示します。

応答の先頭には、伏せ字化の状態と件数を表示します。

```
🛡 伏せました。 氏名 2 / 社名 1 / メールアドレス 1
```

```
⚠️ 伏せていません。設定 piiGuard.enabled が切になっています。
```

### エディタ

右クリックの **PII Guard** メニューに 3 つの操作を追加します。

| 項目 | 何をするか |
| --- | --- |
| このファイルの個人情報を伏せる | ファイルの中身を伏せ字へ置き換える（取り消しで戻せる） |
| 伏せ字を元の値へ戻す | 置き換えたものを戻す |
| 選んだ語を辞書へ足す | 選んだ語を、必ず伏せる語として覚える |

`Ctrl+Shift+P` からは、さらに 3 つ実行できる。

| 項目 | 何をするか |
| --- | --- |
| PII Guard: 辞書を書き出す | 設定と辞書に散らばった語を 1 つにまとめて書き出す |
| PII Guard: モデルの置き場所を確かめる | どこを見ていて、置かれているかを出す |
| PII Guard: モデルを取得する | 取得先からモデルを取る（取得先を書いていなければ断る） |

## 設定

VS Code の設定で `piiGuard` を検索する。

| 設定 | 既定 | 何を決めるか |
| --- | --- | --- |
| `piiGuard.enabled` | オン | 伏せ字化の有効・無効 |
| `piiGuard.terms` | 空 | 必ず伏せたい語。登録した語は完全一致で検出します |
| `piiGuard.dictionaryPaths` | 空 | 辞書ファイルの場所。空なら `~/.agent/pii-dictionary.txt` |
| `piiGuard.properNouns.enabled` | オフ | 固有名詞検出を使うか |
| `piiGuard.properNouns.timeBudgetMs` | 10000 | 検出に使う上限時間（ミリ秒）。`0` は時間制限なし |
| `piiGuard.properNouns.retryCount` | 3 | 時間切れまたは一時的な失敗後の再試行回数。`0` は再試行なし |
| `piiGuard.properNouns.modelPath` | 空 | モデルの場所。空なら `~/.agent/pii-ner` |
| `piiGuard.properNouns.modelUrl` | 空 | モデルの取得先URL。既定の取得先はありません |
| `piiGuard.kinds` | すべてオン | 伏せ字化する種類（12種類） |
| `piiGuard.properNouns.entities` | 6種類オン | 固有名詞検出の区分。製品名とイベント名は既定で除外 |

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

モデルを作り直す手順は `docs/build-ner-model.md` に記載しています。

## 中身

```
src/
  extension.ts    入口。参加者とコマンドを登録する
  participant.ts  @mask の受け口。伏せて送り、戻して出す
  stream.ts       区切りをまたいだ伏せ字を戻す
  settings.ts     VS Code の設定を読む
  pii/            伏せる処理そのもの
```
