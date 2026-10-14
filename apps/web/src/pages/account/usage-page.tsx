// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/account/usage` — tokens your assistants used on every connected
 * computer: totals, a year of days and where this month's went.
 */
import { Activity } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { UsageSkeleton } from '@/components/ui/page-skeleton';
import { assistantLabel } from '@/features/devices/devices';
import { AssistantIcon } from '@/features/devices/components/assistant-badge';
import {
	PERIODS,
	compactTokens,
	countsSince,
	fullDateLabel,
	groupSince,
	periodStart,
	totalOf,
	monthLabel,
	usageGrid,
	useUsage,
	utcToday,
	weeksToFit,
	WEEK_PX,
	MIN_WEEKS,
	type UsageSummary,
} from '@/features/usage/usage';
import { cn } from '@/lib/cn';

const SHADES = ['bg-white/[0.06]', 'bg-[#3b2263]', 'bg-[#5b2ba8]', 'bg-[#8442d9]', 'bg-[#c4a1ff]'];
const ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export function UsagePage() {
	const usage = useUsage();
	return (
		<>
			<PageHeader
				title="Usage"
				description="Tokens your AI assistants used, on every computer you’ve connected."
			/>
			<ErrorMessage error={usage.error} />
			{usage.isPending ? (
				<UsageSkeleton />
			) : usage.data ? (
				<UsageReport summary={usage.data} />
			) : null}
		</>
	);
}

function UsageReport({ summary }: { summary: UsageSummary }) {
	const today = utcToday();
	if (summary.days.length === 0 && totalOf(summary.all_time) === 0) {
		return (
			<EmptyState
				icon={Activity}
				title="No token usage yet"
				description="Connected computers send what Claude Code, Codex and OpenCode used. Run skillpouch on a computer and it shows up here."
			/>
		);
	}
	const monthStart = periodStart('month', today);
	const month = countsSince(summary.days, monthStart);
	return (
		<div className="flex flex-col gap-4">
			<section aria-label="Totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				{PERIODS.map((period) => (
					<Total
						key={period.id}
						label={period.label}
						value={totalOf(countsSince(summary.days, periodStart(period.id, today)))}
					/>
				))}
				<Total label="All time" value={totalOf(summary.all_time)} />
			</section>
			<YearGrid summary={summary} today={today} />
			<div className="grid gap-4 md:grid-cols-2">
				<Breakdown
					title="This month by model"
					rows={groupSince(summary.days, monthStart, 'model').map(({ key, total }) => ({
						key,
						label: key,
						total,
					}))}
				/>
				<Breakdown
					title="This month by assistant"
					rows={groupSince(summary.days, monthStart, 'assistant').map(
						({ key, total }) => ({
							key,
							label: (
								<span className="flex items-center gap-2">
									<AssistantIcon id={key} className="size-3.5" />
									{assistantLabel(key)}
								</span>
							),
							total,
						}),
					)}
				/>
			</div>
			<p className="text-[13px] text-muted">
				This month: {compactTokens(month.input)} input · {compactTokens(month.output)}{' '}
				output · {compactTokens(month.cache_read)} cache read ·{' '}
				{compactTokens(month.cache_write)} cache write
			</p>
			<p className="text-xs text-meta">
				Counted from each assistant’s own logs, in UTC days. Every computer sends its totals
				per day and model, and sending a day again replaces it, so nothing is counted twice.
				Only the counts reach the server, never your prompts.
			</p>
		</div>
	);
}

function Total({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg border border-border p-4">
			<p className="text-xs text-meta">{label}</p>
			<p
				className="mt-1 text-2xl font-semibold tracking-tight tabular-nums"
				title={`${value.toLocaleString('en')} tokens`}
			>
				{compactTokens(value)}
			</p>
		</div>
	);
}

/** Width of the grid area, kept up to date as the page resizes. */
function useWidth() {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState<number | null>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () => setWidth(element.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return { ref, width };
}

function YearGrid({ summary, today }: { summary: UsageSummary; today: string }) {
	const { ref, width } = useWidth();
	const weeks = width === null ? MIN_WEEKS : weeksToFit(width);
	const { columns, months } = usageGrid(summary.days, today, weeks);
	const first = columns[0]?.[0]?.day ?? today;
	return (
		<section aria-label="Tokens per day" className="rounded-lg border border-border p-5">
			<div className="mb-4 flex items-center justify-between gap-4">
				<h2 className="text-sm font-medium">Since {monthLabel(first, true)}</h2>
				<Legend />
			</div>
			<div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
				<span />
				<div className="relative mb-1.5 h-4 overflow-hidden text-[11px] whitespace-nowrap text-meta">
					{months.map((month) => (
						<span
							key={month.column}
							className="absolute"
							style={{ left: `${month.column * WEEK_PX}px` }}
						>
							{month.label}
						</span>
					))}
				</div>
				<div className="grid grid-rows-7 gap-[3px] text-[11px] leading-[11px] text-meta">
					{ROW_LABELS.map((label, index) => (
						<span key={index}>{label}</span>
					))}
				</div>
				<div ref={ref} className="min-w-0">
					<div className="grid grid-flow-col grid-rows-7 justify-start gap-[3px]">
						{columns.flatMap((column) =>
							column.map((cell) =>
								cell.future ? (
									<span key={cell.day} className="size-[11px]" />
								) : (
									<span
										key={cell.day}
										data-level={cell.level}
										title={`${fullDateLabel(cell.day)}: ${
											cell.total === 0
												? 'no tokens'
												: `${compactTokens(cell.total)} tokens`
										}`}
										className={cn(
											'size-[11px] rounded-[2px]',
											SHADES[cell.level],
										)}
									/>
								),
							),
						)}
					</div>
				</div>
			</div>
		</section>
	);
}

function Legend() {
	return (
		<div className="flex items-center gap-1 text-[11px] text-meta" aria-hidden>
			<span className="mr-1">Less</span>
			{SHADES.map((shade) => (
				<span key={shade} className={cn('size-[11px] rounded-[2px]', shade)} />
			))}
			<span className="ml-1">More</span>
		</div>
	);
}

function Breakdown({
	title,
	rows,
}: {
	title: string;
	rows: { key: string; label: ReactNode; total: number }[];
}) {
	const max = rows[0]?.total ?? 0;
	return (
		<section aria-label={title} className="rounded-lg border border-border p-5">
			<h2 className="mb-4 text-sm font-medium">{title}</h2>
			{rows.length === 0 ? (
				<p className="text-[13px] text-meta">Nothing yet this month.</p>
			) : (
				<ul className="flex flex-col gap-3">
					{rows.slice(0, 8).map((row) => (
						<li key={row.key} className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between gap-4 text-[13px]">
								<span className="min-w-0 truncate">{row.label}</span>
								<span className="shrink-0 text-muted tabular-nums">
									{compactTokens(row.total)}
								</span>
							</div>
							<div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
								<div
									className="h-full rounded-full bg-accent"
									style={{
										width: `${max ? Math.max(2, (row.total / max) * 100) : 0}%`,
									}}
								/>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
