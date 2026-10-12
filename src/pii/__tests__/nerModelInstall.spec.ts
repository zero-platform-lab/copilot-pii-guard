// npx vitest run services/pii/__tests__/nerModelInstall.spec.ts

import { createHash } from "crypto"
import { promises as fs, readFileSync } from "fs"
import * as os from "os"
import * as path from "path"

import { CHECKSUM_FILE, REQUIRED_FILES, verifyModel } from "../nerModel"
import { copyBundledModelToDefault, installBundledModelOnStartup } from "../nerModelInstall"

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

/** 要るファイルを置き、tar の展開と同じ形の SHA256SUMS を書く。`tag` で版を変える。 */
async function writeModel(dir: string, tag = "v1", override: Record<string, string> = {}) {
	const lines = [`${sha("archive")}  ner-ja.tar.gz`]
	for (const name of REQUIRED_FILES) {
		const content = `${tag}: ${name}`
		await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true })
		await fs.writeFile(path.join(dir, name), override[name] ?? content)
		lines.push(`${sha(content)}  ./${name}`)
	}
	await fs.writeFile(path.join(dir, CHECKSUM_FILE), lines.join("\n") + "\n")
}

describe("copyBundledModelToDefault", () => {
	let root: string
	let bundled: string
	let target: string

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "ner-install-"))
		bundled = path.join(root, "dist", "ner-model")
		target = path.join(root, "home", ".agent", "pii-ner")
		await writeModel(bundled)
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	const leftovers = async () =>
		(await fs.readdir(path.dirname(target)).catch(() => [] as string[])).filter((name) => name !== "pii-ner")

	it("同梱していない配布物では何もしない", async () => {
		await expect(copyBundledModelToDefault({ bundled: undefined, target })).resolves.toEqual({
			result: "no-bundle",
		})
	})

	it("既定の場所が空なら写し、照合に合うモデルが置かれる。一時的な場所は残さない", async () => {
		await expect(copyBundledModelToDefault({ bundled, target })).resolves.toEqual({ result: "copied", target })

		expect(await verifyModel(target)).toEqual({ ok: true, missing: [], mismatched: [] })
		expect(await leftovers()).toEqual([])
	})

	it("同じものがもうあれば写さない", async () => {
		await copyBundledModelToDefault({ bundled, target })
		const before = (await fs.stat(path.join(target, "onnx/model_quantized.onnx"))).mtimeMs

		await expect(copyBundledModelToDefault({ bundled, target })).resolves.toEqual({ result: "already", target })
		expect((await fs.stat(path.join(target, "onnx/model_quantized.onnx"))).mtimeMs).toBe(before)
	})

	it("古い版のモデルは、新しい版に入れ替える。古いほうは残さない", async () => {
		await writeModel(target, "v0")
		await fs.writeFile(path.join(target, "extra-from-old.txt"), "old")

		await expect(copyBundledModelToDefault({ bundled, target })).resolves.toEqual({ result: "copied", target })

		expect(readFileSync(path.join(target, "config.json"), "utf8")).toBe("v1: config.json")
		await expect(fs.access(path.join(target, "extra-from-old.txt"))).rejects.toThrow()
		expect(await leftovers()).toEqual([])
	})

	it("照合の値が同じでも、大きさが違うファイルがあれば写し直す（途中で切れたものなど）", async () => {
		await copyBundledModelToDefault({ bundled, target })
		await fs.writeFile(path.join(target, "tokenizer.json"), "trunc")

		await expect(copyBundledModelToDefault({ bundled, target })).resolves.toEqual({ result: "copied", target })
		expect(await verifyModel(target)).toEqual({ ok: true, missing: [], mismatched: [] })
	})

	it("同梱のモデルが照合に合わなければ写さず、既定の場所の今のモデルも壊さない", async () => {
		await writeModel(target, "v0")
		await writeModel(bundled, "v1", { "onnx/model_quantized.onnx": "broken" })

		const result = await copyBundledModelToDefault({ bundled, target })

		expect(result).toMatchObject({ result: "failed", target })
		expect((result as { reason: string }).reason).toContain("値が違う: onnx/model_quantized.onnx")
		expect(readFileSync(path.join(target, "config.json"), "utf8")).toBe("v0: config.json")
		expect(await leftovers()).toEqual([])
	})

	it("同梱のファイルが欠けていれば写さない", async () => {
		await fs.rm(path.join(bundled, "tokenizer.json"))

		await expect(copyBundledModelToDefault({ bundled, target })).resolves.toMatchObject({ result: "failed" })
		await expect(fs.access(target)).rejects.toThrow()
		expect(await leftovers()).toEqual([])
	})

	it("置き先を指定しなければ、既定の場所（ホームの .agent/pii-ner）へ写す", async () => {
		// 本物のホームを壊さないよう、ホームを一時ディレクトリに差し替える
		const home = path.join(root, "fake-home")
		await fs.mkdir(home)
		vi.stubEnv("HOME", home)
		vi.stubEnv("USERPROFILE", home)
		try {
			await expect(copyBundledModelToDefault({ bundled })).resolves.toEqual({
				result: "copied",
				target: path.join(home, ".agent", "pii-ner"),
			})
		} finally {
			vi.unstubAllEnvs()
		}
	})

	it("場所を指定しなければ、同梱の場所と既定の場所を自分で決める（試験では同梱が無い）", async () => {
		await expect(copyBundledModelToDefault()).resolves.toEqual({ result: "no-bundle" })
	})
})

