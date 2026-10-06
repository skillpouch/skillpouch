// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unlock routes (plan 06 §3, 15 §4.1, §8): master-password parameters and
 * pepper, envelopes for an unlocking browser, trusted-browser enrollment,
 * passkey (PRF) unlockers and the account's security settings.
 */
import {
	BrowserEnrollRequest,
	IdParam,
	MasterPasswordChange,
	PasskeyAssertRequest,
	PasskeyAssertResponse,
	PasskeyOptionsResponse,
	PasskeyRegisterRequest,
	PasskeyRemoveRequest,
	PasskeyUnlocker,
	PepperResponse,
	SecuritySettings,
	SecuritySettingsPatch,
	UnlockEnvelopesQuery,
	UnlockEnvelopesResponse,
	UnlockFailedResponse,
	UnlockParams,
	UnlockPrepared,
	Uuid,
	b64urlMax,
} from '@skillpouch/contracts';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { memberOf, sessionOf } from '../../http/principal';
import type { ZodApp } from '../../http/zod-app';
import { clientIpHash, isStepUpFresh } from '../../security/authenticate';
import { AppError } from '../../http/app-error';
import {
	assertionOptions,
	registerPasskey,
	registrationOptions,
	removePasskey,
	verifyAssertion,
} from './passkeys.service';
import {
	changeMasterPassword,
	enrollBrowser,
	envelopesForUnlock,
	prepareUnlock,
	readSecuritySettings,
	recordUnlockFailure,
	releasePepper,
	renewBrowserTrust,
	unlockParams,
	updateSecuritySettings,
} from './unlock.service';

const HeadSeq = z.object({ head_seq: z.number().int() });

