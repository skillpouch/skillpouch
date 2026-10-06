// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Computers (CLIs) and browsers that can open the account's pouches.
 *
 * Revoking signs the member out at once (server side) *and* — because this
 * browser is unlocked — removes it from the roster and rotates every pouch
 * key, so even a copy of its old keys can't read anything written later.
 */
import { buildRemoveMember } from '@skillpouch/crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { BrowserRecord, DeviceRecord, PouchRecord } from '@/lib/api/types';
import { currentKeyring } from '../session/session-store';
import { reloadKeyring, withRosterChange } from '../vault/keyring';

export interface DeviceList {
	devices: DeviceRecord[];
	browsers: BrowserRecord[];
}

export function useDevices() {
	return useQuery({
		queryKey: queryKeys.devices,
		queryFn: () => api.get<DeviceList>('/v1/devices'),
		refetchInterval: 60_000,
	});
}

export type SyncState = 'synced' | 'behind' | 'never';

/** Whether a computer has acknowledged every event of a pouch. */
export function deviceSyncState(
	device: DeviceRecord,
	pouch: Pick<PouchRecord, 'id' | 'event_seq'>,
): SyncState {
	const cursor = device.cursors.find((entry) => entry.pouch_id === pouch.id);
	if (!cursor) return 'never';
	return cursor.acked_seq >= pouch.event_seq ? 'synced' : 'behind';
}

export function activeDevices(list: DeviceList | undefined): DeviceRecord[] {
	return (list?.devices ?? []).filter((device) => device.state !== 'revoked');
}

function useInvalidateDevices() {
	const client = useQueryClient();
	return () => client.invalidateQueries({ queryKey: queryKeys.devices });
}

export function useRenameDevice() {
	const invalidate = useInvalidateDevices();
	return useMutation({
		mutationFn: ({ id, name }: { id: string; name: string }) =>
			api.patch(`/v1/devices/${id}`, { name: name.trim() }),
		onSuccess: invalidate,
	});
}

/**
 * `remove` + `rotate_keys` signed by this browser. A member can't remove
 * itself this way; its own revocation is server-side and the next unlocked
 * member rotates the keys.
 */
async function signedRemoval(memberId: string | null) {
	if (!memberId) return undefined;
	const keyring = currentKeyring();
	if (memberId === keyring.member.id) return undefined;
	if (keyring.roster.members.get(memberId)?.removedSeq != null) return undefined;
	return buildRemoveMember(keyring, memberId);
}

export function useRevokeDevice() {
	const invalidate = useInvalidateDevices();
	return useMutation({
		mutationFn: (device: Pick<DeviceRecord, 'id' | 'member_id'>) =>
			withRosterChange(async () => {
				const roster = await signedRemoval(device.member_id);
				await api.post(`/v1/devices/${device.id}/revoke`, roster ? { roster } : {});
				await reloadKeyring();
			}),
		onSuccess: invalidate,
	});
}

export function useRevokeBrowser() {
	const invalidate = useInvalidateDevices();
	return useMutation({
		mutationFn: (memberId: string) =>
			withRosterChange(async () => {
				const roster = await signedRemoval(memberId);
				await api.post(`/v1/browsers/${memberId}/revoke`, roster ? { roster } : {});
				if (memberId !== currentKeyring().member.id) await reloadKeyring();
			}),
		onSuccess: invalidate,
	});
}

export const OS_LABEL: Record<DeviceRecord['os'], string> = {
	linux: 'Linux',
	macos: 'macOS',
	windows: 'Windows',
};

/** `claude-code` → `Claude Code`. */
export function assistantLabel(id: string): string {
	const known: Record<string, string> = {
		'claude-code': 'Claude Code',
		opencode: 'OpenCode',
		codex: 'Codex',
		'gemini-cli': 'Gemini CLI',
		cursor: 'Cursor',
		windsurf: 'Windsurf',
		copilot: 'Copilot',
		antigravity: 'Antigravity',
	};
	return known[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
