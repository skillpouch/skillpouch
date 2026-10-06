// SPDX-License-Identifier: AGPL-3.0-only
/** Helpers for the fixed-SQL maintenance jobs. */

/** Rows of a `db.execute(sql…)` result, typed by the caller. */
export function rows<T>(result: { rows: unknown[] }): T[] {
	return result.rows as T[];
}
