// npx vitest run src/__tests__/participant.spec.ts
//
// **これがこの拡張の要である。** モデルへ渡った文に生の値が 1 つも無いことを、実際に
// 受け取った側から確かめる。
//
// ほかの試験は、伏せる関数の戻り値と、呼び出し箇所の数を見ている。どちらも「モデルが
// 実際に受け取った文」は一度も見ていない。送る手前で組み立て直す処理が 1 つでも挟まれば、
// 伏せたはずの値がそのまま出ていく。
//
// **伏せない場合も確かめる。** 生の値が渡ることを見ておかないと、この試験が本当に何かを
// 確かめているのか分からない。

import { TaskPiiMasker } from "../pii/TaskPiiMasker"
import { PiiMapping, resetSessionMapping } from "../pii/maskConversation"
import { createHandler } from "../participant"

vi.mock("../paths", () => ({ getGlobalAgentDirectory: () => "/w/存在しない" }))

beforeEach(() => resetSessionMapping())

/** 伏せたい値。どれも作り物である。 */
const SECRETS = {
	email: "taro@corp.example",
	address: "東京都渋谷区神南1-2-3",
	org: "株式会社サンプル",
	card: "4111 1111 1111 1111",
}

const PROMPT = `${SECRETS.org} の ${SECRETS.email} へ送る案内を書いて。所在地は ${SECRETS.address}、番号は ${SECRETS.card}。`

/** 受け取った文を控え、決めた断片を返すだけのモデル。 */
function fakeModel(reply: string[]) {
	const seen: string[] = []

	return {
		seen,
		model: {
			sendRequest: async (messages: { content: string }[]) => {
				seen.push(...messages.map((one) => one.content))
				return {
					stream: (async function* () {
						for (const one of reply) yield { value: one }
					})(),
				}
			},
		},
	}
}

/** 画面へ出た文を集める。 */
function fakeStream() {
	const parts: string[] = []
	return { parts, stream: { markdown: (text: string) => parts.push(text), progress: vi.fn() } }
}

async function ask(settings: object, reply: string[] = ["わかりました"], references: unknown[] = []) {
	const fake = fakeModel(reply)
	const out = fakeStream()

	const handler = createHandler({
		masker: () => new TaskPiiMasker(settings as never),
		// 切のときも確かめられるよう、設定から決める。
		isEnabled: () => (settings as { enabled?: boolean }).enabled !== false,
		selectModel: async () => fake.model as never,
	})

	await handler(
		{ prompt: PROMPT, references } as never,
		{ history: [] } as never,
		out.stream as never,
		{} as never,
	)

	return { sent: fake.seen.join(""), shown: out.parts.join("") }
}

