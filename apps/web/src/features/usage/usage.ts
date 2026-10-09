// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Token usage summed over every connected computer. The CLI reads each
 * assistant's own logs and sends one row per UTC day, assistant and model;
 * sending a day again replaces it, so nothing is counted twice.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

export interface TokenCounts {
	input: number;
	output: number;
	cache_read: number;
	cache_write: number;
}

export interface UsageRow extends TokenCounts {
	/** `YYYY-MM-DD`, UTC. */
	day: string;
	assistant: string;
	model: string;
}

export interface UsageSummary {
	days: UsageRow[];
	all_time: TokenCounts;
	updated_at: string | null;
}

export type Period = 'today' | 'week' | 'month';

export const PERIODS: { id: Period; label: string }[] = [
	{ id: 'today', label: 'Today' },
	{ id: 'week', label: 'This week' },
	{ id: 'month', label: 'This month' },
];

const DAY_MS = 86_400_000;

export function useUsage() {
	return useQuery({
		queryKey: queryKeys.usage,
		queryFn: () => api.get<UsageSummary>('/v1/usage'),
	});
}

export function totalOf(counts: TokenCounts): number {
	return counts.input + counts.output + counts.cache_read + counts.cache_write;
}

export function emptyCounts(): TokenCounts {
	return { input: 0, output: 0, cache_read: 0, cache_write: 0 };
}

/** Today in UTC, the day the server counts in. */
export function utcToday(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(day: string): number {
	return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The first day of `period`; weeks start on Monday. */
export function periodStart(period: Period, today: string): string {
	if (period === 'today') return today;
	if (period === 'week') return addDays(today, -weekdayOf(today));
	return `${today.slice(0, 8)}01`;
}

export function countsSince(rows: UsageRow[], from: string): TokenCounts {
	const sum = emptyCounts();
	for (const row of rows) {
		if (row.day < from) continue;
		sum.input += row.input;
		sum.output += row.output;
		sum.cache_read += row.cache_read;
		sum.cache_write += row.cache_write;
	}
	return sum;
}

export function perDay(rows: UsageRow[]): Map<string, number> {
	const days = new Map<string, number>();
	for (const row of rows) days.set(row.day, (days.get(row.day) ?? 0) + totalOf(row));
	return days;
}

/** Tokens since `from` per model or assistant, largest first. */
export function groupSince(
	rows: UsageRow[],
	from: string,
	by: 'model' | 'assistant',
): { key: string; total: number }[] {
	const groups = new Map<string, number>();
	for (const row of rows) {
		if (row.day < from) continue;
		groups.set(row[by], (groups.get(row[by]) ?? 0) + totalOf(row));
	}
	return [...groups]
		.filter(([, total]) => total > 0)
		.map(([key, total]) => ({ key, total }))
		.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export interface GridDay {
	day: string;
	total: number;
	/** 0 nothing, 1–4 by rank among the busy days shown. */
	level: number;
	future: boolean;
}

/**
 * `weeks` columns of seven days, Monday first, ending with this week, plus
 * where each month starts.
 */
export function usageGrid(
	rows: UsageRow[],
	today: string,
	weeks: number,
): { columns: GridDay[][]; months: { column: number; label: string }[] } {
	const start = addDays(periodStart('week', today), -(weeks - 1) * 7);
	const totals = perDay(rows);
	const days = Array.from({ length: weeks * 7 }, (_, index) => addDays(start, index));
	const values = days.map((day) => totals.get(day) ?? 0);
	const shade = levels(values);
	const columns = Array.from({ length: weeks }, (_, week) =>
		days.slice(week * 7, week * 7 + 7).map((day, row) => ({
			day,
			total: values[week * 7 + row] ?? 0,
			level: shade[week * 7 + row] ?? 0,
			future: day > today,
		})),
	);
	const starts = columns.flatMap((column, index) => {
		const first = column.find((cell) => cell.day.endsWith('-01'));
		return first ? [{ column: index, day: first.day }] : [];
	});
	const months = starts.map(({ column, day }) => ({ column, label: monthLabel(day) }));
	return { columns, months };
}

/** One week column: an 11px day plus the 3px gap. */
export const WEEK_PX = 14;
export const MIN_WEEKS = 12;
/** Two years: as far back as the server keeps days. */
export const MAX_WEEKS = 105;

/** How many week columns fill `width` pixels of grid. */
export function weeksToFit(width: number): number {
	const fit = Math.floor((width + 3) / WEEK_PX);
	return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, fit));
}

/**
 * How dark each day is: by rank among the busy days, so a few huge days
 * don't wash out the rest and the busiest day is always the darkest.
 */
export function levels(values: number[]): number[] {
	const busy = values.filter((value) => value > 0).sort((a, b) => a - b);
	return values.map((value) => {
		if (value === 0) return 0;
		const rank = busy.filter((other) => other <= value).length;
		return Math.ceil((rank * 4) / busy.length);
	});
}

/** `1234567` → `1.2M`. */
export function compactTokens(value: number): string {
	const units: [number, string][] = [
		[1e12, 'T'],
		[1e9, 'B'],
		[1e6, 'M'],
		[1e3, 'K'],
	];
	for (const [size, unit] of units) {
		if (value >= size) {
			const scaled = value / size;
			return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1)}${unit}`;
		}
	}
	return String(value);
}

export function monthLabel(day: string, withYear = false): string {
	return new Date(`${day}T00:00:00Z`).toLocaleString('en', {
		month: 'short',
		...(withYear ? { year: 'numeric' } : {}),
		timeZone: 'UTC',
	});
}

/** `Friday, October 9, 2026`. */
export function fullDateLabel(day: string): string {
	return new Date(`${day}T00:00:00Z`).toLocaleString('en', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	});
}

/** `Oct 9`. */
export function dayLabel(day: string): string {
	return new Date(`${day}T00:00:00Z`).toLocaleString('en', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});
}
