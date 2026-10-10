// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading a pouch's contents. The server returns opaque artifacts whose head
 * revision is a sealed, signed envelope; here each one is verified against
 * the signer's roster key, decrypted, and turned into an `Ingredient`. A head
 * this browser already saw replaced by a newer one is refused (`head-pins`).
 *
 * File contents are fetched separately (and only when needed) in one framed
 * batch request, then decrypted blob by blob.
 */
import {
	CryptoError,
	maySignRevision,
	openBlob,
	openRevision,
	parseFetched,
	pouchKeys,
	type Keyring,
	type ManifestEntry,
	type RevisionBody,
} from '@skillpouch/crypto';
import { Limits } from '@skillpouch/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { ArtifactRecord, RevisionRecord } from '@/lib/api/types';
import { useUnlocked } from '../session/session-store';
import { pinHeads } from '../vault/head-pins';
import { reportTamper } from '../vault/security-report';
import { asText, describe } from './content';
import { isIngredientKind, kindDefinition, type IngredientKind } from './kinds';

/** Items are synced into every assistant's home folder; other scopes are not shown. */
export const GLOBAL_SCOPE = 'global';

export interface Ingredient {
	id: string;
	kind: IngredientKind;
	scope: string;
	name: string;
	files: ManifestEntry[];
	/** Plaintext bytes of all files. */
	size: number;
	revisionId: string;
	keyGen: number;
	updatedAt: string;
	createdBy: string;
	deleted: boolean;
	/** The decrypted revision body, needed to build the next revision. */
	body: RevisionBody;
}

/** An artifact this browser couldn't verify or decrypt — listed, never trusted. */
export interface UnreadableArtifact {
	id: string;
	reason: string;
}

export interface PouchContents {
	/** Items of every scope; `inScope` keeps the global ones. */
	ingredients: Ingredient[];
	unreadable: UnreadableArtifact[];
}

export async function openHead(
	keyring: Keyring,
	pouchId: string,
	head: RevisionRecord,
	updatedAt: string,
	deleted: boolean,
): Promise<Ingredient | null> {
	const signer = keyring.roster.members.get(head.signer_member_id);
	if (!signer) throw new CryptoError('signature_invalid', 'revision by an unknown member');
	const body = await openRevision(
		pouchKeys(keyring, pouchId),
		{ ...head, revision_id: head.id },
		signer.signPub,
	);
	if (!maySignRevision(keyring.roster, signer.id, body.roster_head)) {
		throw new CryptoError(
			'signature_invalid',
			'revision by a member removed before it was written',
		);
	}
	const kind = body.kind;
	if (!isIngredientKind(kind)) return null;
	return {
		id: body.artifact_id,
		kind,
		scope: body.scope,
		name: body.logical_key,
		files: body.entries,
		size: body.entries.reduce((sum, entry) => sum + entry.size, 0),
		revisionId: body.revision_id,
		keyGen: head.key_gen,
		updatedAt,
		createdBy: body.author_member_id,
		deleted: deleted || body.deleted,
		body,
	};
}

async function fetchAllArtifacts(pouchId: string): Promise<ArtifactRecord[]> {
	const all: ArtifactRecord[] = [];
	let cursor: string | null = null;
	do {
		const page: { data: { items: ArtifactRecord[] }; nextCursor: string | null } =
			await api.page<{ items: ArtifactRecord[] }>(`/v1/pouches/${pouchId}/artifacts`, {
				query: { limit: Limits.pageMax, cursor },
			});
		all.push(...page.data.items);
		cursor = page.nextCursor;
	} while (cursor);
	return all;
}

export async function loadPouchContents(keyring: Keyring, pouchId: string): Promise<PouchContents> {
	const artifacts = await fetchAllArtifacts(pouchId);
	const ingredients: Ingredient[] = [];
	const unreadable: UnreadableArtifact[] = [];
	await Promise.all(
		artifacts.map(async (artifact) => {
			if (!artifact.head) return;
			try {
				const opened = await openHead(
					keyring,
					pouchId,
					artifact.head,
					artifact.updated_at,
					artifact.deleted_at !== null,
				);
				if (opened) ingredients.push(opened);
			} catch (error) {
				reportTamper(error, { where: 'revision', pouchId });
				unreadable.push({ id: artifact.id, reason: (error as Error).message });
			}
		}),
	);
	const replayed = await pinHeads(
		keyring.member.id,
		pouchId,
		ingredients.map((ingredient) => ({
			artifactId: ingredient.id,
			revisionId: ingredient.revisionId,
			parents: [ingredient.body.parent_id, ingredient.body.merge_parent_id],
		})),
	);
	const current = ingredients.filter((ingredient) => !replayed.has(ingredient.id));
	for (const id of replayed) {
		const error = new CryptoError(
			'revision_rollback',
			'the server offered an older version of an item than this browser already saw',
		);
		reportTamper(error, { where: 'revision', pouchId });
		unreadable.push({ id, reason: error.message });
	}
	current.sort((a, b) => a.name.localeCompare(b.name));
	return { ingredients: current, unreadable };
}

export function usePouchContents(pouchId: string) {
	const { keyring } = useUnlocked();
	return useQuery({
		queryKey: [...queryKeys.contents(pouchId), keyring.roster.headSeq],
		queryFn: () => loadPouchContents(keyring, pouchId),
	});
}

