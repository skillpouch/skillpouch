// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Projects of a pouch. A folder joins with `skillpouch init` (or is created
 * here first and linked later); its items keep the scope `project:<id>`.
 * Names and descriptions are encrypted like everything else: the server
 * only ever sees one more opaque item.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { PouchRecord } from '@/lib/api/types';
import { queryKeys } from '@/lib/api/query-keys';
import { asText } from '../ingredients/content';
import {
	fetchBlobs,
	inScope,
	usePouchContents,
	type Ingredient,
	type ProjectRecord,
} from '../ingredients/ingredients';
import { useInvalidateContents } from '../ingredients/mutations';
import { commitIngredient, textFile } from '../ingredients/write';
import { currentKeyring, useUnlocked } from '../session/session-store';
import { PROJECT_FILE, PROJECT_KIND, projectScope } from './scope';

export interface ProjectMeta {
	name: string;
	description: string;
}

export interface Project extends ProjectMeta {
	/** The id in the folder's `.skillpouch/project.json`; scope `project:<id>`. */
	id: string;
	scope: string;
	updatedAt: string;
	record: ProjectRecord;
	/** The whole manifest, so edits keep keys written by the CLI. */
	manifest: Record<string, unknown>;
}

/** Reads a project manifest; null when it is missing or not a JSON object. */
export function parseManifest(text: string | null): Record<string, unknown> | null {
	if (text === null) return null;
	try {
		const value: unknown = JSON.parse(text);
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** Name and description of a manifest, falling back to the project id. */
export function projectMeta(manifest: Record<string, unknown> | null, id: string): ProjectMeta {
	const name = typeof manifest?.name === 'string' ? manifest.name.trim() : '';
	const description = manifest?.description;
	return {
		name: name || id,
		description: typeof description === 'string' ? description.trim() : '',
	};
}

export function serializeManifest(manifest: Record<string, unknown>, meta: ProjectMeta): string {
	const value = { ...manifest, name: meta.name.trim(), description: meta.description.trim() };
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateProjectName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return 'Give the project a name.';
	if (trimmed.length > 64) return 'Use at most 64 characters.';
	return null;
}

/** Live items of one project. */
export function projectItems(ingredients: Ingredient[], projectId: string): Ingredient[] {
	return inScope(ingredients, projectScope(projectId));
}

/** Live projects of a pouch with their decrypted names, sorted by name. */
export function useProjects(pouchId: string) {
	const { keyring } = useUnlocked();
	const contents = usePouchContents(pouchId);
	const records = (contents.data?.projects ?? []).filter((record) => !record.deleted);
	const files = records
		.map((record) => ({ record, entry: record.files.find((e) => e.path === PROJECT_FILE) }))
		.filter((item) => item.entry !== undefined);
	const meta = useQuery({
		queryKey: [
			...queryKeys.projects(pouchId),
			files.map((item) => item.record.revisionId).join(','),
		],
		enabled: contents.data !== undefined,
		staleTime: Number.POSITIVE_INFINITY,
		queryFn: async () => {
			const blobs = await fetchBlobs(
				keyring,
				pouchId,
				files.map((item) => item.entry!.blob),
			);
			const projects: Project[] = records.map((record) => {
				const entry = record.files.find((e) => e.path === PROJECT_FILE);
				const bytes = entry ? blobs.get(entry.blob) : undefined;
				const manifest = parseManifest(bytes ? asText(bytes) : null);
				return {
					id: record.name,
					scope: projectScope(record.name),
					...projectMeta(manifest, record.name),
					updatedAt: record.updatedAt,
					record,
					manifest: manifest ?? {},
				};
			});
			return projects.sort((a, b) => a.name.localeCompare(b.name));
		},
	});
	return {
		data: meta.data,
		isPending: contents.isPending || meta.isPending,
		error: contents.error ?? meta.error,
	};
}

type PouchRef = Pick<PouchRecord, 'id' | 'epoch'>;

export function useCreateProject(pouch: PouchRef) {
	const invalidate = useInvalidateContents(pouch.id);
	return useMutation({
		mutationFn: async (meta: ProjectMeta) => {
			const id = crypto.randomUUID();
			await commitIngredient({
				keyring: currentKeyring(),
				pouch,
				type: 'create',
				artifactId: crypto.randomUUID(),
				base: null,
				kind: PROJECT_KIND,
				name: id,
				files: [textFile(PROJECT_FILE, serializeManifest({}, meta))],
			});
			return id;
		},
		onSettled: invalidate,
	});
}

export function useUpdateProject(pouch: PouchRef) {
	const invalidate = useInvalidateContents(pouch.id);
	return useMutation({
		mutationFn: ({ project, meta }: { project: Project; meta: ProjectMeta }) =>
			commitIngredient({
				keyring: currentKeyring(),
				pouch,
				type: 'update',
				artifactId: project.record.id,
				base: project.record,
				kind: PROJECT_KIND,
				scope: project.record.scope,
				name: project.id,
				files: [textFile(PROJECT_FILE, serializeManifest(project.manifest, meta))],
			}),
		onSettled: invalidate,
	});
}

/** Deletes every item of the project, then the project itself. */
export function useDeleteProject(pouch: PouchRef) {
	const invalidate = useInvalidateContents(pouch.id);
	return useMutation({
		mutationFn: async ({ project, items }: { project: Project; items: Ingredient[] }) => {
			const keyring = currentKeyring();
			for (const item of [...items, project.record]) {
				await commitIngredient({
					keyring,
					pouch,
					type: 'delete',
					artifactId: item.id,
					base: item,
					kind: item.kind,
					scope: item.scope,
					name: item.name,
					previousEntries: item.files,
				});
			}
		},
		onSettled: invalidate,
	});
}
