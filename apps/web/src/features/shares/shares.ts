// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Share links. One ingredient is sealed in the browser with a fresh random
 * key that only exists in the link's `#fragment` — browsers never send the
 * fragment to a server, so SkillPouch stores ciphertext it can't open.
 *
 * Secret values in MCP server and hook configs (`env`, `headers`) are
 * stripped before sealing; the recipient fills them in when importing.
 */
import {
	b64,
	concat,
	fromUtf8,
	generation,
	newShareKey,
	open,
	openShare,
	pouchKeys,
	seal,
	sealedKeyGen,
	sealShare,
	unb64,
	utf8,
	type Keyring,
	type ShareBundle,
} from '@skillpouch/crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { PublicShareRecord, ShareRecord } from '@/lib/api/types';
import { asText, stripSecrets } from '../ingredients/content';
import { fetchIngredientFiles, type Ingredient } from '../ingredients/ingredients';
import { kindDefinition } from '../ingredients/kinds';
import { currentKeyring } from '../session/session-store';

export type ShareExpiry = '1d' | '7d' | '30d' | 'never';

export interface ShareLabel {
	kind: string;
	name: string;
}

const labelAad = (shareId: string) => concat('skillpouch/v1/share-label', shareId);

/** Kind + name, sealed with the pouch's metadata key so only members can read the list. */
export function sealShareLabel(
	keyring: Keyring,
	pouchId: string,
	shareId: string,
	label: ShareLabel,
) {
	const keys = pouchKeys(keyring, pouchId);
	return b64(
		seal(
			keys.current.meta,
			keys.current.keyGen,
			utf8(JSON.stringify(label)),
			labelAad(shareId),
		),
	);
}

export function openShareLabel(
	keyring: Keyring,
	share: Pick<ShareRecord, 'id' | 'pouch_id' | 'label_enc'>,
): ShareLabel | null {
	try {
		const keys = pouchKeys(keyring, share.pouch_id);
		const sealed = unb64(share.label_enc);
		const gen = generation(keys, sealedKeyGen(sealed));
		return JSON.parse(fromUtf8(open(gen.meta, sealed, labelAad(share.id)))) as ShareLabel;
	} catch {
		return null;
	}
}

export function shareUrl(shareId: string, key: string): string {
	return `${location.origin}/s/${shareId}#key=${key}`;
}

/** Reads the key from `#key=…`; null when the link was cut off. */
export function keyFromHash(hash: string): string | null {
	const key = new URLSearchParams(hash.replace(/^#/, '')).get('key');
	return key && /^[A-Za-z0-9_-]{43}$/.test(key) ? key : null;
}

export async function buildBundle(
	keyring: Keyring,
	pouchId: string,
	ingredient: Ingredient,
	description: string,
): Promise<ShareBundle> {
	const files = await fetchIngredientFiles(keyring, pouchId, ingredient);
	const secretKeys = kindDefinition(ingredient.kind)?.secretKeys ?? [];
	const stripped: string[] = [];
	const encoder = new TextEncoder();
	return {
		format: 1,
		kind: ingredient.kind,
		name: ingredient.name,
		description,
		files: ingredient.files.map((entry) => {
			let bytes = files.get(entry.path)!;
			const text = asText(bytes);
			if (text !== null && secretKeys.length > 0 && entry.path.endsWith('.json')) {
				const cleaned = stripSecrets(text, secretKeys);
				stripped.push(...cleaned.stripped.map((key) => `${entry.path}:${key}`));
				bytes = encoder.encode(cleaned.text);
			}
			return { path: entry.path, content: b64(bytes), mode: entry.mode };
		}),
		stripped,
		shared_at: new Date().toISOString(),
	};
}

export function useShares() {
	return useQuery({
		queryKey: queryKeys.shares,
		queryFn: async () => (await api.get<{ shares: ShareRecord[] }>('/v1/shares')).shares,
	});
}

export function useCreateShare(pouchId: string) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: async (input: {
			ingredient: Ingredient;
			description: string;
			expires: ShareExpiry;
			oneTime: boolean;
		}) => {
			const keyring = currentKeyring();
			const id = crypto.randomUUID();
			const key = newShareKey();
			const bundle = await buildBundle(keyring, pouchId, input.ingredient, input.description);
			await api.post(`/v1/pouches/${pouchId}/shares`, {
				id,
				bundle: b64(sealShare(id, key, bundle)),
				label_enc: sealShareLabel(keyring, pouchId, id, {
					kind: input.ingredient.kind,
					name: input.ingredient.name,
				}),
				expires: input.expires,
				one_time: input.oneTime,
			});
			return { id, url: shareUrl(id, key), stripped: bundle.stripped };
		},
		onSuccess: () =>
			Promise.all([
				client.invalidateQueries({ queryKey: queryKeys.shares }),
				client.invalidateQueries({ queryKey: queryKeys.me }),
			]),
	});
}

export function useRevokeShare() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (shareId: string) => api.post(`/v1/shares/${shareId}/revoke`),
		onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.shares }),
	});
}

// ---- recipient side ------------------------------------------------------------

export function fetchPublicShare(shareId: string): Promise<PublicShareRecord> {
	return api.get<PublicShareRecord>(`/v1/public/shares/${shareId}`);
}

/** Reusable links: download and open. */
export async function openReusableShare(shareId: string, key: string): Promise<ShareBundle> {
	const sealed = await api.bytes('GET', `/v1/public/shares/${shareId}/bundle`);
	return openShare(shareId, key, sealed);
}

/** One-time links: claiming uses the link up, so it happens only on "Open". */
export async function claimOneTimeShare(shareId: string, key: string): Promise<ShareBundle> {
	const { bundle } = await api.post<{ bundle: string }>(`/v1/shares/${shareId}/claim`);
	return openShare(shareId, key, unb64(bundle));
}

export function recordImport(shareId: string): Promise<unknown> {
	return api.post(`/v1/shares/${shareId}/imported`);
}