describe("伏せてから Copilot へ送る", () => {
	it("伏せると、生の値は 1 つも渡らない", async () => {
		const { sent } = await ask({
			enabled: true,
			terms: [{ value: SECRETS.org, kind: "org" }],
		})

		expect(sent).not.toBe("")
		for (const [name, value] of Object.entries(SECRETS)) {
			expect(sent, `${name} が渡っている`).not.toContain(value)
		}
		expect(sent).toContain("{{email-001}}")
		expect(sent).toContain("{{org-001}}")
		expect(sent).toContain("{{address-001}}")
		expect(sent).toContain("{{card-001}}")
	})

	it("伏せなければ、生の値が渡る", async () => {
		// これが渡らないなら、上の試験は何も確かめていない。
		const { sent } = await ask({})

		expect(sent).toContain(SECRETS.email)
		expect(sent).toContain(SECRETS.address)
	})

	it("添付したファイル、選択範囲、文字列参照も伏せてから送る", async () => {
		const fileSecret = "hanako@corp.example"
		const selectionSecret = "東京都千代田区丸の内1-1-1"
		const referenceSecret = "4111 1111 1111 1111"
		const fake = fakeModel(["はい"])
		const out = fakeStream()
		const document = { getText: (range?: unknown) => (range ? selectionSecret : `連絡先は ${fileSecret}`) }
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
			openTextDocument: async () => document as never,
		})
		const uri = { scheme: "file", path: "/work/customer.txt" }

		await handler(
			{
				prompt: "参照を要約して",
				references: [{ value: uri }, { value: { uri, range: {} } }, { value: referenceSecret }],
			} as never,
			{} as never,
			out.stream as never,
			{} as never,
		)

		const sent = fake.seen.join("")
		for (const value of [fileSecret, selectionSecret, referenceSecret]) expect(sent).not.toContain(value)
		expect(out.parts.join("")).toContain("参照した本文 3 件")
	})

	it("添付ファイルと選択範囲のファイル対応表を一度だけ取り込み、衝突した番号を直す", async () => {
		const fake = fakeModel(["{{email-002}}へ返します"])
		const out = fakeStream()
		const masker = new TaskPiiMasker({ enabled: true } as never)
		masker.allocator.importEntries([["{{email-001}}", "bob@corp.example"]])
		const prepareReferenceMapping = vi.fn(async (_uri: unknown, active: TaskPiiMasker) => {
			const remapped = active.allocator.importEntries([["{{email-001}}", "alice@corp.example"]])
			return (text: string) => {
				let replaced = text
				for (const [from, to] of remapped) replaced = replaced.replaceAll(from, to)
				return replaced
			}
		})
		const handler = createHandler({
			masker: () => masker,
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
			openTextDocument: async () => ({ getText: () => "連絡先は {{email-001}}" }) as never,
			prepareReferenceMapping,
		})
		const uri = { scheme: "file", authority: "", path: "/work/customer.txt", query: "" }

		await handler(
			{
				prompt: "参照を確認して",
				references: [{ value: uri }, { value: { uri, range: {} } }],
			} as never,
			{ history: [] } as never,
			out.stream as never,
			{} as never,
		)

		const sent = fake.seen.join("")
		expect(prepareReferenceMapping).toHaveBeenCalledTimes(1)
		expect(sent).toContain("{{email-002}}")
		expect(sent).not.toContain("連絡先は {{email-001}}")
		expect(out.parts.join("")).toContain("alice@corp.exampleへ返します")
	})

	it("ファイル対応表を準備できない参照は送らず、理由を表示する", async () => {
		const fake = fakeModel(["はい"])
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
			openTextDocument: async () => ({ getText: () => "機密 {{email-001}}" }) as never,
			prepareReferenceMapping: async () => Promise.reject(new Error("broken mapping")),
		})
		const uri = { scheme: "file", path: "/work/private.txt" }

		await handler(
			{ prompt: "確認して", references: [{ value: uri }] } as never,
			{ history: [] } as never,
			out.stream as never,
			{} as never,
		)

		expect(fake.seen.join("")).not.toContain("{{email-001}}")
		expect(out.parts.join("")).toContain("読み込めなかった参照は送信しませんでした")
		expect(out.parts.join("")).toContain("/work/private.txt")
	})

	it("伏せ字化が切ならファイル対応表を準備せず、参照本文をそのまま送る", async () => {
		const fake = fakeModel(["はい"])
		const prepareReferenceMapping = vi.fn(async () => Promise.reject(new Error("broken mapping")))
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: false } as never),
			isEnabled: () => false,
			selectModel: async () => fake.model as never,
			openTextDocument: async () => ({ getText: () => "連絡先は alice@corp.example" }) as never,
			prepareReferenceMapping,
		})
		const uri = { scheme: "file", path: "/work/customer.txt" }

		await handler(
			{ prompt: "確認して", references: [{ value: uri }] } as never,
			{ history: [] } as never,
			fakeStream().stream as never,
			{} as never,
		)

		expect(prepareReferenceMapping).not.toHaveBeenCalled()
		expect(fake.seen.join("")).toContain("alice@corp.example")
	})

	it("読めない参照は送らず、理由を表示する", async () => {
		const fake = fakeModel(["はい"])
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
			openTextDocument: async () => Promise.reject(new Error("read failed")),
		})

		await handler(
			{ prompt: "確認して", references: [{ value: { scheme: "file", path: "/work/private.txt" } }] } as never,
			{} as never,
			out.stream as never,
			{} as never,
		)

		expect(fake.seen.join("")).not.toContain("private.txt")
		expect(out.parts.join("")).toContain("読み込めなかった参照は送信しませんでした")
	})

	it("応答の伏せ字は、元の値へ戻して画面へ出す", async () => {
		const { shown } = await ask(
			{ enabled: true, terms: [{ value: SECRETS.org, kind: "org" }] },
			["{{org-001}} 宛に ", "{{email-0", "01}} で送ります"],
		)

		// 2 つ目と 3 つ目は伏せ字が割れて届く。断片ごとに戻すと、ここが戻らない。
		expect(shown).toContain(SECRETS.org)
		expect(shown).toContain(SECRETS.email)
		expect(shown).not.toContain("{{")
	})

	it("伏せたことと、その件数を必ず出す", async () => {
		// **出さないと、伏せたのか素通りしたのかが分からない。** 画面は何も変わらない
		// ので、これがいちばん気づけない失敗である。
		const { shown } = await ask({
			enabled: true,
			terms: [{ value: SECRETS.org, kind: "org" }],
		})

		expect(shown).toContain("伏せました")
		expect(shown).toContain("社名 1")
		expect(shown).toContain("メールアドレス 1")
	})

	it("切のときは、伏せていないことをはっきり出す", async () => {
		// 切ったまま話しかけると、生の文がそのまま Copilot へ渡る。**黙らない。**
		const { shown, sent } = await ask({ enabled: false })

		expect(shown).toContain("伏せていません")
		expect(shown).toContain("piiGuard.enabled")
		// 実際に生の文が渡っていることも見る。出す文と実物が食い違っては意味が無い。
		expect(sent).toContain(SECRETS.email)
	})

	it("伏せるものが無ければ、そう出す", async () => {
		const fake = fakeModel(["はい"])
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
		})

		await handler(
			{ prompt: "今日の天気は" } as never,
			{ history: [] } as never,
			out.stream as never,
			{} as never,
		)

		// 「伏せました」と紛れない文にする。0 件なのに伏せたように見せない。
		expect(out.parts.join("")).toContain("伏せるものは見つかりませんでした")
	})

	it("セッション対応表上限に達したらモデルへ送らず、理由を表示する", async () => {
		const fake = fakeModel(["送られない"])
		const out = fakeStream()
		const mapping = new PiiMapping()
		const handler = createHandler({
			masker: () =>
				new TaskPiiMasker({ enabled: true, sessionMapping: { maxEntries: 1 } } as never, mapping),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
		})

		await handler(
			{ prompt: "alice@corp.example と bob@corp.example" } as never,
			{ history: [] } as never,
			out.stream as never,
			{} as never,
		)

		expect(fake.seen).toHaveLength(0)
		expect(mapping.size).toBe(0)
		expect(out.parts.join("")).toContain("セッション対応表の対応数が設定上限に達した")
	})

	it("モデルを選べなければ、送らずに理由を出す", async () => {
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => undefined,
		})

		await handler({ prompt: PROMPT } as never, { history: [] } as never, out.stream as never, {} as never)

		expect(out.parts.join("")).toContain("Copilot")
	})

	it("同じ @mask との会話履歴を伏せてから順番どおり引き継ぐ", async () => {
		const previousEmail = "hanako@corp.example"
		const fake = fakeModel(["承知しました"])
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
		})
		const history = [
			{ prompt: `${previousEmail} の担当を覚えて`, references: [], participant: "pii-guard.mask" },
			{
				response: [{ value: { value: `担当は ${previousEmail} ですね` } }],
				result: {},
				participant: "pii-guard.mask",
			},
		]

		await handler(
			{ prompt: "その担当へ案内を書いて", references: [] } as never,
			{ history } as never,
			out.stream as never,
			{} as never,
		)

		expect(fake.seen).toHaveLength(3)
		expect(fake.seen[0]).toContain("{{email-001}} の担当を覚えて")
		expect(fake.seen[1]).toContain("担当は {{email-001}} ですね")
		expect(fake.seen[2]).toBe("その担当へ案内を書いて")
		for (const sent of fake.seen) expect(sent).not.toContain(previousEmail)
	})

	it("前回の状態表示をモデルの会話履歴へ混ぜない", async () => {
		const fake = fakeModel(["続けます"])
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
		})
		const history = [
			{ prompt: "最初の依頼", references: [], participant: "pii-guard.mask" },
			{
				response: [{ value: { value: "> 🛡 伏せました。\n\nモデルの回答" } }],
				result: { metadata: { "piiGuard.modelResponse": "モデルの回答" } },
				participant: "pii-guard.mask",
			},
		]

		await handler(
			{ prompt: "続きを書いて", references: [] } as never,
			{ history } as never,
			out.stream as never,
			{} as never,
		)

		expect(fake.seen).toEqual(["最初の依頼", "モデルの回答", "続きを書いて"])
	})

	it("ファイル道具の結果も伏せてからモデルへ返す", async () => {
		const requests: Array<Array<{ role: number; content: unknown }>> = []
		let round = 0
		const model = {
			sendRequest: async (messages: Array<{ role: number; content: unknown }>) => {
				requests.push(messages)
				round++
				return {
					stream: (async function* () {
						if (round === 1) {
							yield { callId: "call-1", name: "pii_guard_read_file", input: { path: "customer.txt" } }
						} else {
							yield { value: "読みました" }
						}
					})(),
				}
			},
		}
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => model as never,
			tools: [{ name: "pii_guard_read_file", description: "読む" }],
			confirmFileAccess: async () => true,
			runTool: async () => "連絡先は hanako@corp.example",
		})

		await handler(
			{ prompt: "customer.txtを読んで", references: [] } as never,
			{ history: [] } as never,
			out.stream as never,
			{} as never,
		)

		expect(requests).toHaveLength(2)
		const second = JSON.stringify(requests[1])
		expect(second).toContain("{{email-001}}")
		expect(second).not.toContain("hanako@corp.example")
	})

	it("ファイル道具のエラー文も伏せてからモデルへ返す", async () => {
		const requests: Array<Array<{ role: number; content: unknown }>> = []
		let round = 0
		const model = {
			sendRequest: async (messages: Array<{ role: number; content: unknown }>) => {
				requests.push(messages)
				round++
				return {
					stream: (async function* () {
						if (round === 1) {
							yield { callId: "call-1", name: "pii_guard_read_file", input: { path: "customer.txt" } }
						} else {
							yield { value: "読めませんでした" }
						}
					})(),
				}
			},
		}
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => model as never,
			tools: [{ name: "pii_guard_read_file", description: "読む" }],
			confirmFileAccess: async () => true,
			runTool: async () => {
				throw new Error("hanako@corp.example のファイルを読めません")
			},
		})

		await handler(
			{ prompt: "customer.txtを読んで", references: [] } as never,
			{ history: [] } as never,
			fakeStream().stream as never,
			{} as never,
		)

		const second = JSON.stringify(requests[1])
		expect(second).toContain("{{email-001}}")
		expect(second).not.toContain("hanako@corp.example")
	})

	it("Write Restore の現在値を回答の先頭へ常に表示する", async () => {
		const safe = await ask({ enabled: true })
		expect(safe.shown).toContain("Write Restore: 切")

		const fake = fakeModel(["はい"])
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			restoreFileWrites: () => true,
			selectModel: async () => fake.model as never,
		})
		await handler(
			{ prompt: "書いて", references: [] } as never,
			{ history: [] } as never,
			out.stream as never,
			{} as never,
		)

		expect(out.parts.join("")).toContain("Write Restore: 入")
	})
})

