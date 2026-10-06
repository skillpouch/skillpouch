// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeps `me` (plan, usage, deletion schedule) fresh in the session store:
 * any `invalidateQueries(queryKeys.me)` refetches it and every component
 * reading the session sees the new values.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { Me } from '@/lib/api/types';
import { patchMe, useUnlocked } from './session-store';

/**
 * Two sources write `me`: this query, and the session store (startup and
 * every re-bootstrap). Whichever is newer wins: a fresh fetch is pushed into
 * the store, and a store update is pushed into the query cache so a stale
 * cached copy can never overwrite it.
 */
export function useMeSync(): void {
	const { me } = useUnlocked();
	const client = useQueryClient();
	const query = useQuery({
		queryKey: queryKeys.me,
		queryFn: () => api.get<Me>('/v1/me'),
		initialData: me,
		staleTime: 15_000,
	});

	useEffect(() => {
		if (client.getQueryData(queryKeys.me) !== me) client.setQueryData(queryKeys.me, me);
	}, [client, me]);

	const fetched = query.data;
	const fetchedAt = query.dataUpdatedAt;
	useEffect(() => {
		if (fetched) patchMe(fetched);
		// Only a new fetch should write to the store, not a store change echoing back.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fetchedAt]);
}
