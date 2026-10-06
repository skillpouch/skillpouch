// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeps `me` (plan, usage, deletion schedule) fresh in the session store:
 * any `invalidateQueries(queryKeys.me)` refetches it and every component
 * reading the session sees the new values.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { Me } from '@/lib/api/types';
import { patchMe, useUnlocked } from './session-store';

export function useMeSync(): void {
	const { me } = useUnlocked();
	const query = useQuery({
		queryKey: queryKeys.me,
		queryFn: () => api.get<Me>('/v1/me'),
		initialData: me,
		staleTime: 15_000,
	});
	useEffect(() => {
		if (query.data && query.data !== me) patchMe(query.data);
	}, [query.data, me]);
}
