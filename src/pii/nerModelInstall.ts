import { promises as fs } from "fs"
import * as path from "path"

import { bundledModelDirectory, CHECKSUM_FILE, defaultModelDirectory, REQUIRED_FILES, verifyModel } from "./nerModel"

/** 同梱のモデルを既定の場所へ写した結果。 */
export type BundledModelCopy =
	| { result: "no-bundle" }
	| { result: "already"; target: string }
	| { result: "copied"; target: string }
	| { result: "failed"; target: string; reason: string }

type Locations = { bundled?: string; target?: string }

/**
 * 同梱のモデルを、既定の置き場所（`~/.agent/pii-ner`）へ写す。
 *
 * **なぜ写すか。** 同梱のモデルは拡張を入れた場所の中にあり、拡張を更新すると消える。同梱版を
 * 入れた端末を、次の版の同梱しない配布物で更新すると、第 2 層が黙って止まる。既定の場所へ
 * 写しておけば、以後は同梱しない配布物で更新しても動き続ける。利用者の提案を受けて、
 * ボタンではなく、起動したときに自動で写す。
 *
 * **移さずに写す。** 拡張を入れた場所は VS Code が持つ。中身を外へ移すと、同じ版を入れ直した
 * ときなどに食い違う。
 *
 * **半端なモデルを既定の場所に残さない。** 一時的な場所へ写して照合し、合ったときだけ入れ替える。
 * 照合に合わなければ、写したものを捨てる。
 */
export async function copyBundledModelToDefault(locations: Locations = {}): Promise<BundledModelCopy> {
	const bundled = locations.bundled ?? bundledModelDirectory()
	if (!bundled) return { result: "no-bundle" }

	const target = locations.target ?? defaultModelDirectory()

	// 毎回 300 MB を読み直さないよう、照合の値と大きさで「同じものがもうある」かを見る。
	// 中身まで確かめる照合は、モデルを読み込むときに行う。
	if (await sameModel(bundled, target)) return { result: "already", target }

	const staging = `${target}.copying-${process.pid}-${Date.now()}`
	try {
		await fs.mkdir(path.join(staging, "onnx"), { recursive: true })
		for (const name of [CHECKSUM_FILE, ...REQUIRED_FILES]) {
			await fs.copyFile(path.join(bundled, name), path.join(staging, name))
		}

		const check = await verifyModel(staging)
		if (!check.ok) {
			throw new Error(
				`照合に合わない（置かれていない: ${check.missing.join(", ")} / 値が違う: ${check.mismatched.join(", ")}）`,
			)
		}

		// 古いものを脇へ退けてから入れ替える。入れ替えの途中で止まっても、どちらかは残る。
		const old = `${target}.old-${process.pid}-${Date.now()}`
		const hadOld = await exists(target)
		if (hadOld) await fs.rename(target, old)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.rename(staging, target)
		if (hadOld) await fs.rm(old, { recursive: true, force: true })

		return { result: "copied", target }
	} catch (error) {
		/* v8 ignore next -- 到達不能: force の rm は、権限の問題が無い限り失敗しない。片付けの失敗で結果を変えないための防御 */
		await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
		/* v8 ignore next -- 到達不能: fs の例外と、上で投げる例外は必ず Error。防御は残す */
		return { result: "failed", target, reason: error instanceof Error ? error.message : String(error) }
	}
}

async function exists(target: string): Promise<boolean> {
	return fs.access(target).then(
		() => true,
		() => false,
	)
}

/** 照合の値（SHA256SUMS）が同じで、要るファイルがすべて同じ大きさで置かれているか。 */
async function sameModel(bundled: string, target: string): Promise<boolean> {
	try {
		const [ours, theirs] = await Promise.all([
			fs.readFile(path.join(bundled, CHECKSUM_FILE), "utf8"),
			fs.readFile(path.join(target, CHECKSUM_FILE), "utf8"),
		])
		if (ours !== theirs) return false

		for (const name of REQUIRED_FILES) {
			const [a, b] = await Promise.all([fs.stat(path.join(bundled, name)), fs.stat(path.join(target, name))])
			if (a.size !== b.size) return false
		}
		return true
	} catch {
		return false
	}
}

/**
 * 起動したときに呼ぶ。置き場所を指定している人には何もしない（指定したほうを使うため）。
 * 約 300 MB を書くので待たない。結果は拡張のログに出す。写し終わるまでの間は、同梱のモデルを使う。
 */
export function installBundledModelOnStartup(
	modelPath: () => string | undefined,
	log: (line: string) => void,
	copy: () => Promise<BundledModelCopy> = copyBundledModelToDefault,
): Promise<BundledModelCopy | undefined> {
	if (modelPath()?.trim()) return Promise.resolve(undefined)

	return copy().then(
		(result) => {
			if (result.result === "copied") log(`[PII] 同梱のモデルを ${result.target} へ写した`)
			if (result.result === "failed")
				log(`[PII] 同梱のモデルを ${result.target} へ写せなかった: ${result.reason}`)
			return result
		},
		// 待たずに呼ぶので、予期しない例外も受け止めてログに出す。受け止めないと拡張ホストに
		// 誰も受け止めない例外が残る（起動の試験で、fs を模したときに起きた）。
		(error: unknown) => {
			log(`[PII] 同梱のモデルを写す途中で失敗した: ${error instanceof Error ? error.message : String(error)}`)
			return undefined
		},
	)
}
