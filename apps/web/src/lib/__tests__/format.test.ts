// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { safeRedirect } from '../auth';
import { createSseParser, type SseMessage } from '../api/sse';
import {
	formatBytes,
	formatCountdown,
	formatMoney,
	formatRelative,
	formatTimeLeft,
	plural,
} from '../format';

describe('format', () => {
	it('formats bytes with binary steps', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(-5)).toBe('0 B');
		expect(formatBytes(Number.NaN)).toBe('0 B');
		expect(formatBytes(90)).toBe('90 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB');
		expect(formatBytes(1024 ** 3)).toBe('1 GB');
	});

	it('formats relative times', () => {
		const now = Date.parse('2026-10-06T12:00:00Z');
		expect(formatRelative(null, now)).toBe('never');
		expect(formatRelative(new Date(now - 10_000), now)).toBe('just now');
		expect(formatRelative(new Date(now - 5 * 60_000), now)).toBe('5 min ago');
		expect(formatRelative(new Date(now - 26 * 3600_000), now)).toBe('yesterday');
		expect(formatRelative(new Date(now + 3 * 86400_000).toISOString(), now)).toBe('in 3 days');
	});

	it('formats money, plurals and countdowns', () => {
		expect(formatMoney(500)).toBe('$5.00');
		expect(plural(1, 'skill')).toBe('1 skill');
		expect(plural(3, 'pouch', 'pouches')).toBe('3 pouches');
		expect(formatCountdown(600_000)).toBe('10:00');
		expect(formatCountdown(61_001)).toBe('1:02');
		expect(formatCountdown(-5)).toBe('0:00');
	});
});

describe('safeRedirect', () => {
	it.each([
		[undefined, '/app'],
		['/app/account', '/app/account'],
		['https://evil.example', '/app'],
		['//evil.example', '/app'],
		['/\\evil.example', '/app'],
		['javascript:alert(1)', '/app'],
	])('%s → %s', (input, expected) => {
		expect(safeRedirect(input)).toBe(expected);
	});
});

describe('createSseParser', () => {
	it('parses events across chunk boundaries, CRLF, comments and multi-line data', () => {
		const messages: SseMessage[] = [];
		const feed = createSseParser((message) => messages.push(message));
		feed(': keepalive\n\nevent: acc');
		feed('ount\r\nid: 7\r\ndata: {"a":1}\r\n\r\n');
		feed('data: line1\ndata: line2\n\n');
		feed('event: empty\n\n');
		expect(messages).toEqual([
			{ event: 'account', data: '{"a":1}', id: '7' },
			{ event: 'message', data: 'line1\nline2', id: '7' },
		]);
	});
});

describe('formatTimeLeft', () => {
	const now = Date.parse('2026-10-09T00:00:00Z');
	const at = (minutes: number) => new Date(now + minutes * 60_000);
	it.each([
		[7 * 1440, '7 days'],
		[6 * 1440 + 3 * 60 + 59, '6 days 3 hours'],
		[1440 + 30, '1 day'],
		[5 * 60 + 20, '5 hours 20 min'],
		[60, '1 hour'],
		[12, '12 min'],
		[0, 'less than a minute'],
		[-30, 'less than a minute'],
	])('%i min → %s', (minutes, expected) => {
		expect(formatTimeLeft(at(minutes), now)).toBe(expected);
	});
});
