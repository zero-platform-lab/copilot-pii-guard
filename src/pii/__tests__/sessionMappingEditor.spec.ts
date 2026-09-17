const mocks = vi.hoisted(() => ({
	showInformationMessage: vi.fn(async (..._args: unknown[]) => undefined as unknown),
	showWarningMessage: vi.fn(async (..._args: unknown[]) => undefined as unknown),
}))

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: mocks.showInformationMessage,
		showWarningMessage: mocks.showWarningMessage,
	},
}))

vi.mock("../../messages", () => ({
	t: (key: string, args?: Record<string, unknown>) => (args ? `${key}:${JSON.stringify(args)}` : key),
}))

import { PiiMapping, maskConversation } from "../maskConversation"
import { clearSessionMapping } from "../sessionMappingEditor"

const addEmails = (mapping: PiiMapping, text: string) =>
	maskConversation("", [{ type: "message", role: "user", content: text } as never], { kinds: ["email"] }, mapping)

beforeEach(() => vi.clearAllMocks())

describe("セッション対応表の消去", () => {
	it("空なら確認を開かない", async () => {
		await clearSessionMapping(new PiiMapping())

		expect(mocks.showInformationMessage).toHaveBeenCalledExactlyOnceWith("common:pii.noMapping")
		expect(mocks.showWarningMessage).not.toHaveBeenCalled()
	})

	it("件数と復元不能を確認して全件を消す", async () => {
		const mapping = new PiiMapping()
		addEmails(mapping, "alice@x.example と bob@y.example")
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.clearMapping")

		await clearSessionMapping(mapping)

		expect(mocks.showWarningMessage.mock.calls[0][0]).toBe(
			'common:pii.confirmClearMapping:{"scope":"common:pii.sessionMapping","count":2}',
		)
		expect(mapping.size).toBe(0)
		expect(mocks.showInformationMessage).toHaveBeenCalledWith('common:pii.mappingCleared:{"count":2}')
	})

	it("確認を取り消したら消さない", async () => {
		const mapping = new PiiMapping()
		addEmails(mapping, "alice@x.example")
		mocks.showWarningMessage.mockResolvedValueOnce(undefined)

		await clearSessionMapping(mapping)

		expect(mapping.restore("{{email-001}}")).toBe("alice@x.example")
	})

	it("確認中に増えた対応は消さない", async () => {
		const mapping = new PiiMapping()
		addEmails(mapping, "alice@x.example")
		mocks.showWarningMessage.mockImplementationOnce(async () => {
			addEmails(mapping, "bob@y.example")
			return "common:pii.clearMapping"
		})

		await clearSessionMapping(mapping)

		expect(mapping.size).toBe(1)
		expect(mapping.restore("{{email-001}} / {{email-002}}")).toBe("{{email-001}} / bob@y.example")
	})
})
