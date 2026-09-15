#!/usr/bin/env python3
"""公開モデルを取得し、PII Guard用のONNX配布物を作る。"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path


DEFAULT_MODEL = "tsmatz/xlm-roberta-ner-japanese"
DEFAULT_OUTPUT = Path("build/ner-model")
REQUIRED_FILES = (
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "onnx/model_quantized.onnx",
)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="公開モデルをONNXへ変換・量子化し、PII Guard用の配布物を作ります。"
    )
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"出力先（既定: {DEFAULT_OUTPUT.as_posix()}）",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"変換元のHugging FaceモデルID（既定: {DEFAULT_MODEL}）",
    )
    return parser.parse_args()


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, shell=False)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def reset_directory(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True)


def main() -> None:
    args = arguments()
    output = args.output.resolve()
    if output == Path(output.anchor):
        raise SystemExit("ファイルシステムのルートは出力先に指定できません。")

    executable_name = "optimum-cli.exe" if sys.platform == "win32" else "optimum-cli"
    beside_python = Path(sys.executable).parent / executable_name
    optimum = str(beside_python) if beside_python.is_file() else shutil.which("optimum-cli")
    if optimum is None:
        raise SystemExit(
            "optimum-cli が見つかりません。model-requirements.txt の環境から実行してください。"
        )

    output.mkdir(parents=True, exist_ok=True)
    fp32 = output / "fp32"
    int8 = output / "int8"
    dist = output / "ner-ja"
    upload = output / "upload"
    for directory in (fp32, int8, dist, upload):
        reset_directory(directory)

    print("元モデルを取得してONNXへ変換します。", flush=True)
    run(
        [
            optimum,
            "export",
            "onnx",
            "--model",
            args.model,
            "--task",
            "token-classification",
            str(fp32),
        ]
    )

    print("モデルをint8へ量子化します。", flush=True)
    run(
        [
            optimum,
            "onnxruntime",
            "quantize",
            "--onnx_model",
            str(fp32),
            "--avx2",
            "-o",
            str(int8),
        ]
    )

    (dist / "onnx").mkdir(parents=True)
    for name in REQUIRED_FILES:
        source = int8 / Path(name).name if name.startswith("onnx/") else fp32 / name
        target = dist / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

    archive = output / "ner-ja.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        bundle.add(dist, arcname="ner-ja")

    checksums = [f"{sha256(dist / name)}  ./{name}" for name in REQUIRED_FILES]
    checksums.append(f"{sha256(archive)}  {archive.name}")
    checksum_file = output / "SHA256SUMS"
    checksum_file.write_text("\n".join(checksums) + "\n", encoding="utf-8")

    for name in REQUIRED_FILES:
        shutil.copy2(dist / name, upload / Path(name).name)
    shutil.copy2(checksum_file, upload / checksum_file.name)
    shutil.copy2(archive, upload / archive.name)

    print(f"配布用ファイルを作成しました: {upload}")


if __name__ == "__main__":
    main()
