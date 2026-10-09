// SPDX-License-Identifier: AGPL-3.0-only
/** Display formatting shared by every page. Pure functions, no React. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** `1536` → `1.5 KB`. Binary steps (plan limits are 100 MiB, 1 GiB) with the familiar labels. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const exponent = Math.min(Math.floor(Math.log2(bytes) / 10), UNITS.length - 1);
	const value = bytes / 1024 ** exponent;
	const digits = exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return `${Number(value.toFixed(digits))} ${UNITS[exponent]}`;
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
	['second', 60],
	['minute', 60],
	['hour', 24],
	['day', 7],
	['week', 4.345],
	['month', 12],
	['year', Number.POSITIVE_INFINITY],
];

/** `2 min ago`, `yesterday`, `in 3 days`. */
export function formatRelative(date: Date | string | null | undefined, now = Date.now()): string {
	if (!date) return 'never';
	const value = typeof date === 'string' ? new Date(date) : date;
	let delta = (value.getTime() - now) / 1000;
	if (Math.abs(delta) < 45) return 'just now';
	for (const [unit, size] of STEPS) {
		if (Math.abs(delta) < size) {
			return RELATIVE.format(Math.round(delta), unit).replace('minutes', 'min');
		}
		delta /= size;
	}
	return value.toLocaleDateString();
}

const DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

/** `Oct 6, 2026`. */
export function formatDate(date: Date | string | null | undefined): string {
	if (!date) return '—';
	return DATE.format(typeof date === 'string' ? new Date(date) : date);
}

/** `$5.00` from integer cents. */
export function formatMoney(cents: number, currency = 'usd'): string {
	return new Intl.NumberFormat('en', {
		style: 'currency',
		currency: currency.toUpperCase(),
	}).format(cents / 100);
}

/** `3 skills`, `1 skill`. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** `00:09:41` style countdown → `9:41`. */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `6 days 3 hours`, `5 hours 20 min`, `12 min`: the two largest units left until `until`. */
export function formatTimeLeft(until: Date | string, now = Date.now()): string {
	const end = typeof until === 'string' ? new Date(until) : until;
	const minutes = Math.max(0, Math.floor((end.getTime() - now) / 60_000));
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	if (days > 0)
		return hours > 0 ? `${plural(days, 'day')} ${plural(hours, 'hour')}` : plural(days, 'day');
	const rest = minutes % 60;
	if (hours > 0) return rest > 0 ? `${plural(hours, 'hour')} ${rest} min` : plural(hours, 'hour');
	return minutes > 0 ? `${minutes} min` : 'less than a minute';
}
