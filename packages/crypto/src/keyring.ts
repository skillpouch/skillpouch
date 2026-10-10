// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A keyring is what an unlocked client holds in memory: the member it acts
 * as, the verified roster, and the key material of every pouch it can open.
 * Higher-level flows (genesis, enrollment, adding members, rotation) are
 * built on it so the browser and test tools share one implementation.
 */
import type { KeyEnvelopeInput } from '@skillpouch/contracts';
import { bytesEqual } from './bytes';
import { CryptoError } from './errors';
import { openKeyEnvelope, sealKeyEnvelope, type EnvelopeRecipient } from './key-envelopes';
import type { MemberKeyPair } from './keys';
import {
	buildPouchKeys,
	newPouchSecrets,
	type PouchKeys,
	type PouchSecretMaterial,
} from './pouch-keys';
import { activeMembers, type MemberState, type RosterState } from './roster';

export interface Member {
	id: string;
	kind: MemberState['kind'];
	keys: MemberKeyPair;
}

export interface Keyring {
	member: Member;
	roster: RosterState;
	/** Opened key material per pouch and generation (needed to re-seal for new members). */
	material: Map<string, Map<number, PouchSecretMaterial>>;
	pouches: Map<string, PouchKeys>;
}

/**
 * Opens every envelope addressed to `member`. Pouch keys follow the signed
 * roster, so an envelope from a non-member, for a generation no
 * `rotate_keys` announced, or from a removed member for the newest
 * generation is refused, as are two different keys for one generation and
 * an active member's pouch whose newest generation was withheld.
 */
export async function openKeyring(
	member: Member,
	roster: RosterState,
	envelopes: KeyEnvelopeInput[],
): Promise<Keyring> {
	const material = new Map<string, Map<number, PouchSecretMaterial>>();
	for (const envelope of envelopes) {
		if (envelope.member_id !== member.id) continue;
		const pouch = roster.pouches.get(envelope.pouch_id);
		if (!pouch || envelope.key_gen < 1 || envelope.key_gen > pouch.keyGen) {
			throw new CryptoError(
				'envelope_mismatch',
				'key envelope for a generation the roster never announced',
			);
		}
		const creator = roster.members.get(envelope.created_by_member);
		if (!creator) {
			throw new CryptoError('signature_invalid', 'key envelope from an unknown member');
		}
		// Every removal rotates the keys: a removed member never sealed the newest.
		if (creator.removedSeq !== null && envelope.key_gen >= pouch.keyGen) {
			throw new CryptoError('signature_invalid', 'key envelope from a removed member');
		}
		const opened = await openKeyEnvelope(envelope, member.id, member.keys, creator.signPub);
		let perPouch = material.get(envelope.pouch_id);
		if (!perPouch) material.set(envelope.pouch_id, (perPouch = new Map()));
		const known = perPouch.get(envelope.key_gen);
		if (known && !sameMaterial(known, opened)) {
			throw new CryptoError('envelope_mismatch', 'two different keys for one generation');
		}
		perPouch.set(envelope.key_gen, opened);
	}
	const self = roster.members.get(member.id);
	for (const [pouchId, generations] of material) {
		const [first, ...rest] = [...generations.values()];
		if (rest.some((other) => !bytesEqual(other.pis, first!.pis))) {
			throw new CryptoError('envelope_mismatch', `pouch ${pouchId} has two identity secrets`);
		}
		const announced = roster.pouches.get(pouchId)!.keyGen;
		if (self?.removedSeq === null && Math.max(...generations.keys()) < announced) {
			// Writing with an older key would let a removed member read it.
			throw new CryptoError(
				'roster_rollback',
				`the server withheld key generation ${announced} of pouch ${pouchId}`,
			);
		}
	}
	const keyring: Keyring = { member, roster, material, pouches: new Map() };
	refreshPouchKeys(keyring);
	return keyring;
}

const sameMaterial = (a: PouchSecretMaterial, b: PouchSecretMaterial) =>
	bytesEqual(a.ps, b.ps) && bytesEqual(a.pis, b.pis);

