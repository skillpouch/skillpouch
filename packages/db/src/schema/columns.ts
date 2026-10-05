// SPDX-License-Identifier: AGPL-3.0-only
import { bigint, customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** `bytea` mapped to Node `Buffer` (a `Uint8Array`). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => 'bytea',
	toDriver: (value) => Buffer.from(value),
	fromDriver: (value) => Buffer.from(value),
});

/** `timestamptz` as JS `Date`. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** `bigint` as JS number — every bigint we store stays far below 2^53. */
export const int8 = (name: string) => bigint(name, { mode: 'number' });

/** The tenant column every tenant table carries (03 §5.0). */
export const tenantColumn = () => uuid('storage_account_id').notNull();
