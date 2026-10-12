import { describe, expect, it } from "vitest"

import { unexpectedFiles } from "./vsix-files.mjs"

describe("unexpectedFiles", () => {
	it("拡張に要るものだけなら、何も返さない", () => {
		const listing = [
			"package.json",
			"README.md",
			"LICENSE",
			"NOTICE",
			"dist/extension.js",
			"dist/node_modules/onnxruntime-node/package.json",
			"dist/ner-model/SHA256SUMS",
			"docs/build-ner-model.md",
		].join("\n")

		expect(unexpectedFiles(listing)).toEqual([])
	})

	it("一覧に無いもの（網羅率の報告・道具・設定のファイル）を返す", () => {
		const listing = [
			"dist/extension.js",
			"coverage/index.html",
			"coverage/copilot-pii-guard/src/participant.ts.html",
			"scripts/build_ner_model.py",
			".gitignore",
			"src/extension.ts",
			"bin/copilot-pii-guard-0.3.0.vsix",
		].join("\n")

		expect(unexpectedFiles(listing)).toEqual([
			"coverage/index.html",
			"coverage/copilot-pii-guard/src/participant.ts.html",
			"scripts/build_ner_model.py",
			".gitignore",
			"src/extension.ts",
			"bin/copilot-pii-guard-0.3.0.vsix",
		])
	})

	it("名前が似ているだけのものは通さない（前方一致はディレクトリの区切りまで）", () => {
		expect(unexpectedFiles("distribution/a.js\ndocs.md\nREADME.md.bak\npackage.json.orig")).toEqual([
			"distribution/a.js",
			"docs.md",
			"README.md.bak",
			"package.json.orig",
		])
	})

	it("空の行と前後の空白は無視する。Windows の改行でも読む", () => {
		expect(unexpectedFiles("\r\n  dist/extension.js  \r\n\r\ncoverage/x.html\r\n")).toEqual(["coverage/x.html"])
	})
})
