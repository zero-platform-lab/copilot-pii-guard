// モデルを取りに行くときの proxy。本体の `proxyDispatcher` を置き換える。
//
// **企業 proxy を尊重する。** 経由しないと、proxy の内側からは 282 MB が取れない。
// 本体は独自の設定を持つが、この拡張は VS Code の `http.proxy` だけを見る。1 つの拡張の
// ためにもう 1 つ proxy の設定を覚えさせない。

import * as vscode from "vscode"
import { ProxyAgent } from "undici"

/** VS Code の設定と環境変数から proxy を決める。無ければ `undefined`。 */
export function getProxyDispatcher(): ProxyAgent | undefined {
	const configured = vscode.workspace.getConfiguration("http").get<string>("proxy")
	const url = configured?.trim() || process.env.https_proxy || process.env.HTTPS_PROXY

	return url ? new ProxyAgent(url) : undefined
}

/** proxy を経由して取る。`dispatcher` が無ければそのまま取る。 */
export async function fetchThrough(
	dispatcher: ProxyAgent | undefined,
	url: string,
	init: RequestInit = {},
): Promise<Response> {
	// **`unknown` を挟む。** `dispatcher` は undici の欄で、`RequestInit` の型には無い。
	// Node の同梱する `undici-types` と、依存に入れた `undici` の型が別物として扱われる。
	return fetch(url, dispatcher ? ({ ...init, dispatcher } as unknown as RequestInit) : init)
}
