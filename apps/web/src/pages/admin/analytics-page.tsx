// SPDX-License-Identifier: AGPL-3.0-only
/** `/admin/analytics` — earnings, growth, computers, token usage and storage over a range. */
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorMessage } from '@/components/ui/error-message';
import { Progress } from '@/components/ui/progress';
import { Segmented } from '@/components/ui/segmented';
import {
	change,
	compact,
	dayLabel,
	RANGES,
	useAnalytics,
	type Analytics,
	type Range,
} from '@/features/admin/admin';
import { BarChart, Breakdown } from '@/features/admin/components/charts';
import { Figure, FigureGrid, Panel, TableSkeleton } from '@/features/admin/components/parts';
import { AssistantIcon } from '@/features/devices/components/assistant-badge';
import { assistantLabel, OS_LABEL } from '@/features/devices/devices';
import { formatBytes, formatDate, formatMoney } from '@/lib/format';

export function AdminAnalyticsPage() {
	const [days, setDays] = useState<Range>(30);
	const analytics = useAnalytics(days);
	const data = analytics.data;
	return (
		<>
			<PageHeader
				title="Analytics"
				description={`The last ${days} days, in UTC, against the ${days} days before.`}
				actions={
					<Segmented
						label="Range"
						value={String(days)}
						onChange={(value) => setDays(Number(value) as Range)}
						options={RANGES.map((range) => ({
							value: String(range),
							label: range === 365 ? '1 year' : `${range} days`,
						}))}
					/>
				}
			/>
			<ErrorMessage error={analytics.error} className="mb-4" />
			{data ? <Numbers data={data} /> : <TableSkeleton rows={12} />}
		</>
	);
}

