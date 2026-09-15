# 固有名詞検出モデルを作る

`model-ner-ja-v1` は、公開されている日本語の固有表現抽出モデルをONNXへ変換し、
int8へ量子化した配布物です。変換処理は拡張機能の中では実行しません。利用者の環境へ
Pythonや変換用ライブラリを追加せず、変換済みファイルだけを検証して読み込むためです。

## 変換元

- モデル: [tsmatz/xlm-roberta-ner-japanese](https://huggingface.co/tsmatz/xlm-roberta-ner-japanese)（MIT）
- 学習データ: [stockmark/ner-wikipedia-dataset](https://huggingface.co/datasets/stockmark/ner-wikipedia-dataset)（CC BY-SA 3.0）

## 必要なもの

- Python 3.11
- `scripts/model-requirements.txt` に記載した変換用ライブラリ
- モデルを取得できるネットワーク接続

DockerとNode.jsは使いません。変換用ライブラリをプラグインへ組み込むこともありません。

## Linux

リポジトリのルートで、変換専用の仮想環境を作って実行します。

```sh
python3.11 -m venv .venv-model
.venv-model/bin/python -m pip install -r scripts/model-requirements.txt
.venv-model/bin/python scripts/build_ner_model.py
```

出力先を変える場合:

```sh
.venv-model/bin/python scripts/build_ner_model.py build/another-model
```

## Windows

PowerShellでリポジトリのルートから、変換専用の仮想環境を作って実行します。

```powershell
py -3.11 -m venv .venv-model
.venv-model\Scripts\python.exe -m pip install -r scripts\model-requirements.txt
.venv-model\Scripts\python.exe scripts\build_ner_model.py
```

出力先を変える場合:

```powershell
.venv-model\Scripts\python.exe scripts\build_ner_model.py build\another-model
```

## 出力

`build/ner-model/upload` に、個別配布用のモデルファイル、`SHA256SUMS`、手動搬送用の
`ner-ja.tar.gz` が作られます。個別配布用ファイルは同じディレクトリへ平らに置き、
そのURLを `piiGuard.properNouns.modelUrl` に設定します。

READMEに記載しているURLは例示用です。実際の配布先へ置き換えてください。
