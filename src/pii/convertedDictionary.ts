// 変換した値を、辞書として書き出す。
//
// **目的。** 固有名詞検出（推定）や辞書で伏せた値を、辞書のファイルとして残す。残した辞書を
// 読ませれば、次からはモデル無しでも同じ語を確実に伏せられる。チームでの共有や、
// PII Guard MCP の辞書にも使える。
//
// **出すのは氏名・社名・その他の語だけ。** 辞書に書ける種類はこの 3 つである。メールアドレスや
// 電話番号は形で毎回見つかるので、辞書へ入れる意味が無い。
//
// **書き出したものは元の値の一覧である。** 作業場所（ワークスペース）の中へ保存すると、
// エージェントが読み取って LLM へ送る恐れがあるので、確かめてから書く。

import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"

import { t } from "../messages"

import { getGlobalAgentDirectory } from "../paths"
import { DICTIONARY_HEADER, dictionaryLine } from "./dictionaryEditor"
import { insideWorkspace } from "./fileMapping"
import type { PiiTerm } from "./types"

type DictionaryKind = NonNullable<PiiTerm["kind"]>

const KINDS: readonly DictionaryKind[] = ["person", "org", "term"]

export type ConvertedTerms = {
	terms: PiiTerm[]
	/** 辞書の 1 行に収まらない値（改行・タブを含む）。書き出さない。 */
	skipped: number
}

/** 正規表現の特殊な文字を、文字そのものとして扱うように逃がす。 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
}

/**
 * 辞書へ書くと別の意味に読まれる値か。
 *
 * 辞書を読む側（`parseDictionaryLines`）は、`#` で始まる行を飛ばし、`/…/` を正規表現として扱い、
 * 前後の空白を落とす。そうした値は、文字そのものに一致する正規表現として書く。
 */
function needsRegex(value: string): boolean {
	return value.startsWith("#") || value.startsWith("/") || value !== value.trim()
}

/**
 * 対応表（伏せ字 → 元の値）から、辞書に書く語を取り出す。
 *
 * 種類は伏せ字（`{{person-001}}`）から読む。同じ種類と値は 1 つにまとめる。
 */
export function convertedTerms(entries: Iterable<readonly [string, string]>): ConvertedTerms {
	const seen = new Map<string, PiiTerm>()
	let skipped = 0

	for (const [placeholder, value] of entries) {
		const kind = /^\{\{([a-z]+)-\d+\}\}$/.exec(placeholder)?.[1] as DictionaryKind | undefined
		if (!kind || !KINDS.includes(kind)) continue
		if (value.length === 0) continue
		if (/[\t\r\n]/.test(value)) {
			skipped++
			continue
		}

		const term: PiiTerm = needsRegex(value)
			? { value: escapeRegExp(value), kind, regex: true }
			: { value, kind }
		const key = `${kind}\0${term.regex ? "/" : ""}${term.value}`
		if (!seen.has(key)) seen.set(key, term)
	}

	// 種類ごとに並べる。読む人が、氏名と社名を分けて見直せる。
	const terms = [...seen.values()].sort((a, b) => KINDS.indexOf(a.kind!) - KINDS.indexOf(b.kind!))
	return { terms, skipped }
}

/** 辞書のファイルの中身にする。読み戻すと同じ語になる書式（`parseDictionaryLines`）。 */
export function formatConvertedDictionary(terms: readonly PiiTerm[]): string {
	const lines = terms.map((term) => dictionaryLine(term.regex ? { ...term, value: `/${term.value}/` } : term))
	return `${DICTIONARY_HEADER}# PII Guard が変換した値から書き出した（${terms.length} 件）。\n\n${lines.join("")}`
}

/** 書き出しの既定の場所。使っている辞書（pii-dictionary.txt）は上書きしない。 */
export function defaultConvertedDictionaryPath(): string {
	return path.join(getGlobalAgentDirectory(), "pii-dictionary-converted.txt")
}

export type ExportConvertedDeps = {
	/** セッション対応表の中身。 */
	sessionEntries: () => Iterable<readonly [string, string]>
	/** 有効にしたファイル対応表の中身。読めなければ投げる。 */
	fileEntries: () => Promise<Iterable<readonly [string, string]>>
}

export async function exportConvertedDictionary(deps: ExportConvertedDeps): Promise<void> {
	let fromFiles: Iterable<readonly [string, string]> = []
	try {
		fromFiles = await deps.fileEntries()
	} catch {
		// **ファイル対応表が読めなくても、セッションの分は出す。** 欠けたことは知らせる。
		await vscode.window.showWarningMessage(t("common:pii.converted.fileMappingFailed"))
	}

	const { terms, skipped } = convertedTerms([...deps.sessionEntries(), ...fromFiles])
	if (terms.length === 0) {
		await vscode.window.showInformationMessage(t("common:pii.converted.nothing"))
		return
	}

	const uri = await vscode.window.showSaveDialog({
		filters: { テキスト: ["txt"] },
		defaultUri: vscode.Uri.file(defaultConvertedDictionaryPath()),
	})
	if (!uri) return

	if (insideWorkspace(uri)) {
		const proceed = t("common:pii.converted.saveAnyway")
		const answer = await vscode.window.showWarningMessage(
			t("common:pii.converted.insideWorkspace"),
			{ modal: true },
			proceed,
		)
		if (answer !== proceed) return
	}

	await fs.mkdir(path.dirname(uri.fsPath), { recursive: true })
	// 書き出しは UTF-8 で行う（`exportDictionary` と同じ）。
	await fs.writeFile(uri.fsPath, formatConvertedDictionary(terms), "utf8")

	await vscode.window.showInformationMessage(
		skipped > 0
			? t("common:pii.converted.exportedWithSkipped", { count: terms.length, skipped, path: shown(uri.fsPath) })
			: t("common:pii.converted.exported", { count: terms.length, path: shown(uri.fsPath) }),
	)
}

/** ホームの下なら `~` で短く出す。 */
function shown(file: string): string {
	const home = os.homedir()
	return file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file
}
