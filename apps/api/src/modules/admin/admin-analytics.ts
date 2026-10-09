// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The admin dashboard's numbers: earnings, growth, subscriptions, devices,
 * token usage and storage. Aggregates only, read through the `sp_admin`
 * pool; nothing here can see pouch names or content.
 */
import { payments, plans, storageAccounts, users } from '@skillpouch/db';
import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { decodeCursor, encodeCursor } from '../../http/cursor';
import { paginated } from '../../http/serialization';
import { addSeconds } from '../../lib/dates';
import { appendAudit } from '../../security/audit';
import { principalLabel, type SessionPrincipal } from '../../security/principal';
import { syncPaymentsFromProvider } from '../billing/payment-sync';
import { overview } from './admin.service';

/** Charges that brought money in (refunds are subtracted separately). */
const COUNTED = sql`status IN ('paid', 'refunded', 'partially_refunded')`;
/** What the business keeps of one charge: net of tax, less its refunded share. */
const EARNED = sql`CASE WHEN amount_cents > 0 THEN net_cents - (refunded_cents::numeric * net_cents / amount_cents) ELSE 0 END`;
const TOKENS = sql`(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)`;
const TOP = 8;

type Row = Record<string, unknown>;

/** `YYYY-MM-DD` of a UTC day. */
export function utcDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** The last `days` UTC days, oldest first, today last. */
export function dayRange(today: Date, days: number): string[] {
	const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
	return Array.from({ length: days }, (_, index) =>
		utcDay(new Date(start - (days - 1 - index) * 86_400_000)),
	);
}

const num = (value: unknown) => Number(value ?? 0) || 0;
const int = (value: unknown) => Math.round(num(value));

function counts(rows: Row[]): { name: string; count: number }[] {
	return rows.map((row) => ({ name: String(row.name ?? 'unknown'), count: int(row.n) }));
}

