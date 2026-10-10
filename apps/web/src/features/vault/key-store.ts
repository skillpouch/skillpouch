// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where this browser keeps its member key: IndexedDB, one record per signed-in
 * user. The private keys are non-extractable `CryptoKey`s — script can use
 * them to sign and decrypt, but nothing (not even this app) can read them out.
 *
 * Alongside the keys we pin what this browser has already verified: the
 * account's genesis hash and the highest roster head seen (seq and hash), so
 * a server that later serves a different history or rolls it back is detected.
 */
import type { MemberKeyPair } from '@skillpouch/crypto';

export interface StoredBrowserKey {
	userId: string;
	keys: MemberKeyPair;
	/** Roster member id once this browser is enrolled. */
	memberId: string | null;
	/** Untrusted browsers are removed from the account when you sign out. */
	trusted: boolean;
	pinnedGenesisHash: string | null;
	pinnedHeadSeq: number;
	/** Hash of the statement at `pinnedHeadSeq` (absent on records saved before it was kept). */
	pinnedHeadHash?: string | null;
	createdAt: string;
}

const DB_NAME = 'skillpouch';
const STORE = 'browser-keys';

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE, { keyPath: 'userId' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function withStore<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	const db = await openDatabase();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(STORE, mode);
			const request = run(tx.objectStore(STORE));
			tx.oncomplete = () => resolve(request.result);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

export async function loadBrowserKey(userId: string): Promise<StoredBrowserKey | null> {
	const record = await withStore<StoredBrowserKey | undefined>('readonly', (store) =>
		store.get(userId),
	);
	return record ?? null;
}

export async function saveBrowserKey(record: StoredBrowserKey): Promise<void> {
	await withStore('readwrite', (store) => store.put(record));
}

export async function updateBrowserKey(
	userId: string,
	patch: Partial<Omit<StoredBrowserKey, 'userId' | 'keys'>>,
): Promise<StoredBrowserKey | null> {
	const current = await loadBrowserKey(userId);
	if (!current) return null;
	const next = { ...current, ...patch };
	await saveBrowserKey(next);
	return next;
}

export async function deleteBrowserKey(userId: string): Promise<void> {
	await withStore('readwrite', (store) => store.delete(userId));
}
