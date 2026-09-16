// Copilot Chat の `@mask` の受け口。
//
// **仕組み。** 利用者の文を伏せてから Copilot のモデルへ送り、返ってきた文の伏せ字を
// 元の値へ戻して画面へ出す。送るのはこの拡張が組み立てた文だけなので、**伏せ忘れた
// ものが混ざる経路が無い。**
//
// **普通の Copilot Chat は素通りする。** Copilot 自身の要求へ割り込む口は VS Code の
// API に無い。伏せたいときは `@mask` と書いてもらう必要がある。この制限は README にも
// 書く。書かないと、入れただけで守られていると思われる。

import * as vscode from "vscode"

import type { TaskPiiMasker } from "./pii/TaskPiiMasker"
import { createStreamRestorer } from "./stream"
import { t } from "./messages"
import type { AgentMessage, FileToolMode } from "./types"
import { FILE_TOOLS, fileToolAccess, runFileTool } from "./fileTools"

/** 履歴へ残す、モデルが実際に返した本文。状態表示を次の依頼へ混ぜないために使う。 */
const MODEL_RESPONSE_METADATA = "piiGuard.modelResponse"

/** 画面へ出す種類の名前。設定の説明と揃える。 */
const LABELS: Record<string, string> = {
	person: "氏名",
	org: "社名",
	term: "辞書の語",
	email: "メールアドレス",
	phone: "電話番号",
	host: "社内の宛先",
	ip: "IP アドレス",
	card: "カード番号",
	secret: "鍵",
	zip: "郵便番号",
	address: "住所",
	mynumber: "マイナンバー",
}

/** 伏せ字を数える。`{{email-001}}` の `email` を種類として拾う。 */
export function countPlaceholders(text: string): Record<string, number> {
	const counts: Record<string, number> = {}
	for (const found of text.matchAll(/\{\{([a-z]+)-\d+\}\}/g)) {
		const kind = found[1]
		counts[kind] = (counts[kind] ?? 0) + 1
	}
	return counts
}

/** 伏せた件数を、種類ごとに 1 行で書く。 */
export function describeCounts(counts: Record<string, number>): string {
	const entries = Object.entries(counts).filter(([, count]) => count > 0)
	if (entries.length === 0) return ""

	return entries.map(([kind, count]) => `${LABELS[kind] ?? kind} ${count}`).join(" / ")
}

/**
 * いまの状態を 1 行で書く。
 *
 * **必ず出す。** 出さないと、切れているのか、伏せるものが無かったのかが分からない。
 * 切れているまま話しかけると、生の文がそのまま Copilot へ渡る。**画面は何も変わらない
 * ので、これがいちばん気づけない失敗である。**
 */
export function describeState(enabled: boolean, maskedText: string): string {
	if (!enabled) {
		return (
			"> ⚠️ **伏せていません。** 設定 `piiGuard.enabled` が切になっています。" +
			"このまま送ると、書いた内容はそのまま Copilot へ渡ります。\n\n"
		)
	}

	const detail = describeCounts(countPlaceholders(maskedText))
	return detail
		? `> 🛡 **伏せました。** ${detail}\n\n`
		: "> 🛡 伏せるものは見つかりませんでした。\n\n"
}

/** ファイル道具が書くときの状態。安全側の既定は伏せ字のまま。 */
export function describeWriteMode(
	enabled: boolean,
	restore: boolean,
	fileToolMode: FileToolMode = "confirmEdit",
): string {
	if (!enabled) return "> 🛡 **Write Restore: 停止中** 伏せ字化が切のためファイル道具を使いません。\n\n"
	if (fileToolMode !== "confirmEdit") {
		return "> 🛡 **Write Restore: 停止中** 現在の権限では書込道具を使いません。\n\n"
	}
	return restore
		? "> ⚠️ **Write Restore: 入** ファイル道具は元の値へ戻して書きます。\n\n"
		: "> 🛡 **Write Restore: 切** ファイル道具は伏せ字のまま書きます。\n\n"
}

