# PII Guard for Copilot

Copilot へ送る前に、氏名・社名・連絡先などを伏せ字へ置き換える VS Code の拡張。

```
あなた:   @mask 株式会社サンプルの田中さんへ送る案内を書いて
Copilot へ: {{org-001}} の {{person-001}} へ送る案内を書いて
画面:      株式会社サンプルの田中さんへ、以下のとおりご案内します…
```

送るのはこの拡張が組み立てた文だけなので、**伏せ忘れたものが混ざる経路が無い。** 返って
きた文は元の値へ戻してから画面へ出すので、読むときは普通の日本語である。

## できないこと

**普通の Copilot Chat と補完は素通りする。** Copilot 自身の要求へ割り込む口は VS Code の
API に無い。伏せたいときは `@mask` と書く必要がある。

**取りこぼす。** 伏せるものがある文の約 1 割で何かしら残る。短い姓（`森` `林`）はとくに
弱い。**実際に扱う氏名や社名は辞書に書く**こと。完全一致なので取りこぼさない。

## 2 つの層

| | 何を見るか | モデル |
| --- | --- | --- |
| 第 1 層 | 形と検査数字と辞書（メールアドレス、電話、住所、番号、鍵、辞書の語） | 要らない |
| 第 2 層 | 前後の文からの固有名詞の判定（氏名、社名、地名、施設名） | 要る（約 282 MB） |

**第 1 層に人名の規則は無い。** 敬称から当てる規則は誤検出が多く、外してある。辞書に無い
氏名を伏せるには第 2 層が要る。

## 作り方

必要なもの: Node 20 以上、VS Code 1.95 以上。

```sh
cd ~/copilot-pii-guard
npm install
npm run check-types   # 型
npm test              # 試験（372 件）
npm run vsix          # 配布物を作る（bin/ の下）
```

`npm run vsix` は 3 つ作る。**第 2 層の native は platform ごとに違う**ので、分けて
作らないと動かない。

| 出来るもの | 対象 | 第 2 層 |
| --- | --- | --- |
| `copilot-pii-guard-linux-x64-0.1.0.vsix` | Linux (x64) | 動く |
| `copilot-pii-guard-win32-x64-0.1.0.vsix` | Windows (x64) | 動く |
| `copilot-pii-guard-0.1.0.vsix` | それ以外 | 動かない（第 1 層は動く） |

## 入れ方

```sh
code --install-extension bin/copilot-pii-guard-linux-x64-0.1.0.vsix
```

画面からも入れられる。拡張の一覧 → 右上の `…` → **VSIX からのインストール**。

入れたら VS Code を開き直し、Copilot Chat で `@mask` と打つ。一覧に **PII Guard** が
出れば入っている。

## 使い方

### Copilot Chat

`@mask` に続けて普通に書く。

```
@mask この議事録を要約して
```

### エディタ

右クリックに 3 つ増える。

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
| `piiGuard.enabled` | 入 | 伏せるかどうか |
| `piiGuard.terms` | 空 | 必ず伏せる語。**ここに書いたものは取りこぼさない** |
| `piiGuard.dictionaryPaths` | 空 | 辞書のファイル。空なら `~/.agent/pii-dictionary.txt` |
| `piiGuard.properNouns.enabled` | 切 | 第 2 層を使うか |
| `piiGuard.properNouns.timeBudgetMs` | 3000 | 判定の上限（ミリ秒）。**0 なら待ち続ける** |
| `piiGuard.properNouns.modelPath` | 空 | モデルの置き場所。空なら `~/.agent/pii-ner` |
| `piiGuard.properNouns.modelUrl` | 空 | モデルの取得先。**既定の取得先は持たない** |

### 辞書の書き方

1 行に 1 つ。種類はタブで区切る。`/.../` と書くと正規表現になる。

```
株式会社サンプル	org
田中太郎	person
/案件[0-9]{4}/	term
```

## 第 2 層を使うには

1. 設定で `piiGuard.properNouns.enabled` を入にする
2. `~/.agent/pii-ner` へモデルの 6 ファイルを置く
3. VS Code を開き直す

**閉鎖環境でも使える。** 別の機械で保存したファイルを媒体で運び、置き場所へ置けばよい。
拡張から見れば、取得した場合と区別が付かない。

網がある環境なら、`piiGuard.properNouns.modelUrl` に取得先を書いてから
`PII Guard: モデルを取得する` を実行する。**既定の取得先は持たない。** 持つと、誰の指示も
無く 282 MB を取りに行く経路を抱えることになる。

## 中身

```
src/
  extension.ts    入口。参加者とコマンドを登録する
  participant.ts  @mask の受け口。伏せて送り、戻して出す
  stream.ts       区切りをまたいだ伏せ字を戻す
  settings.ts     VS Code の設定を読む
  pii/            伏せる処理そのもの（第 1 層・第 2 層）
```

`src/pii` は [local-code-agent](https://github.com/zero-platform-lab/local-code-agent) から
写したものである。向こうで直したら、こちらへも写す。
