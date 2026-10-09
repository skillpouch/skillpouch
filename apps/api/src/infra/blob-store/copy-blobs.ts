// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Copies every blob of a filesystem store into another store (moving to
 * R2 or S3). Safe to run again: blobs the target already has are skipped,
 * and the source is never changed.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapLimited } from '../../lib/map-limited';
import type { BlobKey, BlobStore } from './blob-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BATCH = 256;
const CONCURRENCY = 16;

export interface CopyReport {
	copied: number;
	skipped: number;
}

export async function copyBlobs(
	fsRoot: string,
	target: BlobStore,
	progress: (report: CopyReport) => void = () => {},
): Promise<CopyReport> {
	const report: CopyReport = { copied: 0, skipped: 0 };
	let batch: { key: BlobKey; path: string }[] = [];
	const flush = async () => {
		await mapLimited(batch, CONCURRENCY, async ({ key, path }) => {
			if (await target.has(key)) {
				report.skipped += 1;
				return;
			}
			await target.put(key, await readFile(path));
			report.copied += 1;
		});
		batch = [];
		progress({ ...report });
	};
	for await (const blob of fsBlobs(fsRoot)) {
		batch.push(blob);
		if (batch.length >= BATCH) await flush();
	}
	if (batch.length > 0) await flush();
	return report;
}

/** `<root>/<sa>/<pouch>/<ab>/<cd>/<blob_id-hex>`; anything else (like `.tmp`) is ignored. */
async function* fsBlobs(root: string): AsyncGenerator<{ key: BlobKey; path: string }> {
	for (const storageAccountId of await folders(root, UUID)) {
		const accountDir = join(root, storageAccountId);
		for (const pouchId of await folders(accountDir, UUID)) {
			const pouchDir = join(accountDir, pouchId);
			for (const ab of await folders(pouchDir, /^[0-9a-f]{2}$/)) {
				for (const cd of await folders(join(pouchDir, ab), /^[0-9a-f]{2}$/)) {
					const dir = join(pouchDir, ab, cd);
					for (const entry of await readdir(dir, { withFileTypes: true })) {
						if (!entry.isFile() || !HEX64.test(entry.name)) continue;
						if (!entry.name.startsWith(ab + cd)) continue;
						yield {
							key: { storageAccountId, pouchId, blobIdHex: entry.name },
							path: join(dir, entry.name),
						};
					}
				}
			}
		}
	}
}

async function folders(dir: string, name: RegExp): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		},
	);
	return entries
		.filter((entry) => entry.isDirectory() && name.test(entry.name))
		.map((entry) => entry.name)
		.sort();
}
