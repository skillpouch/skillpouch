// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Passkeys as *unlock keys* (WebAuthn PRF) — never for sign-in.
 *
 * Each passkey is a `passkey` roster member. Its key pair is derived from the
 * authenticator's PRF output for `prfInput(member_salt)`:
 *
 *   seed = HKDF-SHA256(prf, member_salt, "skillpouch/v1/member-seed/passkey")
 *
 * and the pouch keys are HPKE-sealed to it like for any other member. The
 * server keeps the credential id + public key (to offer and verify it), the
 * salt and those envelopes; the PRF output and everything derived from it
 * stay in this page. WebAuthn responses are sent with the PRF results removed.
 */
import {
	CryptoError,
	b64,
	buildAddMember,
	buildRemoveMember,
	memberEntry,
	newMemberSalt,
	openKeyring,
	passkeyMemberKeys,
	prfInput,
	randomBytes,
	sameKey,
	unb64,
	type Keyring,
} from '@skillpouch/crypto';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { KeyEnvelopeRecord, PasskeyRecord } from '@/lib/api/types';
import { currentKeyring } from '../session/session-store';
import { reloadKeyring, withRosterChange } from './keyring';
import { loadVerifiedRoster } from './roster';
import { reportingTamper } from './security-report';
import { completeUnlock, fetchUnlockParams, type UnlockContext } from './unlock';

export type PasskeyProblem =
	'prf_unsupported' | 'prf_missing' | 'cancelled' | 'already_added' | 'no_passkey';

const PROBLEMS: Record<PasskeyProblem, string> = {
	prf_unsupported:
		'This passkey can’t unlock SkillPouch: its authenticator doesn’t support the PRF extension. Nothing was saved. Try another passkey provider or a recent security key.',
	prf_missing:
		'This browser or passkey didn’t return an unlock secret. Use your master password instead.',
	cancelled: 'The passkey prompt was closed. Nothing was changed.',
	already_added: 'This passkey already unlocks SkillPouch.',
	no_passkey: 'No passkey is set up for unlocking yet.',
};

export class PasskeyError extends Error {
	constructor(readonly problem: PasskeyProblem) {
		super(PROBLEMS[problem]);
		this.name = 'PasskeyError';
	}
}

// ---- feature detection ----------------------------------------------------------

export type PrfSupport = 'supported' | 'unsupported' | 'unknown';

type CapabilitiesApi = {
	getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
};

/**
 * Whether this browser can evaluate PRF. `unknown` (no capability API, e.g.
 * older Firefox) still offers passkeys; a missing PRF result is then explained
 * when the user tries.
 */
export async function detectPrfSupport(): Promise<PrfSupport> {
	const credentialApi = globalThis.PublicKeyCredential as
		(typeof PublicKeyCredential & CapabilitiesApi) | undefined;
	if (!credentialApi || !globalThis.navigator?.credentials) return 'unsupported';
	if (typeof credentialApi.getClientCapabilities !== 'function') return 'unknown';
	try {
		const capability = (await credentialApi.getClientCapabilities())['extension:prf'];
		return capability === true ? 'supported' : capability === false ? 'unsupported' : 'unknown';
	} catch {
		return 'unknown';
	}
}

export function usePrfSupport(): PrfSupport | undefined {
	return useQuery({
		queryKey: queryKeys.prfSupport,
		queryFn: detectPrfSupport,
		staleTime: Infinity,
	}).data;
}

/** The account's passkey unlockers (from the unlock parameters every session may read). */
export function usePasskeys() {
	return useQuery({
		queryKey: queryKeys.unlockParams,
		queryFn: fetchUnlockParams,
		select: (params) => params.passkeys,
	});
}

/**
 * Whether the unlock page leads with "Unlock with passkey": the account has
 * one and this browser isn't known to lack PRF. Errors fall back to the
 * master password rather than block the page.
 */
