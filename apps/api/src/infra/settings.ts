// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runtime settings stored in `system_settings` and toggled from the admin
 * dashboard — currently the maintenance write pause.
 * Cached for 2 s per instance.
 */
import { systemSettings, type Database } from '@skillpouch/db';
import { eq } from 'drizzle-orm';

export const WRITE_PAUSE_KEY = 'maintenance_write_pause';

export class SettingsCache {
	private writePause: { value: boolean; expires: number } | null = null;

	constructor(
		private readonly db: Database,
		private readonly envWritePause: boolean,
	) {}

	async isWritePaused(): Promise<boolean> {
		if (this.envWritePause) return true;
		if (this.writePause && this.writePause.expires > Date.now()) return this.writePause.value;
		const [row] = await this.db
			.select({ value: systemSettings.value })
			.from(systemSettings)
			.where(eq(systemSettings.key, WRITE_PAUSE_KEY));
		const value = (row?.value as { enabled?: boolean } | undefined)?.enabled === true;
		this.writePause = { value, expires: Date.now() + 2000 };
		return value;
	}

	invalidate(): void {
		this.writePause = null;
	}
}