/** 設定値と、伏せ字化によって狭めた実効権限を利用者へ示す。 */
export function describeFileToolMode(enabled: boolean, configured: FileToolMode): string {
	if (!enabled) return "> 🛡 **ファイル道具: off** 伏せ字化が切のため停止しています。\n\n"
	if (configured === "off") return "> 🛡 **ファイル道具: off** 一覧・検索・読取・書込を使いません。\n\n"
	if (configured === "readOnly") {
		return "> 🛡 **ファイル道具: readOnly** 確認後に一覧・検索・読取だけを使います。\n\n"
	}
	return "> 🛡 **ファイル道具: confirmEdit** 読取は依頼ごと、書込は毎回確認します。\n\n"
}

export type ParticipantDeps = {
	/** いまの設定で伏せる仕掛け。呼ばれるたびに設定を読み直す。 */
	masker: () => TaskPiiMasker
	/** 伏せる設定が入っているか。切なら、そのことを画面へ出す。 */
	isEnabled: () => boolean
	/** ファイル道具の書き込みを元の値へ戻すか。既定は戻さない。 */
	restoreFileWrites?: () => boolean
	/** ファイル道具の権限。未指定は現行互換の confirmEdit。 */
	fileToolMode?: () => FileToolMode
	/** ファイル道具が扱うファイルのFile Vaultを今回のSession Vaultへ取り込む。 */
	prepareFileVault?: (path: string, masker: TaskPiiMasker) => Promise<(text: string) => string>
	/** 使うモデルを選ぶ。既定は Copilot のもの。 */
	selectModel?: () => Promise<vscode.LanguageModelChat | undefined>
	/** 参照した文書を読む。試験では、実ファイルを開かずに差し替える。 */
	openTextDocument?: (uri: vscode.Uri) => Thenable<vscode.TextDocument>
	/** 試験用の道具一覧。既定はPII Guard自身のファイル道具。 */
	tools?: readonly vscode.LanguageModelChatTool[]
	/** 試験用の道具実行境界。返り値は呼び出し側でもう一度伏せる。 */
	runTool?: (
		name: string,
		input: object,
		masker: TaskPiiMasker,
		restoreWrites: boolean,
		token: vscode.CancellationToken,
	) => Promise<string>
	/** 依頼で初めて一覧・検索・読取を行う前の確認。 */
	confirmFileAccess?: (call: ToolCall) => Promise<boolean>
}

type ReferenceText = { label: string; text: string }

/** `Uri` は実装が増えても、この 2 つの値を持つ。`Location` はここに当てはまらない。 */
function isUri(value: unknown): value is vscode.Uri {
	return (
		typeof value === "object" &&
		value !== null &&
		"scheme" in value &&
		typeof value.scheme === "string" &&
		"path" in value &&
		typeof value.path === "string"
	)
}

/** ファイル全体、または選択範囲（Location）を、モデルへ送る前の本文として取り出す。 */
export async function readReferences(
	references: readonly vscode.ChatPromptReference[],
	openTextDocument: (uri: vscode.Uri) => Thenable<vscode.TextDocument> = vscode.workspace.openTextDocument,
): Promise<{ texts: ReferenceText[]; failures: string[] }> {
	const texts: ReferenceText[] = []
	const failures: string[] = []

	for (const reference of references) {
		const { value } = reference
		if (typeof value === "string") {
			texts.push({ label: reference.modelDescription ?? "参照", text: value })
			continue
		}

		const location =
			typeof value === "object" && value !== null && "uri" in value && "range" in value && isUri(value.uri)
				? (value as vscode.Location)
				: undefined
		const uri = isUri(value) ? value : location?.uri
		if (!uri) continue

		try {
			const document = await openTextDocument(uri)
			texts.push({ label: uri.path, text: document.getText(location?.range) })
		} catch {
			failures.push(uri.path)
		}
	}

	return { texts, failures }
}

/** 参照した本文を、出どころが分かる形で依頼文へ加える。ここで加えた全体を伏せる。 */
export function promptWithReferences(prompt: string, references: readonly ReferenceText[]): string {
	return [
		prompt,
		...references.map((reference) => `\n\n--- 参照: ${reference.label} ---\n${reference.text}`),
	].join("")
}

/** 応答履歴のうち、モデルへ再び渡せるMarkdown本文だけを取り出す。 */
function responseText(turn: vscode.ChatResponseTurn): string {
	const saved = turn.result.metadata?.[MODEL_RESPONSE_METADATA]
	if (typeof saved === "string") return saved

	// 0.2.3以前の履歴にはmetadataが無い。MarkdownStringの形を見て本文を救う。
	return turn.response
		.map((part) => {
			const value = (part as { value?: unknown }).value
			if (typeof value !== "object" || value === null || !("value" in value)) return ""
			return typeof value.value === "string" ? value.value : ""
		})
		.join("")
}