export function usePasskeyOffer(): 'loading' | 'available' | 'unavailable' {
	const support = usePrfSupport();
	const passkeys = usePasskeys();
	if (support === 'unsupported' || passkeys.isError) return 'unavailable';
	if (support === undefined || passkeys.isPending) return 'loading';
	return passkeys.data.length > 0 ? 'available' : 'unavailable';
}

// ---- WebAuthn JSON <-> browser objects --------------------------------------------

interface CredentialJson {
	id: string;
	type?: string;
	transports?: string[];
}

/** `@simplewebauthn/server` registration options as the API returns them. */
export interface CreationOptionsJson {
	challenge: string;
	rp: { id?: string; name: string };
	user: { id: string; name: string; displayName: string };
	pubKeyCredParams: PublicKeyCredentialParameters[];
	timeout?: number;
	attestation?: AttestationConveyancePreference;
	excludeCredentials?: CredentialJson[];
	authenticatorSelection?: AuthenticatorSelectionCriteria;
	extensions?: Record<string, unknown>;
}

export interface RequestOptionsJson {
	challenge: string;
	rpId?: string;
	timeout?: number;
	userVerification?: UserVerificationRequirement;
	allowCredentials?: CredentialJson[];
}

/** WebAuthn PRF extension shapes (not in every TypeScript DOM lib yet). */
interface PrfValues {
	first: BufferSource;
	second?: BufferSource;
}
interface PrfInputs {
	eval?: PrfValues;
	evalByCredential?: Record<string, PrfValues>;
}
interface PrfOutputs {
	enabled?: boolean;
	results?: { first?: BufferSource };
}

const buffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy.buffer;
};

const descriptor = (credential: CredentialJson): PublicKeyCredentialDescriptor => ({
	type: 'public-key',
	id: buffer(unb64(credential.id)),
	...(credential.transports
		? { transports: credential.transports as AuthenticatorTransport[] }
		: {}),
});

export function toCreationOptions(
	json: CreationOptionsJson,
	prf: PrfInputs,
): PublicKeyCredentialCreationOptions {
	return {
		challenge: buffer(unb64(json.challenge)),
		rp: json.rp,
		user: { ...json.user, id: buffer(unb64(json.user.id)) },
		pubKeyCredParams: json.pubKeyCredParams,
		...(json.timeout ? { timeout: json.timeout } : {}),
		...(json.attestation ? { attestation: json.attestation } : {}),
		...(json.authenticatorSelection
			? { authenticatorSelection: json.authenticatorSelection }
			: {}),
		excludeCredentials: (json.excludeCredentials ?? []).map(descriptor),
		extensions: { ...json.extensions, prf } as AuthenticationExtensionsClientInputs,
	};
}

export function toRequestOptions(
	json: RequestOptionsJson,
	prf: PrfInputs,
): PublicKeyCredentialRequestOptions {
	return {
		challenge: buffer(unb64(json.challenge)),
		...(json.rpId ? { rpId: json.rpId } : {}),
		...(json.timeout ? { timeout: json.timeout } : {}),
		...(json.userVerification ? { userVerification: json.userVerification } : {}),
		allowCredentials: (json.allowCredentials ?? []).map(descriptor),
		extensions: { prf } as AuthenticationExtensionsClientInputs,
	};
}

const bytesOf = (source: BufferSource): Uint8Array =>
	source instanceof ArrayBuffer
		? new Uint8Array(source.slice(0))
		: new Uint8Array(
				source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
			);

const encode = (source: BufferSource | null | undefined) =>
	source ? b64(bytesOf(source)) : undefined;

function prfOutputs(credential: PublicKeyCredential): PrfOutputs | undefined {
	return (credential.getClientExtensionResults() as { prf?: PrfOutputs }).prf;
}

/** A copy of the PRF output (the caller wipes it), or null when the authenticator gave none. */
export function prfResult(credential: PublicKeyCredential): Uint8Array | null {
	const first = prfOutputs(credential)?.results?.first;
	return first ? bytesOf(first) : null;
}

