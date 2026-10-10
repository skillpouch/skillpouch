// SPDX-License-Identifier: AGPL-3.0-only
/** The web app's byte and count formatting, for the pricing cards. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** `1536` → `1.5 KB`. Binary steps (plan limits are 100 MiB, 1 GiB) with the familiar labels. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const exponent = Math.min(Math.floor(Math.log2(bytes) / 10), UNITS.length - 1);
	const value = bytes / 1024 ** exponent;
	const digits = exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return `${Number(value.toFixed(digits))} ${UNITS[exponent]}`;
}

/** `3 skills`, `1 skill`. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}