/** Rebuilds derived pouch keys after `material` changed. */
export function refreshPouchKeys(keyring: Keyring): void {
	keyring.pouches.clear();
	for (const [pouchId, generations] of keyring.material) {
		keyring.pouches.set(
			pouchId,
			buildPouchKeys(
				pouchId,
				[...generations].map(([keyGen, material]) => ({ keyGen, material })),
			),
		);
	}
}

export function pouchKeys(keyring: Keyring, pouchId: string): PouchKeys {
	const keys = keyring.pouches.get(pouchId);
	if (!keys) throw new CryptoError('wrong_secret', 'this member has no keys for the pouch');
	return keys;
}

export function addMaterial(
	keyring: Keyring,
	pouchId: string,
	keyGen: number,
	material: PouchSecretMaterial,
): void {
	let perPouch = keyring.material.get(pouchId);
	if (!perPouch) keyring.material.set(pouchId, (perPouch = new Map()));
	perPouch.set(keyGen, material);
	refreshPouchKeys(keyring);
}

const asRecipient = (member: Pick<MemberState, 'id' | 'encPub'>): EnvelopeRecipient => ({
	id: member.id,
	encPub: member.encPub,
});

/**
 * Seals every generation of every pouch this keyring holds to `recipients`
 * (a new browser, a newly authorized CLI, a new passkey…).
 */
export async function sealAllFor(
	keyring: Keyring,
	recipients: EnvelopeRecipient[],
	pouchIds?: Iterable<string>,
): Promise<KeyEnvelopeInput[]> {
	const wanted = pouchIds ? new Set(pouchIds) : undefined;
	const creator = { id: keyring.member.id, signKey: keyring.member.keys.signKey };
	const envelopes: KeyEnvelopeInput[] = [];
	for (const [pouchId, generations] of keyring.material) {
		if (wanted && !wanted.has(pouchId)) continue;
		for (const [keyGen, material] of generations) {
			for (const recipient of recipients) {
				envelopes.push(
					await sealKeyEnvelope(creator, recipient, pouchId, keyGen, material),
				);
			}
		}
	}
	return envelopes;
}

/** Creates the secrets of a brand-new pouch and seals generation 1 to every active member. */
export async function createPouchSecrets(
	keyring: Keyring,
	pouchId: string,
	recipients: EnvelopeRecipient[] = activeMembers(keyring.roster).map(asRecipient),
): Promise<KeyEnvelopeInput[]> {
	addMaterial(keyring, pouchId, 1, newPouchSecrets());
	return sealAllFor(keyring, recipients, [pouchId]);
}

/**
 * Key rotation after removing a member: a new `PS_{g+1}` for every pouch
 * (PIS is kept), sealed to every remaining active member. Returns the
 * `new_generations` map for the `rotate_keys` statement and the envelopes.
 */
export async function rotateAll(
	keyring: Keyring,
	remaining: EnvelopeRecipient[],
): Promise<{ newGenerations: Record<string, number>; envelopes: KeyEnvelopeInput[] }> {
	const creator = { id: keyring.member.id, signKey: keyring.member.keys.signKey };
	const newGenerations: Record<string, number> = {};
	const envelopes: KeyEnvelopeInput[] = [];
	for (const [pouchId, keys] of [...keyring.pouches]) {
		const rosterGen = keyring.roster.pouches.get(pouchId)?.keyGen ?? keys.current.keyGen;
		const next = Math.max(rosterGen, keys.current.keyGen) + 1;
		const material = newPouchSecrets(keyring.material.get(pouchId)!.values().next().value!.pis);
		addMaterial(keyring, pouchId, next, material);
		newGenerations[pouchId] = next;
		for (const recipient of remaining) {
			envelopes.push(await sealKeyEnvelope(creator, recipient, pouchId, next, material));
		}
	}
	return { newGenerations, envelopes };
}

export function recipientsOf(members: Pick<MemberState, 'id' | 'encPub'>[]): EnvelopeRecipient[] {
	return members.map(asRecipient);
}

/** Debug-safe fingerprint of a member's signing key (first 16 bytes of x, grouped). */
export function memberFingerprint(member: Pick<MemberState, 'signPub'>): string {
	return (member.signPub.x.slice(0, 16).match(/.{4}/g) ?? []).join(' ');
}
