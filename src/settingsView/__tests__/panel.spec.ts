// npx vitest run src/settingsView/__tests__/panel.spec.ts
// @vitest-environment node
//
// 設定の画面と VS Code の設定のつなぎ。
//
// **画面の操作から設定の書き込みまでを 1 つの試験でつなぐ**（「画面と拡張の継ぎ目」）。画面の
// スクリプトを jsdom で実際に動かし、届いた知らせを本物のつなぎ（createSettingsBridge）へ渡す。
// 片側ずつの試験では、画面が送る形と拡張が受ける形のずれが見えない。

import { JSDOM } from "jsdom"

const mocks = vi.hoisted(() => ({
	executeCommand: vi.fn(async (..._args: unknown[]) => undefined as unknown),
	createWebviewPanel: vi.fn(),
	onDidChangeConfiguration: vi.fn(),
	configuration: undefined as unknown,
}))

vi.mock("vscode", () => ({
	commands: { executeCommand: mocks.executeCommand },
	window: { createWebviewPanel: mocks.createWebviewPanel },
	workspace: {
		getConfiguration: () => mocks.configuration,
		onDidChangeConfiguration: mocks.onDidChangeConfiguration,
	},
	ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
	ViewColumn: { Active: -1 },
}))

import packageJson from "../../../package.json"
import { sectionsWithFields } from "../fields"
import { ACTIONS, settingsHtml } from "../html"
import { createSettingsBridge, openSettingsView, type FromView, type ToView } from "../panel"

/** VS Code の設定と同じ形（get / inspect / update をメソッドで持つ）。 */
class FakeConfiguration {
	readonly global = new Map<string, unknown>()
	readonly workspace = new Map<string, unknown>()
	readonly folder = new Map<string, unknown>()
	readonly updates: [string, unknown, number][] = []

	get<T>(key: string): T | undefined {
		return (this.folder.get(key) ?? this.workspace.get(key) ?? this.global.get(key)) as T | undefined
	}

	inspect<T>(key: string) {
		return {
			key,
			globalValue: this.global.get(key) as T | undefined,
			workspaceValue: this.workspace.get(key) as T | undefined,
			workspaceFolderValue: this.folder.get(key) as T | undefined,
		}
	}

	async update(key: string, value: unknown, target: number): Promise<void> {
		this.updates.push([key, value, target])
		this.global.set(key, value)
	}
}

let configuration: FakeConfiguration

beforeEach(() => {
	vi.clearAllMocks()
	configuration = new FakeConfiguration()
	mocks.configuration = configuration
})

