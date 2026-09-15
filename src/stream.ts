// 逐次で届く応答の伏せ字を、元の値へ戻す。
//
// **区切りをまたぐ。** モデルの応答は細切れで届く。`{{person-001}}` が `{{person-` と
// `001}}` に割れて届くことがあり、断片ごとに戻すと**どちらも戻らない。** 画面には
// `{{person-001}}` がそのまま出る。
//
// だから、伏せ字になりかけの末尾は握っておき、閉じてから戻す。

/** 伏せ字 1 つの長さの上限。`{{organization-001}}` でも 21 文字である。 */
const LONGEST = 64

/**
 * 握っておく境目を決める。
 *
 * 閉じていない `{{` があればその手前まで。末尾が `{` なら、次の断片で `{{` になり得る
 * のでその手前まで。
 */
function safeCut(buffer: string): number {
	const open = buffer.lastIndexOf("{{")
	if (open >= 0 && buffer.indexOf("}}", open) < 0) {
		// **いつまでも握らない。** 閉じない `{{` を書かれると、応答が 1 文字も出なくなる。
		return buffer.length - open > LONGEST ? buffer.length : open
	}

	return buffer.endsWith("{") ? buffer.length - 1 : buffer.length
}

export type StreamRestorer = {
	/** 届いた断片を渡し、いま出してよい文を受け取る。 */
	push(fragment: string): string
	/** 終わったときに、握っていたぶんを出す。 */
	flush(): string
}

/** 断片をまたいで戻す仕掛けを作る。 */
export function createStreamRestorer(restore: (text: string) => string): StreamRestorer {
	let held = ""

	return {
		push(fragment) {
			const buffer = held + fragment
			const cut = safeCut(buffer)
			held = buffer.slice(cut)
			return restore(buffer.slice(0, cut))
		},
		flush() {
			const out = restore(held)
			held = ""
			return out
		},
	}
}
