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

/** Unknown ancestry is not proof of a newer head, even when its signature is valid. */
export function classify(seen: SeenHead | undefined, offered: OfferedHead): HeadRefusal | null {
	if (!seen || seen.head === offered.revisionId || offered.parents[0] === seen.head) return null;
	return seen.older.includes(offered.revisionId) ? 'rollback' : 'unknown';
}

/** Remembers `head` as the artifact's newest verified head. */
export function remember(heads: Record<string, SeenHead>, head: OfferedHead): void {
	const seen = heads[head.artifactId] ?? { head: '', older: [] };
	const older = new Set(seen.older);
	if (seen.head && seen.head !== head.revisionId) older.add(seen.head);
	for (const parent of head.parents) if (parent && parent !== head.revisionId) older.add(parent);
	older.delete(head.revisionId);
	// Evicted ancestors become unknown, never accepted. Bound storage per item.
	heads[head.artifactId] = { head: head.revisionId, older: [...older].slice(-MAX_OLDER) };
}

/**
 * Checks and remembers accepted heads atomically. Refused heads must not be used.
 */
export async function pinHeads(
	memberId: string,
	pouchId: string,
	offered: OfferedHead[],
): Promise<Map<string, HeadRefusal>> {
	const db = await openDatabase();
	try {
		return await new Promise<Map<string, HeadRefusal>>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			const store = tx.objectStore(STORE);
			const id = `${memberId}/${pouchId}`;
			const refused = new Map<string, HeadRefusal>();
			const read = store.get(id);
			read.onsuccess = () => {
				try {
					const record = (read.result as PinRecord | undefined) ?? { id, heads: {} };
					for (const head of offered) {
						const reason = classify(record.heads[head.artifactId], head);
						if (reason) refused.set(head.artifactId, reason);
						else if (!refused.has(head.artifactId)) remember(record.heads, head);
					}
					store.put(record);
				} catch (error) {
					tx.abort();
					reject(error);
				}
			};
			tx.oncomplete = () => resolve(refused);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}
