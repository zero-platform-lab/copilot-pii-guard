// 設定の画面を開き、画面と VS Code の設定をつなぐ。
//
// **書き込む先はユーザーの設定（Global）。** ワークスペースの設定で上書きされている項目は、
// ここで変えても効かないので、画面にそう出す。
//
// **まとめて確かめてから書く。** 1 つでも誤りがあれば何も書かない。半分だけ書けた状態を作ると、
// 画面と実際の設定がずれる。

import { randomBytes } from "crypto"

import * as vscode from "vscode"

import { check, sectionsWithFields, type Field } from "./fields"
import { ACTIONS, settingsHtml } from "./html"

/** 画面から届く知らせ。 */
export type FromView =
	| { type: "ready" }
	| { type: "save"; values: Record<string, unknown> }
	| { type: "command"; command: string }

/** 画面へ送る知らせ。 */
export type ToView =
	| { type: "state"; values: Record<string, unknown>; overridden: Record<string, boolean> }
	| { type: "saved" }
	| { type: "errors"; errors: Record<string, string> }

type Settings = Pick<vscode.WorkspaceConfiguration, "get" | "inspect" | "update">

export type SettingsBridge = {
	fields: Map<string, Field>
	/** 今の値と、ワークスペースの設定で上書きされているか。 */
	state(): ToView & { type: "state" }
	/** 画面から届いた知らせを受ける。返すのは画面へ送るもの（無ければ undefined）。 */
	receive(message: FromView): Promise<ToView | undefined>
}

/**
 * 画面とのやりとりの中身。VS Code の画面（webview）から切り離して試験できるようにする。
 *
 * `configuration` は `vscode.workspace.getConfiguration()`（根を指定しない形）を渡す。
 */
export function createSettingsBridge(
	configuration: () => Settings,
	run: (command: string) => Thenable<unknown> = (command) => vscode.commands.executeCommand(command),
): SettingsBridge {
	const fields = new Map(sectionsWithFields().flatMap((section) => section.fields.map((field) => [field.key, field])))
	const allowed = new Set(ACTIONS.map((action) => action.command))

	const state = (): ToView & { type: "state" } => {
		const settings = configuration()
		const values: Record<string, unknown> = {}
		const overridden: Record<string, boolean> = {}
		for (const [key, field] of fields) {
			values[key] = settings.get(key) ?? field.default
			const inspected = settings.inspect(key)
			overridden[key] = inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined
		}
		return { type: "state", values, overridden }
	}

	const receive = async (message: FromView): Promise<ToView | undefined> => {
		switch (message.type) {
			case "ready":
				return state()
			case "command":
				// **一覧にあるコマンドだけを実行する。** 画面から任意のコマンドを動かせないようにする。
				if (allowed.has(message.command)) await run(message.command)
				return undefined
			case "save": {
				const errors: Record<string, string> = {}
				const accepted: [string, unknown][] = []
				for (const [key, value] of Object.entries(message.values ?? {})) {
					const field = fields.get(key)
					if (!field) {
						errors[key] = "この画面で変えられる設定ではありません"
						continue
					}
					const result = check(field, value)
					if (result.ok) accepted.push([key, result.value])
					else errors[key] = result.error
				}
				if (Object.keys(errors).length > 0) return { type: "errors", errors }

				const settings = configuration()
				for (const [key, value] of accepted) {
					await settings.update(key, value, vscode.ConfigurationTarget.Global)
				}
				return { type: "saved" }
			}
		}
	}

	return { fields, state, receive }
}

let current: vscode.WebviewPanel | undefined

/** 設定の画面を開く。開いていれば前に出す。 */
export function openSettingsView(context: Pick<vscode.ExtensionContext, "subscriptions">): void {
	if (current) {
		current.reveal()
		return
	}

	const panel = vscode.window.createWebviewPanel("piiGuard.settings", "PII Guard の設定", vscode.ViewColumn.Active, {
		enableScripts: true,
		localResourceRoots: [],
	})
	current = panel
	const bridge = createSettingsBridge(() => vscode.workspace.getConfiguration())
	const post = (message: ToView | undefined) => {
		if (message) void panel.webview.postMessage(message)
	}

	panel.webview.html = settingsHtml({
		nonce: randomBytes(16).toString("base64"),
		cspSource: panel.webview.cspSource,
		model: { sections: sectionsWithFields(), actions: ACTIONS },
	})

	const subscriptions = [
		panel.webview.onDidReceiveMessage(async (message: FromView) => {
			const answer = await bridge.receive(message)
			post(answer)
			// 保存できたら、書けた値を読み直して画面へ返す（拡張が整えた値に揃える）。
			// **保存できなかったときは読み直さない。** 描き直すと、出したばかりの誤りの文が消える。
			if (answer?.type === "saved") post(bridge.state())
		}),
		// ほかの場所（VS Code の設定の画面など）で変わったら、画面も揃える。
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("piiGuard")) post(bridge.state())
		}),
	]
	panel.onDidDispose(() => {
		current = undefined
		for (const subscription of subscriptions) subscription.dispose()
	})
	context.subscriptions.push(panel)
}