/** 同じ`@mask`参加者との履歴を、伏せる前の内部会話形式へ直す。 */
async function historyMessages(
	history: vscode.ChatContext["history"],
	openTextDocument: (uri: vscode.Uri) => Thenable<vscode.TextDocument>,
): Promise<{ messages: AgentMessage[]; failures: string[] }> {
	const messages: AgentMessage[] = []
	const failures: string[] = []

	for (const turn of history) {
		if ("prompt" in turn) {
			const references = await readReferences(turn.references ?? [], openTextDocument)
			messages.push({
				type: "message",
				role: "user",
				content: promptWithReferences(turn.prompt, references.texts),
			})
			failures.push(...references.failures)
			continue
		}

		const text = responseText(turn)
		if (text) messages.push({ type: "message", role: "assistant", content: text })
	}

	return { messages, failures }
}

/** 内部会話形式から、VS Codeのモデルへ渡すuser/assistantメッセージを作る。 */
function toModelMessages(messages: readonly AgentMessage[]): vscode.LanguageModelChatMessage[] {
	return messages.flatMap((message) => {
		if (message.type !== "message" || typeof message.content !== "string") return []
		return [
			message.role === "assistant"
				? vscode.LanguageModelChatMessage.Assistant(message.content)
				: vscode.LanguageModelChatMessage.User(message.content),
		]
	})
}

async function defaultModel(): Promise<vscode.LanguageModelChat | undefined> {
	const [model] = await vscode.lm.selectChatModels({ vendor: "copilot" })
	return model
}

type ToolCall = { callId: string; name: string; input: object }

/** 提示時と実行時で同じ一覧を使うため、権限による絞り込みを1か所に置く。 */
export function fileToolsForMode(
	tools: readonly vscode.LanguageModelChatTool[],
	mode: FileToolMode,
): readonly vscode.LanguageModelChatTool[] {
	if (mode === "off") return []
	return tools.filter((tool) => {
		const access = fileToolAccess(tool.name)
		return access === "read" || (access === "write" && mode === "confirmEdit")
	})
}

function toolTarget(call: ToolCall): string {
	const value = (call.input as Record<string, unknown>).path ?? (call.input as Record<string, unknown>).pattern
	return typeof value === "string" && value.trim() ? `（${value}）` : ""
}

function toolOperation(call: ToolCall): string {
	if (call.name === "pii_guard_list_files") return "一覧"
	if (call.name === "pii_guard_search_files") return "検索"
	if (call.name === "pii_guard_read_file") return "読取"
	return call.name
}

/** 確認画面はローカルなので、モデルが使った伏せ字のパスを利用者にだけ戻して見せる。 */
function localConfirmationCall(call: ToolCall, masker: TaskPiiMasker): ToolCall {
	const input = { ...call.input } as Record<string, unknown>
	for (const key of ["path", "pattern"] as const) {
		if (typeof input[key] === "string") input[key] = masker.restoreExplicitly(input[key])
	}
	return { ...call, input }
}

async function confirmFileAccess(call: ToolCall): Promise<boolean> {
	const names = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.name).join("、")
	const workspace = names ? `作業場所「${names}」` : "開いている作業場所"
	const choice = await vscode.window.showWarningMessage(
		`この依頼で${workspace}のファイルを${toolOperation(call)}し、` +
			`ファイル名や内容を伏せてからCopilotへ送ります${toolTarget(call)}。` +
			"検出には漏れがあり得ます。",
		{ modal: true },
		"許可する",
	)
	return choice === "許可する"
}

function toolCallFrom(part: unknown): ToolCall | undefined {
	if (typeof part !== "object" || part === null) return undefined
	if (!("callId" in part) || !("name" in part) || !("input" in part)) return undefined
	if (typeof part.callId !== "string" || typeof part.name !== "string") return undefined
	if (typeof part.input !== "object" || part.input === null) return undefined
	return part as ToolCall
}

function textFromPart(part: unknown): string | undefined {
	if (typeof part !== "object" || part === null || !("value" in part)) return undefined
	return typeof part.value === "string" ? part.value : undefined
}

