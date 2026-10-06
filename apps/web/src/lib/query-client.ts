// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api/errors';

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			refetchOnWindowFocus: true,
			retry: (failureCount, error) => {
				// Client errors don't get better by retrying.
				if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
				return failureCount < 2;
			},
		},
		mutations: { retry: false },
	},
});