/** Downloads and decrypts blobs in batches of the API's framed fetch limit. */
export async function fetchBlobs(
	keyring: Keyring,
	pouchId: string,
	ids: string[],
): Promise<Map<string, Uint8Array>> {
	const keys = pouchKeys(keyring, pouchId);
	const unique = [...new Set(ids)];
	const result = new Map<string, Uint8Array>();
	for (let start = 0; start < unique.length; start += Limits.blobBatchMaxParts) {
		const batch = unique.slice(start, start + Limits.blobBatchMaxParts);
		const framed = await api.bytes('POST', `/v1/pouches/${pouchId}/blobs/fetch`, {
			body: { ids: batch },
		});
		try {
			for (const [id, stored] of parseFetched(framed))
				result.set(id, openBlob(keys, id, stored));
		} catch (error) {
			reportTamper(error, { where: 'blob', pouchId });
			throw error;
		}
	}
	return result;
}

/** All files of one ingredient version, keyed by path. */
export async function fetchIngredientFiles(
	keyring: Keyring,
	pouchId: string,
	ingredient: Pick<Ingredient, 'files'>,
): Promise<Map<string, Uint8Array>> {
	const blobs = await fetchBlobs(
		keyring,
		pouchId,
		ingredient.files.map((entry) => entry.blob),
	);
	const files = new Map<string, Uint8Array>();
	for (const entry of ingredient.files) {
		const bytes = blobs.get(entry.blob);
		if (!bytes) throw new Error(`missing file ${entry.path}`);
		files.set(entry.path, bytes);
	}
	return files;
}

export function useIngredientFiles(pouchId: string, ingredient: Ingredient | null) {
	const { keyring } = useUnlocked();
	return useQuery({
		queryKey: queryKeys.files(pouchId, ingredient?.revisionId ?? 'none'),
		queryFn: () => fetchIngredientFiles(keyring, pouchId, ingredient!),
		enabled: ingredient !== null,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

/** The main file of an ingredient (or its first file). */
export function mainEntry(
	ingredient: Pick<Ingredient, 'kind' | 'files'>,
): ManifestEntry | undefined {
	const main = kindDefinition(ingredient.kind)?.mainFile;
	return ingredient.files.find((entry) => entry.path === main) ?? ingredient.files[0];
}

/**
 * One-line descriptions for a list: only the main files are downloaded, in
 * batches. Keyed by revision id so edits refresh them.
 */
export function useDescriptions(pouchId: string, ingredients: Ingredient[] | undefined) {
	const { keyring } = useUnlocked();
	const wanted = (ingredients ?? [])
		.map((ingredient) => ({ ingredient, entry: mainEntry(ingredient) }))
		.filter((item): item is { ingredient: Ingredient; entry: ManifestEntry } => !!item.entry);
	return useQuery({
		queryKey: [
			...queryKeys.descriptions(pouchId),
			wanted.map((item) => item.ingredient.revisionId).join(','),
		],
		enabled: wanted.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
		queryFn: async () => {
			const blobs = await fetchBlobs(
				keyring,
				pouchId,
				wanted.map((item) => item.entry.blob),
			);
			const descriptions = new Map<string, string>();
			for (const { ingredient, entry } of wanted) {
				const bytes = blobs.get(entry.blob);
				descriptions.set(ingredient.id, describe(entry.path, bytes ? asText(bytes) : null));
			}
			return descriptions;
		},
	});
}

/** Most recently updated first; a single-item kind uses the first. */
export function newestFirst(ingredients: readonly Ingredient[]): Ingredient[] {
	return [...ingredients].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Live global ingredients, sorted by name. */
export function inScope(ingredients: Ingredient[]): Ingredient[] {
	return ingredients.filter(
		(ingredient) => ingredient.scope === GLOBAL_SCOPE && !ingredient.deleted,
	);
}

/**
 * The live item of `kind` already called `name` (names are unique per kind,
 * case-insensitively), other than `except`.
 */
export function nameTaken(
	ingredients: Ingredient[],
	kind: string,
	name: string,
	except?: string,
): Ingredient | undefined {
	const folded = name.normalize('NFC').toLowerCase();
	return inScope(ingredients).find(
		(ingredient) =>
			ingredient.kind === kind &&
			ingredient.id !== except &&
			ingredient.name.normalize('NFC').toLowerCase() === folded,
	);
}

/** Live global ingredients per kind (sidebar counts, overview). */
export function countByKind(ingredients: Ingredient[]): Record<IngredientKind, number> {
	const counts = {
		skill: 0,
		instructions: 0,
		agent: 0,
		command: 0,
		mcp_server: 0,
		hook: 0,
		plugin: 0,
	} satisfies Record<IngredientKind, number>;
	for (const ingredient of inScope(ingredients)) counts[ingredient.kind]++;
	return counts;
}

export interface ConflictRecord {
	id: string;
	artifact_id: string | null;
	type: 'update_update' | 'edit_delete' | 'delete_edit' | 'name_collision' | 'local_projection';
	base_revision_id: string | null;
	server_revision_id: string | null;
	incoming_revision_id: string | null;
	head_revision_id: string | null;
	device_id: string | null;
	state: 'open' | 'resolved' | 'superseded';
	created_at: string;
}

/** Open conflicts of a pouch: both versions are kept until someone picks one. */
export function useOpenConflicts(pouchId: string) {
	return useQuery({
		queryKey: queryKeys.conflicts(pouchId),
		queryFn: async () =>
			(
				await api.get<{ conflicts: ConflictRecord[] }>(`/v1/pouches/${pouchId}/conflicts`, {
					query: { state: 'open' },
				})
			).conflicts,
	});
}
