// SPDX-License-Identifier: AGPL-3.0-only
/** `/admin` — how SkillPouch is doing this month: money, people, use. */
import { Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { ErrorMessage } from '@/components/ui/error-message';
import {
	change,
	compact,
	dayLabel,
	pagedItems,
	statusTone,
	useAdminUsers,
	useAnalytics,
	usePayments,
} from '@/features/admin/admin';
import { BarChart, Breakdown } from '@/features/admin/components/charts';
import {
	cellClass,
	Figure,
	FigureGrid,
	Panel,
	rowClass,
	Table,
	TableSkeleton,
} from '@/features/admin/components/parts';
import { formatMoney, formatRelative } from '@/lib/format';

export function AdminOverviewPage() {
	const analytics = useAnalytics(30);
	const data = analytics.data;
	const money = (cents: number) => formatMoney(cents, data?.currency);
	const loading = !data;
	return (
		<>
			<PageHeader title="Overview" description="The last 30 days, in UTC." />
			<ErrorMessage error={analytics.error} className="mb-4" />
			<div className="flex flex-col gap-6">
				<FigureGrid>
					<Figure
						label="Monthly recurring revenue"
						value={data ? money(data.revenue.mrr_cents) : null}
						hint={
							data
								? `${data.subscriptions.by_status.find((s) => s.name === 'active')?.count ?? 0} active subscriptions`
								: null
						}
						loading={loading}
					/>
					<Figure
						label="Earned, 30 days"
						value={data ? money(data.revenue.earned_cents) : null}
						ratio={
							data
								? change(
										data.revenue.earned_cents,
										data.revenue.previous_earned_cents,
									)
								: undefined
						}
						hint="vs. the 30 days before"
						loading={loading}
					/>
					<Figure
						label="New users"
						value={data ? compact(data.users.new) : null}
						ratio={data ? change(data.users.new, data.users.previous_new) : undefined}
						hint={data ? `${compact(data.users.total)} in total` : null}
						loading={loading}
					/>
					<Figure
						label="Computers seen, 30 days"
						value={data ? compact(data.devices.seen_30d) : null}
						hint={data ? `${compact(data.devices.active)} connected` : null}
						loading={loading}
					/>
				</FigureGrid>

				<div className="grid gap-6 lg:grid-cols-2">
					<Panel title="Earnings per day">
						{data ? (
							<BarChart
								label="Earnings per day"
								points={data.series.map((day) => ({
									label: dayLabel(day.day),
									value: day.earned_cents,
								}))}
								format={money}
							/>
						) : (
							<TableSkeleton rows={4} />
						)}
					</Panel>
					<Panel title="Sign-ups per day">
						{data ? (
							<BarChart
								label="Sign-ups per day"
								points={data.series.map((day) => ({
									label: dayLabel(day.day),
									value: day.signups,
								}))}
								format={(value) => compact(value)}
							/>
						) : (
							<TableSkeleton rows={4} />
						)}
					</Panel>
				</div>

				<div className="grid gap-6 lg:grid-cols-3">
					<Panel title="Plans">
						{data ? (
							<Breakdown
								label="Accounts per plan"
								rows={data.plans.map((plan) => ({
									key: plan.slug,
									name: plan.name,
									value: plan.accounts,
								}))}
								format={compact}
							/>
						) : (
							<TableSkeleton rows={3} />
						)}
					</Panel>
					<RecentPayments currency={data?.currency} />
					<NewestUsers />
				</div>
			</div>
		</>
	);
}

function RecentPayments({ currency }: { currency: string | undefined }) {
	const payments = usePayments();
	const items = pagedItems(payments.data).slice(0, 6);
	return (
		<Panel
			title="Latest payments"
			aside={
				<Link to="/admin/payments" className="text-xs text-muted hover:text-fg">
					All payments
				</Link>
			}
		>
			{payments.isPending ? (
				<TableSkeleton rows={4} />
			) : items.length ? (
				<ul className="flex flex-col gap-2 text-[13px]">
					{items.map((payment) => (
						<li key={payment.id} className="flex items-center justify-between gap-3">
							<span className="min-w-0 truncate text-muted">
								{payment.email ?? 'Unknown customer'}
							</span>
							<span className="flex shrink-0 items-center gap-2">
								{payment.status === 'paid' ? null : (
									<Badge tone={statusTone(payment.status)}>
										{payment.status}
									</Badge>
								)}
								<span className="font-mono text-fg">
									{formatMoney(payment.net_cents, payment.currency ?? currency)}
								</span>
							</span>
						</li>
					))}
				</ul>
			) : (
				<p className="py-6 text-center text-[13px] text-meta">No payments yet.</p>
			)}
		</Panel>
	);
}

function NewestUsers() {
	const users = useAdminUsers('');
	const items = pagedItems(users.data).slice(0, 6);
	return (
		<Panel
			title="Newest users"
			aside={
				<Link to="/admin/users" className="text-xs text-muted hover:text-fg">
					All users
				</Link>
			}
		>
			{users.isPending ? (
				<TableSkeleton rows={4} />
			) : (
				<Table label="Newest users" head={['User', 'Plan', 'Joined']} wide={false}>
					{items.map((user) => (
						<tr key={user.id} className={rowClass}>
							<td className={`${cellClass} max-w-[160px] truncate`}>
								<Link
									to="/admin/users/$userId"
									params={{ userId: user.id }}
									className="text-fg hover:underline"
								>
									{user.email}
								</Link>
							</td>
							<td className={`${cellClass} text-muted`}>
								{user.entitlements?.plan_name ?? '—'}
							</td>
							<td className={`${cellClass} text-muted`}>
								{formatRelative(user.created_at)}
							</td>
						</tr>
					))}
				</Table>
			)}
		</Panel>
	);
}
