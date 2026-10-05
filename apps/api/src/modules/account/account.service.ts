// SPDX-License-Identifier: AGPL-3.0-only
/** Storage-account lifecycle: one per user, created on first sign-in (03 §1). */
import { storageAccounts, type Database } from '@skillpouch/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '../../lib/ids';
import { defaultEntitlements } from '../entitlements/entitlements.service';

/** Returns the user's storage account id, creating it with the default plan if needed. */
export async function ensureStorageAccount(db: Database, userId: string): Promise<string> {
	const [existing] = await db
		.select({ id: storageAccounts.id })
		.from(storageAccounts)
		.where(eq(storageAccounts.ownerUserId, userId));
	if (existing) return existing.id;

	const entitlements = await defaultEntitlements(db);
	await db
		.insert(storageAccounts)
		.values({
			id: uuidv7(),
			ownerUserId: userId,
			entitlements,
			quotaBytes: entitlements.storage_bytes,
		})
		.onConflictDoNothing({ target: storageAccounts.ownerUserId });
	const [created] = await db
		.select({ id: storageAccounts.id })
		.from(storageAccounts)
		.where(eq(storageAccounts.ownerUserId, userId));
	if (!created) throw new Error('storage account creation failed');
	return created.id;
}