export async function analytics(deps: Deps, days: number) {
	const db = deps.db.admin;
	const rows = async (query: SQL) => (await db.execute(query)).rows as Row[];
	const now = deps.now();
	const range = dayRange(now, days);
	const from = range[0]!;
	const previousFrom = dayRange(addSeconds(now, -days * 86400), days)[0]!;
	const fromTime = new Date(`${from}T00:00:00Z`);
	const previousTime = new Date(`${previousFrom}T00:00:00Z`);

	// The currency most charges use; the others are listed, not summed.
	const currencies = await rows(
		sql`SELECT currency, count(*) AS n FROM payments WHERE ${COUNTED} GROUP BY currency ORDER BY n DESC, currency`,
	);
	const currency = String(currencies[0]?.currency ?? 'usd');
	const inCurrency = sql`${COUNTED} AND currency = ${currency}`;

	const [
		signups,
		newDevices,
		earnings,
		tokenDays,
		money,
		people,
		subStatus,
		planRows,
		deviceTotals,
		osRows,
		versionRows,
		assistantRows,
		modelRows,
		storage,
		topAccounts,
		headline,
	] = await Promise.all([
		rows(sql`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, count(*) AS n
			FROM users WHERE created_at >= ${fromTime} GROUP BY 1`),
		rows(sql`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, count(*) AS n
			FROM devices WHERE created_at >= ${fromTime} GROUP BY 1`),
		rows(sql`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
				sum(${EARNED}) AS earned, count(*) AS n
			FROM payments WHERE ${inCurrency} AND created_at >= ${fromTime} GROUP BY 1`),
		rows(sql`SELECT day::text AS day, sum(${TOKENS}) AS n
			FROM token_usage WHERE day >= ${from}::date GROUP BY 1`),
		rows(sql`SELECT
				COALESCE(sum(${EARNED}) FILTER (WHERE created_at >= ${fromTime}), 0) AS earned,
				COALESCE(sum(${EARNED}) FILTER (WHERE created_at >= ${previousTime} AND created_at < ${fromTime}), 0) AS previous,
				COALESCE(sum(${EARNED}), 0) AS all_time,
				COALESCE(sum(refunded_cents) FILTER (WHERE created_at >= ${fromTime}), 0) AS refunded,
				count(*) FILTER (WHERE created_at >= ${fromTime}) AS payments,
				count(DISTINCT storage_account_id) FILTER (WHERE created_at >= ${fromTime}) AS paying,
				max(updated_at) AS synced_at
			FROM payments WHERE ${inCurrency}`),
		rows(sql`SELECT count(*) AS total,
				count(*) FILTER (WHERE created_at >= ${fromTime}) AS new,
				count(*) FILTER (WHERE created_at >= ${previousTime} AND created_at < ${fromTime}) AS previous,
				count(*) FILTER (WHERE suspended_at IS NOT NULL) AS suspended,
				count(*) FILTER (WHERE EXISTS (
					SELECT 1 FROM storage_accounts a JOIN devices d ON d.storage_account_id = a.id
					WHERE a.owner_user_id = users.id)) AS with_devices
			FROM users`),
		rows(
			sql`SELECT status AS name, count(*) AS n FROM subscriptions GROUP BY status ORDER BY n DESC`,
		),
		rows(sql`SELECT COALESCE(entitlements->>'plan_slug', 'free') AS slug,
				COALESCE(max(entitlements->>'plan_name'), 'Free') AS name, count(*) AS n
			FROM storage_accounts GROUP BY 1 ORDER BY n DESC`),
		rows(sql`SELECT count(*) FILTER (WHERE state = 'active') AS active,
				count(*) FILTER (WHERE state = 'active' AND last_seen_at > ${addSeconds(now, -7 * 86400)}) AS seen_7d,
				count(*) FILTER (WHERE state = 'active' AND last_seen_at > ${addSeconds(now, -30 * 86400)}) AS seen_30d
			FROM devices`),
		rows(sql`SELECT os AS name, count(*) AS n FROM devices WHERE state = 'active'
			GROUP BY os ORDER BY n DESC`),
		rows(sql`SELECT cli_version AS name, count(*) AS n FROM devices WHERE state = 'active'
			GROUP BY cli_version ORDER BY n DESC, cli_version DESC LIMIT ${TOP}`),
		rows(sql`SELECT assistant AS name, sum(${TOKENS}) AS n FROM token_usage
			WHERE day >= ${from}::date GROUP BY 1 ORDER BY n DESC LIMIT ${TOP}`),
		rows(sql`SELECT model AS name, sum(${TOKENS}) AS n FROM token_usage
			WHERE day >= ${from}::date GROUP BY 1 ORDER BY n DESC LIMIT ${TOP}`),
		rows(sql`SELECT COALESCE(sum(used_bytes), 0) AS used, COALESCE(sum(quota_bytes), 0) AS quota,
				(SELECT count(*) FROM pouches WHERE state <> 'deleted') AS pouches
			FROM storage_accounts`),
		db
			.select({
				userId: users.id,
				email: users.email,
				usedBytes: storageAccounts.usedBytes,
			})
			.from(storageAccounts)
			.innerJoin(users, eq(users.id, storageAccounts.ownerUserId))
			.where(sql`${storageAccounts.usedBytes} > 0`)
			.orderBy(desc(storageAccounts.usedBytes))
			.limit(TOP),
		overview(deps),
	]);
	const [previousTokens] = await rows(sql`SELECT COALESCE(sum(${TOKENS}), 0) AS n
		FROM token_usage WHERE day >= ${previousFrom}::date AND day < ${from}::date`);
	const [cancelScheduled] = await rows(sql`SELECT count(*) AS n FROM subscriptions
		WHERE cancel_at_period_end AND status IN ('active', 'trialing')`);

	const byDay = (list: Row[], field = 'n') =>
		new Map(list.map((row) => [String(row.day), num(row[field])]));
	const signupsBy = byDay(signups);
	const devicesBy = byDay(newDevices);
	const earnedBy = byDay(earnings, 'earned');
	const paymentsBy = byDay(earnings);
	const tokensBy = byDay(tokenDays);
	const totals = money[0] ?? {};
	const people0 = people[0] ?? {};
	const devices0 = deviceTotals[0] ?? {};
	const storage0 = storage[0] ?? {};
	const allAssistants = await rows(sql`SELECT COALESCE(sum(${TOKENS}), 0) AS n
		FROM token_usage WHERE day >= ${from}::date`);

	return {
		days,
		currency,
		series: range.map((day) => ({
			day,
			signups: int(signupsBy.get(day)),
			devices: int(devicesBy.get(day)),
			earned_cents: int(earnedBy.get(day)),
			payments: int(paymentsBy.get(day)),
			tokens: num(tokensBy.get(day)),
		})),
		revenue: {
			mrr_cents: headline.mrr_cents,
			earned_cents: int(totals.earned),
			previous_earned_cents: int(totals.previous),
			all_time_cents: int(totals.all_time),
			refunded_cents: int(totals.refunded),
			payments: int(totals.payments),
			paying_accounts: int(totals.paying),
			other_currencies: currencies.slice(1).map((row) => String(row.currency)),
			synced_at: totals.synced_at ? new Date(String(totals.synced_at)).toISOString() : null,
		},
		users: {
			total: int(people0.total),
			new: int(people0.new),
			previous_new: int(people0.previous),
			with_devices: int(people0.with_devices),
			suspended: int(people0.suspended),
		},
		subscriptions: {
			by_status: counts(subStatus),
			cancel_scheduled: int(cancelScheduled?.n),
		},
		plans: planRows.map((row) => ({
			slug: String(row.slug),
			name: String(row.name),
			accounts: int(row.n),
		})),
		devices: {
			active: int(devices0.active),
			seen_7d: int(devices0.seen_7d),
			seen_30d: int(devices0.seen_30d),
			os: counts(osRows),
			cli_versions: counts(versionRows),
		},
		tokens: {
			total: num(allAssistants[0]?.n),
			previous_total: num(previousTokens?.n),
			assistants: assistantRows.map((row) => ({
				name: String(row.name),
				tokens: num(row.n),
			})),
			models: modelRows.map((row) => ({ name: String(row.name), tokens: num(row.n) })),
		},
		storage: {
			used_bytes: int(storage0.used),
			quota_bytes: int(storage0.quota),
			pouches: int(storage0.pouches),
			top_accounts: topAccounts.map((row) => ({
				user_id: row.userId,
				email: row.email,
				used_bytes: Number(row.usedBytes),
			})),
		},
	};
}

