// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tenant-scoped transactions (plan 08 §4.1–4.2). The only way to query tenant
 * tables: `withTenantTx` opens a transaction and sets the transaction-local
 * `app.sa_id`, which every RLS policy checks. `TenantTx` is a branded type so
 * repository functions cannot be called with a plain connection.
 */
import type { Database } from '@skillpouch/db';
import { sql } from 'drizzle-orm';

declare const tenantBrand: unique symbol;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type TenantTx = Transaction & { readonly [tenantBrand]: string };

export interface TenantTxOptions {
	isolationLevel?: 'read committed' | 'repeatable read' | 'serializable';
	/** Retries on deadlock / serialization failure (06 §4). */
	retries?: number;
}

const RETRYABLE_SQLSTATES = new Set(['40P01', '40001']);

export async function withTenantTx<T>(
	db: Database,
	storageAccountId: string,
	fn: (tx: TenantTx) => Promise<T>,
	options: TenantTxOptions = {},
): Promise<T> {
	const retries = options.retries ?? 0;
	for (let attempt = 0; ; attempt++) {
		try {
			return await db.transaction(
				async (tx) => {
					await tx.execute(
						sql`SELECT set_config('app.sa_id', ${storageAccountId}, true)`,
					);
					return fn(tx as TenantTx);
				},
				options.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined,
			);
		} catch (error) {
			const code =
				(error as { code?: string; cause?: { code?: string } }).code ??
				(error as { cause?: { code?: string } }).cause?.code;
			if (attempt >= retries || !code || !RETRYABLE_SQLSTATES.has(code)) throw error;
			await new Promise((resolve) =>
				setTimeout(resolve, 10 + Math.random() * 40 * (attempt + 1)),
			);
		}
	}
}
