// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Token usage. Each computer counts its assistants' tokens from its own logs
 * and reports them per day, assistant and model under a `source_id` that
 * stays the same across logins. A report never adds to what is stored: a
 * row keeps the larger of its old and new total, so re-sending the same logs
 * (or logs that lost old files to cleanup) never inflates the account total.
 */
import { tokenUsage } from '@skillpouch/db';
import { gte, sql } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import type { DevicePrincipal, Principal } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';

export interface UsageCounts {
	input: number;
	output: number;
	cache_read: number;
	cache_write: number;
}

export interface UsageRow extends UsageCounts {
	day: string;
	assistant: string;
	model: string;
}

/** Days the usage chart can show: two years of whole weeks. */
export const USAGE_DAYS = 735;

const DAY_MS = 86_400_000;

function isoDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

const total = (row: UsageCounts) => row.input + row.output + row.cache_read + row.cache_write;

export async function reportUsage(
	deps: Deps,
	principal: DevicePrincipal,
	sourceId: string,
	rows: UsageRow[],
): Promise<{ stored: number }> {
	const tomorrow = isoDay(new Date(deps.now().getTime() + DAY_MS));
	const seen = new Set<string>();
	for (const row of rows) {
		if (row.day > tomorrow) throw new AppError('validation_failed', { field: 'day' });
		const key = `${row.day}\0${row.assistant}\0${row.model}`;
		if (seen.has(key))
			throw new AppError('validation_failed', { field: 'rows', duplicate: key });
		seen.add(key);
	}
	const reported = rows.filter((row) => total(row) > 0);
	if (reported.length === 0) return { stored: 0 };

	const now = deps.now();
	const stored = await withTenantTx(deps.db.app, principal.storageAccountId, async (tx) =>
		tx
			.insert(tokenUsage)
			.values(
				reported.map((row) => ({
					storageAccountId: principal.storageAccountId,
					sourceId,
					day: row.day,
					assistant: row.assistant,
					model: row.model,
					inputTokens: row.input,
					outputTokens: row.output,
					cacheReadTokens: row.cache_read,
					cacheWriteTokens: row.cache_write,
					deviceId: principal.deviceId,
					updatedAt: now,
				})),
			)
			.onConflictDoUpdate({
				target: [
					tokenUsage.storageAccountId,
					tokenUsage.sourceId,
					tokenUsage.day,
					tokenUsage.assistant,
					tokenUsage.model,
				],
				set: {
					inputTokens: sql`excluded.input_tokens`,
					outputTokens: sql`excluded.output_tokens`,
					cacheReadTokens: sql`excluded.cache_read_tokens`,
					cacheWriteTokens: sql`excluded.cache_write_tokens`,
					deviceId: sql`excluded.device_id`,
					updatedAt: sql`excluded.updated_at`,
				},
				setWhere: sql`excluded.input_tokens + excluded.output_tokens + excluded.cache_read_tokens + excluded.cache_write_tokens
					> ${tokenUsage.inputTokens} + ${tokenUsage.outputTokens} + ${tokenUsage.cacheReadTokens} + ${tokenUsage.cacheWriteTokens}`,
			})
			.returning({ day: tokenUsage.day }),
	);
	return { stored: stored.length };
}

export interface UsageSummary {
	/** Every computer's counts summed, per day, assistant and model. */
	days: UsageRow[];
	/** Since the first report, including days older than `days` covers. */
	all_time: UsageCounts;
	updated_at: string | null;
}

export async function usageSummary(deps: Deps, principal: Principal): Promise<UsageSummary> {
	const since = isoDay(new Date(deps.now().getTime() - (USAGE_DAYS - 1) * DAY_MS));
	return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
		const days = await tx
			.select({
				day: tokenUsage.day,
				assistant: tokenUsage.assistant,
				model: tokenUsage.model,
				input: sql<string>`sum(${tokenUsage.inputTokens})`,
				output: sql<string>`sum(${tokenUsage.outputTokens})`,
				cache_read: sql<string>`sum(${tokenUsage.cacheReadTokens})`,
				cache_write: sql<string>`sum(${tokenUsage.cacheWriteTokens})`,
			})
			.from(tokenUsage)
			.where(gte(tokenUsage.day, since))
			.groupBy(tokenUsage.day, tokenUsage.assistant, tokenUsage.model)
			.orderBy(tokenUsage.day, tokenUsage.assistant, tokenUsage.model);
		const [all] = await tx
			.select({
				input: sql<string | null>`sum(${tokenUsage.inputTokens})`,
				output: sql<string | null>`sum(${tokenUsage.outputTokens})`,
				cache_read: sql<string | null>`sum(${tokenUsage.cacheReadTokens})`,
				cache_write: sql<string | null>`sum(${tokenUsage.cacheWriteTokens})`,
				updated_at: sql<string | null>`max(${tokenUsage.updatedAt})::text`,
			})
			.from(tokenUsage);
		return {
			days: days.map((row) => ({ ...row, ...counts(row) })),
			all_time: counts(all ?? {}),
			updated_at: all?.updated_at ? new Date(all.updated_at).toISOString() : null,
		};
	});
}

/** Postgres returns `sum(bigint)` as a numeric string. */
function counts(row: {
	input?: string | null;
	output?: string | null;
	cache_read?: string | null;
	cache_write?: string | null;
}): UsageCounts {
	return {
		input: Number(row.input ?? 0),
		output: Number(row.output ?? 0),
		cache_read: Number(row.cache_read ?? 0),
		cache_write: Number(row.cache_write ?? 0),
	};
}
