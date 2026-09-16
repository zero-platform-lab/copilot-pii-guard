import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import * as vscode from "vscode"

const FORMAT_VERSION = 1
const KEY_NAME = "piiGuard.fileVault.masterKey.v1"
const AAD = Buffer.from("copilot-pii-guard:file-vault:v1", "utf8")
const FILE_NAME = "file-vault.v1.json"

export type FileVaultEntry = readonly [placeholder: string, value: string]

type StoredFile = {
	identity: string
	enabledAt: string
	lastUsedAt: string
	entries: FileVaultEntry[]
}

type Catalog = {
	formatVersion: 1
	files: Record<string, StoredFile>
}

type Envelope = {
	formatVersion: 1
	algorithm: "aes-256-gcm"
	nonce: string
	ciphertext: string
	tag: string
}

export type FileVaultRecord = Readonly<StoredFile>

export class FileVaultError extends Error {
	constructor(public readonly code: "missingKey" | "corrupt" | "unsupported", cause?: unknown) {
		super(code, { cause })
		this.name = "FileVaultError"
	}
}

function emptyCatalog(): Catalog {
	return { formatVersion: FORMAT_VERSION, files: {} }
}

function decodeKey(encoded: string): Buffer {
	const key = Buffer.from(encoded, "base64")
	if (key.length !== 32) throw new FileVaultError("missingKey")
	return key
}

function encrypt(catalog: Catalog, key: Buffer): Uint8Array {
	const nonce = randomBytes(12)
	const cipher = createCipheriv("aes-256-gcm", key, nonce)
	cipher.setAAD(AAD)
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(catalog), "utf8"), cipher.final()])
	const envelope: Envelope = {
		formatVersion: FORMAT_VERSION,
		algorithm: "aes-256-gcm",
		nonce: nonce.toString("base64"),
		ciphertext: ciphertext.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
	}
	return Buffer.from(JSON.stringify(envelope), "utf8")
}

function validCatalog(value: unknown): value is Catalog {
	if (!value || typeof value !== "object") return false
	const candidate = value as Partial<Catalog>
	if (candidate.formatVersion !== FORMAT_VERSION || !candidate.files || typeof candidate.files !== "object") {
		return false
	}
	return Object.entries(candidate.files).every(([identity, record]) => {
		if (!record || typeof record !== "object" || record.identity !== identity) return false
		if (typeof record.enabledAt !== "string" || typeof record.lastUsedAt !== "string") return false
		if (!Number.isFinite(Date.parse(record.enabledAt)) || !Number.isFinite(Date.parse(record.lastUsedAt))) return false
		return (
			Array.isArray(record.entries) &&
			record.entries.every(
				(entry) =>
					Array.isArray(entry) &&
					entry.length === 2 &&
					typeof entry[0] === "string" &&
					/^\{\{[a-z]+-\d{3,}\}\}$/.test(entry[0]) &&
					typeof entry[1] === "string",
			)
		)
	})
}

function decrypt(raw: Uint8Array, key: Buffer): Catalog {
	try {
		const envelope = JSON.parse(Buffer.from(raw).toString("utf8")) as Partial<Envelope>
		if (envelope.formatVersion !== FORMAT_VERSION || envelope.algorithm !== "aes-256-gcm") {
			throw new FileVaultError("unsupported")
		}
		if (!envelope.nonce || !envelope.ciphertext || !envelope.tag) throw new Error("incomplete envelope")

		const nonce = Buffer.from(envelope.nonce, "base64")
		const tag = Buffer.from(envelope.tag, "base64")
		if (nonce.length !== 12 || tag.length !== 16) throw new Error("invalid envelope")
		const decipher = createDecipheriv("aes-256-gcm", key, nonce)
		decipher.setAAD(AAD)
		decipher.setAuthTag(tag)
		const plain = Buffer.concat([
			decipher.update(Buffer.from(envelope.ciphertext, "base64")),
			decipher.final(),
		])
		const catalog: unknown = JSON.parse(plain.toString("utf8"))
		if (
			catalog &&
			typeof catalog === "object" &&
			"formatVersion" in catalog &&
			catalog.formatVersion !== FORMAT_VERSION
		) {
			throw new FileVaultError("unsupported")
		}
		if (!validCatalog(catalog)) throw new Error("invalid catalog")
		return catalog
	} catch (error) {
		if (error instanceof FileVaultError) throw error
		throw new FileVaultError("corrupt", error)
	}
}

