// npx vitest run src/__tests__/adapters.spec.ts
//
// 本体から写すときに置き換えた 3 つ（置き場所・文言・proxy）。
//
// **小さいが、間違えると全体が静かに壊れる。** 置き場所が違えば辞書が読まれず、文言が
// 空なら何が起きたか分からず、proxy を無視すれば閉じた網からモデルを取れない。

import * as os from "os"

import * as vscode from "vscode"

import { getGlobalAgentDirectory } from "../paths"
import { t } from "../messages"
import { fetchThrough, getProxyDispatcher } from "../proxy"

describe("置き場所", () => {
	it("本体と同じ ~/.agent を見る", () => {
		// **別の場所にすると、両方を入れている利用者が辞書を 2 つ持つ。** 片方へ足した
		// 語が、もう片方では効かない。
		expect(getGlobalAgentDirectory()).toBe(`${os.homedir()}/.agent`)
	})
})

describe("文言", () => {
	it("差し込みの値を埋める", () => {
		expect(t("common:pii.masked", { count: 3 })).toBe("3 件を伏せました。")
	})

	it("知らない鍵は、そのまま返す", () => {
		// **空を返さない。** 返すと画面に何も出ないまま処理だけが進み、何が起きたのか
		// 分からなくなる。
		expect(t("common:pii.存在しない")).toBe("common:pii.存在しない")
	})

	it("値が足りなければ、差し込みの形を残す", () => {
		// 消すと「 件を伏せました」になり、読めない文になる。残っていれば書き忘れに気づける。
		expect(t("common:pii.masked", {})).toBe("{{count}} 件を伏せました。")
	})
})

describe("proxy", () => {
	const setConfig = (proxy: string | undefined) =>
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: () => proxy } as never)

	beforeEach(() => {
		vi.clearAllMocks()
		delete process.env.https_proxy
		delete process.env.HTTPS_PROXY
	})

	it("VS Code の設定があれば、それを使う", () => {
		setConfig("http://proxy.example:8080")

		expect(getProxyDispatcher()).toBeDefined()
	})

	it("設定が空なら、環境変数を見る", () => {
		// **環境変数も見る。** 見ないと、端末では取れるのに拡張からは取れない、という
		// 食い違いになる。
		setConfig("   ")
		process.env.https_proxy = "http://proxy.example:8080"

		expect(getProxyDispatcher()).toBeDefined()
	})

	it("どちらも無ければ、経由しない", () => {
		setConfig(undefined)

		expect(getProxyDispatcher()).toBeUndefined()
	})

	it("経由しないときは、そのまま取りに行く", async () => {
		const seen: unknown[] = []
		vi.stubGlobal("fetch", async (_url: string, init: unknown) => {
			seen.push(init)
			return new Response("ok")
		})

		await fetchThrough(undefined, "https://例/a")

		// `dispatcher` を付けない。付けると undici の型と食い違う。
		expect(seen[0]).not.toHaveProperty("dispatcher")
		vi.unstubAllGlobals()
	})
})
