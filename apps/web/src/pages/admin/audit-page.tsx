// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/admin/audit` — every admin change and sensitive account event, newest
 * first. The log is hash-chained on the server: entries can't be edited.
 */
import { Link } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { actorLabel, pagedItems, useAuditLog, type Audit } from '@/features/admin/admin';
import {
	cellClass,
	LoadMore,
	rowClass,
	Table,
	TableSkeleton,
} from '@/features/admin/components/parts';
import { formatRelative } from '@/lib/format';

export function AdminAuditPage() {
	const audit = useAuditLog();
	const items = pagedItems(audit.data);
	return (
		<>
			<PageHeader
				title="Audit log"
				description="Every admin change, with who made it and why. Entries can't be edited or removed."
			/>
			<ErrorMessage error={audit.error} className="mb-4" />
			{audit.isPending ? (
				<TableSkeleton rows={10} />
			) : items.length ? (
				<>
					<Table label="Audit log" head={['When', 'Who', 'What', 'Target', 'Details']}>
						{items.map((entry) => (
							<tr key={entry.id} className={rowClass}>
								<td
									className={`${cellClass} text-muted`}
									title={new Date(entry.created_at).toLocaleString()}
								>
									{formatRelative(entry.created_at)}
								</td>
								<td
									className={`${cellClass} max-w-[200px] truncate font-mono text-xs`}
								>
									<Actor actor={entry.actor} />
								</td>
								<td className={`${cellClass} font-mono text-xs text-fg`}>
									{entry.action}
								</td>
								<td
									className={`${cellClass} max-w-[200px] truncate font-mono text-xs text-meta`}
								>
									{entry.target ?? '—'}
								</td>
								<td className={`${cellClass} max-w-[320px] truncate text-muted`}>
									{describeDetails(entry)}
								</td>
							</tr>
						))}
					</Table>
					<LoadMore
						hasMore={audit.hasNextPage}
						loading={audit.isFetchingNextPage}
						onMore={() => void audit.fetchNextPage()}
					/>
				</>
			) : (
				<EmptyState icon={ScrollText} title="Nothing logged yet" />
			)}
		</>
	);
}

function Actor({ actor }: { actor: string }) {
	const label = actorLabel(actor);
	if (!actor.startsWith('user:')) return <span className="text-muted">{label}</span>;
	return (
		<Link
			to="/admin/users/$userId"
			params={{ userId: label }}
			className="text-muted hover:text-fg hover:underline"
		>
			{label}
		</Link>
	);
}

/** The reason first, then whatever else the entry carries. */
export function describeDetails(entry: Pick<Audit, 'details'>): string {
	const { reason, ...rest } = entry.details as Record<string, unknown>;
	const others = Object.entries(rest)
		.filter(([, value]) => value !== null && value !== undefined && value !== '')
		.map(
			([key, value]) =>
				`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
		);
	return (
		[typeof reason === 'string' ? `“${reason}”` : null, ...others]
			.filter(Boolean)
			.join(' · ') || '—'
	);
}
