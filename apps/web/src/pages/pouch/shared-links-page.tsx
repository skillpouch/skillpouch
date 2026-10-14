// SPDX-License-Identifier: AGPL-3.0-only
/** `/pouches/:pouchId/shared` — share links created from this pouch. */
import { useParams } from '@tanstack/react-router';
import { Share2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Skeleton } from '@/components/ui/skeleton';
import { kindDefinition } from '@/features/ingredients/kinds';
import { useUnlocked } from '@/features/session/session-store';
import { openShareLabel, useRevokeShare, useShares } from '@/features/shares/shares';
import type { ShareRecord } from '@/lib/api/types';
import { formatDate, formatRelative } from '@/lib/format';

const STATE_TONE = {
	active: 'success',
	expired: 'neutral',
	revoked: 'neutral',
	consumed: 'neutral',
} as const;

const STATE_LABEL = {
	active: 'Active',
	expired: 'Expired',
	revoked: 'Revoked',
	consumed: 'Used',
} as const;

export function SharedLinksPage() {
	const { pouchId } = useParams({ strict: false }) as { pouchId: string };
	const { keyring } = useUnlocked();
	const shares = useShares();
	const revoke = useRevokeShare();
	const [revoking, setRevoking] = useState<ShareRecord | null>(null);
	const rows = (shares.data ?? [])
		.filter((share) => share.pouch_id === pouchId)
		.map((share) => ({ share, label: openShareLabel(keyring, share) }));

	return (
		<>
			<PageHeader
				title="Shared links"
				description="Links created from this pouch. The key is in the link itself. SkillPouch can’t read what you share."
			/>
			<ErrorMessage error={shares.error} />
			{shares.isPending ? (
				<Skeleton className="h-24" />
			) : rows.length === 0 ? (
				<EmptyState
					icon={Share2}
					title="No shared links"
					description="Open an item and choose Share to create a link anyone can import."
				/>
			) : (
				<ul className="divide-y divide-border-soft rounded-lg border border-border">
					{rows.map(({ share, label }) => {
						const kind = label ? kindDefinition(label.kind) : undefined;
						return (
							<li
								key={share.id}
								className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
							>
								<div className="min-w-0 flex-1">
									<p className="flex items-center gap-2 text-[13px]">
										<span className="truncate font-mono text-fg">
											{label?.name ?? 'Unreadable label'}
										</span>
										<span className="text-xs text-meta">
											{kind?.singular ?? ''}
										</span>
										<Badge tone={STATE_TONE[share.state]}>
											{STATE_LABEL[share.state]}
										</Badge>
										{share.one_time ? <Badge>One import</Badge> : null}
									</p>
									<p className="mt-1 text-xs text-meta">
										Created {formatRelative(share.created_at)} ·{' '}
										{share.expires_at
											? `Expires ${formatDate(share.expires_at)}`
											: 'Never expires'}{' '}
										· {share.views} views · {share.imports} imports
									</p>
								</div>
								{share.state === 'active' ? (
									<Button
										size="sm"
										variant="danger-outline"
										onClick={() => setRevoking(share)}
									>
										Revoke
									</Button>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
			<p className="mt-4 text-xs text-meta">
				Links can’t be copied again later: the key was only in the link you copied.
			</p>
			<ConfirmDialog
				open={revoking !== null}
				onOpenChange={(open) => !open && setRevoking(null)}
				title="Revoke this link?"
				description="It stops working immediately and its encrypted copy is deleted. People who already imported it keep their copy."
				confirmLabel="Revoke"
				onConfirm={async () => {
					if (revoking) await revoke.mutateAsync(revoking.id);
				}}
			/>
		</>
	);
}
