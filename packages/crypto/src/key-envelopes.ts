// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Key envelopes hand a pouch's keys to one member:
 *
 *   ciphertext = HPKE_seal(member.enc_pub,
 *                          info = "skillpouch/v1/key-envelope",
 *                          aad  = pouch_id ‖ member_id ‖ u32_be(key_gen),
 *                          PS_g ‖ PIS)
 *   signature  = sign(creator, "skillpouch/v1/key-envelope",
 *                     pouch_id ‖ member_id ‖ u32_be(key_gen) ‖ hpke_enc ‖ ciphertext)
 *
 * The signature lets a recipient reject envelopes the server made up: only
 * an active roster member can create one.
 */
import type { KeyEnvelopeInput } from '@skillpouch/contracts';
import { b64, concat, u32be, unb64, utf8 } from './bytes';
import { hpkeOpen, hpkeSeal, type HpkeRecipientKey } from './hpke';
import { requireSignature, sign, type PublicJwk } from './keys';
import { packSecrets, unpackSecrets, type PouchSecretMaterial } from './pouch-keys';

export const KEY_ENVELOPE_CONTEXT = 'skillpouch/v1/key-envelope';
const INFO = utf8(KEY_ENVELOPE_CONTEXT);

export interface EnvelopeRecipient {
	id: string;
	encPub: PublicJwk;
}

export interface EnvelopeCreator {
	id: string;
	signKey: CryptoKey;
}

const binding = (pouchId: string, memberId: string, keyGen: number) =>
	concat(pouchId, memberId, u32be(keyGen));

export async function sealKeyEnvelope(
	creator: EnvelopeCreator,
	recipient: EnvelopeRecipient,
	pouchId: string,
	keyGen: number,
	material: PouchSecretMaterial,
): Promise<KeyEnvelopeInput> {
	const aad = binding(pouchId, recipient.id, keyGen);
	const sealed = await hpkeSeal(recipient.encPub, INFO, aad, packSecrets(material));
	const signature = await sign(
		creator.signKey,
		KEY_ENVELOPE_CONTEXT,
		concat(aad, sealed.enc, sealed.ciphertext),
	);
	return {
		pouch_id: pouchId,
		member_id: recipient.id,
		key_gen: keyGen,
		hpke_enc: b64(sealed.enc),
		ciphertext: b64(sealed.ciphertext),
		created_by_member: creator.id,
		signature,
	};
}

/**
 * Opens an envelope addressed to `recipientId` after checking the creator's
 * signature (`creatorSignPub` comes from the verified roster).
 */
export async function openKeyEnvelope(
	envelope: KeyEnvelopeInput,
	recipientId: string,
	recipientKey: HpkeRecipientKey,
	creatorSignPub: PublicJwk,
): Promise<PouchSecretMaterial> {
	const aad = binding(envelope.pouch_id, recipientId, envelope.key_gen);
	const enc = unb64(envelope.hpke_enc);
	const ciphertext = unb64(envelope.ciphertext);
	await requireSignature(
		creatorSignPub,
		envelope.signature,
		KEY_ENVELOPE_CONTEXT,
		concat(aad, enc, ciphertext),
		'key envelope',
	);
	return unpackSecrets(await hpkeOpen(recipientKey, { enc, ciphertext }, INFO, aad));
}
