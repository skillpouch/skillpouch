// SPDX-License-Identifier: AGPL-3.0-only
/** `/admin/system` — the running version, failed jobs and the write pause. */
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { adminApi, useAdminAction, useOverview, useSystem } from '@/features/admin/admin';
import { Figure, FigureGrid, Panel, ReasonDialog } from '@/features/admin/components/parts';
import { formatBytes } from '@/lib/format';
import { useState } from 'react';

export function AdminSystemPage() {
	const system = useSystem();
	const overview = useOverview();
	const [pausing, setPausing] = useState(false);
	const pause = useAdminAction((body: { enabled: boolean; reason: string }) =>
		adminApi.put('/system/write-pause', body),
	);
	const paused = system.data?.write_pause ?? false;
	return (
		<>
			<PageHeader title="System" description="Health of this server." />
			<ErrorMessage error={system.error ?? overview.error} className="mb-4" />
			<div className="flex flex-col gap-6">
				<FigureGrid>
					<Figure label="Version" value={system.data?.version} loading={!system.data} />
					<Figure
						label="Failed jobs, 24 hours"
						value={system.data?.failed_jobs_24h ?? '—'}
						hint={
							system.data?.failed_jobs_24h === null
								? 'worker not started yet'
								: system.data?.failed_jobs_24h
									? 'see the worker log'
									: 'all good'
						}
						loading={!system.data}
					/>
					<Figure
						label="Storage used"
						value={overview.data ? formatBytes(overview.data.storage_used_bytes) : null}
						loading={!overview.data}
					/>
					<Figure
						label="Pouches"
						value={overview.data?.pouches}
						loading={!overview.data}
					/>
				</FigureGrid>
				<Panel
					title="Write pause"
					aside={
						paused ? (
							<Badge tone="warn">writes held</Badge>
						) : (
							<Badge tone="success">normal</Badge>
						)
					}
				>
					<p className="text-[13px] text-muted">
						Holds every change (syncs, edits, sign-ups) while reads keep working. Use it
						around a database move or restore, then turn it off.
					</p>
					<div>
						<Button
							variant={paused ? 'primary' : 'danger-outline'}
							onClick={() => setPausing(true)}
							disabled={!system.data}
						>
							{paused ? 'Resume writes' : 'Pause writes'}
						</Button>
					</div>
				</Panel>
			</div>
			<ReasonDialog
				open={pausing}
				onOpenChange={setPausing}
				title={paused ? 'Resume writes?' : 'Pause every write?'}
				description={
					paused
						? 'Changes are accepted again right away.'
						: 'Every user’s syncs and edits wait until you resume.'
				}
				confirmLabel={paused ? 'Resume writes' : 'Pause writes'}
				danger={!paused}
				onConfirm={(reason) => pause.mutateAsync({ enabled: !paused, reason })}
			/>
		</>
	);
}