describe("installBundledModelOnStartup", () => {
	it("置き場所を指定している人には何もしない", async () => {
		const copy = vi.fn()

		await expect(installBundledModelOnStartup(() => " /models/ner ", vi.fn(), copy)).resolves.toBeUndefined()
		expect(copy).not.toHaveBeenCalled()
	})

	it.each([
		[{ result: "copied", target: "/h/pii-ner" }, ["[PII] 同梱のモデルを /h/pii-ner へ写した"]],
		[
			{ result: "failed", target: "/h/pii-ner", reason: "EACCES" },
			["[PII] 同梱のモデルを /h/pii-ner へ写せなかった: EACCES"],
		],
		[{ result: "already", target: "/h/pii-ner" }, []],
		[{ result: "no-bundle" }, []],
	] as const)("指定が無ければ写し、結果をログに出す（%j）", async (result, lines) => {
		const log = vi.fn()

		await expect(
			installBundledModelOnStartup(
				() => undefined,
				log,
				async () => result,
			),
		).resolves.toEqual(result)
		expect(log.mock.calls.map(([line]) => line)).toEqual(lines)
	})

	it.each([
		[new Error("boom"), "[PII] 同梱のモデルを写す途中で失敗した: boom"],
		["plain", "[PII] 同梱のモデルを写す途中で失敗した: plain"],
	])("予期しない例外（%s）も受け止めてログに出す", async (error, line) => {
		const log = vi.fn()

		await expect(
			installBundledModelOnStartup(
				() => undefined,
				log,
				async () => {
					throw error
				},
			),
		).resolves.toBeUndefined()
		expect(log).toHaveBeenCalledWith(line)
	})

	it("既定では copyBundledModelToDefault を使う（試験では同梱が無い）", async () => {
		await expect(installBundledModelOnStartup(() => "", vi.fn())).resolves.toEqual({ result: "no-bundle" })
	})
})

describe("起動の処理", () => {
	it("extension.ts は、起動したときに置き場所の設定を渡して installBundledModelOnStartup を呼ぶ", () => {
		const source = readFileSync(path.resolve(__dirname, "../../extension.ts"), "utf8")

		expect(source).toMatch(
			/\binstallBundledModelOnStartup\(\s*\(\) => readSettings\(\)\.properNouns\?\.modelPath,/,
		)
	})
})
