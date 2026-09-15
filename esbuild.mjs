// 束ねる。
//
// **`onnxruntime-node` は束ねない。** native の実行ファイルを相対の位置で読むので、
// 束ねると見つからない。`dist/node_modules` へ写して、外部のままにする。
//
// **`sharp` は代用に差し替える。** `@huggingface/transformers` が読み込みの時点で
// 要求するが、この拡張は文字しか渡さない。本物を同梱すると 16.5 MB 増える。

import * as esbuild from "esbuild"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, "dist")

const production = process.argv.includes("--production")
/** 配る先。`linux-x64` の形。`universal` なら native を入れない。 */
const target = process.env.PII_GUARD_TARGET ?? `${process.platform}-${process.arch}`

/** `from` の下から、`keep` が真を返すものだけを `to` へ写す。 */
function copyPackage(from, to, keep) {
	let copied = 0

	const walk = (relative) => {
		const full = path.join(from, relative)
		for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
			const next = relative ? path.posix.join(relative, entry.name) : entry.name
			if (entry.isDirectory()) {
				walk(next)
				continue
			}
			if (!keep(next)) continue

			const destination = path.join(to, next)
			fs.mkdirSync(path.dirname(destination), { recursive: true })
			fs.copyFileSync(path.join(from, next), destination)
			copied++
		}
	}

	walk("")
	return copied
}

/**
 * 第 2 層の実行の仕組みを写す。
 *
 * **1 つも写せなければ落とす。** 写せていないまま配ると、第 2 層が動かないのに画面は
 * 何も変わらず、原因の分からない不具合になる。
 */
function copyOnnxRuntime() {
	if (target === "universal") {
		console.log("[onnx] universal のため native を入れない（第 2 層は動かない）")
		return
	}

	const [platform, arch] = target.split("-")
	const from = path.join(HERE, "node_modules", "onnxruntime-node")
	const to = path.join(DIST, "node_modules")

	let natives = 0
	copyPackage(from, path.join(to, "onnxruntime-node"), (relative) => {
		if (relative.startsWith("dist/") || relative === "package.json") return true
		if (!relative.startsWith(`bin/napi-v6/${platform}/${arch}/`)) return false
		// GPU 用。同梱しても使わない。
		if (/cuda|tensorrt|DirectML|dxcompiler|dxil/i.test(relative)) return false

		natives++
		return true
	})

	if (natives === 0) {
		throw new Error(`${platform}-${arch} に当たる native が ${from} に無い。`)
	}

	copyPackage(
		path.join(HERE, "node_modules", "onnxruntime-common"),
		path.join(to, "onnxruntime-common"),
		(relative) => relative.startsWith("dist/") || relative === "package.json",
	)

	console.log(`[onnx] ${platform}-${arch} の native を ${natives} 件写した`)
}

// **毎回消してから作る。**
//
// 消さないと、前に作った platform の native が残る。`universal` を作ったつもりで Linux の
// native が入り、`win32-x64` を作ったつもりで 2 つ入る。どちらも中身を見るまで気づけない。
fs.rmSync(DIST, { recursive: true, force: true })

await esbuild.build({
	entryPoints: [path.join(HERE, "src", "extension.ts")],
	bundle: true,
	outfile: path.join(DIST, "extension.js"),
	platform: "node",
	target: "node20",
	format: "cjs",
	sourcemap: !production,
	minify: production,
	external: ["vscode", "onnxruntime-node"],
	alias: { sharp: path.join(HERE, "src", "build-stubs", "sharp.js") },
	logLevel: "info",
})

copyOnnxRuntime()
