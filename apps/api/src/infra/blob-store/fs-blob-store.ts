// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Filesystem blob driver (default, plan 06 §6): content lives at
 * `<root>/<sa>/<pouch>/<ab>/<cd>/<blob_id-hex>`. Writes go to `<root>/.tmp`,
 * are fsynced, then renamed into place (atomic), then the directory is fsynced.
 */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertValidKey, type BlobKey, type BlobStore } from './blob-store';

export class FsBlobStore implements BlobStore {
	constructor(private readonly root: string) {}

	private pathOf(key: BlobKey): string {
		assertValidKey(key);
		const hex = key.blobIdHex;
		return join(
			this.root,
			key.storageAccountId,
			key.pouchId,
			hex.slice(0, 2),
			hex.slice(2, 4),
			hex,
		);
	}

	async put(key: BlobKey, body: Uint8Array): Promise<void> {
		const target = this.pathOf(key);
		if (await this.exists(target)) return;
		const tmpDir = join(this.root, '.tmp');
		await mkdir(tmpDir, { recursive: true });
		await mkdir(dirname(target), { recursive: true });
		const tmp = join(tmpDir, randomUUID());
		const handle = await open(tmp, 'wx', 0o600);
		try {
			await handle.writeFile(body);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(tmp, target);
		await fsyncDir(dirname(target));
	}

	async get(key: BlobKey): Promise<Buffer | null> {
		try {
			return await readFile(this.pathOf(key));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw error;
		}
	}

	has(key: BlobKey): Promise<boolean> {
		return this.exists(this.pathOf(key));
	}

	async delete(key: BlobKey): Promise<void> {
		await unlink(this.pathOf(key)).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== 'ENOENT') throw error;
		});
	}

	async deletePouch(storageAccountId: string, pouchId: string): Promise<void> {
		assertValidKey({ storageAccountId, pouchId, blobIdHex: '0'.repeat(64) });
		await rm(join(this.root, storageAccountId, pouchId), { recursive: true, force: true });
	}

	private async exists(path: string): Promise<boolean> {
		try {
			await access(path, constants.F_OK);
			return true;
		} catch {
			return false;
		}
	}
}

async function fsyncDir(path: string): Promise<void> {
	const handle = await open(path, 'r');
	try {
		await handle.sync();
	} catch {
		// Some filesystems (e.g. on Windows) cannot fsync directories; rename is still atomic.
	} finally {
		await handle.close();
	}
}
