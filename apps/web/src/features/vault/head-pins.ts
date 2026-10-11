// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What this browser remembers about each item's history, per member and
 * pouch. A new head is accepted only when its signed parent names the pinned
 * head; an unseen intermediate revision or fork cannot prove advancement.
 */
const DB_NAME = 'skillpouch-heads';
const STORE = 'pouches';
const MAX_OLDER = 64;

export interface SeenHead {
	head: string;
	older: string[];
	pending?: { revisionId: string; baseId: string | null };
}

interface PinRecord {
	/** `<member id>/<pouch id>` */
	id: string;
	heads: Record<string, SeenHead>;
}

export interface OfferedHead {
	artifactId: string;
	revisionId: string;
	/** Primary parent and merge parent from the signed body, in that order. */
	parents: (string | null)[];
	/** Signed primary-parent chain, from this offer back to `verifiedFrom`. */
	verifiedFrom?: string;
	verifiedAncestors?: string[];
}

function validRecord(value: unknown, id: string): value is PinRecord {
	if (!value || typeof value !== 'object') return false;
	const record = value as Partial<PinRecord>;
	if (
		record.id !== id ||
		!record.heads ||
		typeof record.heads !== 'object' ||
		Array.isArray(record.heads) ||
		Object.getPrototypeOf(record.heads) !== Object.prototype
	)
		return false;
	return Object.entries(record.heads).every(([artifactId, entry]) => {
		if (!artifactId || !entry || typeof entry !== 'object') return false;
		const head = entry as SeenHead;
		return (
			typeof head.head === 'string' &&
			head.head.length > 0 &&
			Array.isArray(head.older) &&
			head.older.length <= MAX_OLDER &&
			head.older.every((older) => typeof older === 'string' && older.length > 0) &&
			(head.pending === undefined ||
				(head.pending !== null &&
					typeof head.pending.revisionId === 'string' &&
					head.pending.revisionId.length > 0 &&
					(head.pending.baseId === null || typeof head.pending.baseId === 'string')))
		);
	});
}

function storedRecord(value: unknown, id: string): PinRecord {
	if (value === undefined) return { id, heads: {} };
	if (!validRecord(value, id))
		throw new Error('Local item head history is corrupt; writes are blocked.');
	return value;
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE, { keyPath: 'id' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export type HeadRefusal = 'rollback' | 'unknown';

/** The pinned head, and a write from this browser that may have been applied. */
export function trustedHeads(seen: SeenHead): string[] {
	return seen.pending ? [seen.head, seen.pending.revisionId] : [seen.head];
}

/** Unknown ancestry is not proof of a newer head, even when its signature is valid. */
export function classify(seen: SeenHead | undefined, offered: OfferedHead): HeadRefusal | null {
	if (!seen) return null;
	const trusted = trustedHeads(seen);
	if (trusted.includes(offered.revisionId)) return null;
	const parent = offered.parents[0];
	if (parent && trusted.includes(parent)) return null;
	const from = offered.verifiedFrom;
	if (from && trusted.includes(from) && offered.verifiedAncestors?.includes(from)) return null;
	return seen.older.includes(offered.revisionId) ? 'rollback' : 'unknown';
}

/** Remembers `head` as the artifact's newest verified head. */
export function remember(heads: Record<string, SeenHead>, head: OfferedHead): void {
	const seen = heads[head.artifactId] ?? { head: '', older: [] };
	const older = new Set(seen.older);
	if (seen.head && seen.head !== head.revisionId) older.add(seen.head);
	for (const parent of head.parents) if (parent && parent !== head.revisionId) older.add(parent);
	for (const ancestor of head.verifiedAncestors ?? [])
		if (ancestor !== head.revisionId) older.add(ancestor);
	older.delete(head.revisionId);
	// Evicted ancestors become unknown, never accepted. Bound storage per item.
	heads[head.artifactId] = { head: head.revisionId, older: [...older].slice(-MAX_OLDER) };
}

function transact<T>(
	memberId: string,
	pouchId: string,
	update: (record: PinRecord) => T | undefined,
	write = true,
): Promise<T> {
	return openDatabase().then(async (db) => {
		try {
			return await new Promise<T>((resolve, reject) => {
				const tx = db.transaction(STORE, write ? 'readwrite' : 'readonly');
				const store = tx.objectStore(STORE);
				const id = `${memberId}/${pouchId}`;
				let value: T;
				const read = store.get(id);
				read.onsuccess = () => {
					try {
						const record = storedRecord(read.result, id);
						value = update(record) as T;
						if (write) store.put(record);
					} catch (error) {
						reject(error);
						tx.abort();
					}
				};
				tx.oncomplete = () => resolve(value);
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	});
}

/** A read is validated too: corruption cannot masquerade as a never-seen item. */
export function pinnedHeads(memberId: string, pouchId: string): Promise<Record<string, SeenHead>> {
	return transact(memberId, pouchId, (record) => structuredClone(record.heads), false);
}

/** Atomically preflight the editor base and reserve an uncertain remote outcome. */
export function reserveHead(
	memberId: string,
	pouchId: string,
	artifactId: string,
	baseId: string | null,
	revisionId: string,
): Promise<void> {
	return transact(memberId, pouchId, (record) => {
		const seen = record.heads[artifactId];
		if (seen?.pending || (baseId === null ? !!seen : !seen || seen.head !== baseId))
			throw new Error('The item changed since this editor opened; reload before writing.');
		record.heads[artifactId] = {
			head: seen?.head ?? revisionId,
			older: seen?.older ?? [],
			pending: { revisionId, baseId },
		};
	});
}

/**
 * Drops a reservation whose write failed. If the server applied it anyway, its
 * head still follows the pinned one and is accepted on the next read.
 */
export function releaseHead(
	memberId: string,
	pouchId: string,
	artifactId: string,
	revisionId: string,
): Promise<void> {
	return transact(memberId, pouchId, (record) => {
		const seen = record.heads[artifactId];
		if (seen?.pending?.revisionId !== revisionId) return;
		if (seen.pending.baseId === null && seen.head === revisionId)
			delete record.heads[artifactId];
		else record.heads[artifactId] = { head: seen.head, older: seen.older };
	});
}

/** Records this browser's applied write as the item's head. */
export function settleHead(
	memberId: string,
	pouchId: string,
	artifactId: string,
	revisionId: string,
): Promise<void> {
	return transact(memberId, pouchId, (record) => {
		const seen = record.heads[artifactId];
		if (!seen?.pending || seen.pending.revisionId !== revisionId)
			throw new Error('Local pending head changed; reload before writing.');
		remember(record.heads, { artifactId, revisionId, parents: [seen.pending.baseId, null] });
	});
}

/**
 * Checks and remembers accepted heads atomically. Refused heads must not be used.
 */
export async function pinHeads(
	memberId: string,
	pouchId: string,
	offered: OfferedHead[],
): Promise<Map<string, HeadRefusal>> {
	return transact(memberId, pouchId, (record) => {
		const refused = new Map<string, HeadRefusal>();
		for (const head of offered) {
			const seen = record.heads[head.artifactId];
			const reason = classify(seen, head);
			if (reason) refused.set(head.artifactId, reason);
			else if (!refused.has(head.artifactId)) remember(record.heads, head);
		}
		return refused;
	});
}
