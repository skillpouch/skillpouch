// SPDX-License-Identifier: AGPL-3.0-only
import { blake3 } from '@noble/hashes/blake3.js';
import { calculateJwkThumbprint } from 'jose';
import { describe, expect, it } from 'vitest';
import {
	b64,
	blobId,
	buildPouchKeys,
	CryptoError,
	confirmCode,
	deriveMemberKeyPair,
	frameBatch,
	generateMemberKeyPair,
	generateRecoveryKey,
	hpkeOpen,
	hpkeSeal,
	isValidRecoveryKey,
	jwkThumbprint,
	nameIndex,
	newPouchSecrets,
	newShareKey,
	open,
	openBlob,
	openShare,
	pad,
	padmeLength,
	parseFetched,
	parseRecoveryKey,
	passwordSecret,
	randomBytes,
	seal,
	sealBlob,
	sealShare,
	secretMemberKeys,
	sign,
	unpad,
	utf8,
	verify,
	checkNewPassword,
} from '../src';

const keysFor = (pouchId = '01900000-0000-7000-8000-000000000001') =>
	buildPouchKeys(pouchId, [{ keyGen: 1, material: newPouchSecrets() }]);

describe('padding', () => {
	it('rounds lengths up with at most ~12% overhead and round-trips', () => {
		for (const length of [0, 1, 2, 15, 100, 1000, 4097, 100_000]) {
			const padded = pad(new Uint8Array(length).fill(7));
			expect(padded.length).toBe(padmeLength(length + 1));
			expect(padded.length).toBeLessThanOrEqual(Math.ceil((length + 1) * 1.13) + 1);
			expect(unpad(padded).length).toBe(length);
		}
	});

	it('rejects padding without the 0x80 marker', () => {
		expect(() => unpad(new Uint8Array([1, 2, 0, 0]))).toThrow(CryptoError);
	});
});

describe('sealed objects', () => {
	const key = randomBytes(32);
	const aad = utf8('context');

	it('round-trips and records the key generation in the header', () => {
		const sealed = seal(key, 7, utf8('hello'), aad);
		expect(sealed[0]).toBe(1);
		expect(new DataView(sealed.buffer).getUint32(1)).toBe(7);
		expect(new TextDecoder().decode(open(key, sealed, aad))).toBe('hello');
	});

	it('fails on a wrong key, wrong AAD, a flipped bit or a relabelled generation', () => {
		const sealed = seal(key, 1, utf8('hello'), aad);
		expect(() => open(randomBytes(32), sealed, aad)).toThrow(/authentication/);
		expect(() => open(key, sealed, utf8('other'))).toThrow(/authentication/);
		const flipped = sealed.slice();
		flipped[flipped.length - 1]! ^= 1;
		expect(() => open(key, flipped, aad)).toThrow(/authentication/);
		const relabelled = sealed.slice();
		relabelled[4] = 2;
		expect(() => open(key, relabelled, aad)).toThrow(/authentication/);
	});
});

