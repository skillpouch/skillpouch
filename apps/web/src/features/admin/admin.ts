// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The admin dashboard's data. The server decides who is an admin and asks
 * for a recent sign-in before any change; this module only reads and sends.
 * A change may carry a reason, which lands in the audit log.
 */
import type {
	AdminAnalytics,
	AdminOverview,
	AdminPayment,
	AdminPlan,
	AdminPlanInput,
	AdminUser,
	AuditEntry,
} from '@skillpouch/contracts';
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
	type InfiniteData,
} from '@tanstack/react-query';
import type { z } from 'zod';
import { api } from '@/lib/api/client';
import type { Me } from '@/lib/api/types';

export type Analytics = z.infer<typeof AdminAnalytics>;
export type Overview = z.infer<typeof AdminOverview>;
export type AdminUserRecord = z.infer<typeof AdminUser>;
export type Payment = z.infer<typeof AdminPayment>;
export type Plan = z.infer<typeof AdminPlan>;
export type PlanInput = z.input<typeof AdminPlanInput>;
export type Audit = z.infer<typeof AuditEntry>;

export interface UserDetail {
	user: AdminUserRecord;
	devices: {
		id: string;
		name: string;
		os: string;
		cli_version: string;
		state: string;
		last_seen_at: string | null;
	}[];
	pouches: { id: string; state: string; stored_bytes: number; created_at: string }[];
	security_events: { kind: string; severity: string; created_at: string }[];
	subscriptions: {
		id: string;
		status: string;
		external_subscription_id: string;
		current_period_end: string | null;
	}[];
	grants: {
		id: string;
		plan_slug: string;
		ends_at: string | null;
		revoked_at: string | null;
		reason: string;
	}[];
	override: {
		pouch_limit: number | null;
		storage_bytes: number | null;
		expires_at: string | null;
		note: string;
	} | null;
}

export interface AdminSubscription {
	id: string;
	email: string;
	plan_slug: string | null;
	status: string;
	provider: string;
	external_subscription_id: string;
	amount_cents: number;
	interval: string | null;
	current_period_end: string | null;
}

export interface SystemStatus {
	version: string;
	write_pause: boolean;
	failed_jobs_24h: number;
}

export const ADMIN_KEY = ['admin'] as const;
const key = (...parts: unknown[]) => [...ADMIN_KEY, ...parts] as const;

export const isAdmin = (me: Me | undefined) => me?.user.role === 'admin';

/** Ranges the analytics can show, in days. */
export const RANGES = [7, 30, 90, 365] as const;
export type Range = (typeof RANGES)[number];

export function useAnalytics(days: Range) {
	return useQuery({
		queryKey: key('analytics', days),
		queryFn: () => api.get<Analytics>(`/v1/admin/analytics?days=${days}`),
		placeholderData: (previous) => previous,
	});
}

export function useOverview() {
	return useQuery({
		queryKey: key('overview'),
		queryFn: () => api.get<Overview>('/v1/admin/overview'),
	});
}

/** A cursor-paged admin list, loaded a page at a time. */
function usePaged<T>(name: string, path: string, params: Record<string, string> = {}) {
	return useInfiniteQuery({
		queryKey: key(name, params),
		initialPageParam: null as string | null,
		queryFn: ({ pageParam }) => {
			const query = new URLSearchParams({ ...params, limit: '50' });
			if (pageParam) query.set('cursor', pageParam);
			return api.page<{ items: T[] }>(`${path}?${query}`);
		},
		getNextPageParam: (page) => page.nextCursor,
	});
}

export function pagedItems<T>(data: InfiniteData<{ data: { items: T[] } }> | undefined): T[] {
	return data?.pages.flatMap((page) => page.data.items) ?? [];
}

export function useAdminUsers(q: string) {
	return usePaged<AdminUserRecord>('users', '/v1/admin/users', q ? { q } : {});
}

export function useAdminUser(id: string) {
	return useQuery({
		queryKey: key('user', id),
		queryFn: () => api.get<UserDetail>(`/v1/admin/users/${encodeURIComponent(id)}`),
	});
}

export function usePayments() {
	return usePaged<Payment>('payments', '/v1/admin/payments');
}

export function useAuditLog() {
	return usePaged<Audit>('audit', '/v1/admin/audit');
}

export function useSubscriptions() {
	return useQuery({
		queryKey: key('subscriptions'),
		queryFn: () => api.get<{ subscriptions: AdminSubscription[] }>('/v1/admin/subscriptions'),
	});
}

export function useAdminPlans() {
	return useQuery({
		queryKey: key('plans'),
		queryFn: () => api.get<{ plans: Plan[] }>('/v1/admin/plans'),
	});
}

export function useSystem() {
	return useQuery({
		queryKey: key('system'),
		queryFn: () => api.get<SystemStatus>('/v1/admin/system'),
	});
}

/**
 * A change: the request, then every admin view reloads (numbers, lists and
 * the audit log all move together).
 */
export function useAdminAction<Input>(send: (input: Input) => Promise<unknown>) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: send,
		onSuccess: () => client.invalidateQueries({ queryKey: ADMIN_KEY }),
	});
}

export const adminApi = {
	post: (path: string, body: unknown = {}) => api.post(`/v1/admin${path}`, body),
	put: (path: string, body: unknown = {}) => api.put(`/v1/admin${path}`, body),
	delete: (path: string, body: unknown) => api.delete(`/v1/admin${path}`, { body }),
};

/** `+12%` against the period before; null when there's nothing to compare. */
export function change(now: number, before: number): number | null {
	if (before <= 0) return now > 0 ? null : 0;
	return (now - before) / before;
}

export function formatChange(ratio: number | null): string {
	if (ratio === null) return 'new';
	const percent = Math.round(ratio * 100);
	return `${percent > 0 ? '+' : ''}${percent}%`;
}

/** 1.2K, 3.4M, 5.6B. */
export function compact(value: number): string {
	return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
		value,
	);
}

/** Who did it, as the audit log writes it (`user:<id>`, `system`). */
export function actorLabel(actor: string): string {
	return actor.startsWith('user:') ? actor.slice(5) : actor;
}

const DAY_LABEL = new Intl.DateTimeFormat('en', {
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC',
});

/** `Oct 3` from `2026-10-03`. */
export function dayLabel(day: string): string {
	return DAY_LABEL.format(new Date(`${day}T00:00:00Z`));
}

/** Tone of a subscription or payment status. */
export function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' {
	if (['active', 'trialing', 'paid'].includes(status)) return 'success';
	if (['past_due', 'pending', 'partially_refunded', 'unpaid'].includes(status)) return 'warn';
	if (['canceled', 'refunded', 'failed', 'revoked', 'incomplete_expired'].includes(status))
		return 'danger';
	return 'neutral';
}

/** How long an admin gives a plan for. */
export type GrantLength = 'forever' | 'month' | 'year' | 'date';

export const GRANT_LENGTHS: { value: GrantLength; label: string }[] = [
	{ value: 'forever', label: 'Forever' },
	{ value: 'month', label: '1 month' },
	{ value: 'year', label: '1 year' },
	{ value: 'date', label: 'Until…' },
];

/** When the grant ends: null never ends; `date` is a `YYYY-MM-DD` (end of that UTC day). */
export function grantEnd(length: GrantLength, date: string, now = new Date()): string | null {
	if (length === 'forever') return null;
	if (length === 'date') return date ? new Date(`${date}T23:59:59Z`).toISOString() : null;
	const end = new Date(now);
	if (length === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
	else end.setUTCFullYear(end.getUTCFullYear() + 1);
	return end.toISOString();
}