describe("createSettingsBridge", () => {
	const bridge = () => createSettingsBridge(() => configuration)

	it("開いたら、今の値（無ければ package.json の既定）と、ワークスペースで上書きされているかを返す", async () => {
		configuration.global.set("piiGuard.enabled", false)
		configuration.workspace.set("piiGuard.restore", false)
		configuration.folder.set("piiGuard.properNouns.minScore", 0.8)

		const state = (await bridge().receive({ type: "ready" })) as ToView & { type: "state" }

		expect(state.values["piiGuard.enabled"]).toBe(false)
		expect(state.values["piiGuard.fileTools.mode"]).toBe("confirmEdit")
		expect(state.values["piiGuard.properNouns.minScore"]).toBe(0.8)
		expect(Object.keys(state.values).sort()).toEqual(Object.keys(packageJson.contributes.configuration.properties).sort())
		expect(state.overridden).toMatchObject({
			"piiGuard.enabled": false,
			"piiGuard.restore": true,
			"piiGuard.properNouns.minScore": true,
		})
	})

	it("保存は、確かめて整えた値をユーザーの設定へ書く", async () => {
		const result = await bridge().receive({
			type: "save",
			values: { "piiGuard.enabled": false, "piiGuard.dictionaryPaths": [" ~/d.txt ", ""] },
		})

		expect(result).toEqual({ type: "saved" })
		expect(configuration.updates).toEqual([
			["piiGuard.enabled", false, 1],
			["piiGuard.dictionaryPaths", ["~/d.txt"], 1],
		])
	})

	it("1 つでも誤りがあれば、何も書かずに理由を返す", async () => {
		const result = await bridge().receive({
			type: "save",
			values: {
				"piiGuard.enabled": false,
				"piiGuard.properNouns.minScore": 2,
				"piiGuard.unknown": true,
			},
		})

		expect(result).toEqual({
			type: "errors",
			errors: {
				"piiGuard.properNouns.minScore": "1 以下にしてください",
				"piiGuard.unknown": "この画面で変えられる設定ではありません",
			},
		})
		expect(configuration.updates).toEqual([])
	})

	it("値の無い保存は、何も書かずに済ませる", async () => {
		expect(await bridge().receive({ type: "save" } as unknown as FromView)).toEqual({ type: "saved" })
		expect(configuration.updates).toEqual([])
	})

	it("操作のボタンは、一覧にあるコマンドだけを実行する", async () => {
		const run = vi.fn(async () => undefined)
		const one = createSettingsBridge(() => configuration, run)

		expect(await one.receive({ type: "command", command: "piiGuard.modelStatus" })).toBeUndefined()
		await one.receive({ type: "command", command: "workbench.action.terminal.new" })

		expect(run.mock.calls).toEqual([["piiGuard.modelStatus"]])
	})

	it("既定では VS Code のコマンドとして実行する", async () => {
		await bridge().receive({ type: "command", command: "piiGuard.fetchModel" })

		expect(mocks.executeCommand).toHaveBeenCalledWith("piiGuard.fetchModel")
	})

	it("操作のボタンのコマンドは、どれも package.json に並んでいる（押して何も起きないボタンを作らない）", () => {
		const declared = packageJson.contributes.commands.map((command) => command.command)

		for (const action of ACTIONS) expect(declared).toContain(action.command)
	})
})

/** 画面を jsdom で動かし、届いた知らせをつなぎへ渡す。 */
async function openScreen(model = { sections: sectionsWithFields(), actions: ACTIONS }) {
	const bridge = createSettingsBridge(() => configuration, vi.fn(async () => undefined))
	const html = settingsHtml({ nonce: "test-nonce", cspSource: "vscode-resource:", model })
	const sent: FromView[] = []
	const dom = new JSDOM(html, {
		runScripts: "dangerously",
		beforeParse(window) {
			Object.assign(window, {
				acquireVsCodeApi: () => ({ postMessage: (message: FromView) => sent.push(message) }),
				structuredClone,
			})
		},
	})
	const { window } = dom
	const deliver = (message: ToView | undefined) => {
		if (message) window.dispatchEvent(new window.MessageEvent("message", { data: message }))
	}
	/** 画面が送った知らせを、つなぎへ渡して答えを画面へ返す（本物の openSettingsView と同じ流れ）。 */
	const pump = async () => {
		while (sent.length > 0) {
			const message = sent.shift()!
			const answer = await bridge.receive(message)
			deliver(answer)
			if (answer?.type === "saved") deliver(bridge.state())
		}
	}
	await pump()
	const document = window.document
	const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
	return { window, document, byId, sent, pump, deliver, bridge }
}

