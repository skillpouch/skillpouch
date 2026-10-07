// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small per-instance cache with a fixed time to live. Expired entries are
 * swept once the map reaches `sweepAt`, so it never grows with the number of
 * distinct keys ever seen.
 */
export class TtlCache<V> {
	private readonly entries = new Map<string, { value: V; expires: number }>();

	constructor(
		private readonly ttlMs: number,
		private readonly sweepAt: number,
	) {}

	async get(key: string, load: () => Promise<V>): Promise<V> {
		const now = Date.now();
		const hit = this.entries.get(key);
		if (hit && hit.expires > now) return hit.value;
		const value = await load();
		if (this.entries.size >= this.sweepAt) {
			for (const [entryKey, entry] of this.entries) {
				if (entry.expires <= now) this.entries.delete(entryKey);
			}
		}
		this.entries.set(key, { value, expires: now + this.ttlMs });
		return value;
	}

	delete(key: string): void {
		this.entries.delete(key);
	}

	clear(): void {
		this.entries.clear();
	}
}
