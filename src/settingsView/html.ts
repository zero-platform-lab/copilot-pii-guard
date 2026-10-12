// 設定の画面（webview）の HTML。
//
// **外から何も読まない。** スタイルもスクリプトもこの中に置き、CSP で縛る。スクリプトは nonce の
// 付いたものだけが動く。設定の値（辞書のパスや語）を画面へ出すので、HTML として解釈させない
// （`textContent` と `value` だけで入れる）。
//
// **値を確かめるのは拡張の側。** 画面は入力欄を作って値を送るだけで、誤りは拡張から返った文を出す。

import type { Field } from "./fields"

/** 画面の下の、関連する操作。拡張は、この一覧にあるコマンドだけを実行する。 */
export const ACTIONS: readonly { command: string; title: string }[] = [
	{ command: "piiGuard.modelStatus", title: "モデルの置き場所を確かめる" },
	{ command: "piiGuard.fetchModel", title: "モデルを取得する" },
	{ command: "piiGuard.exportDictionary", title: "辞書を書き出す" },
	{ command: "piiGuard.exportConvertedDictionary", title: "変換した値を辞書として書き出す" },
	{ command: "piiGuard.clearSessionMapping", title: "セッション対応表を消去する" },
]

export type ViewModel = {
	sections: { id: string; title: string; fields: Field[] }[]
	actions: readonly { command: string; title: string }[]
}

export function settingsHtml(options: { nonce: string; cspSource: string; model: ViewModel }): string {
	const { nonce, cspSource, model } = options
	// `</script>` を含む値で、スクリプトの外へ出られないようにする。
	const data = JSON.stringify(model).replace(/</g, "\\u003c")

	return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PII Guard の設定</title>
<style nonce="${nonce}">
	body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 20px 80px; max-width: 860px; }
	h1 { font-size: 1.4em; margin: 16px 0 4px; }
	nav { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 12px; flex-wrap: wrap; z-index: 1; }
	nav a { color: var(--vscode-textLink-foreground); text-decoration: none; }
	section { margin-top: 24px; }
	h2 { font-size: 1.15em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
	.field { margin: 14px 0; }
	.label { font-weight: 600; display: block; margin-bottom: 2px; }
	.key { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: 6px; font-weight: normal; }
	.description { color: var(--vscode-descriptionForeground); margin: 2px 0 6px; white-space: pre-wrap; }
	.note { color: var(--vscode-editorWarning-foreground); margin: 4px 0; }
	.error { color: var(--vscode-errorForeground); margin: 4px 0; }
	.dirty .label::after { content: " ●"; color: var(--vscode-textLink-foreground); }
	input[type=text], input[type=number], select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; }
	input[type=text] { width: 100%; box-sizing: border-box; }
	.checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 4px 16px; }
	.row { display: flex; gap: 6px; margin: 4px 0; align-items: center; }
	.row input[type=text] { flex: 1; }
	button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; cursor: pointer; }
	button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
	button:disabled { opacity: 0.5; cursor: default; }
	footer { position: fixed; bottom: 0; left: 0; right: 0; background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-panel-border); padding: 8px 20px; display: flex; gap: 8px; align-items: center; }
	#status { margin-left: 8px; }
	.actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
</head>
<body>
<h1>PII Guard の設定</h1>
<p class="description">VS Code の設定（piiGuard.*）と同じものを編集します。「保存」を押すまで書き込みません。</p>
<nav id="nav"></nav>
<main id="main"></main>
<section>
	<h2>操作</h2>
	<div class="actions" id="actions"></div>
</section>
<footer>
	<button id="save" disabled>保存</button>
	<button id="revert" class="secondary" disabled>変更を取り消す</button>
	<span id="status"></span>
