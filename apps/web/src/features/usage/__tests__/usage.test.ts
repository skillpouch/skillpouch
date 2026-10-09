// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
	compactTokens,
	countsSince,
	fullDateLabel,
	groupSince,
	levels,
	periodStart,
	totalOf,
	usageGrid,
	weeksToFit,
	MAX_WEEKS,
	MIN_WEEKS,
	utcToday,
	type UsageRow,
} from '../usage';

function row(day: string, assistant: string, model: string, total: number): UsageRow {
	const input = Math.floor(total / 2);
	return { day, assistant, model, input, output: total - input, cache_read: 0, cache_write: 0 };
}

// 2026-10-09 is a Friday.
const TODAY = '2026-10-09';
const ROWS = [
	row('2026-10-09', 'claude-code', 'claude-opus', 1_000),
	row('2026-10-09', 'codex', 'gpt-5', 500),
	row('2026-10-05', 'claude-code', 'claude-opus', 2_000),
	row('2026-10-01', 'opencode', 'claude-sonnet', 4_000),
	row('2026-09-30', 'claude-code', 'claude-opus', 8_000),
];

describe('token usage', () => {
	it('counts calendar periods in UTC, weeks from Monday', () => {
		expect(utcToday(new Date('2026-10-09T23:30:00-05:00'))).toBe('2026-10-10');
		expect(periodStart('week', TODAY)).toBe('2026-10-05');
		expect(periodStart('month', TODAY)).toBe('2026-10-01');
		expect(totalOf(countsSince(ROWS, periodStart('today', TODAY)))).toBe(1_500);
		expect(totalOf(countsSince(ROWS, periodStart('week', TODAY)))).toBe(3_500);
		expect(totalOf(countsSince(ROWS, periodStart('month', TODAY)))).toBe(7_500);
	});

	it('groups by model and assistant, largest first', () => {
		const from = periodStart('month', TODAY);
		expect(groupSince(ROWS, from, 'model')).toEqual([
			{ key: 'claude-sonnet', total: 4_000 },
			{ key: 'claude-opus', total: 3_000 },
			{ key: 'gpt-5', total: 500 },
		]);
		expect(groupSince(ROWS, from, 'assistant')[0]).toEqual({ key: 'opencode', total: 4_000 });
	});

	it('lays the year out in Monday-first weeks with month starts', () => {
		const { columns, months } = usageGrid(ROWS, TODAY, 3);
		expect(columns.map((column) => column[0]?.day)).toEqual([
			'2026-09-21',
			'2026-09-28',
			'2026-10-05',
		]);
		expect(months).toEqual([{ column: 1, label: 'Oct' }]);
		// Wed Sep 30 was the busiest day; the weekend after today is empty.
		expect(columns[1]?.[2]).toMatchObject({ day: '2026-09-30', total: 8_000, level: 4 });
		expect(columns[2]?.[5]).toMatchObject({ day: '2026-10-10', future: true });
	});

	it('labels months by name only; the full date is on each day', () => {
		const { months } = usageGrid([], '2026-02-10', 22);
		expect(months.map((month) => month.label)).toEqual(['Oct', 'Nov', 'Dec', 'Jan', 'Feb']);
		expect(fullDateLabel('2026-10-09')).toBe('Friday, October 9, 2026');
	});

	it('fits as many weeks as the width allows, within limits', () => {
		expect(weeksToFit(14 * 60 - 3)).toBe(60);
		expect(weeksToFit(100)).toBe(MIN_WEEKS);
		expect(weeksToFit(10_000)).toBe(MAX_WEEKS);
	});

	it('shades by rank so one huge day does not wash out the rest', () => {
		expect(levels([0, 1, 2, 3, 4, 1_000_000])).toEqual([0, 1, 2, 3, 4, 4]);
		expect(levels([0, 0])).toEqual([0, 0]);
		expect(levels([0, 7, 7])).toEqual([0, 4, 4]);
	});

	it('prints compact numbers', () => {
		expect(compactTokens(999)).toBe('999');
		expect(compactTokens(1_234)).toBe('1.2K');
		expect(compactTokens(250_000_000)).toBe('250M');
		expect(compactTokens(3_100_000_000)).toBe('3.1B');
	});
});