const MAX_TOOL_ROUNDS = 12
const MAX_TOOL_CALLS_PER_ROUND = 8
const MAX_TOOL_CALLS = 24
const MAX_WRITE_CALLS = 8

function toolLimitReason(toolCalls: readonly ToolCall[], total: number, writes: number): string | undefined {
	if (toolCalls.length > MAX_TOOL_CALLS_PER_ROUND) {
		return `1回の応答に含まれる道具が${MAX_TOOL_CALLS_PER_ROUND}件を超えました`
	}
	if (total + toolCalls.length > MAX_TOOL_CALLS) {
		return `1つの依頼で使える道具が${MAX_TOOL_CALLS}件を超えました`
	}
	const addedWrites = toolCalls.filter((call) => fileToolAccess(call.name) === "write").length
	if (writes + addedWrites > MAX_WRITE_CALLS) {
		return `1つの依頼で使える書込道具が${MAX_WRITE_CALLS}件を超えました`
	}
	return undefined
}

/**
 * `@mask` に話しかけられたときの処理。
 *
 * **伏せてから送る。** 伏せた結果を組み立てて送るので、生の文が出ていく経路が無い。
 * **戻してから出す。** 戻さないと、画面に `{{person-001}}` が並んで読めない。
 */
export function createHandler(deps: ParticipantDeps): vscode.ChatRequestHandler {
	const openTextDocument = deps.openTextDocument ?? vscode.workspace.openTextDocument
	const tools = deps.tools ?? FILE_TOOLS
	const executeTool =
		deps.runTool ??
		((name, input, masker, restoreWrites, token) =>
			runFileTool(name, input, masker, {
				restoreWrites,
				token,
				prepareFile: deps.prepareFileVault
					? (path) => deps.prepareFileVault!(path, masker)
					: undefined,
			}))

	return async (request, context, stream, token) => {
		const masker = deps.masker()
		const enabled = deps.isEnabled()
		const restoreWrites = deps.restoreFileWrites?.() === true
		const configuredFileToolMode = deps.fileToolMode?.() ?? "confirmEdit"
		const effectiveFileToolMode: FileToolMode = enabled ? configuredFileToolMode : "off"
		const availableTools = fileToolsForMode(tools, effectiveFileToolMode)
		const availableToolNames = new Set(availableTools.map((tool) => tool.name))
		let fileAccessDecision: "approved" | "denied" | undefined
		const history = await historyMessages(context.history ?? [], openTextDocument)
		const references = await readReferences(request.references ?? [], openTextDocument)
		const messages: AgentMessage[] = [
			...history.messages,
			{
				type: "message",
				role: "user",
				content: promptWithReferences(request.prompt, references.texts),
			},
		]
		const masked = await masker.maskForRequest("", messages)
		const current = masked.messages.at(-1)
		const currentText = current?.type === "message" && typeof current.content === "string" ? current.content : ""

		// **状態を必ず出す。** 切れているのか、伏せるものが無かったのかを、利用者が
		// 見分けられるようにする。
		stream.markdown(describeState(enabled, currentText))
		stream.markdown(describeFileToolMode(enabled, configuredFileToolMode))
		stream.markdown(describeWriteMode(enabled, restoreWrites, effectiveFileToolMode))
		if (references.texts.length > 0) {
			stream.markdown(`> 🛡 参照した本文 ${references.texts.length} 件も伏せて送ります。\n\n`)
		}
		if (references.failures.length > 0) {
			stream.markdown(`> ⚠️ 読み込めなかった参照は送信しませんでした: ${references.failures.join("、")}\n\n`)
		}
		if (history.failures.length > 0) {
			stream.markdown(`> ⚠️ 過去の参照を読み込めず、会話へ引き継げませんでした: ${history.failures.join("、")}\n\n`)
		}

		// **何を伏せたかを出す。** 出さないと、伏せたのか素通りしたのかが分からない。
		// 伏せているつもりで送るのが、いちばん気づけない失敗である。
		for (const trouble of masked.troubles) {
			stream.markdown(`> ⚠️ ${t("common:pii.maskingTrouble", { detail: trouble })}\n\n`)
		}

		const model = deps.selectModel ? await deps.selectModel() : request.model ?? (await defaultModel())
		if (!model) {
			// **理由を名指しで出す。** 「使えません」だけだと、入っていないのか、
			// サインインしていないのかが分からない。
			stream.markdown(
				"Copilot のモデルを使えません。**GitHub Copilot Chat** を入れて、" +
					"サインインしているか確かめてください。\n\n" +
					"右クリックの「このファイルの個人情報を伏せる」は、Copilot が無くても使えます。",
			)
			return
		}

		const modelMessages = toModelMessages(masked.messages)
		// **区切りをまたいで戻す。** 断片ごとに戻すと、割れて届いた伏せ字が戻らない。
		const restorer = createStreamRestorer((text) => masker.unmask(text))
		const modelResponse: string[] = []
		let totalToolCalls = 0
		let writeCalls = 0

		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			if (token.isCancellationRequested) {
				stream.markdown(restorer.flush())
				stream.markdown("\n\n> ⚠️ 利用者が処理を中断しました。")
				return { metadata: { [MODEL_RESPONSE_METADATA]: modelResponse.join("") } }
			}
			const response = await model.sendRequest(modelMessages, { tools: [...availableTools] }, token)
			const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = []
			const toolCalls: ToolCall[] = []

			for await (const part of response.stream) {
				const text = textFromPart(part)
				if (text !== undefined) {
					assistantParts.push(new vscode.LanguageModelTextPart(text))
					modelResponse.push(text)
					stream.markdown(restorer.push(text))
					continue
				}

				const call = toolCallFrom(part)
				if (call) {
					assistantParts.push(part as vscode.LanguageModelToolCallPart)
					toolCalls.push(call)
				}
			}

			if (token.isCancellationRequested) {
				stream.markdown(restorer.flush())
				stream.markdown("\n\n> ⚠️ 利用者が処理を中断しました。")
				return { metadata: { [MODEL_RESPONSE_METADATA]: modelResponse.join("") } }
			}

			if (toolCalls.length === 0) {
				stream.markdown(restorer.flush())
				return { metadata: { [MODEL_RESPONSE_METADATA]: modelResponse.join("") } }
			}

			const limitReason = toolLimitReason(toolCalls, totalToolCalls, writeCalls)
			if (limitReason) {
				stream.markdown(restorer.flush())
				stream.markdown(`\n\n> ⚠️ ${limitReason}。何も実行せず停止しました。`)
				return { metadata: { [MODEL_RESPONSE_METADATA]: modelResponse.join("") } }
			}
			totalToolCalls += toolCalls.length
			writeCalls += toolCalls.filter((call) => fileToolAccess(call.name) === "write").length

			modelMessages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts))
			const toolResults: vscode.LanguageModelToolResultPart[] = []
			for (const call of toolCalls) {
				let raw: string
				if (token.isCancellationRequested) {
					raw = "利用者が処理を中断しました。"
				} else if (!availableToolNames.has(call.name)) {
					raw = `現在のファイル道具モード（${effectiveFileToolMode}）では実行できません: ${call.name}`
				} else {
					if (fileToolAccess(call.name) === "read" && fileAccessDecision === undefined) {
						const approved = await (deps.confirmFileAccess ?? confirmFileAccess)(
							localConfirmationCall(call, masker),
						)
						fileAccessDecision = approved ? "approved" : "denied"
					}

					if (token.isCancellationRequested) {
						raw = "利用者が処理を中断しました。"
					} else if (fileToolAccess(call.name) === "read" && fileAccessDecision === "denied") {
						raw = "利用者がこの依頼でのファイル参照を許可しませんでした。"
					} else {
						stream.progress(`道具を実行しています: ${call.name}`)
						try {
							raw = await executeTool(call.name, call.input, masker, restoreWrites, token)
						} catch (error) {
							raw = `道具を実行できませんでした: ${error instanceof Error ? error.message : String(error)}`
						}
					}
				}

				// 道具本体が失敗した場合も、例外文にはファイル名や検索語が入り得る。
				// 成否にかかわらず、この境界でもう一度伏せる。
				const result = (await masker.maskPrompt(raw)).text
				toolResults.push(
					new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(result)]),
				)
			}
			modelMessages.push(vscode.LanguageModelChatMessage.User(toolResults))
		}

		stream.markdown(restorer.flush())
		stream.markdown("\n\n> ⚠️ 道具の実行回数が上限に達したため停止しました。")
		return { metadata: { [MODEL_RESPONSE_METADATA]: modelResponse.join("") } }
	}
}