</footer>
<script nonce="${nonce}">
(() => {
	const vscode = acquireVsCodeApi()
	const model = ${data}
	const fields = new Map()
	let saved = {}
	let current = {}
	let overridden = {}

	const el = (tag, props = {}, ...children) => {
		const node = document.createElement(tag)
		for (const [name, value] of Object.entries(props)) {
			if (name === "text") node.textContent = value
			else if (name === "className") node.className = value
			else node.setAttribute(name, value)
		}
		for (const child of children) node.append(child)
		return node
	}
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
	const changedKeys = () => [...fields.keys()].filter((key) => !same(current[key], saved[key]))

	function refreshState() {
		const changed = changedKeys()
		for (const key of fields.keys()) {
			document.getElementById("field-" + key).classList.toggle("dirty", changed.includes(key))
		}
		document.getElementById("save").disabled = changed.length === 0
		document.getElementById("revert").disabled = changed.length === 0
	}

	function setValue(key, value) {
		current[key] = value
		document.getElementById("error-" + key).textContent = ""
		document.getElementById("status").textContent = ""
		refreshState()
	}

	function control(field) {
		const value = current[field.key]
		switch (field.kind) {
			case "boolean": {
				const box = el("input", { type: "checkbox", id: "input-" + field.key })
				box.checked = value === true
				box.addEventListener("change", () => setValue(field.key, box.checked))
				return el("label", {}, box, " 有効にする")
			}
			case "enum": {
				const select = el("select", { id: "input-" + field.key })
				for (const option of field.options) {
					const item = el("option", { value: option.value, text: option.value + (option.description ? "：" + option.description : "") })
					item.selected = option.value === value
					select.append(item)
				}
				select.addEventListener("change", () => setValue(field.key, select.value))
				return select
			}
			case "integer":
			case "number": {
				const input = el("input", { type: "number", id: "input-" + field.key, step: field.kind === "integer" ? "1" : "any" })
				if (field.min !== undefined && field.min !== null) input.min = String(field.min)
				if (field.max !== undefined && field.max !== null) input.max = String(field.max)
				input.value = String(value)
				// 空や数でない入力も、そのまま拡張へ送って理由を返してもらう。
				input.addEventListener("input", () => setValue(field.key, input.value === "" ? null : Number(input.value)))
				return input
			}
			case "string": {
				const input = el("input", { type: "text", id: "input-" + field.key })
				input.value = value
				input.addEventListener("input", () => setValue(field.key, input.value))
				return input
			}
			case "checks": {
				const box = el("div", { className: "checks" })
				for (const option of field.options) {
					const check = el("input", { type: "checkbox" })
					check.checked = value[option.value] === true
					check.addEventListener("change", () => setValue(field.key, { ...current[field.key], [option.value]: check.checked }))
					box.append(el("label", { title: option.description }, check, " " + option.value + "：" + option.description))
				}
				return box
			}
			case "strings":
				return listControl(field, () => "", (item, update) => {
					const input = el("input", { type: "text" })
					input.value = item
					input.addEventListener("input", () => update(() => input.value))
					return [input]
				})
			case "terms":
				return listControl(field, () => ({ value: "" }), (item, update) => {
					const input = el("input", { type: "text", placeholder: "語" })
					input.value = item.value ?? ""
					input.addEventListener("input", () => update((now) => ({ ...now, value: input.value })))
					const kind = el("select")
					for (const name of ["", ...field.termKinds]) {
						const option = el("option", { value: name, text: name === "" ? "（種類なし）" : name })
						option.selected = (item.kind ?? "") === name
						kind.append(option)
					}
					kind.addEventListener("change", () => update((now) => ({ ...now, kind: kind.value || undefined })))
					const regex = el("input", { type: "checkbox" })
					regex.checked = item.regex === true
					regex.addEventListener("change", () => update((now) => ({ ...now, regex: regex.checked || undefined })))
					return [input, kind, el("label", {}, regex, " 正規表現")]
				})
		}
		return el("span", { text: "（この型は表示できません）" })
	}

	/**
	 * 行を足し引きできる一覧。行を足し引きしたら一覧ごと作り直す。
	 *
	 * **行の変更は、いまの値に当てる。** 行を作ったときの値に当てると、同じ行の 2 つ目の変更
	 * （語を書いてから種類を選ぶ）が、1 つ目の変更を消す。
	 */
	function listControl(field, blank, row) {
		const box = el("div", {})
		const render = () => {
			box.replaceChildren()
			const items = current[field.key]
			items.forEach((item, index) => {
				const update = (change) => {
					const copy = [...current[field.key]]
					copy[index] = change(copy[index])
					setValue(field.key, copy)
				}
				const remove = el("button", { className: "secondary", text: "削除" })
				remove.addEventListener("click", () => {
					setValue(field.key, current[field.key].filter((_, i) => i !== index))
					render()
				})
				box.append(el("div", { className: "row" }, ...row(item, update), remove))
			})
			const add = el("button", { className: "secondary", text: "行を足す" })
			add.addEventListener("click", () => {
				setValue(field.key, [...current[field.key], blank()])
				render()
			})
			box.append(add)
		}
		render()
		return box
	}

	function render() {
		const main = document.getElementById("main")
		const nav = document.getElementById("nav")
		main.replaceChildren()
		nav.replaceChildren()
		fields.clear()
		for (const section of model.sections) {
			nav.append(el("a", { href: "#section-" + section.id, text: section.title }))
			const box = el("section", { id: "section-" + section.id }, el("h2", { text: section.title }))
			for (const field of section.fields) {
				fields.set(field.key, field)
				const note = el("div", { className: "note", id: "note-" + field.key })
				if (overridden[field.key]) note.textContent = "ワークスペースの設定で上書きされています。ここでの変更は、このワークスペースでは効きません。"
				box.append(
					el(
						"div",
						{ className: "field", id: "field-" + field.key },
						el("span", { className: "label" }, field.label, el("span", { className: "key", text: field.key })),
						el("div", { className: "description", text: field.description.replace(/\\*\\*/g, "").replace(/\`/g, "") }),
						control(field),
						note,
						el("div", { className: "error", id: "error-" + field.key }),
					),
				)
			}
			main.append(box)
		}
		refreshState()
	}

	const actions = document.getElementById("actions")
	for (const action of model.actions) {
		const button = el("button", { className: "secondary", text: action.title })
		button.addEventListener("click", () => vscode.postMessage({ type: "command", command: action.command }))
		actions.append(button)
	}

	document.getElementById("save").addEventListener("click", () => {
		const values = {}
		for (const key of changedKeys()) values[key] = current[key]
		document.getElementById("status").textContent = "保存しています…"
		vscode.postMessage({ type: "save", values })
	})
	document.getElementById("revert").addEventListener("click", () => {
		current = structuredClone(saved)
		render()
	})

	window.addEventListener("message", (event) => {
		const message = event.data
		if (message.type === "state") {
			// 保存していない変更は残す。外で変わった項目だけを取り込む。
			const changed = changedKeys()
			saved = message.values
			overridden = message.overridden
			const next = structuredClone(saved)
			for (const key of changed) next[key] = current[key]
			current = next
			render()
		} else if (message.type === "saved") {
			document.getElementById("status").textContent = "保存しました。"
		} else if (message.type === "errors") {
			for (const [key, error] of Object.entries(message.errors)) {
				const target = document.getElementById("error-" + key)
				if (target) target.textContent = error
			}
			document.getElementById("status").textContent = "保存していません。誤りを直してください。"
		}
	})

	vscode.postMessage({ type: "ready" })
})()
</script>
</body>
</html>`
}
