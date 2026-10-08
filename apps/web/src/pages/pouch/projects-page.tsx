// SPDX-License-Identifier: AGPL-3.0-only
/** `/app/p/:pouchId/projects` — folders whose own items sync with this pouch. */
import { useNavigate, useParams } from '@tanstack/react-router';
import { FolderGit2, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { usePouchContents } from '@/features/ingredients/ingredients';
import { usePouch } from '@/features/pouches/pouches';
import { ProjectDialog } from '@/features/projects/components/project-dialog';
import { ProjectTable } from '@/features/projects/components/project-table';
import { useCreateProject, useProjects } from '@/features/projects/projects';
import { plural } from '@/lib/format';

export function ProjectsPage() {
	const { pouchId } = useParams({ strict: false }) as { pouchId: string };
	const navigate = useNavigate();
	const pouch = usePouch(pouchId).data;
	const contents = usePouchContents(pouchId);
	const projects = useProjects(pouchId);
	const create = useCreateProject(pouch ?? { id: pouchId, epoch: '' });
	const [creating, setCreating] = useState(false);

	if (!pouch) return <PageSkeleton variant="list" />;
	const readOnly = pouch.state !== 'active';
	const list = projects.data ?? [];
	const newButton = (variant: 'primary' | undefined) =>
		readOnly ? null : (
			<Button {...(variant ? { variant } : {})} onClick={() => setCreating(true)}>
				<Plus /> New project
			</Button>
		);

	return (
		<>
			<PageHeader
				title="Projects"
				description={
					projects.data
						? `${plural(list.length, 'project')} in ${pouch.name}`
						: `Folders synced with ${pouch.name}`
				}
				actions={newButton('primary')}
			/>
			<ErrorMessage error={projects.error} className="mb-4" />
			{!projects.isPending && list.length === 0 ? (
				<EmptyState
					icon={FolderGit2}
					title="No projects yet"
					description={
						<>
							Run <code className="font-mono text-fg">skillpouch init</code> inside a
							project folder to sync its own skills, MCP servers and instruction
							files, or create one here and link it later.
						</>
					}
					action={newButton(undefined)}
				/>
			) : (
				<ProjectTable
					pouchId={pouchId}
					projects={list}
					ingredients={contents.data?.ingredients ?? []}
					loading={projects.isPending}
				/>
			)}
			<ProjectDialog
				open={creating}
				onOpenChange={setCreating}
				onSubmit={async (meta) => {
					const projectId = await create.mutateAsync(meta);
					await navigate({
						to: '/app/p/$pouchId/projects/$projectId',
						params: { pouchId, projectId },
					});
				}}
			/>
		</>
	);
}
