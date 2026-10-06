// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The per-pouch event log (plan 04 §4). `seq` is assigned by incrementing
 * `pouches.event_seq` under the pouch row lock inside the mutation
 * transaction — never a sequence — so it is dense *and* commit-ordered: a
 * reader can never see seq 11 before seq 10 commits (04 §4.1).
 */
import type { EventType } from '@skillpouch/contracts';
import { events, pouches } from '@skillpouch/db';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { TenantTx } from '../../security/tenant-tx';

export interface NewEvent {
	storageAccountId: string;
	pouchId: string;
	epoch: string;
	type: EventType;
	artifactId?: string | null;
	revisionId?: string | null;
	operationId?: string | null;
	deviceId?: string | null;
	payload?: Record<string, unknown>;
}

/** Appends one event; the caller must hold the pouch row lock. Returns its seq. */
export async function appendEvent(tx: TenantTx, event: NewEvent): Promise<number> {
	const [row] = await tx
		.update(pouches)
		.set({ eventSeq: sql`${pouches.eventSeq} + 1`, updatedAt: new Date() })
		.where(eq(pouches.id, event.pouchId))
		.returning({ seq: pouches.eventSeq });
	const seq = row!.seq;
	await tx.insert(events).values({
		storageAccountId: event.storageAccountId,
		pouchId: event.pouchId,
		seq,
		epoch: event.epoch,
		type: event.type,
		artifactId: event.artifactId ?? null,
		revisionId: event.revisionId ?? null,
		operationId: event.operationId ?? null,
		deviceId: event.deviceId ?? null,
		payload: event.payload ?? {},
	});
	return seq;
}

export async function readEvents(tx: TenantTx, pouchId: string, after: number, limit: number) {
	return tx
		.select()
		.from(events)
		.where(and(eq(events.pouchId, pouchId), gt(events.seq, after)))
		.orderBy(asc(events.seq))
		.limit(limit);
}

export function eventView(row: typeof events.$inferSelect) {
	return {
		seq: row.seq,
		type: row.type as EventType,
		artifact_id: row.artifactId,
		revision_id: row.revisionId,
		operation_id: row.operationId,
		device_id: row.deviceId,
		payload: row.payload,
		created_at: row.createdAt.toISOString(),
	};
}