describe('pouch keys and blobs', () => {
	it('derives stable, keyed blob ids and name indexes', () => {
		const keys = keysFor();
		const content = utf8('# My skill');
		expect(blobId(keys, content)).toBe(blobId(keys, content));
		expect(blobId(keysFor(), content)).not.toBe(blobId(keys, content));
		expect(blobId(keys, content)).not.toBe(b64(blake3(content)));
		expect(nameIndex(keys, 'skill', 'global', 'PDF-Tools')).toBe(
			nameIndex(keys, 'skill', 'global', 'pdf-tools'),
		);
		expect(nameIndex(keys, 'skill', 'global', 'pdf-tools')).not.toBe(
			nameIndex(keys, 'agent', 'global', 'pdf-tools'),
		);
	});

	it('seals blobs, verifies the keyed id on open and frames batches', () => {
		const keys = keysFor();
		const blob = sealBlob(keys, utf8('content'));
		expect(blob.hash).toBe(b64(blake3(blob.bytes)));
		expect(new TextDecoder().decode(openBlob(keys, blob.id, blob.bytes))).toBe('content');
		const other = sealBlob(keys, utf8('other'));
		expect(() => openBlob(keys, other.id, blob.bytes)).toThrow(/authentication/);

		const framed = frameBatch([blob, other]);
		expect(framed.length).toBe(2 * (32 + 32 + 4) + blob.bytes.length + other.bytes.length);
		const download = new Uint8Array([
			...framed.subarray(0, 32),
			...framed.subarray(64, 68),
			...blob.bytes,
		]);
		expect(parseFetched(download).get(blob.id)).toEqual(blob.bytes);
	});

	it('reads older generations after a rotation', () => {
		const pouchId = '01900000-0000-7000-8000-000000000002';
		const first = newPouchSecrets();
		const old = buildPouchKeys(pouchId, [{ keyGen: 1, material: first }]);
		const blob = sealBlob(old, utf8('v1'));
		const rotated = buildPouchKeys(pouchId, [
			{ keyGen: 1, material: first },
			{ keyGen: 2, material: newPouchSecrets(first.pis) },
		]);
		expect(rotated.current.keyGen).toBe(2);
		expect(new TextDecoder().decode(openBlob(rotated, blob.id, blob.bytes))).toBe('v1');
		expect(sealBlob(rotated, utf8('v1')).id).toBe(blob.id);
	});
});

describe('member keys and signatures', () => {
	it('signs raw r‖s over context ‖ message and rejects other contexts', async () => {
		const keys = await generateMemberKeyPair();
		const signature = await sign(keys.signKey, 'skillpouch/v1/test', utf8('m'));
		expect(Buffer.from(signature, 'base64url').length).toBe(64);
		expect(await verify(keys.signPub, signature, 'skillpouch/v1/test', utf8('m'))).toBe(true);
		expect(await verify(keys.signPub, signature, 'skillpouch/v1/other', utf8('m'))).toBe(false);
		expect(await verify(keys.signPub, signature, 'skillpouch/v1/test', utf8('x'))).toBe(false);
		expect(await verify(keys.signPub, 'AAAA', 'skillpouch/v1/test', utf8('m'))).toBe(false);
	});

	it('derives the same key pair from the same seed, different from another', async () => {
		const seed = randomBytes(32);
		const a = await deriveMemberKeyPair(seed);
		const b = await deriveMemberKeyPair(seed);
		expect(a.signPub).toEqual(b.signPub);
		expect(a.encPub).toEqual(b.encPub);
		expect(a.signPub).not.toEqual(a.encPub);
		expect((await deriveMemberKeyPair(randomBytes(32))).signPub).not.toEqual(a.signPub);
		const signature = await sign(a.signKey, 'c', utf8('m'));
		expect(await verify(b.signPub, signature, 'c', utf8('m'))).toBe(true);
	});

	it('computes RFC 7638 thumbprints', async () => {
		const keys = await generateMemberKeyPair();
		expect(jwkThumbprint(keys.signPub)).toBe(await calculateJwkThumbprint(keys.signPub));
	});
});

