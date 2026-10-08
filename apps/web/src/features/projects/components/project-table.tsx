// SPDX-License-Identifier: AGPL-3.0-only
/** The projects of a pouch: a table on desktop, stacked rows on phones. */
import { Link, useNavigate } from '@tanstack/react-router';
import { Skeleton } from '@/components/ui/skeleton';
import type { Ingredient } from '@/features/ingredients/ingredients';
import { KINDS } from '@/features/ingredients/kinds';
import { formatRelative } from '@/lib/format';
import { projectItems, type Project } from '../projects';

/** "2 Skills · 1 MCP server", or a dash when the project is empty. */
export function summarizeContents(items: Ingredient[]): string {
	const parts = KINDS.map((kind) => {
		const count = items.filter((item) => item.kind === kind.kind).length;
		return count ? `${count} ${count === 1 ? kind.singular : kind.label}` : null;
	}).filter(Boolean);
	return parts.length ? parts.join(' · ') : '—';
}

export function ProjectTable({
	pouchId,
	projects,
	ingredients,
	loading,
}: {
	pouchId: string;
	projects: Project[];
	ingredients: Ingredient[];
	loading: boolean;
}) {
	const navigate = useNavigate();
	if (loading) {
		return (
			<div className="flex flex-col gap-2" aria-busy>
				{Array.from({ length: 4 }, (_, index) => (
					<Skeleton key={index} className="h-12" />
				))}
			</div>
		);
	}
	const rows = projects.map((project) => ({
		project,
		contents: summarizeContents(projectItems(ingredients, project.id)),
	}));
	const link = (project: Project) => ({
		to: '/app/p/$pouchId/projects/$projectId' as const,
		params: { pouchId, projectId: project.id },
	});
	return (
		<>
			<table className="hidden w-full table-fixed border-collapse text-[13px] md:table">
				<thead>
					<tr className="border-b border-border text-left text-xs whitespace-nowrap text-meta">
						<th className="w-[24%] py-2.5 pr-4 font-normal">Name</th>
						<th className="py-2.5 pr-4 font-normal">Description</th>
						<th className="w-[30%] py-2.5 pr-4 font-normal">Contents</th>
						<th className="w-36 py-2.5 font-normal">Updated</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(({ project, contents }) => (
						<tr
							key={project.id}
							onClick={() => void navigate(link(project))}
							className="cursor-pointer border-b border-border-soft whitespace-nowrap transition-colors hover:bg-surface"
						>
							<td className="truncate py-3 pr-4">
								<Link
									{...link(project)}
									className="truncate text-fg outline-none focus-visible:underline"
								>
									{project.name}
								</Link>
							</td>
							<td className="truncate py-3 pr-4 text-muted">
								{project.description || <span className="text-meta">—</span>}
							</td>
							<td className="truncate py-3 pr-4 text-muted">{contents}</td>
							<td className="truncate py-3 text-muted">
								{formatRelative(project.updatedAt)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<ul className="flex flex-col md:hidden">
				{rows.map(({ project, contents }) => (
					<li key={project.id} className="border-b border-border-soft">
						<Link {...link(project)} className="flex min-w-0 flex-col gap-1 py-3">
							<span className="truncate text-sm text-fg">{project.name}</span>
							{project.description ? (
								<span className="truncate text-[13px] text-muted">
									{project.description}
								</span>
							) : null}
							<span className="truncate text-xs text-meta">
								{contents} · {formatRelative(project.updatedAt)}
							</span>
						</Link>
					</li>
				))}
			</ul>
		</>
	);
}
