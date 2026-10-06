// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pouches: the server knows ids, states and sizes; names and descriptions are
 * sealed in the roster and decrypted here with the pouch keys.
 */
import {
	buildCreatePouch,
	buildRenamePouch,
	openPouchMeta,
	type Keyring,
} from '@skillpouch/crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { PouchRecord } from '@/lib/api/types';
import { currentKeyring, useUnlocked } from '../session/session-store';
import { withRosterChange } from '../vault/keyring';

export interface PouchView extends PouchRecord {
	name: string;
	description: string;
	/** False when this browser holds no keys for it (shouldn't happen; shown as "Unavailable"). */
	readable: boolean;
}

export function describePouch(keyring: Keyring, record: PouchRecord): PouchView {
	const keys = keyring.pouches.get(record.id);
	const sealed = keyring.roster.pouches.get(record.id)?.nameEnc;
	if (!keys || !sealed)
		return { ...record, name: 'Unavailable pouch', description: '', readable: false };
	try {
		const meta = openPouchMeta(keys, sealed);
		return { ...record, name: meta.name, description: meta.description, readable: true };
	} catch {
		return { ...record, name: 'Unreadable pouch', description: '', readable: false };
	}
}

export async function fetchPouches(): Promise<PouchRecord[]> {
	return (await api.get<{ pouches: PouchRecord[] }>('/v1/pouches')).pouches;
}

/** Every pouch (including ones in their deletion undo window), oldest first. */
export function usePouches() {
	const { keyring } = useUnlocked();
	return useQuery({
		queryKey: [...queryKeys.pouches, keyring.roster.headSeq],
		queryFn: fetchPouches,
		select: (records) =>
			records
				.map((record) => describePouch(keyring, record))
				.sort((a, b) => a.created_at.localeCompare(b.created_at)),
	});
}

export function usePouch(pouchId: string) {
	const query = usePouches();
	return { ...query, data: query.data?.find((pouch) => pouch.id === pouchId) };
}

export interface PouchMetaInput {
	name: string;
	description: string;
}

export function validatePouchName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return 'Give the pouch a name.';
	if (trimmed.length > 64) return 'Use at most 64 characters.';
	return null;
}

function useInvalidatePouches() {
	const client = useQueryClient();
	return () =>
		Promise.all([
			client.invalidateQueries({ queryKey: queryKeys.pouches }),
			client.invalidateQueries({ queryKey: queryKeys.me }),
			client.invalidateQueries({ queryKey: queryKeys.storage }),
		]);
}

export function useCreatePouch() {
	const invalidate = useInvalidatePouches();
	return useMutation({
		mutationFn: (meta: PouchMetaInput) =>
			withRosterChange(async () => {
				const id = crypto.randomUUID();
				const request = await buildCreatePouch(currentKeyring(), id, {
					name: meta.name.trim(),
					description: meta.description.trim(),
				});
				await api.post('/v1/pouches', request);
				return id;
			}),
		onSuccess: invalidate,
	});
}

export function useRenamePouch(pouchId: string) {
	const invalidate = useInvalidatePouches();
	return useMutation({
		mutationFn: (meta: PouchMetaInput) =>
			withRosterChange(async () => {
				const request = await buildRenamePouch(currentKeyring(), pouchId, {
					name: meta.name.trim(),
					description: meta.description.trim(),
				});
				await api.patch(`/v1/pouches/${pouchId}`, request);
			}),
		onSuccess: invalidate,
	});
}

export function useDeletePouch(pouchId: string) {
	const invalidate = useInvalidatePouches();
	return useMutation({
		mutationFn: (options: { skipUndo?: boolean } = {}) =>
			api.delete(`/v1/pouches/${pouchId}`, {
				query: { skip_undo: options.skipUndo ? 'true' : undefined },
			}),
		onSuccess: invalidate,
	});
}

export function useRestorePouch() {
	const invalidate = useInvalidatePouches();
	return useMutation({
		mutationFn: (pouchId: string) => api.post(`/v1/pouches/${pouchId}/restore`),
		onSuccess: invalidate,
	});
}

/** Make a locked pouch active; at the plan limit another active pouch is locked instead. */
export function useActivatePouch() {
	const invalidate = useInvalidatePouches();
	return useMutation({
		mutationFn: ({ pouchId, lockPouchId }: { pouchId: string; lockPouchId?: string }) =>
			api.post(
				`/v1/pouches/${pouchId}/activate`,
				lockPouchId ? { lock_pouch_id: lockPouchId } : {},
			),
		onSuccess: invalidate,
	});
}
