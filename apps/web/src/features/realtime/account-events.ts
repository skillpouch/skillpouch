// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live updates while the dashboard is open: one account-wide SSE stream.
 *
 * Correctness never depends on it — every query also refetches on focus and
 * after its own mutations — it just makes changes from computers show up
 * within a second. Reconnects with backoff, resuming from the last cursor.
 */
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '@/lib/api/query-keys';
import { readEventStream, type SseMessage } from '@/lib/api/sse';
import { bootstrapSession } from '../session/bootstrap';
import { reloadKeyring } from '../vault/keyring';

export interface AccountEvent {
	type: string;
	data: Record<string, unknown>;
}

/** In-page subscribers (e.g. the Connect CLI dialog waiting for its token). */
const accountListeners = new Set<(event: AccountEvent) => void>();

export function onAccountEvent(listener: (event: AccountEvent) => void): () => void {
	accountListeners.add(listener);
	return () => accountListeners.delete(listener);
}

/** Exported for tests: what each frame does to the caches. */
export async function handleMessage(client: QueryClient, message: SseMessage): Promise<void> {
	if (message.event === 'pouch_event') {
		const { pouch_id: pouchId } = JSON.parse(message.data) as { pouch_id: string };
		await Promise.all([
			client.invalidateQueries({ queryKey: queryKeys.contents(pouchId) }),
			client.invalidateQueries({ queryKey: queryKeys.conflicts(pouchId) }),
			client.invalidateQueries({ queryKey: queryKeys.pouches }),
		]);
		return;
	}
	if (message.event === 'revoked') {
		await bootstrapSession();
		return;
	}
	if (message.event !== 'account') return;
	const event = JSON.parse(message.data) as AccountEvent;
	for (const listener of accountListeners) listener(event);
	switch (event.type) {
		case 'roster.changed':
			await reloadKeyring();
			await client.invalidateQueries({ queryKey: queryKeys.devices });
			break;
		case 'device.revoked':
		case 'browser.trusted':
		case 'cli_auth.approved':
			await client.invalidateQueries({ queryKey: queryKeys.devices });
			break;
		case 'pouch.state_changed':
			await client.invalidateQueries({ queryKey: queryKeys.pouches });
			await client.invalidateQueries({ queryKey: queryKeys.me });
			break;
		case 'entitlements.changed':
		case 'usage.changed':
			await client.invalidateQueries({ queryKey: queryKeys.me });
			await client.invalidateQueries({ queryKey: queryKeys.storage });
			await client.invalidateQueries({ queryKey: queryKeys.billing });
			break;
		case 'unlock.failed_streak':
			await client.invalidateQueries({ queryKey: queryKeys.securityEvents });
			break;
		default:
			break;
	}
}

/** Keeps the stream open while mounted. */
export function useAccountEvents(enabled: boolean): void {
	const client = useQueryClient();
	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		let lastEventId: string | null = null;
		let attempt = 0;
		const loop = async () => {
			while (!controller.signal.aborted) {
				try {
					await readEventStream(
						'/v1/events/stream',
						(message) => {
							attempt = 0;
							if (message.id) lastEventId = message.id;
							if (message.event === 'reconnect') return;
							void handleMessage(client, message);
						},
						controller.signal,
						lastEventId,
					);
				} catch {
					if (controller.signal.aborted) return;
				}
				attempt++;
				const delay =
					Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)) * (0.5 + Math.random());
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		};
		void loop();
		return () => controller.abort();
	}, [client, enabled]);
}