describe("画面と拡張をつなぐ", () => {
	it("画面で変えた値を「保存」で書き、誤りは項目の下に出して何も書かない", async () => {
		const { window, byId, pump } = await openScreen()

		// 伏せ字化を切り、確度の下限を範囲の外にする。
		const enabled = byId<HTMLInputElement>("input-piiGuard.enabled")
		expect(enabled.checked).toBe(true)
		enabled.checked = false
		enabled.dispatchEvent(new window.Event("change"))
		const score = byId<HTMLInputElement>("input-piiGuard.properNouns.minScore")
		score.value = "1.5"
		score.dispatchEvent(new window.Event("input"))

		expect(byId<HTMLButtonElement>("save").disabled).toBe(false)
		byId<HTMLButtonElement>("save").click()
		await pump()

		expect(configuration.updates).toEqual([])
		expect(byId("error-piiGuard.properNouns.minScore").textContent).toBe("1 以下にしてください")
		expect(byId("status").textContent).toContain("保存していません")

		// 直して保存し直す。
		score.value = "0.8"
		score.dispatchEvent(new window.Event("input"))
		expect(byId("error-piiGuard.properNouns.minScore").textContent).toBe("")
		byId<HTMLButtonElement>("save").click()
		await pump()

		expect(configuration.updates).toEqual([
			["piiGuard.enabled", false, 1],
			["piiGuard.properNouns.minScore", 0.8, 1],
		])
		expect(byId("status").textContent).toBe("保存しました。")
		// 書けた値を読み直したので、変えた印は消え、保存のボタンも押せない。
		expect(byId<HTMLButtonElement>("save").disabled).toBe(true)
		expect(byId("field-piiGuard.enabled").classList.contains("dirty")).toBe(false)
	})

	it("語の一覧は、行を足して書いたものが、拡張の整えた形で保存される", async () => {
		const { window, document, byId, pump } = await openScreen()
		const field = byId("field-piiGuard.terms")

		const add = [...field.querySelectorAll("button")].find((button) => button.textContent === "行を足す")!
		add.click()
		const row = field.querySelector(".row")!
		const value = row.querySelector<HTMLInputElement>("input[type=text]")!
		value.value = " 田中 "
		value.dispatchEvent(new window.Event("input"))
		const kind = row.querySelector("select")!
		kind.value = "person"
		kind.dispatchEvent(new window.Event("change"))

		byId<HTMLButtonElement>("save").click()
		await pump()

		expect(configuration.updates).toEqual([["piiGuard.terms", [{ value: "田中", kind: "person" }], 1]])
		expect(document.querySelectorAll("#field-piiGuard\\.terms .row")).toHaveLength(1)
	})

	it("種類のオン・オフは、外した種類も false として保存する", async () => {
		const { window, byId, pump } = await openScreen()
		const boxes = byId("field-piiGuard.kinds").querySelectorAll<HTMLInputElement>("input[type=checkbox]")
		boxes[0].checked = false
		boxes[0].dispatchEvent(new window.Event("change"))

		byId<HTMLButtonElement>("save").click()
		await pump()

		const [[key, value]] = configuration.updates
		expect(key).toBe("piiGuard.kinds")
		expect(value).toMatchObject({ person: false, org: true })
		expect(Object.keys(value as object)).toHaveLength(12)
	})

	it("「変更を取り消す」で、保存した値に戻す", async () => {
		const { window, byId } = await openScreen()
		const path = byId<HTMLInputElement>("input-piiGuard.properNouns.modelPath")
		path.value = "/x"
		path.dispatchEvent(new window.Event("input"))

		byId<HTMLButtonElement>("revert").click()

		expect(byId<HTMLInputElement>("input-piiGuard.properNouns.modelPath").value).toBe("")
		expect(byId<HTMLButtonElement>("save").disabled).toBe(true)
	})

	it("外で設定が変わったら取り込み、保存していない変更は残す", async () => {
		const { window, byId, deliver, bridge } = await openScreen()
		const path = byId<HTMLInputElement>("input-piiGuard.properNouns.modelPath")
		path.value = "/mine"
		path.dispatchEvent(new window.Event("input"))

		configuration.global.set("piiGuard.restore", false)
		configuration.workspace.set("piiGuard.enabled", false)
		deliver(bridge.state())

		expect(byId<HTMLInputElement>("input-piiGuard.restore").checked).toBe(false)
		expect(byId<HTMLInputElement>("input-piiGuard.properNouns.modelPath").value).toBe("/mine")
		expect(byId("note-piiGuard.enabled").textContent).toContain("ワークスペースの設定で上書きされています")
	})

	it("操作のボタンは、そのコマンドを拡張へ送る", async () => {
		const { document, sent } = await openScreen()

		const button = [...document.querySelectorAll("#actions button")].find(
			(one) => one.textContent === "モデルの置き場所を確かめる",
		) as HTMLButtonElement
		button.click()

		expect(sent).toEqual([{ type: "command", command: "piiGuard.modelStatus" }])
	})

	it("設定の文に HTML やスクリプトの終わりが入っていても、文字として出す", async () => {
		const sections = sectionsWithFields()
		sections[0].fields[0] = { ...sections[0].fields[0], description: '</script><img src=x onerror="window.hacked=1">' }
		const { window, byId } = await openScreen({ sections, actions: ACTIONS })

		expect(byId("field-piiGuard.enabled").querySelector(".description")!.textContent).toBe(
			'</script><img src=x onerror="window.hacked=1">',
		)
		expect(byId("field-piiGuard.enabled").querySelector("img")).toBeNull()
		expect((window as unknown as { hacked?: number }).hacked).toBeUndefined()
	})

	it("CSP は外から何も読ませず、nonce の付いたスクリプトとスタイルだけを許す", () => {
		const html = settingsHtml({ nonce: "abc", cspSource: "vscode-resource:", model: { sections: [], actions: [] } })

		expect(html).toContain("default-src 'none'; style-src vscode-resource: 'nonce-abc'; script-src 'nonce-abc';")
		expect(html).not.toMatch(/unsafe-(inline|eval)/)
		expect(html).toContain('<script nonce="abc">')
	})
})

