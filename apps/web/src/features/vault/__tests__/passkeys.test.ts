// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Passkey unlock with a mocked `navigator.credentials`: real crypto (genesis,
 * passkey members, key envelopes), fake authenticators that do or don't
 * evaluate PRF, and users who close the prompt.
 */
import {
	CryptoError,
	b64,
	buildAddMember,
	buildGenesis,
	generateMemberKeyPair,
	memberEntry,
	newMemberSalt,
	passkeyMemberKeys,
	pouchKeys,
	prfInput,
	randomBytes,
	unb64,
	type Keyring,
} from '@skillpouch/crypto';
import type { KeyEnvelopeInput } from '@skillpouch/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { setSession } from '../../session/session-store';
import type { StoredBrowserKey } from '../key-store';
import {
	PasskeyError,
	addPasskey,
	detectPrfSupport,
	openWithPasskey,
	toCreationOptions,
	type CreationOptionsJson,
} from '../passkeys';
import { loadVerifiedRoster } from '../roster';

vi.mock('@/lib/api/client', () => ({
	api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../roster', () => ({ loadVerifiedRoster: vi.fn() }));
vi.mock('../keyring', () => ({
	reloadKeyring: vi.fn(async () => null),
	withRosterChange: <T>(run: () => Promise<T>) => run(),
}));

const post = vi.mocked(api.post);
const get = vi.mocked(api.get);
const create = vi.fn();
const assertWith = vi.fn();

const buf = (bytes: Uint8Array) => bytes.slice().buffer;
const decode = (b64url: string) => JSON.parse(new TextDecoder().decode(unb64(b64url)));

/** What `navigator.credentials.create/get` resolve to, PRF results included. */
function credential(
	kind: 'create' | 'get',
	{
		id = randomBytes(16),
		prf,
		enabled,
	}: { id?: Uint8Array; prf?: Uint8Array; enabled?: boolean } = {},
) {
	const data = buf(randomBytes(37));
	return {
		id: b64(id),
		rawId: buf(id),
		type: 'public-key',
		authenticatorAttachment: 'platform',
		response:
			kind === 'create'
				? {
						clientDataJSON: data,
						attestationObject: data,
						getTransports: () => ['internal'],
					}
				: {
						clientDataJSON: data,
						authenticatorData: data,
						signature: data,
						userHandle: null,
					},
		getClientExtensionResults: () => ({
			prf: {
				...(enabled === undefined ? {} : { enabled }),
				...(prf ? { results: { first: buf(prf) } } : {}),
			},
		}),
	};
}

const creationOptions = (): CreationOptionsJson => ({
	challenge: b64(randomBytes(32)),
	rp: { id: 'localhost', name: 'SkillPouch' },
	user: { id: b64(randomBytes(16)), name: 'ada@example.com', displayName: 'ada@example.com' },
	pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
	excludeCredentials: [{ id: b64(randomBytes(16)), transports: ['usb'] }],
	authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
	extensions: { credProps: true, prf: {} },
});

async function unlockedAccount() {
	const accountId = crypto.randomUUID();
	const pouchId = crypto.randomUUID();
	const genesis = await buildGenesis({
		accountId,
		browserMemberId: crypto.randomUUID(),
		browserKeys: await generateMemberKeyPair(),
		passwordSecret: randomBytes(64),
		passwordMemberId: crypto.randomUUID(),
		recoveryEntropy: randomBytes(16),
		recoveryMemberId: crypto.randomUUID(),
		pouchId,
		pouch: { name: 'Personal', description: '' },
	});
	setSession({
		status: 'unlocked',
		me: {} as never,
		browser: {} as never,
		keyring: genesis.keyring,
	});
	return {
		accountId,
		pouchId,
		keyring: genesis.keyring,
		envelopes: genesis.request.key_envelopes,
	};
}

/** A `PublicKeyCredential` global with (or without) `getClientCapabilities`. */
function stubCredentialApi(capabilities?: Record<string, boolean>) {
	vi.stubGlobal(
		'PublicKeyCredential',
		Object.assign(
			function PublicKeyCredential() {},
			capabilities ? { getClientCapabilities: async () => capabilities } : {},
		),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	Object.defineProperty(navigator, 'credentials', {
		configurable: true,
		value: { create, get: assertWith },
	});
	stubCredentialApi({ 'extension:prf': true });
});

afterEach(() => {
	vi.unstubAllGlobals();
	setSession({ status: 'loading' });
});

describe('detectPrfSupport', () => {
	it('reads getClientCapabilities where the browser has it', async () => {
		expect(await detectPrfSupport()).toBe('supported');
		stubCredentialApi({ 'extension:prf': false });
		expect(await detectPrfSupport()).toBe('unsupported');
		stubCredentialApi({});
		expect(await detectPrfSupport()).toBe('unknown');
	});

	it('is unknown without the capability API and unsupported without WebAuthn', async () => {
		stubCredentialApi();
		expect(await detectPrfSupport()).toBe('unknown');
		vi.stubGlobal('PublicKeyCredential', undefined);
		expect(await detectPrfSupport()).toBe('unsupported');
	});
});

describe('WebAuthn options', () => {
	it('decodes the server’s JSON and asks for PRF with our input', () => {
		const json = creationOptions();
		const salt = newMemberSalt();
		const options = toCreationOptions(json, { eval: { first: buf(prfInput(salt)) } });
		expect(new Uint8Array(options.challenge as ArrayBuffer)).toEqual(unb64(json.challenge));
		expect(new Uint8Array(options.user.id as ArrayBuffer)).toEqual(unb64(json.user.id));
		expect(new Uint8Array(options.excludeCredentials![0]!.id as ArrayBuffer)).toEqual(
			unb64(json.excludeCredentials![0]!.id),
		);
		const extensions = options.extensions as {
			credProps: boolean;
			prf: { eval: { first: ArrayBuffer } };
		};
		expect(extensions.credProps).toBe(true);
		expect(new Uint8Array(extensions.prf.eval.first)).toEqual(prfInput(salt));
	});
});

describe('addPasskey', () => {
	function answer(options = creationOptions()) {
		post.mockImplementation(async (path: string) => {
			if (path === '/v1/account/passkeys/options') return { options } as never;
			if (path === '/v1/account/passkeys') return { id: 'p1' } as never;
			throw new Error(`unexpected POST ${path}`);
		});
		return options;
	}

	const registered = () =>
		post.mock.calls.find(([path]) => path === '/v1/account/passkeys')?.[1] as
			| {
					response: { clientExtensionResults: unknown };
					label: string;
					statement: { statement: string };
					key_envelopes: KeyEnvelopeInput[];
			  }
			| undefined;

	it('adds a passkey member derived from the PRF output — which never leaves the page', async () => {
		const { keyring } = await unlockedAccount();
		answer();
		const prf = randomBytes(32);
		create.mockResolvedValue(credential('create', { prf, enabled: true }));

		await addPasskey('MacBook');

		const publicKey = create.mock.calls[0]![0].publicKey;
		const input = new Uint8Array(publicKey.extensions.prf.eval.first);
		expect(new TextDecoder().decode(input.subarray(0, 17))).toBe('skillpouch/v1/prf');
		expect(input).toHaveLength(17 + 16);
		expect(assertWith).not.toHaveBeenCalled();

		const body = registered()!;
		expect(body.label).toBe('MacBook');
		expect(body.response.clientExtensionResults).toEqual({});
		expect(JSON.stringify(body)).not.toContain(b64(prf));
		const statement = decode(body.statement.statement);
		expect(statement).toMatchObject({ action: 'add', member: { kind: 'passkey' } });
		// The salt the browser fed PRF is the one in the signed roster entry.
		expect(prfInput(unb64(statement.member.member_salt))).toEqual(input);
		const keys = await passkeyMemberKeys(prf, unb64(statement.member.member_salt));
		expect(statement.member.sign_pub).toEqual(keys.signPub);
		expect(body.key_envelopes.length).toBeGreaterThan(0);
		expect(body.key_envelopes.every((e) => e.member_id === statement.member.id)).toBe(true);
		expect(keyring.roster.members.get(statement.member.id)?.kind).toBe('passkey');
	});

	it('asks once more when the authenticator only reports prf.enabled while registering', async () => {
		await unlockedAccount();
		answer();
		const prf = randomBytes(32);
		const made = credential('create', { enabled: true });
		create.mockResolvedValue(made);
		assertWith.mockResolvedValue(credential('get', { prf }));

		await addPasskey('Phone');

		const publicKey = assertWith.mock.calls[0]![0].publicKey;
		expect(new Uint8Array(publicKey.allowCredentials[0].id)).toEqual(
			new Uint8Array(made.rawId),
		);
		expect(new Uint8Array(publicKey.extensions.prf.eval.first)).toEqual(
			new Uint8Array(create.mock.calls[0]![0].publicKey.extensions.prf.eval.first),
		);
		expect(registered()).toBeDefined();
		expect(JSON.stringify(registered())).not.toContain(b64(prf));
	});

	it('explains and saves nothing when the authenticator has no PRF', async () => {
		await unlockedAccount();
		answer();
		create.mockResolvedValue(credential('create', { enabled: false }));
		await expect(addPasskey('Old key')).rejects.toMatchObject({
			name: 'PasskeyError',
			problem: 'prf_unsupported',
		});
		// Browsers that don't know the extension at all: no `prf` result.
		create.mockResolvedValue(credential('create'));
		await expect(addPasskey('Old key')).rejects.toBeInstanceOf(PasskeyError);
		// prf.enabled but the follow-up assertion still returns nothing.
		create.mockResolvedValue(credential('create', { enabled: true }));
		assertWith.mockResolvedValue(credential('get'));
		await expect(addPasskey('Old key')).rejects.toMatchObject({ problem: 'prf_unsupported' });
		expect(registered()).toBeUndefined();
	});

	it('treats a closed prompt as a cancel and an existing credential as already added', async () => {
		await unlockedAccount();
		answer();
		create.mockRejectedValue(new DOMException('closed', 'NotAllowedError'));
		const cancelled = await addPasskey('Mine').catch((error: unknown) => error);
		expect(cancelled).toMatchObject({ problem: 'cancelled' });
		expect((cancelled as Error).message).toMatch(/Nothing was changed/);
		create.mockRejectedValue(new DOMException('known', 'InvalidStateError'));
		await expect(addPasskey('Mine')).rejects.toMatchObject({ problem: 'already_added' });
		expect(registered()).toBeUndefined();
	});
});

describe('openWithPasskey', () => {
	const credentialId = randomBytes(16);
	let prf: Uint8Array;
	let passkeyMemberId: string;
	let account: Awaited<ReturnType<typeof unlockedAccount>> & { all: KeyEnvelopeInput[] };

	beforeEach(async () => {
		const base = await unlockedAccount();
		prf = randomBytes(32);
		const salt = newMemberSalt();
		passkeyMemberId = crypto.randomUUID();
		const added = await buildAddMember(
			base.keyring,
			memberEntry(passkeyMemberId, 'passkey', await passkeyMemberKeys(prf, salt), {
				memberSalt: b64(salt),
			}),
		);
		account = { ...base, all: [...base.envelopes, ...added.key_envelopes] };
		vi.mocked(loadVerifiedRoster).mockResolvedValue(base.keyring.roster);
		get.mockImplementation(async (path: string) => {
			if (path === '/v1/account/unlock/params') {
				return {
					members: [],
					passkeys: [
						{ id: 'p1', member_id: passkeyMemberId, credential_id: b64(credentialId) },
					],
				} as never;
			}
			if (path === '/v1/account/unlock/envelopes') {
				return { key_envelopes: account.all } as never;
			}
			throw new Error(`unexpected GET ${path}`);
		});
		post.mockImplementation(async (path: string) => {
			if (path === '/v1/account/passkeys/assert-options') {
				return {
					options: {
						challenge: b64(randomBytes(32)),
						rpId: 'localhost',
						userVerification: 'required',
						allowCredentials: [{ id: b64(credentialId), transports: ['internal'] }],
					},
				} as never;
			}
			if (path === '/v1/account/passkeys/assert') return {} as never;
			throw new Error(`unexpected POST ${path}`);
		});
	});

	const context = () => ({
		accountId: account.accountId,
		browser: {} as StoredBrowserKey,
		membership: 'none' as const,
	});
	const asserted = () => post.mock.calls.find(([path]) => path === '/v1/account/passkeys/assert');

	it('opens the pouch keys as the passkey member and sends the assertion without PRF', async () => {
		assertWith.mockResolvedValue(credential('get', { id: credentialId, prf }));
		const keyring: Keyring = await openWithPasskey(context());

		expect(keyring.member).toMatchObject({ id: passkeyMemberId, kind: 'passkey' });
		expect(pouchKeys(keyring, account.pouchId).current).toEqual(
			pouchKeys(account.keyring, account.pouchId).current,
		);
		const publicKey = assertWith.mock.calls[0]![0].publicKey;
		const salt = unb64(account.keyring.roster.members.get(passkeyMemberId)!.memberSalt!);
		expect(
			new Uint8Array(publicKey.extensions.prf.evalByCredential[b64(credentialId)].first),
		).toEqual(prfInput(salt));
		const body = asserted()![1] as { response: { clientExtensionResults: unknown } };
		expect(body.response.clientExtensionResults).toEqual({});
		expect(JSON.stringify(body)).not.toContain(b64(prf));
	});

	it('a wrong PRF output fails locally and never asks the server for a grant', async () => {
		assertWith.mockResolvedValue(credential('get', { id: credentialId, prf: randomBytes(32) }));
		await expect(openWithPasskey(context())).rejects.toMatchObject({ kind: 'wrong_secret' });
		await expect(openWithPasskey(context())).rejects.toBeInstanceOf(CryptoError);
		expect(asserted()).toBeUndefined();
	});

	it('reports a closed prompt or a missing PRF result instead of failing silently', async () => {
		assertWith.mockRejectedValue(new DOMException('closed', 'NotAllowedError'));
		await expect(openWithPasskey(context())).rejects.toMatchObject({ problem: 'cancelled' });
		assertWith.mockResolvedValue(credential('get', { id: credentialId }));
		await expect(openWithPasskey(context())).rejects.toMatchObject({ problem: 'prf_missing' });
		expect(asserted()).toBeUndefined();
	});

	it('says so when the account has no passkey', async () => {
		get.mockResolvedValueOnce({ members: [], passkeys: [] } as never);
		await expect(openWithPasskey(context())).rejects.toMatchObject({ problem: 'no_passkey' });
		expect(assertWith).not.toHaveBeenCalled();
	});
});
