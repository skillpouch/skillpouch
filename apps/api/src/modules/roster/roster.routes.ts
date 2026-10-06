// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account roster, members and key envelopes (plan 15 §6–§7, 06 §3).
 */
import {
	GenesisRequest,
	KeyEnvelope,
	Member,
	RosterAppendRequest,
	RosterResponse,
	toBase64Url,
} from '@skillpouch/contracts';
import { keyEnvelopes, storageAccounts } from '@skillpouch/db';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { AppError } from '../../http/app-error';
import { memberOf, principalOf, sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { appendAudit } from '../../security/audit';
import { jwkThumbprint } from '../../security/dpop';
import { parseRosterStatement } from '../../security/e2ee-structure';
import { principalLabel } from '../../security/principal';
import { withTenantTx } from '../../security/tenant-tx';
import { assertPouchAllowance } from '../pouches/pouches.service';
import {
	appendStatements,
	assertEnvelopeCoverage,
	insertKeyEnvelopes,
	loadMembers,
	memberView,
	readRoster,
	rosterStatementView,
} from './roster.service';

const GENERIC_APPEND_ACTIONS = new Set([
	'add',
	'remove',
	'rotate_keys',
	'rename_pouch',
	'archive_pouch',
]);

export async function rosterRoutes(app: ZodApp, deps: Deps) {
	app.post(
		'/v1/account/roster/genesis',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['account'],
				summary:
					'Account genesis: roster #0 + first pouch + key envelopes (web onboarding only)',
				body: GenesisRequest,
				response: { 200: z.object({ genesis_hash: z.string(), pouch_id: z.string() }) },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			const [genesis, createPouch] = request.body.statements;
			const genesisBody = parseRosterStatement(genesis!.statement).body;
			if (
				genesisBody.action !== 'genesis' ||
				parseRosterStatement(createPouch!.statement).body.action !== 'create_pouch'
			) {
				throw new AppError('roster_invalid', {
					reason: 'expected [genesis, create_pouch]',
				});
			}
			// The browser doing genesis must be one of the members it creates.
			const browserKeys = await Promise.all(
				(genesisBody.members ?? [])
					.filter((member) => member.kind === 'browser')
					.map((member) => jwkThumbprint(member.sign_pub)),
			);
			if (!principal.jkt || !browserKeys.includes(principal.jkt)) {
				throw new AppError('roster_invalid', {
					reason: 'genesis must include this browser',
				});
			}

			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const [account] = await tx
					.select({ genesisHash: storageAccounts.genesisHash })
					.from(storageAccounts)
					.where(eq(storageAccounts.id, principal.storageAccountId))
					.for('update');
				if (account?.genesisHash) throw new AppError('roster_exists');

				const result = await appendStatements(tx, request.body.statements, {
					storageAccountId: principal.storageAccountId,
					allowedActions: new Set(['genesis', 'create_pouch']),
					beforeCreatePouch: (innerTx) =>
						assertPouchAllowance(innerTx, principal.storageAccountId),
				});
				await insertKeyEnvelopes(
					tx,
					principal.storageAccountId,
					request.body.key_envelopes,
				);
				await assertEnvelopeCoverage(tx);
				await appendAudit(tx, {
					storageAccountId: principal.storageAccountId,
					actor: principalLabel(principal),
					action: 'account.genesis',
				});
				return {
					genesis_hash: toBase64Url(result.statements[0]!.hash),
					pouch_id: result.createdPouchIds[0]!,
				};
			});
		},
	);

	app.get(
		'/v1/account/roster',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['account'],
				summary: 'Read signed roster statements after a sequence number',
				querystring: z.object({ after: z.coerce.number().int().min(-1).default(-1) }),
				response: { 200: RosterResponse },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const [account] = await tx
					.select()
					.from(storageAccounts)
					.where(eq(storageAccounts.id, principal.storageAccountId));
				const rows = await readRoster(tx, request.query.after);
				return {
					genesis_hash: account?.genesisHash ? toBase64Url(account.genesisHash) : null,
					head_seq: account?.genesisHash ? account.rosterSeq : -1,
					statements: rows.map(rosterStatementView),
				};
			});
		},
	);

	app.post(
		'/v1/account/roster',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['account'],
				summary:
					'Append signed roster statements (+ key envelopes) — add browser/recovery, remove, rotate keys, rename/archive pouch',
				body: RosterAppendRequest,
				response: { 200: z.object({ head_seq: z.number().int() }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const signer = memberOf(principal);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const result = await appendStatements(tx, request.body.statements, {
					storageAccountId: principal.storageAccountId,
					requiredSigner: signer,
					allowedActions: GENERIC_APPEND_ACTIONS,
				});
				await insertKeyEnvelopes(
					tx,
					principal.storageAccountId,
					request.body.key_envelopes,
				);
				await assertEnvelopeCoverage(tx);
				await appendAudit(tx, {
					storageAccountId: principal.storageAccountId,
					actor: principalLabel(principal),
					action: 'roster.append',
					details: {
						actions: result.statements.map((s) => s.body.action),
						head_seq: result.headSeq,
					},
				});
				return { head_seq: result.headSeq };
			});
		},
	);

	app.get(
		'/v1/account/members',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['account'],
				summary: 'All roster members (public keys, state)',
				response: { 200: z.object({ members: z.array(Member) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => ({
				members: [...(await loadMembers(tx)).values()].map(memberView),
			}));
		},
	);

	app.get(
		'/v1/account/key-envelopes',
		{
			config: { auth: 'any' },
			schema: {
				tags: ['account'],
				summary:
					'Key envelopes sealed to the calling member (all pouches, all generations)',
				response: { 200: z.object({ key_envelopes: z.array(KeyEnvelope) }) },
			},
		},
		async (request) => {
			const principal = principalOf(request);
			const memberId = memberOf(principal);
			return withTenantTx(deps.db.app, principal.storageAccountId, async (tx) => {
				const rows = await tx
					.select()
					.from(keyEnvelopes)
					.where(eq(keyEnvelopes.memberId, memberId))
					.orderBy(asc(keyEnvelopes.pouchId), asc(keyEnvelopes.keyGen));
				return {
					key_envelopes: rows.map((row) => ({
						pouch_id: row.pouchId,
						member_id: row.memberId,
						key_gen: row.keyGen,
						hpke_enc: toBase64Url(row.hpkeEnc),
						ciphertext: toBase64Url(row.ciphertext),
						created_by_member: row.createdByMember,
						signature: toBase64Url(row.signature),
						created_at: row.createdAt.toISOString(),
					})),
				};
			});
		},
	);
}
