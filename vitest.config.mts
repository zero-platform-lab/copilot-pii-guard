import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["./vitest.setup.ts"],
		// `vscode` は拡張ホストの中にしか無い。試験では偽物を当てる。
		alias: { vscode: new URL("./src/__mocks__/vscode.ts", import.meta.url).pathname },
	},
})