describe("openSettingsView", () => {
	function fakePanel() {
		const handlers: { message?: (message: FromView) => Promise<void>; dispose?: () => void } = {}
		const panel = {
			reveal: vi.fn(),
			onDidDispose: (handler: () => void) => {
				handlers.dispose = handler
			},
			webview: {
				html: "",
				cspSource: "vscode-resource:",
				postMessage: vi.fn(async (_message: unknown) => true),
				onDidReceiveMessage: (handler: (message: FromView) => Promise<void>) => {
					handlers.message = handler
					return { dispose: vi.fn() }
				},
			},
		}
		return { panel, handlers }
	}

	it("画面を開き、届いた知らせに答え、設定の変化を知らせ、閉じたら開き直せる", async () => {
		const { panel, handlers } = fakePanel()
		mocks.createWebviewPanel.mockReturnValue(panel)
		let onConfiguration: ((event: { affectsConfiguration: (key: string) => boolean }) => void) | undefined
		mocks.onDidChangeConfiguration.mockImplementation((handler) => {
			onConfiguration = handler
			return { dispose: vi.fn() }
		})
		const context = { subscriptions: [] as unknown[] }

		openSettingsView(context as never)

		expect(mocks.createWebviewPanel).toHaveBeenCalledWith(
			"piiGuard.settings",
			"PII Guard の設定",
			-1,
			{ enableScripts: true, localResourceRoots: [] },
		)
		expect(panel.webview.html).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]{24}';/)
		expect(context.subscriptions).toContain(panel)

		await handlers.message!({ type: "ready" })
		expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "state" }))

		await handlers.message!({ type: "save", values: { "piiGuard.enabled": false } })
		expect(panel.webview.postMessage.mock.calls.slice(-2).map(([message]) => (message as ToView).type)).toEqual([
			"saved",
			"state",
		])

		// 保存できなかったときは、誤りだけを返して読み直さない（誤りの文を消さない）。
		const beforeErrors = panel.webview.postMessage.mock.calls.length
		await handlers.message!({ type: "save", values: { "piiGuard.properNouns.minScore": 2 } })
		expect(panel.webview.postMessage.mock.calls.slice(beforeErrors).map(([message]) => (message as ToView).type)).toEqual([
			"errors",
		])

		// 何も返さない知らせ（操作のボタン）は、画面へ何も送らない。
		const before = panel.webview.postMessage.mock.calls.length
		await handlers.message!({ type: "command", command: "piiGuard.modelStatus" })
		expect(panel.webview.postMessage.mock.calls.length).toBe(before)

		onConfiguration!({ affectsConfiguration: (key) => key === "editor" })
		expect(panel.webview.postMessage.mock.calls.length).toBe(before)
		onConfiguration!({ affectsConfiguration: (key) => key === "piiGuard" })
		expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "state" }))

		// 開いている間は、もう 1 つ作らずに前へ出す。
		openSettingsView(context as never)
		expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1)
		expect(panel.reveal).toHaveBeenCalled()

		// 閉じたら、次は新しく開く。
		handlers.dispose!()
		const second = fakePanel()
		mocks.createWebviewPanel.mockReturnValue(second.panel)
		openSettingsView(context as never)
		expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2)
		second.handlers.dispose!()
	})
})
