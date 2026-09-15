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
import { resetSessionVault } from "../pii/maskConversation"
import { createHandler } from "../participant"

vi.mock("../paths", () => ({ getGlobalAgentDirectory: () => "/w/存在しない" }))

beforeEach(() => resetSessionVault())

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
					text: (async function* () {
						for (const one of reply) yield one
					})(),
				}
			},
		},
	}
}

/** 画面へ出た文を集める。 */
function fakeStream() {
	const parts: string[] = []
	return { parts, stream: { markdown: (text: string) => parts.push(text) } }
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

	await handler({ prompt: PROMPT, references } as never, {} as never, out.stream as never, {} as never)

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

		await handler({ prompt: "今日の天気は" } as never, {} as never, out.stream as never, {} as never)

		// 「伏せました」と紛れない文にする。0 件なのに伏せたように見せない。
		expect(out.parts.join("")).toContain("伏せるものは見つかりませんでした")
	})

	it("モデルを選べなければ、送らずに理由を出す", async () => {
		const out = fakeStream()
		const handler = createHandler({
			masker: () => new TaskPiiMasker({ enabled: true } as never),
			isEnabled: () => true,
			selectModel: async () => undefined,
		})

		await handler({ prompt: PROMPT } as never, {} as never, out.stream as never, {} as never)

		expect(out.parts.join("")).toContain("Copilot")
	})
})
