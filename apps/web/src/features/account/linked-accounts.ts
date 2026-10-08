// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import { listLinkedAccounts, type OAuthProvider } from '@/lib/auth';

/** Where the profile page lists sign-in methods, for links that send you there. */
export const SIGN_IN_METHODS_ID = 'sign-in-methods';

export function useLinkedAccounts() {
	return useQuery({ queryKey: queryKeys.linkedAccounts, queryFn: listLinkedAccounts });
}

/**
 * Whether `provider` is a sign-in method; undefined while loading. If the list
 * can't load, assume it is, so nothing waits on it.
 */
export function useIsLinked(provider: OAuthProvider): boolean | undefined {
	const accounts = useLinkedAccounts();
	if (accounts.isError) return true;
	return accounts.data?.some((account) => account.providerId === provider);
}
