// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What this browser remembers about each item's history, per member and
 * pouch: the newest head revision it verified and every revision it knows
 * came before (the previous heads, and the parents their signed bodies
 * name). The server only ever moves a head to a new revision, so offering
 * one of those again is replaying an older version — refused, like a roster
 * rollback.
 */
const DB_NAME = 'skillpouch-heads';
const STORE = 'pouches';

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
	/** Parent and merge parent from the signed body. */
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

/** The artifacts whose offered head this browser saw replaced. */
export function replayed(heads: Record<string, SeenHead>, offered: OfferedHead[]): Set<string> {
	return new Set(
		offered
			.filter((head) => heads[head.artifactId]?.older.includes(head.revisionId))
			.map((head) => head.artifactId),
	);
}

/** Remembers `head` as the artifact's newest verified head. */
export function remember(heads: Record<string, SeenHead>, head: OfferedHead): void {
	const seen = heads[head.artifactId] ?? { head: '', older: [] };
	const older = new Set(seen.older);
	if (seen.head && seen.head !== head.revisionId) older.add(seen.head);
	for (const parent of head.parents) if (parent && parent !== head.revisionId) older.add(parent);
	heads[head.artifactId] = { head: head.revisionId, older: [...older] };
}

/**
 * Checks the heads a listing offers against what this browser saw before and
 * remembers the accepted ones, in one transaction. Returns the artifact ids
 * whose head is an older version: those must not be used.
 */
export async function pinHeads(
	memberId: string,
	pouchId: string,
	offered: OfferedHead[],
): Promise<Set<string>> {
	const db = await openDatabase();
	try {
		return await new Promise<Set<string>>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			const store = tx.objectStore(STORE);
			const id = `${memberId}/${pouchId}`;
			let refused = new Set<string>();
			const read = store.get(id);
			read.onsuccess = () => {
				const record = (read.result as PinRecord | undefined) ?? { id, heads: {} };
				refused = replayed(record.heads, offered);
				for (const head of offered) {
					if (!refused.has(head.artifactId)) remember(record.heads, head);
				}
				store.put(record);
			};
			tx.oncomplete = () => resolve(refused);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}