describe("ファイルを触る前の同意（FR-PII-11）", () => {
	// **同意を取る処理そのものである。** 壊れても画面は変わらない。窓が出ないだけなので、
	// 気づけるのは後から差分を見たときだけである。

	/** 道具を 1 回呼び、次の回で終わるモデル。`calls` に呼んだ道具を残す。 */
	function toolModel(calls: { name: string; input: object }[], rounds = 1) {
		let round = 0
		return {
			sendRequest: async () => {
				round++
				return {
					stream: (async function* () {
						if (round <= rounds) {
							const call = calls[round - 1] ?? calls[0]
							yield { callId: `call-${round}`, name: call.name, input: call.input }
						} else {
							yield { value: "終わりました" }
						}
					})(),
				}
			},
		}
	}

	async function run(options: {
		asked: unknown[]
		approve: boolean
		calls: { name: string; input: object }[]
		rounds?: number
		masker?: TaskPiiMasker
	}) {
		const ran: string[] = []
		const out = fakeStream()
		const handler = createHandler({
			masker: () => options.masker ?? new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => toolModel(options.calls, options.rounds) as never,
			tools: options.calls.map((one) => ({ name: one.name, description: one.name })),
			confirmFileAccess: async (call) => {
				options.asked.push(call)
				return options.approve
			},
			runTool: async (name) => {
				ran.push(name)
				return "読みました"
			},
		})

		await handler(
			{ prompt: "customer.txt を読んで", references: [] } as never,
			{ history: [] } as never,
			out.stream as never,
			{} as never,
		)

		return { ran, shown: out.parts.join("") }
	}

	it("読む前に必ず 1 度聞く", async () => {
		const asked: unknown[] = []

		const { ran } = await run({
			asked,
			approve: true,
			calls: [{ name: "pii_guard_read_file", input: { path: "customer.txt" } }],
		})

		expect(asked).toHaveLength(1)
		expect(ran).toEqual(["pii_guard_read_file"])
	})

	it("断ったら、道具を実行しない", async () => {
		// **ここが要である。** 実行してしまえば、ファイルの中身はもう読まれている。
		const asked: unknown[] = []

		const { ran, shown } = await run({
			asked,
			approve: false,
			calls: [{ name: "pii_guard_read_file", input: { path: "customer.txt" } }],
		})

		expect(ran).toEqual([])
		expect(shown).not.toContain("読みました")
	})

	it("1 度答えたら、同じ依頼では聞き直さない", async () => {
		// 毎回聞くと、道具を呼ぶたびに窓が出て、利用者は読まずに押すようになる。
		const asked: unknown[] = []

		const { ran } = await run({
			asked,
			approve: true,
			rounds: 3,
			calls: [
				{ name: "pii_guard_read_file", input: { path: "a.txt" } },
				{ name: "pii_guard_read_file", input: { path: "b.txt" } },
				{ name: "pii_guard_read_file", input: { path: "c.txt" } },
			],
		})

		expect(asked).toHaveLength(1)
		expect(ran).toHaveLength(3)
	})

	it("1 度断ったら、同じ依頼では二度と実行しない", async () => {
		const asked: unknown[] = []

		const { ran } = await run({
			asked,
			approve: false,
			rounds: 3,
			calls: [
				{ name: "pii_guard_read_file", input: { path: "a.txt" } },
				{ name: "pii_guard_read_file", input: { path: "b.txt" } },
				{ name: "pii_guard_read_file", input: { path: "c.txt" } },
			],
		})

		expect(asked).toHaveLength(1)
		expect(ran).toEqual([])
	})

	it("聞くときは、伏せ字ではなく元の道筋を見せる", async () => {
		// **伏せ字のままでは、何を許可するのか分からない。** `{{path-001}} を読みます` と
		// 出ても、利用者には判断できない。
		const masker = new TaskPiiMasker({
			enabled: true,
			terms: [{ value: "顧客名簿", kind: "term" }],
		} as never)
		const masked = (await masker.maskPrompt("顧客名簿.txt")).text
		expect(masked).not.toContain("顧客名簿")

		const asked: { input: Record<string, unknown> }[] = []
		await run({
			asked: asked as never,
			approve: true,
			masker,
			calls: [{ name: "pii_guard_read_file", input: { path: masked } }],
		})

		expect(asked[0].input.path).toBe("顧客名簿.txt")
	})
})

