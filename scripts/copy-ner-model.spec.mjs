import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { REQUIRED_FILES } from "../src/pii/nerModel"
import { copyNerModel, NER_MODEL_FILES } from "./copy-ner-model.mjs"

let dir
let model
let dist

/** 中身の小さい偽のモデルと、その照合値を置く。 */
function placeModel(files = NER_MODEL_FILES) {
	const lines = []
	for (const name of files) {
		const file = path.join(model, name)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, `content of ${name}`)
		lines.push(`${createHash("sha256").update(`content of ${name}`).digest("hex")}  ./${name}`)
	}
	fs.writeFileSync(path.join(model, "SHA256SUMS"), lines.join("\n") + "\n")
}

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-ner-model-"))
	model = path.join(dir, "model")
	dist = path.join(dir, "dist")
	fs.mkdirSync(model)
	vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
	fs.rmSync(dir, { recursive: true, force: true })
})

describe("copyNerModel", () => {
	it("同梱するファイルは、拡張が照合で要求するファイルと同じ", () => {
		expect(NER_MODEL_FILES).toEqual([...REQUIRED_FILES])
	})

	it("照合に合うモデルを、照合値と一緒に dist/ner-model へ写す", () => {
		placeModel()

		expect(copyNerModel(model, dist)).toBe(path.join(dist, "ner-model"))
		for (const name of [...NER_MODEL_FILES, "SHA256SUMS"]) {
			expect(fs.readFileSync(path.join(dist, "ner-model", name), "utf8")).toBe(
				fs.readFileSync(path.join(model, name), "utf8"),
			)
		}
	})

	it("照合値が無いモデルは同梱しない", () => {
		expect(() => copyNerModel(model, dist)).toThrow("照合できないモデルは同梱しない")
	})

	it("照合値に載っていないファイルがあれば止める", () => {
		placeModel(NER_MODEL_FILES.slice(0, -1))

		expect(() => copyNerModel(model, dist)).toThrow("SHA256SUMS に onnx/model_quantized.onnx の値が無い")
	})

	it("照合値にあるのに置かれていないファイルがあれば止める", () => {
		placeModel()
		fs.rmSync(path.join(model, "tokenizer.json"))

		expect(() => copyNerModel(model, dist)).toThrow(`${path.join(model, "tokenizer.json")} が無い`)
	})

	it("中身が照合値と合わなければ止め、途中まで写したものを照合値なしで残さない", () => {
		placeModel()
		fs.writeFileSync(path.join(model, "onnx", "model_quantized.onnx"), "壊れた")

		expect(() => copyNerModel(model, dist)).toThrow("onnx/model_quantized.onnx が SHA256SUMS と合わない")
		// 照合値が無いので、拡張は同梱とみなさない（bundledModelDirectory）。
		expect(fs.existsSync(path.join(dist, "ner-model", "SHA256SUMS"))).toBe(false)
	})
})
