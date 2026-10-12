// 固有名詞検出のモデルを `dist/ner-model` へ写す。外へ出られない端末のための、モデルを
// 入れた配布物（`package-vsix.mjs --with-model=<dir>`）で使う。
//
// **写す前に `SHA256SUMS` と照合する。** 欠けたり壊れたりしたモデルを同梱すると、入れた
// 全員の端末で、固有名詞検出が動かないか、静かに検出が甘くなる。合わなければ束ねること
// 自体を失敗させる。

import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

/** 同梱するファイル。`src/pii/nerModel.ts` の `REQUIRED_FILES` と同じ並び。 */
export const NER_MODEL_FILES = [
	"config.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"special_tokens_map.json",
	"onnx/model_quantized.onnx",
]

export function copyNerModel(modelDir, distDir) {
	const sumsPath = path.join(modelDir, "SHA256SUMS")
	if (!fs.existsSync(sumsPath)) {
		throw new Error(`[copyNerModel] ${sumsPath} が無い。照合できないモデルは同梱しない`)
	}

	const sums = new Map()
	for (const line of fs.readFileSync(sumsPath, "utf8").split("\n")) {
		const found = /^([0-9a-f]{64})\s+\*?\.?\/?(.+?)\s*$/.exec(line)
		if (found) sums.set(found[2], found[1])
	}

	const dest = path.join(distDir, "ner-model")
	for (const name of NER_MODEL_FILES) {
		const expected = sums.get(name)
		if (!expected) {
			throw new Error(`[copyNerModel] SHA256SUMS に ${name} の値が無い`)
		}
		const source = path.join(modelDir, name)
		if (!fs.existsSync(source)) {
			throw new Error(`[copyNerModel] ${source} が無い`)
		}
		const actual = createHash("sha256").update(fs.readFileSync(source)).digest("hex")
		if (actual !== expected) {
			throw new Error(`[copyNerModel] ${name} が SHA256SUMS と合わない（壊れているか、別の版）`)
		}
		fs.mkdirSync(path.dirname(path.join(dest, name)), { recursive: true })
		fs.copyFileSync(source, path.join(dest, name))
	}
	fs.copyFileSync(sumsPath, path.join(dest, "SHA256SUMS"))

	console.log(`[copyNerModel] ${modelDir} から ${dest} へ写した`)
	return dest
}
