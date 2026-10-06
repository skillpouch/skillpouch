// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every React Query key in one place, so invalidation after a mutation or a
 * realtime event can't miss a cache entry.
 */
export const queryKeys = {
	me: ['me'] as const,
	pouches: ['pouches'] as const,
	contents: (pouchId: string) => ['pouch', pouchId, 'contents'] as const,
	descriptions: (pouchId: string) => ['pouch', pouchId, 'descriptions'] as const,
	files: (pouchId: string, revisionId: string) =>
		['pouch', pouchId, 'files', revisionId] as const,
	conflicts: (pouchId: string) => ['pouch', pouchId, 'conflicts'] as const,
	pouch: (pouchId: string) => ['pouch', pouchId] as const,
	devices: ['devices'] as const,
	storage: ['storage'] as const,
	shares: ['shares'] as const,
	billing: ['billing'] as const,
	invoices: ['billing', 'invoices'] as const,
	plans: ['plans'] as const,
	securityEvents: ['security', 'events'] as const,
	securitySettings: ['security', 'settings'] as const,
	passkeys: ['security', 'passkeys'] as const,
	unlockParams: ['unlock', 'params'] as const,
} as const;
