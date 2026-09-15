// モデルの取得と、置き場所の確認。
//
// **利用者が指示したときだけ取りに行く。** 282 MB を勝手に取らない。
//
// **既定の取得先を持たない。** 持つと、誰の指示も無く特定の場所へ 282 MB を取りに行く
// 経路を抱えることになる。閉鎖環境で使うものが、既定で外へ出てよい理由は無い。

import * as vscode from "vscode"

import { fetchModel, resolveBase } from "./pii/nerFetch"
import { defaultModelDirectory, describeCheck, locateModel } from "./pii/nerModel"
import { resolveDictionaryPath } from "./pii/dictionary"
import { readSettings } from "./settings"
import { t } from "./messages"

/** 設定から、いま見ている置き場所を決める。空欄なら既定の場所。 */
export function modelDirectory(): string {
	const raw = readSettings().properNouns?.modelPath
	return (raw && resolveDictionaryPath(raw)) || defaultModelDirectory()
}

/** どこを見ていて、置かれているかを出す。閉鎖環境ではこれが唯一の手がかりである。 */
export async function showModelStatus(): Promise<void> {
	const directory = modelDirectory()
	const found = await locateModel(directory)

	await vscode.window.showInformationMessage(
		found.present
			? `置かれています（${Math.round(found.bytes / 1024 / 1024)} MB）: ${directory}`
			: `置かれていません（${found.missing.length} ファイルが足りません）: ${directory}`,
	)
}

/**
 * モデルを取得する。
 *
 * **進み具合を出す前に断る。** 出してから断ると、取りに行ったのに失敗したように見える。
 * 実際には 1 度も外へ出ていない。
 */
export async function fetchModelCommand(): Promise<void> {
	const directory = modelDirectory()
	const url = readSettings().properNouns?.modelUrl ?? ""

	if (!resolveBase(url)) {
		await vscode.window.showErrorMessage(t("common:pii.noModelUrl"))
		return
	}

	// 282 MB を待たせるので、何を取っているかを出す。
	const check = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: t("common:pii.fetchingModel"), cancellable: false },
		async (progress) => {
			try {
				return await fetchModel(directory, {
					baseUrl: url,
					report: (one) => progress.report({ message: one }),
				})
			} catch (error) {
				await vscode.window.showErrorMessage(
					t("common:pii.fetchFailed", { error: error instanceof Error ? error.message : String(error) }),
				)
				return undefined
			}
		},
	)

	if (check === undefined) return

	// **取れたつもりで欠けている状態を作らない。** 欠けたまま使うと、第 2 層が静かに
	// 動かず、画面の見た目も変わらない。
	const why = describeCheck(check)
	if (why) {
		await vscode.window.showErrorMessage(t("common:pii.modelIncomplete", { detail: why }))
		return
	}

	await vscode.window.showInformationMessage(t("common:pii.modelReady", { path: directory }))
}
