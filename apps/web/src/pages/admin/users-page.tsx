// SPDX-License-Identifier: AGPL-3.0-only
/** `/admin/users` — every account, newest first; search by email, name or id. */
import { useNavigate } from '@tanstack/react-router';
import { Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { pagedItems, useAdminUsers, type AdminUserRecord } from '@/features/admin/admin';
import {
	cellClass,
	LoadMore,
	rowClass,
	Table,
	TableSkeleton,
} from '@/features/admin/components/parts';
import { formatBytes, formatDate } from '@/lib/format';

export function AdminUsersPage() {
	const [text, setText] = useState('');
	const [query, setQuery] = useState('');
	useEffect(() => {
		const timer = setTimeout(() => setQuery(text.trim()), 300);
		return () => clearTimeout(timer);
	}, [text]);
	const users = useAdminUsers(query);
	const items = pagedItems(users.data);
	return (
		<>
			<PageHeader
				title="Users"
				description="Accounts, newest first. Open one to manage it."
			/>
			<div className="relative mb-4 max-w-md">
				<Search
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-meta"
					aria-hidden
				/>
				<Input
					aria-label="Search users"
					placeholder="Email, name or user id"
					className="pl-9"
					value={text}
					onChange={(event) => setText(event.target.value)}
					spellCheck={false}
				/>
			</div>
			<ErrorMessage error={users.error} className="mb-4" />
			{users.isPending ? (
				<TableSkeleton />
			) : items.length ? (
				<>
					<UserTable users={items} />
					<LoadMore
						hasMore={users.hasNextPage}
						loading={users.isFetchingNextPage}
						onMore={() => void users.fetchNextPage()}
					/>
				</>
			) : (
				<EmptyState
					icon={Users}
					title={query ? 'Nobody matches' : 'No users yet'}
					description={query ? `Nothing found for “${query}”.` : undefined}
				/>
			)}
		</>
	);
}

function UserTable({ users }: { users: AdminUserRecord[] }) {
	const navigate = useNavigate();
	return (
		<Table
			label="Users"
			head={['User', 'Plan', 'Pouches', 'Computers', 'Storage', 'Joined', '']}
		>
			{users.map((user) => {
				const open = () =>
					void navigate({ to: '/admin/users/$userId', params: { userId: user.id } });
				return (
					<tr
						key={user.id}
						className={`${rowClass} cursor-pointer hover:bg-hover/50`}
						onClick={open}
					>
						<td className={`${cellClass} max-w-[280px]`}>
							<button
								type="button"
								onClick={open}
								className="flex min-w-0 cursor-pointer flex-col text-left"
							>
								<span className="truncate text-fg">{user.name || user.email}</span>
								<span className="truncate text-xs text-meta">{user.email}</span>
							</button>
						</td>
						<td className={`${cellClass} text-muted`}>
							{user.entitlements?.plan_name ?? '—'}
						</td>
						<td className={`${cellClass} font-mono text-muted`}>{user.pouch_count}</td>
						<td className={`${cellClass} font-mono text-muted`}>{user.device_count}</td>
						<td className={`${cellClass} font-mono text-muted`}>
							{formatBytes(user.used_bytes)}
						</td>
						<td className={`${cellClass} text-muted`}>{formatDate(user.created_at)}</td>
						<td className={`${cellClass} text-right`}>
							<span className="inline-flex gap-1.5">
								{user.role === 'admin' ? <Badge tone="accent">admin</Badge> : null}
								{user.suspended_at ? <Badge tone="danger">suspended</Badge> : null}
							</span>
						</td>
					</tr>
				);
			})}
		</Table>
	);
}