function Numbers({ data }: { data: Analytics }) {
	const money = (cents: number) => formatMoney(cents, data.currency);
	const series = (pick: (day: Analytics['series'][number]) => number) =>
		data.series.map((day) => ({ label: dayLabel(day.day), value: pick(day) }));
	const activation = data.users.total ? data.users.with_devices / data.users.total : 0;
	return (
		<div className="flex flex-col gap-8">
			<section className="flex flex-col gap-4" aria-label="Money">
				<h2 className="text-sm font-medium text-muted">Money</h2>
				<FigureGrid>
					<Figure
						label="Earned"
						value={money(data.revenue.earned_cents)}
						ratio={change(
							data.revenue.earned_cents,
							data.revenue.previous_earned_cents,
						)}
						hint="after tax and refunds"
					/>
					<Figure
						label="Monthly recurring revenue"
						value={money(data.revenue.mrr_cents)}
					/>
					<Figure
						label="Payments"
						value={compact(data.revenue.payments)}
						hint={`${compact(data.revenue.paying_accounts)} paying accounts`}
					/>
					<Figure
						label="Refunded"
						value={money(data.revenue.refunded_cents)}
						hint={`${money(data.revenue.all_time_cents)} earned all time`}
					/>
				</FigureGrid>
				<Panel
					title="Earnings"
					aside={
						<span className="text-xs text-meta">
							{data.revenue.synced_at
								? `Payments copied ${formatDate(data.revenue.synced_at)}`
								: 'No payments copied yet'}
							{data.revenue.other_currencies.length
								? ` · ${data.revenue.other_currencies.join(', ').toUpperCase()} not included`
								: ''}
						</span>
					}
				>
					<BarChart
						label="Earnings per day"
						points={series((d) => d.earned_cents)}
						format={money}
					/>
				</Panel>
			</section>

			<section className="flex flex-col gap-4" aria-label="People">
				<h2 className="text-sm font-medium text-muted">People</h2>
				<FigureGrid>
					<Figure
						label="New users"
						value={compact(data.users.new)}
						ratio={change(data.users.new, data.users.previous_new)}
					/>
					<Figure label="All users" value={compact(data.users.total)} />
					<Figure
						label="Connected a computer"
						value={`${Math.round(activation * 100)}%`}
						hint={`${compact(data.users.with_devices)} users`}
					/>
					<Figure label="Suspended" value={compact(data.users.suspended)} />
				</FigureGrid>
				<div className="grid gap-6 lg:grid-cols-2">
					<Panel title="Sign-ups">
						<BarChart
							label="Sign-ups per day"
							points={series((d) => d.signups)}
							format={compact}
						/>
					</Panel>
					<Panel title="Computers connected">
						<BarChart
							label="Computers connected per day"
							points={series((d) => d.devices)}
							format={compact}
						/>
					</Panel>
				</div>
				<div className="grid gap-6 lg:grid-cols-2">
					<Panel title="Subscriptions">
						<Breakdown
							label="Subscriptions by status"
							rows={data.subscriptions.by_status.map((row) => ({
								key: row.name,
								name: row.name.replace(/_/g, ' '),
								value: row.count,
							}))}
							format={compact}
						/>
						{data.subscriptions.cancel_scheduled ? (
							<p className="text-xs text-meta">
								{data.subscriptions.cancel_scheduled} cancel at the end of their
								period.
							</p>
						) : null}
					</Panel>
					<Panel title="Plans">
						<Breakdown
							label="Accounts per plan"
							rows={data.plans.map((plan) => ({
								key: plan.slug,
								name: plan.name,
								value: plan.accounts,
							}))}
							format={compact}
						/>
					</Panel>
				</div>
			</section>

			<section className="flex flex-col gap-4" aria-label="Use">
				<h2 className="text-sm font-medium text-muted">Use</h2>
				<FigureGrid>
					<Figure
						label="Tokens"
						value={compact(data.tokens.total)}
						ratio={change(data.tokens.total, data.tokens.previous_total)}
					/>
					<Figure label="Computers seen, 7 days" value={compact(data.devices.seen_7d)} />
					<Figure
						label="Computers seen, 30 days"
						value={compact(data.devices.seen_30d)}
					/>
					<Figure label="Pouches" value={compact(data.storage.pouches)} />
				</FigureGrid>
				<Panel title="Tokens per day">
					<BarChart
						label="Tokens per day"
						points={series((d) => d.tokens)}
						format={compact}
					/>
				</Panel>
				<div className="grid gap-6 lg:grid-cols-2">
					<Panel title="Tokens by assistant">
						<Breakdown
							label="Tokens by assistant"
							rows={data.tokens.assistants.map((row) => ({
								key: row.name,
								name: (
									<span className="flex items-center gap-2">
										<AssistantIcon id={row.name} className="size-3.5" />
										{assistantLabel(row.name)}
									</span>
								),
								value: row.tokens,
							}))}
							format={compact}
						/>
					</Panel>
					<Panel title="Tokens by model">
						<Breakdown
							label="Tokens by model"
							rows={data.tokens.models.map((row) => ({
								key: row.name,
								name: <span className="font-mono">{row.name}</span>,
								value: row.tokens,
							}))}
							format={compact}
						/>
					</Panel>
					<Panel title="Operating systems">
						<Breakdown
							label="Connected computers by operating system"
							rows={data.devices.os.map((row) => ({
								key: row.name,
								name: OS_LABEL[row.name as keyof typeof OS_LABEL] ?? row.name,
								value: row.count,
							}))}
							format={compact}
						/>
					</Panel>
					<Panel title="CLI versions">
						<Breakdown
							label="Connected computers by CLI version"
							rows={data.devices.cli_versions.map((row) => ({
								key: row.name,
								name: <span className="font-mono">{row.name}</span>,
								value: row.count,
							}))}
							format={compact}
						/>
					</Panel>
				</div>
			</section>

			<section className="flex flex-col gap-4" aria-label="Storage">
				<h2 className="text-sm font-medium text-muted">Storage</h2>
				<div className="grid gap-6 lg:grid-cols-2">
					<Panel title="Used of every account's limit">
						<div className="flex items-baseline justify-between text-[13px]">
							<span className="font-mono text-fg">
								{formatBytes(data.storage.used_bytes)}
							</span>
							<span className="text-meta">
								of {formatBytes(data.storage.quota_bytes)}
							</span>
						</div>
						<Progress
							value={data.storage.used_bytes}
							max={data.storage.quota_bytes}
							label="Storage used of all limits"
						/>
					</Panel>
					<Panel title="Largest accounts">
						<Breakdown
							label="Largest accounts by storage"
							rows={data.storage.top_accounts.map((row) => ({
								key: row.user_id,
								name: (
									<Link
										to="/admin/users/$userId"
										params={{ userId: row.user_id }}
										className="hover:underline"
									>
										{row.email}
									</Link>
								),
								value: row.used_bytes,
							}))}
							format={formatBytes}
						/>
					</Panel>
				</div>
			</section>
		</div>
	);
}
