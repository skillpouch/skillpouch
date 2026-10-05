// SPDX-License-Identifier: AGPL-3.0-only
/** RFC 3339 UTC strings for responses (17 §4). */
export function iso(date: Date): string;
export function iso(date: Date | null): string | null;
export function iso(date: Date | null): string | null {
	return date === null ? null : date.toISOString();
}

export function addSeconds(date: Date, seconds: number): Date {
	return new Date(date.getTime() + seconds * 1000);
}
