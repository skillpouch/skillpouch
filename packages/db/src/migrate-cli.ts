// SPDX-License-Identifier: AGPL-3.0-only
/** `pnpm db:migrate` — applies migrations to MIGRATION_DATABASE_URL (owner role). */
import { migrate } from './migrate';

const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
	console.error('Set MIGRATION_DATABASE_URL (or DATABASE_URL).');
	process.exit(1);
}

const applied = await migrate({ connectionString, log: (message) => console.log(message) });
console.log(applied.length === 0 ? 'Schema is up to date.' : `Applied ${applied.length} file(s).`);
