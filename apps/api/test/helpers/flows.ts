// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Multi-step flows reused by many tests: web onboarding (account genesis)
 * and "Authorize CLI" login — the same sequences the real clients run.
 */
import { createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from '../../src/lib/ids';
import { cliConfirmCode } from '../../src/modules/cli-auth/cli-auth.service';
import type { BrowserClient } from './clients';
import { CliClient, signIn } from './clients';
import {
	envelopesFor,
	memberJson,
	newMember,
	rosterHead,
	statement,
	type MemberHandle,
} from './e2ee';
import type { Harness } from './harness';
import { TestKey } from './keys';

export interface Account {
	browser: BrowserClient;
	accountId: string;
	pouchId: string;
	browserMember: MemberHandle;
	passwordMember: MemberHandle;
	recoveryMember: MemberHandle;
	/** Every active member that must receive key envelopes. */
	members: MemberHandle[];
}

export async function accountIdOf(harness: Harness, userId: string): Promise<string> {
	const { rows } = await harness.owner.query(
		'SELECT id FROM storage_accounts WHERE owner_user_id = $1',
		[userId],
	);
	return rows[0].id as string;
}

/** Sign in on the web and run onboarding genesis. */
export async function setupAccount(harness: Harness, email: string): Promise<Account> {
	const browser = await signIn(harness, email);
	const accountId = await accountIdOf(harness, browser.userId);
	const prepared = await browser.post('/v1/account/unlock/prepare');
	if (prepared.status !== 200)
		throw new Error(`prepare failed: ${JSON.stringify(prepared.body)}`);
	const browserMember = await newMember('browser', browser.key);
	const passwordMember = await newMember('password');
	const recoveryMember = await newMember('recovery');
	const pouchId = uuidv7();
	const head = { seq: -1, hash: null };
	const genesis = await statement(browserMember, accountId, head, {
		action: 'genesis',
		members: [
			memberJson(browserMember),
			memberJson(passwordMember),
			memberJson(recoveryMember),
		],
	});
	const createPouch = await statement(browserMember, accountId, head, {
		action: 'create_pouch',
		pouch: { id: pouchId, name_enc: 'bmFtZQ' },
	});
	const response = await browser.post('/v1/account/roster/genesis', {
		statements: [genesis, createPouch],
		key_envelopes: envelopesFor(
			pouchId,
			[browserMember, passwordMember, recoveryMember],
			1,
			browserMember.id,
		),
	});
	if (response.status !== 200)
		throw new Error(`genesis failed: ${JSON.stringify(response.body)}`);
	browser.memberId = browserMember.id;
	return {
		browser,
		accountId,
		pouchId,
		browserMember,
		passwordMember,
		recoveryMember,
		members: [browserMember, passwordMember, recoveryMember],
	};
}

/** `skillpouch login` → browser clicks Authorize → CLI redeems tokens. */
export async function authorizeCli(
	harness: Harness,
	account: Account,
	name = 'laptop',
	options: { connectToken?: string } = {},
): Promise<CliClient> {
	const cli = new CliClient(harness, await TestKey.generate(), await TestKey.generate());
	const verifier = randomBytes(32).toString('base64url');
	const created = await cli.post('/v1/cli-auth/requests', {
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		device_name: name,
		os: 'linux',
		arch: 'x64',
		cli_version: '0.1.0',
		sign_pub: cli.key.jwk,
		enc_pub: cli.encKey.jwk,
		key_storage: 'file',
		...(options.connectToken ? { connect_token: options.connectToken } : {}),
	});
	if (created.status !== 200)
		throw new Error(`cli-auth request failed: ${JSON.stringify(created.body)}`);
	const requestId = created.body.data.request_id as string;

	const deviceMember: MemberHandle = {
		id: uuidv7(),
		kind: 'device',
		key: cli.key,
		enc: cli.encKey,
	};
	const head = await rosterHead(account.browser);
	const add = await statement(account.browserMember, account.accountId, head, {
		action: 'add',
		member: memberJson(deviceMember),
	});
	const pouches = (await account.browser.get('/v1/pouches')).body.data.pouches as {
		id: string;
		key_gen: number;
		state: string;
	}[];
	const envelopes = pouches
		.filter((pouch) => pouch.state !== 'deleted')
		.flatMap((pouch) =>
			envelopesFor(pouch.id, [deviceMember], pouch.key_gen, account.browserMember.id),
		);
	// The user types the code their terminal printed (link logins only).
	const view = (await account.browser.get(`/v1/cli-auth/requests/${requestId}`)).body.data;
	const approved = await account.browser.post(`/v1/cli-auth/requests/${requestId}/approve`, {
		statement: add,
		welcome: Buffer.from('sealed-welcome').toString('base64url'),
		key_envelopes: envelopes,
		...(options.connectToken
			? {}
			: {
					confirm_code: cliConfirmCode({
						id: requestId,
						signPub: view.sign_pub,
						encPub: view.enc_pub,
						jkt: view.jkt,
					}),
				}),
	});
	if (approved.status !== 200)
		throw new Error(`approve failed: ${JSON.stringify(approved.body)}`);

	const token = await cli.post('/v1/cli-auth/token', {
		request_id: requestId,
		code_verifier: verifier,
	});
	if (token.status !== 200 || token.body.data.status !== 'approved') {
		throw new Error(`token failed: ${JSON.stringify(token.body)}`);
	}
	cli.accessTokenValue = token.body.data.access_token;
	cli.refreshToken = token.body.data.refresh_token;
	cli.deviceId = token.body.data.device_id;
	cli.storageAccountId = token.body.data.storage_account_id;
	if (token.body.data.member_id !== deviceMember.id) {
		throw new Error(`token names member ${token.body.data.member_id}, not ${deviceMember.id}`);
	}
	cli.memberId = deviceMember.id;
	account.members.push(deviceMember);
	return cli;
}

/** Creates another pouch from the web (signed `create_pouch` + envelopes for every member). */
export async function createPouch(account: Account) {
	const pouchId = uuidv7();
	const head = await rosterHead(account.browser);
	const created = await statement(account.browserMember, account.accountId, head, {
		action: 'create_pouch',
		pouch: { id: pouchId, name_enc: 'bmFtZQ' },
	});
	return account.browser.post('/v1/pouches', {
		statement: created,
		key_envelopes: envelopesFor(pouchId, account.members, 1, account.browserMember.id),
	});
}

export function newId(): string {
	return uuidv7();
}
