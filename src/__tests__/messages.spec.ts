import { t } from "../messages"

describe("右クリックに出す文言", () => {
	it("内部の翻訳キーではなく、日本語の確認文を返す", () => {
		expect(t("common:pii.confirmMask", { detail: "メールアドレス 1" })).toBe(
			"メールアドレス 1\n置き換えますか。取り消しの操作で元へ戻せます。",
		)
		expect(t("common:pii.replace")).toBe("置き換える")
	})

	it("右クリックで使う種類名と完了表示を返す", () => {
		expect(t("common:pii.kind.email")).toBe("メールアドレス")
		expect(t("common:pii.replaced", { summary: "メールアドレス 1" })).toBe("メールアドレス 1 を伏せました。")
	})
})