describe("ファイル道具の権限", () => {
	const declaredTools = [
		{ name: "pii_guard_read_file", description: "読む" },
		{ name: "pii_guard_write_file", description: "書く" },
	]

	function toolModel(calls: Array<{ callId: string; name: string; input: object }>) {
		const offered: string[][] = []
		let round = 0
		return {
			offered,
			model: {
				sendRequest: async (_messages: unknown, options: { tools: Array<{ name: string }> }) => {
					offered.push(options.tools.map((tool) => tool.name))
					round++
					return {
						stream: (async function* () {
							if (round === 1) {
								for (const call of calls) yield call
							} else {
								yield { value: "完了" }
							}
						})(),
					}
				},
			},
		}
	}

	it("confirmEdit は読取と書込を提示する", async () => {
		const fake = toolModel([])
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			fileToolMode: () => "confirmEdit",
			selectModel: async () => fake.model as never,
			tools: declaredTools,
		})

		await handler({ prompt: "確認" } as never, { history: [] } as never, out.stream as never, {} as never)

		expect(fake.offered[0]).toEqual(["pii_guard_read_file", "pii_guard_write_file"])
		expect(out.parts.join("")).toContain("ファイル道具: confirmEdit")
	})

	it("readOnly は書込を提示せず、直接要求されても実行しない", async () => {
		const fake = toolModel([{ callId: "write-1", name: "pii_guard_write_file", input: { path: "a.txt" } }])
		const runTool = vi.fn(async () => "書きました")
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			fileToolMode: () => "readOnly",
			selectModel: async () => fake.model as never,
			tools: declaredTools,
			runTool,
		})

		await handler({ prompt: "書いて" } as never, { history: [] } as never, out.stream as never, {} as never)

		expect(fake.offered[0]).toEqual(["pii_guard_read_file"])
		expect(runTool).not.toHaveBeenCalled()
		expect(out.parts.join("")).toContain("ファイル道具: readOnly")
		expect(out.parts.join("")).toContain("Write Restore: 停止中")
	})

	it("伏せ字化が切なら道具を提示せず、直接要求されても実行しない", async () => {
		const fake = toolModel([{ callId: "read-1", name: "pii_guard_read_file", input: { path: "a.txt" } }])
		const runTool = vi.fn(async () => "秘密")
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: false } as never),
			isEnabled: () => false,
			fileToolMode: () => "confirmEdit",
			selectModel: async () => fake.model as never,
			tools: declaredTools,
			runTool,
		})

		await handler({ prompt: "読んで" } as never, { history: [] } as never, out.stream as never, {} as never)

		expect(fake.offered[0]).toEqual([])
		expect(runTool).not.toHaveBeenCalled()
		expect(out.parts.join("")).toContain("ファイル道具: off")
	})

	it("複数の読取呼び出しでも依頼ごとに1回だけ確認する", async () => {
		const fake = toolModel([
			{ callId: "read-1", name: "pii_guard_read_file", input: { path: "a.txt" } },
			{ callId: "read-2", name: "pii_guard_read_file", input: { path: "b.txt" } },
		])
		const confirm = vi.fn(async () => true)
		const runTool = vi.fn(async () => "本文")
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			fileToolMode: () => "confirmEdit",
			selectModel: async () => fake.model as never,
			tools: declaredTools,
			confirmFileAccess: confirm,
			runTool,
		})

		await handler({ prompt: "読んで" } as never, { history: [] } as never, fakeStream().stream as never, {} as never)

		expect(confirm).toHaveBeenCalledOnce()
		expect(runTool).toHaveBeenCalledTimes(2)
	})

	it("確認画面では伏せ字のパスをローカルで元へ戻す", async () => {
		const fake = toolModel([
			{ callId: "read-1", name: "pii_guard_read_file", input: { path: "{{term-001}}.txt" } },
		])
		const seen: object[] = []
		const handler = createHandler({
			masker: () =>
				new TaskPiiMasker({
					enabled: true,
					terms: [{ value: "顧客名", kind: "term" }],
				} as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
			tools: declaredTools,
			confirmFileAccess: async (call) => {
				seen.push(call.input)
				return true
			},
			runTool: async () => "本文",
		})

		await handler(
			{ prompt: "顧客名.txtを読んで" } as never,
			{ history: [] } as never,
			fakeStream().stream as never,
			{} as never,
		)

		expect(seen).toEqual([{ path: "顧客名.txt" }])
	})

	it("前の依頼で許可していても、次の依頼ではもう一度確認する", async () => {
		let requestCount = 0
		const model = {
			sendRequest: async () => {
				requestCount++
				return {
					stream: (async function* () {
						if (requestCount % 2 === 1) {
							yield { callId: `read-${requestCount}`, name: "pii_guard_read_file", input: { path: "a.txt" } }
						} else {
							yield { value: "完了" }
						}
					})(),
				}
			},
		}
		const confirm = vi.fn(async () => true)
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => model as never,
			tools: declaredTools,
			confirmFileAccess: confirm,
			runTool: async () => "本文",
		})

		await handler({ prompt: "1回目" } as never, { history: [] } as never, fakeStream().stream as never, {} as never)
		await handler({ prompt: "2回目" } as never, { history: [] } as never, fakeStream().stream as never, {} as never)

		expect(confirm).toHaveBeenCalledTimes(2)
	})

	it("読取を拒否した依頼では再確認せず、どの読取も実行しない", async () => {
		const fake = toolModel([
			{ callId: "read-1", name: "pii_guard_read_file", input: { path: "a.txt" } },
			{ callId: "read-2", name: "pii_guard_read_file", input: { path: "b.txt" } },
		])
		const confirm = vi.fn(async () => false)
		const runTool = vi.fn(async () => "本文")
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
			tools: declaredTools,
			confirmFileAccess: confirm,
			runTool,
		})

		await handler({ prompt: "読んで" } as never, { history: [] } as never, fakeStream().stream as never, {} as never)

		expect(confirm).toHaveBeenCalledOnce()
		expect(runTool).not.toHaveBeenCalled()
	})

	it("1回の応答に9件の道具があれば、1件も実行せず停止する", async () => {
		const fake = toolModel(
			Array.from({ length: 9 }, (_, index) => ({
				callId: `read-${index}`,
				name: "pii_guard_read_file",
				input: { path: `${index}.txt` },
			})),
		)
		const confirm = vi.fn(async () => true)
		const runTool = vi.fn(async () => "本文")
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
			tools: declaredTools,
			confirmFileAccess: confirm,
			runTool,
		})

		await handler({ prompt: "全部読んで" } as never, { history: [] } as never, out.stream as never, {} as never)

		expect(confirm).not.toHaveBeenCalled()
		expect(runTool).not.toHaveBeenCalled()
		expect(out.parts.join("")).toContain("8件を超えました")
	})

	it("中断済みなら新しい道具を実行しない", async () => {
		const fake = toolModel([{ callId: "read-1", name: "pii_guard_read_file", input: { path: "a.txt" } }])
		const confirm = vi.fn(async () => true)
		const runTool = vi.fn(async () => "本文")
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => fake.model as never,
			tools: declaredTools,
			confirmFileAccess: confirm,
			runTool,
		})

		await handler(
			{ prompt: "読んで" } as never,
			{ history: [] } as never,
			fakeStream().stream as never,
			{ isCancellationRequested: true } as never,
		)

		expect(confirm).not.toHaveBeenCalled()
		expect(runTool).not.toHaveBeenCalled()
		expect(fake.offered).toEqual([])
	})

	it("モデル応答中に中断されたら道具を実行せず停止する", async () => {
		const token = { isCancellationRequested: false }
		let requests = 0
		const model = {
			sendRequest: async () => {
				requests++
				return {
					stream: (async function* () {
						yield { callId: "read-1", name: "pii_guard_read_file", input: { path: "a.txt" } }
						token.isCancellationRequested = true
					})(),
				}
			},
		}
		const confirm = vi.fn(async () => true)
		const runTool = vi.fn(async () => "本文")
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => model as never,
			tools: declaredTools,
			confirmFileAccess: confirm,
			runTool,
		})

		await handler({ prompt: "読んで" } as never, { history: [] } as never, out.stream as never, token as never)

		expect(requests).toBe(1)
		expect(confirm).not.toHaveBeenCalled()
		expect(runTool).not.toHaveBeenCalled()
		expect(out.parts.join("")).toContain("処理を中断しました")
	})
})
