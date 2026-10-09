// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/admin/subscriptions` and `/admin/payments`: what Polar reported, copied
 * here. Polar stays the record; payments can be pulled again with Sync.
 */
import { Link } from '@tanstack/react-router';
import { CreditCard, Receipt, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Segmented } from '@/components/ui/segmented';
import { toast } from '@/components/ui/toast';
import {
	adminApi,
	pagedItems,
	statusTone,
	useAdminAction,
	usePayments,
	useSubscriptions,
} from '@/features/admin/admin';
import {
	cellClass,
	LoadMore,
	rowClass,
	Table,
	TableSkeleton,
} from '@/features/admin/components/parts';
import { formatDate, formatMoney } from '@/lib/format';

type SubscriptionFilter = 'all' | 'active' | 'ending' | 'ended';

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

export function AdminSubscriptionsPage() {
	const subscriptions = useSubscriptions();
	const [filter, setFilter] = useState<SubscriptionFilter>('active');
	const rows = useMemo(
		() =>
			(subscriptions.data?.subscriptions ?? []).filter((sub) => {
				if (filter === 'active') return ACTIVE.has(sub.status);
				if (filter === 'ended') return !ACTIVE.has(sub.status);
				return true;
			}),
		[subscriptions.data, filter],
	);
	return (
		<>
			<PageHeader
				title="Subscriptions"
				description="Kept in step with Polar by webhooks and a nightly check."
				actions={
					<Segmented
						label="Show"
						value={filter}
						onChange={setFilter}
						options={[
							{ value: 'active', label: 'Active' },
							{ value: 'ended', label: 'Ended' },
							{ value: 'all', label: 'All' },
						]}
					/>
				}
			/>
			<ErrorMessage error={subscriptions.error} className="mb-4" />
			{subscriptions.isPending ? (
				<TableSkeleton />
			) : rows.length ? (
				<Table
					label="Subscriptions"
					head={['Customer', 'Plan', 'Status', 'Price', 'Renews or ends', 'Polar id']}
				>
					{rows.map((sub) => (
						<tr key={sub.id} className={rowClass}>
							<td className={`${cellClass} max-w-[240px] truncate text-fg`}>
								{sub.email}
							</td>
							<td className={`${cellClass} text-muted`}>{sub.plan_slug ?? '—'}</td>
							<td className={cellClass}>
								<Badge tone={statusTone(sub.status)}>
									{sub.status.replace(/_/g, ' ')}
								</Badge>
							</td>
							<td className={`${cellClass} font-mono text-muted`}>
								{formatMoney(sub.amount_cents)}
								{sub.interval ? `/${sub.interval}` : ''}
							</td>
							<td className={`${cellClass} text-muted`}>
								{formatDate(sub.current_period_end)}
							</td>
							<td className={`${cellClass} font-mono text-xs text-meta`}>
								{sub.external_subscription_id}
							</td>
						</tr>
					))}
				</Table>
			) : (
				<EmptyState icon={CreditCard} title="No subscriptions here" />
			)}
		</>
	);
}

export function AdminPaymentsPage() {
	const payments = usePayments();
	const items = pagedItems(payments.data);
	const sync = useAdminAction(() => adminApi.post('/payments/sync'));
	return (
		<>
			<PageHeader
				title="Payments"
				description="Every charge Polar made, newest first. Earned is after tax, before Polar's fees."
				actions={
					<Button
						onClick={() =>
							sync.mutate(undefined, {
								onSuccess: () => toast.success('Payments copied from Polar.'),
							})
						}
						disabled={sync.isPending}
					>
						<RefreshCw className={sync.isPending ? 'animate-spin' : undefined} />
						Sync with Polar
					</Button>
				}
			/>
			<ErrorMessage error={sync.error ?? payments.error} className="mb-4" />
			{payments.isPending ? (
				<TableSkeleton />
			) : items.length ? (
				<>
					<Table
						label="Payments"
						head={[
							'Date',
							'Customer',
							'Plan',
							'Status',
							'Paid',
							'Tax',
							'Refunded',
							'Earned',
						]}
					>
						{items.map((payment) => {
							const money = (cents: number) => formatMoney(cents, payment.currency);
							const kept =
								payment.amount_cents > 0
									? payment.net_cents -
										Math.round(
											(payment.refunded_cents * payment.net_cents) /
												payment.amount_cents,
										)
									: 0;
							return (
								<tr key={payment.id} className={rowClass}>
									<td className={`${cellClass} text-muted`}>
										{formatDate(payment.created_at)}
									</td>
									<td className={`${cellClass} max-w-[220px] truncate`}>
										{payment.user_id ? (
											<Link
												to="/admin/users/$userId"
												params={{ userId: payment.user_id }}
												className="text-fg hover:underline"
											>
												{payment.email}
											</Link>
										) : (
											<span className="text-meta">Not linked</span>
										)}
									</td>
									<td className={`${cellClass} text-muted`}>
										{payment.plan_slug ?? '—'}
									</td>
									<td className={cellClass}>
										<Badge tone={statusTone(payment.status)}>
											{payment.status.replace(/_/g, ' ')}
										</Badge>
									</td>
									<td className={`${cellClass} font-mono text-muted`}>
										{money(payment.amount_cents)}
									</td>
									<td className={`${cellClass} font-mono text-meta`}>
										{money(payment.tax_cents)}
									</td>
									<td className={`${cellClass} font-mono text-meta`}>
										{payment.refunded_cents
											? money(payment.refunded_cents)
											: '—'}
									</td>
									<td className={`${cellClass} font-mono text-fg`}>
										{['paid', 'refunded', 'partially_refunded'].includes(
											payment.status,
										)
											? money(kept)
											: '—'}
									</td>
								</tr>
							);
						})}
					</Table>
					<LoadMore
						hasMore={payments.hasNextPage}
						loading={payments.isFetchingNextPage}
						onMore={() => void payments.fetchNextPage()}
					/>
				</>
			) : (
				<EmptyState
					icon={Receipt}
					title="No payments yet"
					description="They appear here when Polar sends an order, every half hour, or when you sync."
				/>
			)}
		</>
	);
}