/** Charges, newest first. Cursor = `createdAt|id` of the last row. */
export async function listPayments(
	deps: Deps,
	query: { cursor?: string | undefined; limit: number },
) {
	const cursor = decodeCursor(query.cursor);
	let where: SQL | undefined;
	if (cursor) {
		const [created, id] = cursor.split('|');
		const at = new Date(created ?? '');
		if (Number.isNaN(at.getTime()) || !id)
			throw new AppError('validation_failed', { reason: 'cursor' });
		where = or(
			lt(payments.createdAt, at),
			and(eq(payments.createdAt, at), lt(payments.id, id)),
		);
	}
	const rows = await deps.db.admin
		.select({
			payment: payments,
			userId: users.id,
			email: users.email,
			slug: plans.slug,
		})
		.from(payments)
		.leftJoin(storageAccounts, eq(storageAccounts.id, payments.storageAccountId))
		.leftJoin(users, eq(users.id, storageAccounts.ownerUserId))
		.leftJoin(plans, eq(plans.id, payments.planId))
		.where(where)
		.orderBy(desc(payments.createdAt), desc(payments.id))
		.limit(query.limit + 1);
	const page = rows.slice(0, query.limit);
	const last = page.at(-1);
	return paginated(
		page.map(({ payment, userId, email, slug }) => ({
			id: payment.id,
			user_id: userId,
			email,
			plan_slug: slug,
			status: payment.status,
			currency: payment.currency,
			amount_cents: payment.amountCents,
			net_cents: payment.netCents,
			tax_cents: payment.taxCents,
			refunded_cents: payment.refundedCents,
			created_at: payment.createdAt.toISOString(),
		})),
		rows.length > query.limit && last
			? encodeCursor(`${last.payment.createdAt.toISOString()}|${last.payment.id}`)
			: null,
	);
}

/** Pulls charges from the billing provider now. */
export async function syncPayments(deps: Deps, admin: SessionPrincipal) {
	if (!deps.billing) throw new AppError('billing_unavailable');
	const synced = (await syncPaymentsFromProvider(deps)) ?? 0;
	await deps.db.admin.transaction((tx) =>
		appendAudit(tx, {
			storageAccountId: null,
			actor: principalLabel(admin),
			action: 'admin.payments_synced',
			target: null,
			details: { synced },
		}),
	);
	return { synced };
}

/** Looking at one person's account is recorded too. */
export async function recordUserViewed(deps: Deps, admin: SessionPrincipal, userId: string) {
	if (userId === admin.userId) return;
	await deps.db.admin.transaction((tx) =>
		appendAudit(tx, {
			storageAccountId: null,
			actor: principalLabel(admin),
			action: 'admin.user_viewed',
			target: userId,
			details: {},
		}),
	);
}
