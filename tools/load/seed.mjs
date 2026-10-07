// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Seeds N accounts straight into the sandbox database, each with one pouch and
 * one authorized CLI device (its key is a roster member, its refresh token is
 * known). Writes `accounts.ndjson` for the driver. The API itself is not used,
 * so seeding 100 000 accounts takes seconds, not hours of sign-ups.
 *
 *   node seed.mjs 100000            # SEED_DATABASE_URL to override
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import pg from 'pg';
import { Key, uuidv7 } from './lib.mjs';

const total = Number(process.argv[2] ?? 1000);
const url =
	process.env.SEED_DATABASE_URL ?? 'postgres://postgres:loadtest@127.0.0.1:55433/skillpouch';
const BATCH = 2000;
const ENTITLEMENTS = {
	plan_slug: 'free',
	plan_name: 'Free',
	source: 'default',
	pouch_limit: 1,
	storage_bytes: 104857600,
};

const client = new pg.Client({ connectionString: url });
await client.connect();
const out = createWriteStream(new URL('./accounts.ndjson', import.meta.url));
const started = Date.now();

for (let offset = 0; offset < total; offset += BATCH) {
	const rows = [];
	for (let index = offset; index < Math.min(total, offset + BATCH); index++) {
		const key = Key.generate();
		const enc = Key.generate();
		rows.push({
			index,
			userId: `load-${index}-${randomUUID().slice(0, 8)}`,
			accountId: randomUUID(),
			pouchId: uuidv7(),
			epoch: randomUUID(),
			deviceId: uuidv7(),
			memberId: uuidv7(),
			refreshSecret: randomBytes(32).toString('base64url'),
			key,
			enc,
		});
	}
	const col = (pick) => rows.map(pick);
	await client.query('BEGIN');
	await client.query(
		`INSERT INTO users (id, name, email, email_verified)
		 SELECT u, u, u || '@load.test', true FROM unnest($1::text[]) u`,
		[col((r) => r.userId)],
	);
	await client.query(
		`INSERT INTO storage_accounts (id, owner_user_id, entitlements, quota_bytes, genesis_hash, roster_seq)
		 SELECT a, u, $3::jsonb, 104857600, '\\x00', 1 FROM unnest($1::uuid[], $2::text[]) AS t(a, u)`,
		[col((r) => r.accountId), col((r) => r.userId), JSON.stringify(ENTITLEMENTS)],
	);
	await client.query(
		`INSERT INTO pouches (id, storage_account_id, created_seq, epoch)
		 SELECT p, a, 0, e FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS t(p, a, e)`,
		[col((r) => r.pouchId), col((r) => r.accountId), col((r) => r.epoch)],
	);
	await client.query(
		`INSERT INTO devices (id, storage_account_id, user_id, name, os, arch, cli_version, refresh_hash, refresh_family_id)
		 SELECT d, a, u, 'load-' || d, 'linux', 'x86_64', '0.1.0', h, gen_random_uuid()
		 FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::bytea[]) AS t(d, a, u, h)`,
		[
			col((r) => r.deviceId),
			col((r) => r.accountId),
			col((r) => r.userId),
			col((r) => createHash('sha256').update(r.refreshSecret).digest()),
		],
	);
	await client.query(
		`INSERT INTO device_keys (storage_account_id, device_id, jkt, public_jwk, key_storage)
		 SELECT a, d, j, k::jsonb, 'file' FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[]) AS t(a, d, j, k)`,
		[
			col((r) => r.accountId),
			col((r) => r.deviceId),
			col((r) => r.key.jkt),
			col((r) => JSON.stringify(r.key.jwk)),
		],
	);
	await client.query(
		`INSERT INTO account_members (id, storage_account_id, kind, device_id, sign_pub, enc_pub, key_storage, added_seq)
		 SELECT m, a, 'device', d, s::jsonb, e::jsonb, 'file', 1
		 FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[]) AS t(m, a, d, s, e)`,
		[
			col((r) => r.memberId),
			col((r) => r.accountId),
			col((r) => r.deviceId),
			col((r) => JSON.stringify(r.key.jwk)),
			col((r) => JSON.stringify(r.enc.jwk)),
		],
	);
	await client.query('COMMIT');
	for (const r of rows) {
		out.write(
			`${JSON.stringify({
				i: r.index,
				account: r.accountId,
				pouch: r.pouchId,
				epoch: r.epoch,
				device: r.deviceId,
				member: r.memberId,
				refresh: `spr1.${r.accountId}.${r.deviceId}.${r.refreshSecret}`,
				key: r.key.privateJwk,
			})}\n`,
		);
	}
	process.stdout.write(`\rseeded ${Math.min(total, offset + BATCH)}/${total}`);
}
await client.query('ANALYZE');
await new Promise((done) => out.end(done));
await client.end();
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)} s`);
