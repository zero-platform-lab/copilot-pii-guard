// platform を指定して VSIX を作る。
//
// **なぜ包みが要るのか。** `vsce package` は `vscode:prepublish`（`pnpm bundle --production`）
// を実行し直す。そのため `pnpm bundle --target=...` と書いても、束ね直しで指定が失われ、
// **いま動いている機械の platform のものが入る**。Windows 向けに作ったつもりで Linux の
// native が入る、という取り違えが実際に起きた。
//
// 環境変数なら prepublish にも届く。シェルの書き方が platform で変わらないよう、
// `node` から渡す。
//
// 作ったあと、**中身が指定した platform のものかを確かめる**。ここを見ないと、同じ
// 取り違えが黙って通る。

import { spawnSync } from "child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { unexpectedFiles } from "./scripts/vsix-files.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))

const { version } = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"))
const publish = process.argv.includes("--publish")
const targets = process.argv.filter((one) => one === "universal" || /^[a-z0-9]+-[a-z0-9]+$/.test(one))

// **固有名詞検出のモデルを同梱する（`--with-model=<展開したモデルの置き場所>`）。** 外へ出られない
// 端末で、モデルを取りに行けないため。約 280 MB 大きくなるので、同梱しない配布物とは分けて作り、
// 名前の末尾に `-with-model` を付ける。照合は束ね方（`scripts/copy-ner-model.mjs`）が行う。
const withModelArg = process.argv.find((one) => one.startsWith("--with-model="))
const modelDir = withModelArg ? path.resolve(withModelArg.slice("--with-model=".length)) : undefined
if (modelDir && (publish || targets.includes("universal"))) {
	// universal には native が無く、同梱しても固有名詞検出が動かない。店へ出すものには入れない。
	console.error("--with-model は platform を指した配布物にだけ使える（universal と --publish には使えない）。")
	process.exit(1)
}

// **platform を指さない作り方を許さない。**
//
// 指さないと、いま動いている機械の native だけが入る。ほかの platform で入れた人は、
// 第 2 層が黙って動かない（例外は `TaskPiiMasker` が握るので、画面には何も出ない）。
if (targets.length === 0) {
	console.error(
		"使い方: node package-vsix.mjs <platform>-<arch> [<platform>-<arch> …] [--publish] [--with-model=<モデルの置き場所>]",
	)
	console.error("第 2 層の native を含むため、platform を指さずには作れない。")
	process.exit(1)
}

for (const target of targets) {
	buildOne(target)
}

/** 1 つ実行する。失敗したらそこで止める。 */
function run(command, args, env) {
	const result = spawnSync(command, args, { cwd: here, env, stdio: "inherit", shell: true })
	if (result.status !== 0) process.exit(result.status ?? 1)
}

function buildOne(target) {
	// 束ね直しにも届くよう、環境変数でも渡す（`vsce` が `vscode:prepublish` を実行し直す）。
	const env = { ...process.env, PII_GUARD_TARGET: target, PII_GUARD_MODEL_DIR: modelDir ?? "" }

	run("node", ["esbuild.mjs", "--production"], env)
	mkdirSync(path.join(here, "bin"), { recursive: true })

	// **入れるファイルを、入れてよいものの一覧で確かめてから包む**（`scripts/vsix-files.mjs`）。
	// v0.2.9 の VSIX には、ソースを含む網羅率の報告（`coverage/`）が黙って入っていた。
	const listing = spawnSync("vsce", ["ls", "--no-dependencies"], { cwd: here, env, encoding: "utf8", shell: true })
	if (listing.status !== 0) {
		console.error(listing.stderr)
		process.exit(listing.status ?? 1)
	}
	const unexpected = unexpectedFiles(listing.stdout)
	if (unexpected.length > 0) {
		console.error(`\nVSIX に入れてはいけないファイルが ${unexpected.length} 件ある（.vscodeignore に足すか、消してから作る）:`)
		for (const file of unexpected.slice(0, 20)) console.error(`  ${file}`)
		process.exit(1)
	}

	// `universal` は platform を指さずに作る。受け取り手を絞らない配布物になる。
	const forTarget = target === "universal" ? [] : ["--target", target]

	if (publish) {
		// **2 つの店へ出す。** 片方だけにすると、もう片方の利用者が古い版のままになる。
		// **出す先は 1 つ。** 社内で配るものなので、店へは出さない。出すときは
		// ここへ足す。
		run("vsce", ["publish", "--no-dependencies", ...forTarget], env)
	} else {
		const out = modelDir ? `bin/copilot-pii-guard-${target}-with-model-${version}.vsix` : "bin"
		run("vsce", ["package", "--no-dependencies", ...forTarget, "--out", out], env)
	}

	// `universal` には native が入らない。**入っていないことを確かめる。**
	//
	// 確かめずに済ませていたら、`dist` の消し忘れで Linux の native が入ったまま
	// `universal` が出来上がった。中身を見るまで気づけない。
	const binDirAll = path.join(here, "dist", "node_modules", "onnxruntime-node")
	if (target === "universal") {
		if (existsSync(binDirAll)) {
			console.error("\nuniversal に native が入っている。dist を消さずに作っている。")
			process.exit(1)
		}
		console.log("\n確認: universal には native を入れていない（第 2 層は動かない）。")
		return
	}

	// **確かめる。** 束ね直しで platform が戻っていないか、写した実物から見る。
	//
	// **`unzip` に頼らない。** Windows には無いことが多く、無いと検査が黙って素通りする。
	// この取り違えが起きたのはまさに Windows 向けを作ったときなので、そこで効かない検査には
	// 意味が無い。VSIX の中身は `dist/` の写しなので、そちらを直接見る。
	const binDir = path.join(here, "dist", "node_modules", "onnxruntime-node", "bin", "napi-v6")
	if (!existsSync(binDir)) {
		console.error(`\n${binDir} が無い。第 2 層の実行の仕組みが同梱されていない。`)
		process.exit(1)
	}

	const platforms = readdirSync(binDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) =>
			readdirSync(path.join(binDir, entry.name), { withFileTypes: true })
				.filter((arch) => arch.isDirectory())
				.map((arch) => `${entry.name}-${arch.name}`),
		)

	if (platforms.length !== 1 || platforms[0] !== target) {
		console.error(`\n${target} を作ったつもりが、入っているのは ${platforms.join(", ") || "（無し）"} である。`)
		process.exit(1)
	}

	console.log(`\n確認: ${target} の実行の仕組みだけが入っている。`)

	// **同梱を頼んだのに入っていない、を作らない。** 照合値が無ければ拡張は同梱とみなさない。
	// 頼んでいないのに入っている（前に作った dist の残り）も、280 MB 大きい通常版になるので止める。
	const bundledSums = path.join(here, "dist", "ner-model", "SHA256SUMS")
	if (Boolean(modelDir) !== existsSync(bundledSums)) {
		console.error(modelDir ? `\n${bundledSums} が無い。モデルが同梱されていない。` : "\n頼んでいないのにモデルが同梱されている。")
		process.exit(1)
	}
	if (modelDir) console.log(`確認: 固有名詞検出のモデルを同梱した（${path.dirname(bundledSums)}）。`)
}