/** The registration response for the API — without `clientExtensionResults.prf.results`. */
export function registrationJson(credential: PublicKeyCredential) {
	const response = credential.response as AuthenticatorAttestationResponse;
	return {
		id: credential.id,
		rawId: b64(new Uint8Array(credential.rawId)),
		type: credential.type,
		response: {
			clientDataJSON: encode(response.clientDataJSON),
			attestationObject: encode(response.attestationObject),
			transports: response.getTransports?.() ?? [],
		},
		authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
		clientExtensionResults: {},
	};
}

/** The assertion for the API — again without the PRF output. */
export function assertionJson(credential: PublicKeyCredential) {
	const response = credential.response as AuthenticatorAssertionResponse;
	return {
		id: credential.id,
		rawId: b64(new Uint8Array(credential.rawId)),
		type: credential.type,
		response: {
			clientDataJSON: encode(response.clientDataJSON),
			authenticatorData: encode(response.authenticatorData),
			signature: encode(response.signature),
			userHandle: encode(response.userHandle),
		},
		authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
		clientExtensionResults: {},
	};
}

function asPasskeyError(error: unknown): unknown {
	if (error instanceof DOMException) {
		if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
			return new PasskeyError('cancelled');
		}
		if (error.name === 'InvalidStateError') return new PasskeyError('already_added');
	}
	return error;
}

async function createCredential(
	options: PublicKeyCredentialCreationOptions,
): Promise<PublicKeyCredential> {
	try {
		const credential = await navigator.credentials.create({ publicKey: options });
		if (!credential) throw new PasskeyError('cancelled');
		return credential as PublicKeyCredential;
	} catch (error) {
		throw asPasskeyError(error);
	}
}

async function getCredential(
	options: PublicKeyCredentialRequestOptions,
): Promise<PublicKeyCredential> {
	try {
		const credential = await navigator.credentials.get({ publicKey: options });
		if (!credential) throw new PasskeyError('cancelled');
		return credential as PublicKeyCredential;
	} catch (error) {
		throw asPasskeyError(error);
	}
}

/** Asks the browser to forget a credential we won't use (where supported; best effort). */
function forgetCredential(rpId: string | undefined, credentialId: string): void {
	const credentialApi = globalThis.PublicKeyCredential as unknown as {
		signalUnknownCredential?: (options: {
			rpId: string;
			credentialId: string;
		}) => Promise<void>;
	};
	if (rpId && credentialApi?.signalUnknownCredential) {
		credentialApi.signalUnknownCredential({ rpId, credentialId }).catch(() => undefined);
	}
}

// ---- Security page: add, rename, remove -------------------------------------------------

/**
 * Registers a passkey with PRF and adds it as a member. Many authenticators
 * only report `prf.enabled` while registering; they are asked once more
 * (a local, unverified assertion) for the actual output.
 */
export async function addPasskey(label: string): Promise<PasskeyRecord> {
	const { options } = await api.post<{ options: CreationOptionsJson }>(
		'/v1/account/passkeys/options',
	);
	const salt = newMemberSalt();
	const evalInput = { first: buffer(prfInput(salt)) };
	const credential = await createCredential(toCreationOptions(options, { eval: evalInput }));
	let prf = prfResult(credential);
	if (!prf) {
		if (prfOutputs(credential)?.enabled !== true) {
			forgetCredential(options.rp.id, credential.id);
			throw new PasskeyError('prf_unsupported');
		}
		const local = await getCredential({
			challenge: buffer(randomBytes(32)),
			...(options.rp.id ? { rpId: options.rp.id } : {}),
			allowCredentials: [{ type: 'public-key', id: credential.rawId }],
			userVerification: 'required',
			extensions: { prf: { eval: evalInput } } as AuthenticationExtensionsClientInputs,
		});
		prf = prfResult(local);
		if (!prf) {
			forgetCredential(options.rp.id, credential.id);
			throw new PasskeyError('prf_unsupported');
		}
	}
	let keys;
	try {
		keys = await passkeyMemberKeys(prf, salt);
	} finally {
		prf.fill(0);
	}
	const record = await withRosterChange(async () => {
		const { statement, key_envelopes } = await buildAddMember(
			currentKeyring(),
			memberEntry(crypto.randomUUID(), 'passkey', keys, { memberSalt: b64(salt) }),
		);
		return api.post<PasskeyRecord>('/v1/account/passkeys', {
			response: registrationJson(credential),
			label,
			statement: statement.input,
			key_envelopes,
		});
	}).catch((error: unknown) => {
		forgetCredential(options.rp.id, credential.id);
		throw error;
	});
	await reloadKeyring();
	return record;
}

