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

import { PiiVault, maskConversation } from "../maskConversation"
import { clearSessionVault } from "../sessionVaultEditor"

const addEmails = (vault: PiiVault, text: string) =>
	maskConversation("", [{ type: "message", role: "user", content: text } as never], { kinds: ["email"] }, vault)

beforeEach(() => vi.clearAllMocks())

describe("Session Vaultの消去", () => {
	it("空なら確認を開かない", async () => {
		await clearSessionVault(new PiiVault())

		expect(mocks.showInformationMessage).toHaveBeenCalledExactlyOnceWith("common:pii.noVault")
		expect(mocks.showWarningMessage).not.toHaveBeenCalled()
	})

	it("件数と復元不能を確認して全件を消す", async () => {
		const vault = new PiiVault()
		addEmails(vault, "alice@x.example と bob@y.example")
		mocks.showWarningMessage.mockResolvedValueOnce("common:pii.clearVault")

		await clearSessionVault(vault)

		expect(mocks.showWarningMessage.mock.calls[0][0]).toBe(
			'common:pii.confirmClearVault:{"scope":"common:pii.sessionVault","count":2}',
		)
		expect(vault.size).toBe(0)
		expect(mocks.showInformationMessage).toHaveBeenCalledWith('common:pii.vaultCleared:{"count":2}')
	})

	it("確認を取り消したら消さない", async () => {
		const vault = new PiiVault()
		addEmails(vault, "alice@x.example")
		mocks.showWarningMessage.mockResolvedValueOnce(undefined)

		await clearSessionVault(vault)

		expect(vault.restore("{{email-001}}")).toBe("alice@x.example")
	})

	it("確認中に増えた対応は消さない", async () => {
		const vault = new PiiVault()
		addEmails(vault, "alice@x.example")
		mocks.showWarningMessage.mockImplementationOnce(async () => {
			addEmails(vault, "bob@y.example")
			return "common:pii.clearVault"
		})

		await clearSessionVault(vault)

		expect(vault.size).toBe(1)
		expect(vault.restore("{{email-001}} / {{email-002}}")).toBe("{{email-001}} / bob@y.example")
	})
})
