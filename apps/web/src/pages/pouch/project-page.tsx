// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/app/p/:pouchId/projects/:projectId` — what one project uses, one type at a
 * time (`?kind=skills`). Instruction files are kept per file here (AGENTS.md,
 * CLAUDE.md, …): we can't know which assistant a project is used with.
 */
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { Segmented } from '@/components/ui/segmented';
import { toast } from '@/components/ui/toast';
import {
	IngredientList,
	type PanelSearch,
} from '@/features/ingredients/components/ingredient-list';
import { countByKind, usePouchContents } from '@/features/ingredients/ingredients';
import { KINDS, kindBySlug } from '@/features/ingredients/kinds';
import { usePouch } from '@/features/pouches/pouches';
import { ProjectDialog } from '@/features/projects/components/project-dialog';
import {
	projectItems,
	useDeleteProject,
	useProjects,
	useUpdateProject,
} from '@/features/projects/projects';
import { plural } from '@/lib/format';
import { NotFoundPage } from '../not-found-page';

export interface ProjectSearch extends PanelSearch {
	kind?: string;
}

export function ProjectPage() {
	const { pouchId, projectId } = useParams({ strict: false }) as {
		pouchId: string;
		projectId: string;
	};
	const search = useSearch({ strict: false }) as ProjectSearch;
	const navigate = useNavigate();
	const pouch = usePouch(pouchId).data;
	const contents = usePouchContents(pouchId);
	const projects = useProjects(pouchId);
	const ref = pouch ?? { id: pouchId, epoch: '' };
	const update = useUpdateProject(ref);
	const remove = useDeleteProject(ref);
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const project = projects.data?.find((candidate) => candidate.id === projectId);
	if (!projects.isPending && !project && remove.isIdle) return <NotFoundPage />;
	if (!pouch || !project) return <PageSkeleton variant="list" />;

	const readOnly = pouch.state !== 'active';
	const items = projectItems(contents.data?.ingredients ?? [], project.id);
	const counts = countByKind(items, project.scope);
	const kind =
		kindBySlug(search.kind ?? '') ??
		KINDS.find((candidate) => counts[candidate.kind] > 0) ??
		kindBySlug('instructions')!;

	const go = (next: ProjectSearch) =>
		void navigate({
			to: '/app/p/$pouchId/projects/$projectId',
			params: { pouchId, projectId },
			search: next,
			replace: true,
		});
	const setPanel = (next: PanelSearch) => go({ kind: kind.slug, ...next });

	return (
		<>
			<Link
				to="/app/p/$pouchId/projects"
				params={{ pouchId }}
				className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
			>
				<ChevronLeft className="size-4" aria-hidden /> Projects
			</Link>
			<PageHeader
				title={project.name}
				description={project.description || plural(items.length, 'item')}
				actions={
					readOnly ? null : (
						<>
							<Button onClick={() => setEditing(true)}>
								<Pencil /> Edit
							</Button>
							<Button variant="danger-outline" onClick={() => setDeleting(true)}>
								<Trash2 /> Delete
							</Button>
							<Button variant="primary" onClick={() => setPanel({ new: true })}>
								<Plus /> Add {kind.singular.toLowerCase()}
							</Button>
						</>
					)
				}
			/>
			<p className="-mt-3 mb-6 flex flex-wrap items-center gap-2 text-xs text-meta">
				<span>
					Project ID <span className="font-mono text-muted">{project.id}</span>
				</span>
				<CopyButton value={project.id} variant="ghost" className="h-6 px-2 text-xs" />
			</p>
			<div className="mb-5 overflow-x-auto">
				<Segmented
					label="Type"
					value={kind.slug}
					onChange={(slug) => go({ kind: slug })}
					options={KINDS.map((candidate) => ({
						value: candidate.slug,
						label: counts[candidate.kind]
							? `${candidate.label} ${counts[candidate.kind]}`
							: candidate.label,
					}))}
					className="w-max"
				/>
			</div>
			<IngredientList
				key={kind.kind}
				pouch={pouch}
				kind={kind}
				scope={project.scope}
				search={search}
				onPanel={setPanel}
			/>

			<ProjectDialog
				open={editing}
				onOpenChange={setEditing}
				initial={{ name: project.name, description: project.description }}
				onSubmit={(meta) => update.mutateAsync({ project, meta })}
			/>
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title={`Delete ${project.name}?`}
				description={
					items.length
						? `Its ${plural(items.length, 'item')} will be removed from this pouch and from the project folder on every computer on next sync. Older versions are kept for 30 days.`
						: 'It will be removed from this pouch. Linked folders stop syncing on next sync.'
				}
				confirmLabel="Delete project"
				onConfirm={async () => {
					await remove.mutateAsync({ project, items });
					toast.success(`${project.name} deleted`);
					await navigate({ to: '/app/p/$pouchId/projects', params: { pouchId } });
				}}
			/>
		</>
	);
}