function isNotFound(error: unknown): boolean {
	return error instanceof Error && /FileNotFound|EntryNotFound/i.test(error.name)
}

/** ワークスペース固有領域の暗号化カタログ。全操作を直列化して更新の取りこぼしを防ぐ。 */
export class FileVaultStore {
	private tail: Promise<void> = Promise.resolve()
	private readonly target: vscode.Uri

	constructor(
		private readonly root: vscode.Uri,
		private readonly secrets: Pick<vscode.SecretStorage, "get" | "store">,
		private readonly fs: Pick<
			typeof vscode.workspace.fs,
			"readFile" | "writeFile" | "createDirectory" | "rename" | "delete"
		> = vscode.workspace.fs,
		private readonly now: () => Date = () => new Date(),
	) {
		this.target = vscode.Uri.joinPath(root, FILE_NAME)
	}

	private exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation, operation)
		this.tail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	private async read(): Promise<{ catalog: Catalog; exists: boolean }> {
		let raw: Uint8Array
		try {
			raw = await this.fs.readFile(this.target)
		} catch (error) {
			if (isNotFound(error)) return { catalog: emptyCatalog(), exists: false }
			throw error
		}

		const encoded = await this.secrets.get(KEY_NAME)
		if (!encoded) throw new FileVaultError("missingKey")
		return { catalog: decrypt(raw, decodeKey(encoded)), exists: true }
	}

	private async write(catalog: Catalog, existed: boolean): Promise<void> {
		let encoded = await this.secrets.get(KEY_NAME)
		if (!encoded) {
			if (existed) throw new FileVaultError("missingKey")
			encoded = randomBytes(32).toString("base64")
			await this.secrets.store(KEY_NAME, encoded)
		}

		await this.fs.createDirectory(this.root)
		const temporary = vscode.Uri.joinPath(this.root, `${FILE_NAME}.${randomBytes(8).toString("hex")}.tmp`)
		await this.fs.writeFile(temporary, encrypt(catalog, decodeKey(encoded)))
		try {
			await this.fs.rename(temporary, this.target, { overwrite: true })
		} catch (error) {
			try {
				await this.fs.delete(temporary)
			} catch {
				// 元の暗号文を守ることを優先する。一時ファイルの掃除失敗で理由を置き換えない。
			}
			throw error
		}
	}

	inspect(identity: string): Promise<FileVaultRecord | undefined> {
		return this.exclusive(async () => (await this.read()).catalog.files[identity])
	}

	load(identity: string): Promise<FileVaultRecord | undefined> {
		return this.exclusive(async () => {
			const { catalog, exists } = await this.read()
			const record = catalog.files[identity]
			if (!record) return undefined
			record.lastUsedAt = this.now().toISOString()
			await this.write(catalog, exists)
			return record
		})
	}

	enable(identity: string, entries: readonly FileVaultEntry[] = []): Promise<FileVaultRecord> {
		return this.exclusive(async () => {
			const { catalog, exists } = await this.read()
			const timestamp = this.now().toISOString()
			const previous = catalog.files[identity]
			const merged = new Map(previous?.entries ?? [])
			for (const [placeholder, value] of entries) merged.set(placeholder, value)
			const record: StoredFile = {
				identity,
				enabledAt: previous?.enabledAt ?? timestamp,
				lastUsedAt: timestamp,
				entries: [...merged],
			}
			catalog.files[identity] = record
			await this.write(catalog, exists)
			return record
		})
	}

	appendIfEnabled(identity: string, entries: readonly FileVaultEntry[]): Promise<boolean> {
		return this.exclusive(async () => {
			const { catalog, exists } = await this.read()
			const record = catalog.files[identity]
			if (!record) return false
			const merged = new Map(record.entries)
			for (const [placeholder, value] of entries) merged.set(placeholder, value)
			record.entries = [...merged]
			record.lastUsedAt = this.now().toISOString()
			await this.write(catalog, exists)
			return true
		})
	}

	delete(identity: string): Promise<number> {
		return this.exclusive(async () => {
			const { catalog, exists } = await this.read()
			const count = catalog.files[identity]?.entries.length
			if (count === undefined) return 0
			delete catalog.files[identity]
			await this.write(catalog, exists)
			return count
		})
	}
}
