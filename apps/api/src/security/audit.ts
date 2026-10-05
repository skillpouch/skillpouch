// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tamper-evident audit log (plan 08 §10): each row stores the previous row's
 * hash, `row_hash = BLAKE3(prev_hash ‖ canonical row)`, forming one chain per
 * storage account. Appends are serialized per account with an advisory lock.
 */
import { canonicalJson } from '@skillpouch/contracts';
import { auditLog } from '@skillpouch/db';
import { sql } from 'drizzle-orm';
import { blake3Hash } from './crypto-util';

export interface AuditEntry {
	storageAccountId: string | null;
	actor: string;
	action: string;
	target?: string | null;
	details?: Record<string, unknown>;
	ipHash?: Buffer | null;
}

interface Executor {
	execute: (query: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }>;
	insert: (table: typeof auditLog) => {
		values: (row: typeof auditLog.$inferInsert) => Promise<unknown>;
	};
}

export function computeRowHash(prevHash: Buffer | null, row: Record<string, unknown>): Buffer {
	const body = new TextEncoder().encode(canonicalJson(row));
	const input = new Uint8Array((prevHash?.length ?? 0) + body.length);
	if (prevHash) input.set(prevHash, 0);
	input.set(body, prevHash?.length ?? 0);
	return blake3Hash(input);
}

/** Appends one audit row inside the caller's transaction. */
export async function appendAudit(tx: Executor, entry: AuditEntry): Promise<void> {
	const chainKey = entry.storageAccountId ?? 'system';
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`audit:${chainKey}`}))`);
	const previous = await tx.execute(
		entry.storageAccountId
			? sql`SELECT row_hash FROM audit_log WHERE storage_account_id = ${entry.storageAccountId} ORDER BY created_at DESC LIMIT 1`
			: sql`SELECT row_hash FROM audit_log WHERE storage_account_id IS NULL ORDER BY created_at DESC LIMIT 1`,
	);
	const prevHash = (previous.rows[0]?.row_hash as Buffer | undefined) ?? null;
	const createdAt = new Date();
	const details = entry.details ?? {};
	const rowHash = computeRowHash(prevHash, {
		storage_account_id: entry.storageAccountId,
		actor: entry.actor,
		action: entry.action,
		target: entry.target ?? null,
		details,
		created_at: createdAt.toISOString(),
	});
	await tx.insert(auditLog).values({
		storageAccountId: entry.storageAccountId,
		actor: entry.actor,
		action: entry.action,
		target: entry.target ?? null,
		details,
		ipHash: entry.ipHash ?? null,
		prevHash,
		rowHash,
		createdAt,
	});
}
