// 置き場所。本体の `agent-config` を置き換える。
//
// **本体と同じ `~/.agent` を見る。** 別の場所にすると、両方を入れている利用者が辞書を
// 2 つ持つことになる。片方へ足した語が、もう片方では効かない。

import * as os from "os"
import * as path from "path"

/** 設定と辞書を置く場所。 */
export function getGlobalAgentDirectory(): string {
	return path.join(os.homedir(), ".agent")
}
