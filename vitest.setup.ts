// 試験を実行する前の共通の支度。
//
// **網を既定で塞ぐ。** 塞がないと、取得の試験が本当に GitHub へ 282 MB を取りに行く。
// 必要な試験だけが `allowNetConnect` で開ける。

import nock from "nock"

nock.disableNetConnect()

export function allowNetConnect(host?: string | RegExp): void {
	if (host) {
		nock.enableNetConnect(host)
	} else {
		nock.enableNetConnect()
	}
}