export function renamePasskey(id: string, label: string): Promise<PasskeyRecord> {
	return api.patch<PasskeyRecord>(`/v1/account/passkeys/${id}`, { label });
}

/** Removes the member and rotates every pouch key (it may have been a lost security key). */
export async function removePasskey(passkey: Pick<PasskeyRecord, 'id' | 'member_id'>) {
	await withRosterChange(async () => {
		const change = await buildRemoveMember(currentKeyring(), passkey.member_id);
		await api.delete(`/v1/account/passkeys/${passkey.id}`, { body: change });
		await reloadKeyring();
	});
}

// ---- Unlock page ---------------------------------------------------------------------

/**
 * Proves a passkey and returns a keyring acting as its member. The derived
 * key is checked against the signed roster *before* the assertion is sent, so
 * a wrong passkey never gets this session a grant.
 */
export async function openWithPasskey(context: UnlockContext): Promise<Keyring> {
	const [params, roster] = await Promise.all([
		fetchUnlockParams(),
		loadVerifiedRoster(context.accountId, context.browser),
	]);
	// Salts come from the signed roster, not from the server's view of it.
	const salts = new Map<string, Uint8Array>();
	for (const member of roster.members.values()) {
		if (member.kind === 'passkey' && member.removedSeq === null && member.memberSalt) {
			salts.set(member.id, unb64(member.memberSalt));
		}
	}
	const passkeys = params.passkeys.filter((passkey) => salts.has(passkey.member_id));
	if (passkeys.length === 0) throw new PasskeyError('no_passkey');

	const { options } = await api.post<{ options: RequestOptionsJson }>(
		'/v1/account/passkeys/assert-options',
	);
	const evalByCredential = Object.fromEntries(
		passkeys.map((passkey) => [
			passkey.credential_id,
			{ first: buffer(prfInput(salts.get(passkey.member_id)!)) },
		]),
	);
	const credential = await getCredential(toRequestOptions(options, { evalByCredential }));
	const passkey = passkeys.find((candidate) => candidate.credential_id === credential.id);
	if (!passkey) throw new CryptoError('wrong_secret', 'This passkey isn’t set up for unlocking.');
	const prf = prfResult(credential);
	if (!prf) throw new PasskeyError('prf_missing');
	let keys;
	try {
		keys = await passkeyMemberKeys(prf, salts.get(passkey.member_id)!);
	} finally {
		prf.fill(0);
	}
	if (!sameKey(keys.signPub, roster.members.get(passkey.member_id)!.signPub)) {
		throw new CryptoError(
			'wrong_secret',
			'This passkey didn’t open your pouches. Use your master password instead.',
		);
	}
	await api.post('/v1/account/passkeys/assert', { response: assertionJson(credential) });
	const { key_envelopes } = await api.get<{ key_envelopes: KeyEnvelopeRecord[] }>(
		'/v1/account/unlock/envelopes',
		{ query: { member_id: passkey.member_id } },
	);
	return reportingTamper({ where: 'key_envelopes' }, () =>
		openKeyring({ id: passkey.member_id, kind: 'passkey', keys }, roster, key_envelopes),
	);
}

export async function unlockBrowserWithPasskey(
	context: UnlockContext,
	options: { trust: boolean },
): Promise<void> {
	await completeUnlock(context, await openWithPasskey(context), options);
}
