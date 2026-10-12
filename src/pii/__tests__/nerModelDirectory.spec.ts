// npx vitest run services/pii/__tests__/nerModelDirectory.spec.ts
//
// 第 2 層のモデルの置き場所の決め方。利用者の指定 → 既定の置き場所 → 同梱のモデルの順。

import { readFileSync, promises as fs } from "fs"
import * as os from "os"
import * as path from "path"

import { bundledModelDirectory, CHECKSUM_FILE, defaultModelDirectory, modelDirectoryFor } from "../nerModel"

describe("bundledModelDirectory", () => {
	let base: string

	beforeEach(async () => {
		base = await fs.mkdtemp(path.join(os.tmpdir(), "bundled-ner-"))
	})

	afterEach(async () => {
		await fs.rm(base, { recursive: true, force: true })
	})

	it("同梱していない配布物では undefined", () => {
		expect(bundledModelDirectory(base)).toBeUndefined()
	})

	it("照合の値（SHA256SUMS）が無ければ、同梱とみなさない", async () => {
		await fs.mkdir(path.join(base, "ner-model"))

		expect(bundledModelDirectory(base)).toBeUndefined()
	})

	it("dist/ner-model に SHA256SUMS があれば、その場所を返す", async () => {
		await fs.mkdir(path.join(base, "ner-model"))
		await fs.writeFile(path.join(base, "ner-model", CHECKSUM_FILE), "")

		expect(bundledModelDirectory(base)).toBe(path.join(base, "ner-model"))
	})

	it("既定では、束ねた extension.js の隣（__dirname）を見る", () => {
		// 試験では src/services/pii を見るので、同梱は無い
		expect(bundledModelDirectory()).toBeUndefined()
	})
})

describe("modelDirectoryFor", () => {
	let base: string

	beforeEach(async () => {
		base = await fs.mkdtemp(path.join(os.tmpdir(), "bundled-ner-"))
		await fs.mkdir(path.join(base, "ner-model"))
		await fs.writeFile(path.join(base, "ner-model", CHECKSUM_FILE), "")
	})

	afterEach(async () => {
		await fs.rm(base, { recursive: true, force: true })
	})

	it("利用者の指定があれば、同梱のモデルより優先する", () => {
		expect(modelDirectoryFor("/models/ner", base)).toBe("/models/ner")
	})

	it("指定が無く、まだ写していなければ、同梱のモデルを使う", () => {
		expect(modelDirectoryFor(undefined, base, path.join(base, "home-ner"))).toBe(path.join(base, "ner-model"))
	})

	it("同梱のモデルを既定の置き場所へ写したあとは、既定の置き場所を使う", async () => {
		const copied = path.join(base, "home-ner")
		// 写す前は同梱の場所を見て、写したあとは既定の場所へ移る
		expect(modelDirectoryFor(undefined, base, copied)).toBe(path.join(base, "ner-model"))
		await fs.mkdir(copied)
		await fs.writeFile(path.join(copied, CHECKSUM_FILE), "")

		expect(modelDirectoryFor(undefined, base, copied)).toBe(copied)
	})

	it("既定の置き場所に照合の値が無ければ、写したものとはみなさない", async () => {
		const partial = path.join(base, "home-ner")
		await fs.mkdir(partial)

		expect(modelDirectoryFor(undefined, base, partial)).toBe(path.join(base, "ner-model"))
	})

	it("指定も同梱も無ければ、既定の置き場所を使う", () => {
		expect(modelDirectoryFor(undefined, path.join(base, "nowhere"))).toBe(defaultModelDirectory())
	})
})

// 置き場所を決める箇所は 3 つ。判定と画面の表示は同じ順で決め、取ってくる先には同梱の場所を使わない。
// 箇所を足した人が赤で気づくよう、ソースを読んで数と使い分けを固定する。
describe("置き場所を決める箇所", () => {
	const root = path.resolve(__dirname, "../..")
	const read = (file: string) => readFileSync(path.join(root, file), "utf8")
	const count = (source: string, pattern: RegExp) => (source.match(pattern) ?? []).length

	it("判定（TaskPiiMasker）は modelDirectoryFor で決める", () => {
		const source = read("pii/TaskPiiMasker.ts")

		expect(count(source, /\bmodelDirectoryFor\(/g)).toBe(1)
		expect(count(source, /\bdefaultModelDirectory\(/g)).toBe(0)
	})

	it("画面の「どこを見ているか」は modelDirectoryFor、「取ってくる」先は defaultModelDirectory で決める", () => {
		const source = read("model.ts")

		expect(count(source, /\bmodelDirectoryFor\(/g)).toBe(1)
		expect(count(source, /\bdefaultModelDirectory\(\)/g)).toBe(1)
		// 取ってくる先（fetchDirectory）のほうに defaultModelDirectory があり、同梱の場所は使わない
		const fetchDirectory = source.slice(source.indexOf("export function fetchDirectory"))
		expect(fetchDirectory.slice(0, fetchDirectory.indexOf("\n}\n"))).toMatch(/\?\? defaultModelDirectory\(\)/)
		// 取得と表示が、それぞれの関数で置き場所を決める
		expect(count(source, /\bconst directory = fetchDirectory\(\)/g)).toBe(1)
		expect(count(source, /\bconst directory = modelDirectory\(\)/g)).toBe(1)
	})
})