export async function unlockRoutes(app: ZodApp, deps: Deps) {
	app.get(
		'/v1/account/unlock/params',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['unlock'],
				summary:
					'KDF parameters, secret-derived members and passkeys for the unlock screen',
				response: { 200: UnlockParams },
			},
		},
		async (request) => unlockParams(deps, sessionOf(request)),
	);

	app.post(
		'/v1/account/unlock/prepare',
		{
			config: { auth: 'session', rateLimit: 'auth' },
			schema: {
				tags: ['unlock'],
				summary:
					'Fresh KDF salt + pepper (pending until genesis or a password change commits them)',
				description:
					'Before genesis: any bound session of the account. Afterwards (master-password change): an unlocked browser with a fresh sign-in.',
				response: { 200: UnlockPrepared },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			if (principal.memberId && !isStepUpFresh(principal, deps.now())) {
				throw new AppError('step_up_required');
			}
			return prepareUnlock(deps, principal);
		},
	);

	app.post(
		'/v1/account/unlock/pepper',
		{
			config: { auth: 'session', rateLimit: 'auth' },
			schema: {
				tags: ['unlock'],
				summary: 'Release the unlock pepper (10/hour, 30/day per account; audited)',
				response: { 200: PepperResponse },
			},
		},
		async (request) => releasePepper(deps, sessionOf(request), clientIpHash(deps, request)),
	);

	app.post(
		'/v1/account/unlock/failed',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['unlock'],
				summary: 'Report a wrong master password (5 in a row notify the other devices)',
				response: { 200: UnlockFailedResponse },
			},
		},
		async (request) => recordUnlockFailure(deps, sessionOf(request)),
	);

	app.get(
		'/v1/account/unlock/envelopes',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['unlock'],
				summary:
					'Key envelopes of a password/passkey/recovery member, for a browser that is unlocking',
				description:
					'Password and passkey members require this session to have proven the secret first (pepper release / passkey assertion).',
				querystring: UnlockEnvelopesQuery,
				response: { 200: UnlockEnvelopesResponse },
			},
		},
		async (request) => envelopesForUnlock(deps, sessionOf(request), request.query.member_id),
	);

	app.put(
		'/v1/account/unlock',
		{
			config: { auth: 'session', stepUp: true },
			schema: {
				tags: ['unlock'],
				summary:
					'Change the master password: commit prepared params with add(new) + remove(old)',
				body: MasterPasswordChange,
				response: { 200: HeadSeq },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			return changeMasterPassword(deps, principal, memberOf(principal), request.body);
		},
	);

	app.post(
		'/v1/account/browsers/enroll',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['unlock'],
				summary:
					'Trust this browser: add it to the roster, signed by the member that unlocked it',
				body: BrowserEnrollRequest,
				response: { 200: z.object({ member_id: Uuid, head_seq: z.number().int() }) },
			},
		},
		async (request) =>
			enrollBrowser(deps, sessionOf(request), request.body, clientIpHash(deps, request)),
	);

	app.post(
		'/v1/account/browsers/renew-trust',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['unlock'],
				summary:
					'Re-trust this browser after its trust window lapsed (proof signed by a secret member)',
				body: z.strictObject({ signer_member_id: Uuid, signature: b64urlMax(256) }),
				response: { 200: z.object({ member_id: Uuid }) },
			},
		},
		async (request) => renewBrowserTrust(deps, sessionOf(request), request.body),
	);

	app.get(
		'/v1/account/security-settings',
		{
			config: { auth: 'session' },
			schema: { tags: ['unlock'], response: { 200: SecuritySettings } },
		},
		async (request) => readSecuritySettings(deps, sessionOf(request).storageAccountId),
	);

	app.patch(
		'/v1/account/security-settings',
		{
			config: { auth: 'session', stepUp: true },
			schema: {
				tags: ['unlock'],
				summary: 'Trusted-browser window (7–90 days) and auto-lock minutes',
				body: SecuritySettingsPatch,
				response: { 200: SecuritySettings },
			},
		},
		async (request) => updateSecuritySettings(deps, sessionOf(request), request.body),
	);

	// ---- passkeys -------------------------------------------------------------

	app.post(
		'/v1/account/passkeys/options',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['unlock'],
				summary: 'WebAuthn registration options for a PRF unlock passkey',
				response: { 200: PasskeyOptionsResponse },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			memberOf(principal);
			return registrationOptions(deps, principal);
		},
	);

	app.post(
		'/v1/account/passkeys',
		{
			config: { auth: 'session' },
			schema: {
				tags: ['unlock'],
				summary: 'Register a passkey unlocker + its signed add(passkey member) statement',
				body: PasskeyRegisterRequest,
				response: { 200: PasskeyUnlocker },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			return registerPasskey(deps, principal, memberOf(principal), request.body);
		},
	);

	app.delete(
		'/v1/account/passkeys/:id',
		{
			config: { auth: 'session', stepUp: true },
			schema: {
				tags: ['unlock'],
				summary: 'Remove a passkey unlocker: signed remove + rotate_keys',
				params: IdParam,
				body: PasskeyRemoveRequest,
				response: { 200: HeadSeq },
			},
		},
		async (request) => {
			const principal = sessionOf(request);
			return removePasskey(
				deps,
				principal,
				memberOf(principal),
				request.params.id,
				request.body,
			);
		},
	);

	app.post(
		'/v1/account/passkeys/assert-options',
		{
			config: { auth: 'session', rateLimit: 'auth' },
			schema: {
				tags: ['unlock'],
				summary: 'WebAuthn assertion options (allowCredentials) for PRF unlock',
				response: { 200: PasskeyOptionsResponse },
			},
		},
		async (request) => assertionOptions(deps, sessionOf(request)),
	);

	app.post(
		'/v1/account/passkeys/assert',
		{
			config: { auth: 'session', rateLimit: 'auth' },
			schema: {
				tags: ['unlock'],
				summary:
					'Verify a passkey assertion; grants this session the passkey member’s envelopes',
				body: PasskeyAssertRequest,
				response: { 200: PasskeyAssertResponse },
			},
		},
		async (request) => verifyAssertion(deps, sessionOf(request), request.body.response),
	);
}
