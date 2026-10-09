// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Delayed purges: everything the user scheduled with a
 * 7-day undo window — a deleted pouch, an "I lost everything" encrypted-data
 * reset, a deleted account. Each runs in one transaction per subject and
 * deletes rows in foreign-key order; blob objects are removed after commit.
 */
import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { appendAudit } from '../security/audit';
import { rows } from './sql';

type Tx = Parameters<Parameters<Deps['db']['maintenance']['transaction']>[0]>[0];

/** Deletes all data of one pouch (not the roster statements, which are append-only history). */
async function purgePouchRows(tx: Tx, pouchId: string): Promise<void> {
	await tx.execute(sql`UPDATE artifacts SET head_revision_id = NULL WHERE pouch_id = ${pouchId}`);
	for (const table of [
		'snapshots',
		'shares',
		'checkpoints',
		'bindings',
		'conflicts',
		'operation_receipts',
		'events',
		'device_cursors',
		'revision_blobs',
		'revisions',
		'blobs',
		'artifacts',
		'key_envelopes',
	]) {
		await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE pouch_id = ${pouchId}`);
	}
	await tx.execute(
		sql`UPDATE devices SET active_pouch_id = NULL WHERE active_pouch_id = ${pouchId}`,
	);
	await tx.execute(sql`DELETE FROM pouches WHERE id = ${pouchId}`);
}

/**
 * Recomputes used bytes from what is actually stored (blobs + envelopes) and
 * sets or clears `over_quota_since` to match.
 */
export async function recalcAccountUsage(tx: Tx, storageAccountId: string): Promise<void> {
	await tx.execute(sql`
		WITH actual AS (
			SELECT
				COALESCE((SELECT sum(stored_size) FROM blobs WHERE storage_account_id = ${storageAccountId} AND state = 'stored'), 0)
					+ COALESCE((SELECT sum(octet_length(envelope)) FROM revisions WHERE storage_account_id = ${storageAccountId}), 0)
					+ COALESCE((SELECT sum(stored_size) FROM shares WHERE storage_account_id = ${storageAccountId}), 0) AS used,
				COALESCE((SELECT sum(stored_size) FROM blobs WHERE storage_account_id = ${storageAccountId} AND state = 'pending'), 0) AS pending
		)
		UPDATE storage_accounts sa SET
			used_bytes = actual.used,
			pending_bytes = actual.pending,
			over_quota_since = CASE WHEN actual.used > sa.quota_bytes THEN COALESCE(sa.over_quota_since, now()) ELSE NULL END
		FROM actual
		WHERE sa.id = ${storageAccountId}`);
}

/**
 * Purges one deleted pouch right away instead of after the 7-day undo window
 * (`DELETE /v1/pouches/:id?skip_undo=true`). The caller has already
 * checked ownership and marked the pouch deleted.
 */
export async function purgePouchNow(
	deps: Deps,
	storageAccountId: string,
	pouchId: string,
): Promise<void> {
	const purged = await deps.db.maintenance.transaction(async (tx) => {
		const [locked] = rows<{ id: string }>(
			await tx.execute(
				sql`SELECT id FROM pouches WHERE id = ${pouchId} AND storage_account_id = ${storageAccountId} AND state = 'deleted' FOR UPDATE`,
			),
		);
		if (!locked) return false;
		await purgePouchRows(tx, pouchId);
		await recalcAccountUsage(tx, storageAccountId);
		await appendAudit(tx, {
			storageAccountId,
			actor: 'user',
			action: 'pouch.purged',
			target: pouchId,
			details: { skipped_undo: true },
		});
		return true;
	});
	if (purged) await deps.blobs.deletePouch(storageAccountId, pouchId);
}

/** Pouches deleted more than 7 days ago (and not restored). */
export async function purgeDeletedPouches(deps: Deps): Promise<number> {
	const due = rows<{ id: string; storage_account_id: string }>(
		await deps.db.maintenance.execute(
			sql`SELECT id, storage_account_id FROM pouches WHERE state = 'deleted' AND delete_after < now() LIMIT 100`,
		),
	);
	for (const pouch of due) {
		await deps.db.maintenance.transaction(async (tx) => {
			const [locked] = rows<{ id: string }>(
				await tx.execute(
					sql`SELECT id FROM pouches WHERE id = ${pouch.id} AND state = 'deleted' AND delete_after < now() FOR UPDATE`,
				),
			);
			if (!locked) return;
			await purgePouchRows(tx, pouch.id);
			await recalcAccountUsage(tx, pouch.storage_account_id);
			await appendAudit(tx, {
				storageAccountId: pouch.storage_account_id,
				actor: 'system',
				action: 'pouch.purged',
				target: pouch.id,
			});
		});
		await deps.blobs.deletePouch(pouch.storage_account_id, pouch.id);
	}
	return due.length;
}

/** Removes every encrypted byte and the whole roster of one account (keeps sign-in and billing). */
async function wipeEncryptedData(tx: Tx, storageAccountId: string): Promise<string[]> {
	const pouchIds = rows<{ id: string }>(
		await tx.execute(
			sql`SELECT id FROM pouches WHERE storage_account_id = ${storageAccountId}`,
		),
	).map((row) => row.id);
	for (const pouchId of pouchIds) await purgePouchRows(tx, pouchId);
	for (const table of [
		'unlock_grants',
		'webauthn_challenges',
		'passkey_unlockers',
		'account_unlock',
		'roster_statements',
	]) {
		await tx.execute(
			sql`DELETE FROM ${sql.identifier(table)} WHERE storage_account_id = ${storageAccountId}`,
		);
	}
	// Every CLI was a roster member: revoke them all, they must log in again.
	await tx.execute(sql`
		UPDATE devices SET state = 'revoked', revoked_at = COALESCE(revoked_at, now()), revoke_reason = 'encryption_reset',
			token_version = token_version + 1,
			refresh_hash = sha256(convert_to(gen_random_uuid()::text, 'UTF8')), prev_refresh_hash = NULL
		WHERE storage_account_id = ${storageAccountId}`);
	await tx.execute(
		sql`DELETE FROM account_members WHERE storage_account_id = ${storageAccountId}`,
	);
	await tx.execute(sql`
		UPDATE storage_accounts SET genesis_hash = NULL, roster_seq = 0, roster_head_hash = NULL,
			used_bytes = 0, pending_bytes = 0, reset_after = NULL, updated_at = now()
		WHERE id = ${storageAccountId}`);
	return pouchIds;
}

/** "Lost everything" resets confirmed more than 7 days ago. */
export async function resetEncryptedAccounts(deps: Deps): Promise<number> {
	const due = rows<{ id: string }>(
		await deps.db.maintenance.execute(
			sql`SELECT id FROM storage_accounts WHERE reset_after < now() LIMIT 50`,
		),
	);
	for (const account of due) {
		const pouchIds = await deps.db.maintenance.transaction(async (tx) => {
			const [locked] = rows<{ id: string }>(
				await tx.execute(
					sql`SELECT id FROM storage_accounts WHERE id = ${account.id} AND reset_after < now() FOR UPDATE`,
				),
			);
			if (!locked) return [];
			const ids = await wipeEncryptedData(tx, account.id);
			await appendAudit(tx, {
				storageAccountId: account.id,
				actor: 'system',
				action: 'account.encryption_reset',
			});
			return ids;
		});
		for (const pouchId of pouchIds) await deps.blobs.deletePouch(account.id, pouchId);
	}
	return due.length;
}

/** Accounts whose deletion was confirmed more than 7 days ago: everything goes. */
export async function purgeDeletedAccounts(deps: Deps): Promise<number> {
	const due = rows<{ id: string; owner_user_id: string }>(
		await deps.db.maintenance.execute(
			sql`SELECT id, owner_user_id FROM storage_accounts WHERE delete_after < now() LIMIT 20`,
		),
	);
	for (const account of due) {
		const pouchIds = await deps.db.maintenance.transaction(async (tx) => {
			const [locked] = rows<{ id: string }>(
				await tx.execute(
					sql`SELECT id FROM storage_accounts WHERE id = ${account.id} AND delete_after < now() FOR UPDATE`,
				),
			);
			if (!locked) return [];
			const ids = await wipeEncryptedData(tx, account.id);
			for (const table of [
				'device_keys',
				'devices',
				'security_events',
				'subscriptions',
				'plan_grants',
				'entitlement_overrides',
				'cli_auth_requests',
				'cli_connect_tokens',
				'audit_log',
				'marketplaces',
				'github_installations',
				'token_usage',
			]) {
				await tx.execute(
					sql`DELETE FROM ${sql.identifier(table)} WHERE storage_account_id = ${account.id}`,
				);
			}
			await tx.execute(sql`DELETE FROM storage_accounts WHERE id = ${account.id}`);
			await tx.execute(
				sql`UPDATE conflicts SET resolved_by = NULL WHERE resolved_by = ${account.owner_user_id}`,
			);
			await tx.execute(sql`DELETE FROM users WHERE id = ${account.owner_user_id}`);
			await appendAudit(tx, {
				storageAccountId: null,
				actor: 'system',
				action: 'account.purged',
				target: account.id,
			});
			return ids;
		});
		for (const pouchId of pouchIds) await deps.blobs.deletePouch(account.id, pouchId);
	}
	return due.length;
}
