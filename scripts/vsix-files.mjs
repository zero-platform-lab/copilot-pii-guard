// VSIX に入れてよいファイルの一覧と、その確かめ方。
//
// **入れてよいものを決めて、それ以外を止める。** `.vscodeignore` は「入れないもの」を並べる形
// なので、新しく生まれたディレクトリ（網羅率の報告 `coverage/` など）は黙って入る。実際に
// v0.2.9 の VSIX には、ソースを含む網羅率の報告が入っていた。入れてよいものの一覧で確かめれば、
// 一覧に無いものが混ざった時点で作るのを止められる。

/** そのままの名前で入れてよいファイル。 */
const FILES = new Set(["package.json", "README.md", "LICENSE", "NOTICE"])

/** この下なら入れてよいディレクトリ。 */
const DIRECTORIES = ["dist/", "docs/"]

/** `vsce ls` の出力（1 行 1 ファイル）から、入れてはいけないファイルを返す。 */
export function unexpectedFiles(listing) {
	return listing
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.filter((file) => !FILES.has(file) && !DIRECTORIES.some((directory) => file.startsWith(directory)))
}
