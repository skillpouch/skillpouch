// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The newest CLI release, read from the npm registry (the `skillpouch`
 * package's `latest` tag) so a release never needs a server config change.
 * Answers come from a cache; when npm can't be reached the last known
 * version is kept.
 */
import { z } from 'zod';

const REGISTRY_URL = 'https://registry.npmjs.org/skillpouch/latest';
const FRESH_MS = 15 * 60_000;
const RETRY_MS = 60_000;
const TIMEOUT_MS = 5_000;

const Latest = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+([-+][\w.-]+)?$/) });

export class CliReleases {
	private known: string | null = null;
	private checkAfter = 0;
	private pending: Promise<void> | null = null;

	constructor(
		private readonly http: typeof fetch = fetch,
		private readonly now: () => number = Date.now,
	) {}

	/** The latest published version, or null when npm was never reached. */
	async latest(): Promise<string | null> {
		if (this.now() >= this.checkAfter) {
			this.pending ??= this.refresh().finally(() => {
				this.pending = null;
			});
			// Only the first answer waits; later ones get the cached version at once.
			if (this.known === null) await this.pending;
		}
		return this.known;
	}

	private async refresh(): Promise<void> {
		try {
			const response = await this.http(REGISTRY_URL, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			const parsed = response.ok ? Latest.safeParse(await response.json()) : null;
			if (parsed?.success) {
				this.known = parsed.data.version;
				this.checkAfter = this.now() + FRESH_MS;
				return;
			}
			this.checkAfter = this.now() + RETRY_MS;
		} catch {
			this.checkAfter = this.now() + RETRY_MS;
		}
	}
}