describe('secrets', () => {
	const params = { alg: 'argon2id' as const, m: 19_456, t: 2, p: 1 };

	it('derives the password member from password + salt + pepper only', async () => {
		const salt = randomBytes(16);
		const pepper = randomBytes(32);
		const memberSalt = randomBytes(16);
		const a = await passwordSecret('correct horse battery', salt, params, pepper);
		const b = await passwordSecret('correct horse battery', salt, params, pepper);
		expect(a).toEqual(b);
		expect(a.length).toBe(64);
		const keys = await secretMemberKeys('password', a, memberSalt);
		expect((await secretMemberKeys('password', b, memberSalt)).signPub).toEqual(keys.signPub);
		const wrong = await passwordSecret('correct horse battery!', salt, params, pepper);
		expect((await secretMemberKeys('password', wrong, memberSalt)).signPub).not.toEqual(
			keys.signPub,
		);
		const otherPepper = await passwordSecret(
			'correct horse battery',
			salt,
			params,
			randomBytes(32),
		);
		expect(otherPepper).not.toEqual(a);
	});

	it('normalizes the password (NFKC) so the same text on another keyboard unlocks', async () => {
		const salt = randomBytes(16);
		const pepper = randomBytes(32);
		const composed = await passwordSecret('ﬁlé-password-12', salt, params, pepper);
		const decomposed = await passwordSecret('file\u0301-password-12', salt, params, pepper);
		expect(composed).toEqual(decomposed);
	});

	it('generates and parses 12-word Recovery Keys, tolerant of case and spacing', () => {
		const key = generateRecoveryKey();
		expect(key.words).toHaveLength(12);
		const messy = `  ${key.words.join('   ').toUpperCase()}\n`;
		expect(isValidRecoveryKey(messy)).toBe(true);
		expect(parseRecoveryKey(messy).entropy).toEqual(key.entropy);
		// All-zero entropy is "abandon … about"; swapping the checksum word breaks it.
		expect(isValidRecoveryKey(`${'abandon '.repeat(11)}about`)).toBe(true);
		expect(isValidRecoveryKey(`${'abandon '.repeat(11)}abandon`)).toBe(false);
		expect(isValidRecoveryKey(key.words.slice(0, 11).join(' '))).toBe(false);
		expect(() => parseRecoveryKey('not a key')).toThrow(/Recovery Key/);
	});

	it('checks new master passwords', () => {
		expect(checkNewPassword('short')).toEqual({ ok: false, reason: 'too_short' });
		expect(checkNewPassword('aaaaaaaaaaaaaaaa')).toEqual({ ok: false, reason: 'too_simple' });
		expect(checkNewPassword('abcabcabcabcabc')).toEqual({ ok: false, reason: 'too_simple' });
		expect(checkNewPassword('violet-anchor-92', 'violet-anchor-93')).toEqual({
			ok: false,
			reason: 'mismatch',
		});
		expect(checkNewPassword('violet-anchor-92', 'violet-anchor-92')).toEqual({ ok: true });
	});
});

describe('HPKE, confirm codes and share bundles', () => {
	it('seals to a member key and binds info + aad', async () => {
		const keys = await generateMemberKeyPair();
		const sealed = await hpkeSeal(keys.encPub, utf8('info'), utf8('aad'), utf8('secret'));
		expect(sealed.enc.length).toBe(65);
		expect(
			new TextDecoder().decode(await hpkeOpen(keys, sealed, utf8('info'), utf8('aad'))),
		).toBe('secret');
		await expect(hpkeOpen(keys, sealed, utf8('info'), utf8('other'))).rejects.toThrow(
			CryptoError,
		);
		const other = await generateMemberKeyPair();
		await expect(hpkeOpen(other, sealed, utf8('info'), utf8('aad'))).rejects.toThrow(
			CryptoError,
		);
	});

	it('derives an 8-digit confirm code that changes with any key', async () => {
		const a = await generateMemberKeyPair();
		const code = confirmCode('req', a.signPub, a.encPub, jwkThumbprint(a.signPub));
		expect(code).toMatch(/^\d{4}-\d{4}$/);
		expect(confirmCode('req', a.signPub, a.encPub, jwkThumbprint(a.signPub))).toBe(code);
		const b = await generateMemberKeyPair();
		expect(confirmCode('req', a.signPub, b.encPub, jwkThumbprint(a.signPub))).not.toBe(code);
	});

	it('shares open only with the link key and the right share id', () => {
		const key = newShareKey();
		const bundle = {
			format: 1 as const,
			kind: 'skill',
			name: 'pdf-tools',
			description: 'Work with PDFs',
			files: [{ path: 'SKILL.md', content: b64(utf8('# PDF')), mode: 'file' as const }],
			stripped: [],
			shared_at: new Date().toISOString(),
		};
		const sealed = sealShare('share-1', key, bundle);
		expect(openShare('share-1', key, sealed)).toEqual(bundle);
		expect(() => openShare('share-2', key, sealed)).toThrow(CryptoError);
		expect(() => openShare('share-1', newShareKey(), sealed)).toThrow(CryptoError);
		expect(() => openShare('share-1', key.slice(0, 10), sealed)).toThrow(/incomplete/);
	});
});
