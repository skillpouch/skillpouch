// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/admin/users/:userId` — one account: plan, limits, computers, pouches
 * (sizes only; names are end-to-end encrypted), billing and security events,
 * and every change an admin can make. Each change asks for a reason.
 */
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
	adminApi,
	grantEnd,
	GRANT_LENGTHS,
	statusTone,
	useAdminAction,
	useAdminPlans,
	useAdminUser,
	type GrantLength,
	type UserDetail,
} from '@/features/admin/admin';
import {
	cellClass,
	Panel,
	ReasonDialog,
	rowClass,
	Table,
	TableSkeleton,
} from '@/features/admin/components/parts';
import { OS_LABEL } from '@/features/devices/devices';
import { useSession } from '@/features/session/session-store';
import { formatBytes, formatDate, formatRelative } from '@/lib/format';

type Action =
	| 'grant'
	| 'override'
	| 'clear-override'
	| 'suspend'
	| 'unsuspend'
	| 'revoke-devices'
	| 'make-admin'
	| 'remove-admin'
	| 'delete'
	| { revokeGrant: string };

const GB = 1024 ** 3;

export function AdminUserPage() {
	const { userId } = useParams({ from: '/admin/users/$userId' });
	const detail = useAdminUser(userId);
	const [action, setAction] = useState<Action | null>(null);
	const data = detail.data;
	return (
		<>
			<Link
				to="/admin/users"
				className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
			>
				<ArrowLeft className="size-4" aria-hidden /> Users
			</Link>
			<PageHeader
				title={data ? data.user.name || data.user.email : 'User'}
				description={data ? <UserLine detail={data} /> : null}
			/>
			<ErrorMessage error={detail.error} className="mb-4" />
			{data ? (
				<div className="flex flex-col gap-6">
					<div className="grid gap-6 lg:grid-cols-3">
						<PlanPanel detail={data} onAction={setAction} />
						<LimitsPanel detail={data} onAction={setAction} />
						<AccessPanel detail={data} onAction={setAction} />
					</div>
					<DevicesPanel detail={data} />
					<div className="grid gap-6 lg:grid-cols-2">
						<PouchesPanel detail={data} />
						<EventsPanel detail={data} />
					</div>
				</div>
			) : (
				<TableSkeleton rows={10} />
			)}
			{data ? (
				<Actions detail={data} action={action} onClose={() => setAction(null)} />
			) : null}
		</>
	);
}

function UserLine({ detail }: { detail: UserDetail }) {
	const { user } = detail;
	return (
		<span className="flex flex-wrap items-center gap-2">
			<span>{user.email}</span>
			<span aria-hidden>·</span>
			<span>joined {formatDate(user.created_at)}</span>
			<span className="font-mono text-meta">{user.id}</span>
			{user.role === 'admin' ? <Badge tone="accent">admin</Badge> : null}
			{user.suspended_at ? <Badge tone="danger">suspended</Badge> : null}
			{user.entitlements === null ? <Badge>no account yet</Badge> : null}
		</span>
	);
}

type PanelProps = { detail: UserDetail; onAction: (action: Action) => void };

function PlanPanel({ detail, onAction }: PanelProps) {
	const { entitlements } = detail.user;
	const grants = detail.grants.filter((grant) => !grant.revoked_at);
	return (
		<Panel
			title="Plan"
			aside={
				<Button size="sm" onClick={() => onAction('grant')} disabled={!entitlements}>
					Give a plan
				</Button>
			}
		>
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
				<dt className="text-meta">Plan</dt>
				<dd className="text-fg">{entitlements?.plan_name ?? '—'}</dd>
				<dt className="text-meta">Through</dt>
				<dd className="text-muted">{entitlements?.source ?? '—'}</dd>
			</dl>
			{detail.subscriptions.map((sub) => (
				<div key={sub.id} className="flex items-center justify-between gap-2 text-[13px]">
					<span className="truncate font-mono text-xs text-meta">
						{sub.external_subscription_id}
					</span>
					<Badge tone={statusTone(sub.status)}>{sub.status.replace(/_/g, ' ')}</Badge>
				</div>
			))}
			{grants.length ? (
				<ul className="flex flex-col gap-2 border-t border-border-soft pt-3 text-[13px]">
					{grants.map((grant) => (
						<li key={grant.id} className="flex items-center justify-between gap-2">
							<span className="min-w-0">
								<span className="text-fg">{grant.plan_slug}</span>{' '}
								<span className="text-meta">
									{grant.ends_at
										? `until ${formatDate(grant.ends_at)}`
										: 'forever'}
								</span>
							</span>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => onAction({ revokeGrant: grant.id })}
							>
								Take back
							</Button>
						</li>
					))}
				</ul>
			) : null}
		</Panel>
	);
}

function LimitsPanel({ detail, onAction }: PanelProps) {
	const { entitlements, used_bytes, pouch_count } = detail.user;
	const { override } = detail;
	return (
		<Panel
			title="Limits"
			aside={
				<Button size="sm" onClick={() => onAction('override')} disabled={!entitlements}>
					{override ? 'Change' : 'Override'}
				</Button>
			}
		>
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
				<dt className="text-meta">Pouches</dt>
				<dd className="font-mono text-fg">
					{pouch_count} of {entitlements?.pouch_limit ?? '—'}
				</dd>
				<dt className="text-meta">Storage</dt>
				<dd className="font-mono text-fg">
					{formatBytes(used_bytes)} of{' '}
					{entitlements ? formatBytes(entitlements.storage_bytes) : '—'}
				</dd>
			</dl>
			{override ? (
				<div className="flex items-start justify-between gap-2 border-t border-border-soft pt-3 text-[13px]">
					<span className="text-muted">
						Override
						{override.expires_at ? ` until ${formatDate(override.expires_at)}` : ''}
						{override.note ? ` · ${override.note}` : ''}
					</span>
					<Button size="sm" variant="ghost" onClick={() => onAction('clear-override')}>
						Remove
					</Button>
				</div>
			) : null}
		</Panel>
	);
}

function AccessPanel({ detail, onAction }: PanelProps) {
	const session = useSession();
	const self = 'me' in session && session.me.user.id === detail.user.id;
	const { user } = detail;
	return (
		<Panel title="Access">
			<div className="flex flex-col gap-2">
				{user.suspended_at ? (
					<Button onClick={() => onAction('unsuspend')}>Lift suspension</Button>
				) : (
					<Button
						variant="danger-outline"
						onClick={() => onAction('suspend')}
						disabled={self}
					>
						Suspend
					</Button>
				)}
				<Button
					variant="danger-outline"
					onClick={() => onAction('revoke-devices')}
					disabled={!detail.devices.some((device) => device.state !== 'revoked')}
				>
					Sign out every computer
				</Button>
				<Button
					onClick={() => onAction(user.role === 'admin' ? 'remove-admin' : 'make-admin')}
				>
					{user.role === 'admin' ? 'Remove admin' : 'Make admin'}
				</Button>
				<Button
					variant="danger-outline"
					onClick={() => onAction('delete')}
					disabled={self || !user.storage_account_id}
				>
					Delete account
				</Button>
			</div>
			{user.suspended_at ? (
				<p className="text-xs text-meta">Suspended {formatRelative(user.suspended_at)}.</p>
			) : null}
		</Panel>
	);
}

function DevicesPanel({ detail }: { detail: UserDetail }) {
	return (
		<Panel title="Computers">
			{detail.devices.length ? (
				<Table label="Computers" head={['Name', 'System', 'CLI', 'State', 'Last seen']}>
					{detail.devices.map((device) => (
						<tr key={device.id} className={rowClass}>
							<td className={`${cellClass} text-fg`}>{device.name}</td>
							<td className={`${cellClass} text-muted`}>
								{OS_LABEL[device.os as keyof typeof OS_LABEL] ?? device.os}
							</td>
							<td className={`${cellClass} font-mono text-muted`}>
								{device.cli_version}
							</td>
							<td className={cellClass}>
								<Badge tone={device.state === 'active' ? 'success' : 'neutral'}>
									{device.state}
								</Badge>
							</td>
							<td className={`${cellClass} text-muted`}>
								{device.last_seen_at
									? formatRelative(device.last_seen_at)
									: 'never'}
							</td>
						</tr>
					))}
				</Table>
			) : (
				<p className="py-4 text-center text-[13px] text-meta">No computers connected.</p>
			)}
		</Panel>
	);
}

function PouchesPanel({ detail }: { detail: UserDetail }) {
	return (
		<Panel title="Pouches">
			<p className="-mt-2 text-xs text-meta">
				Names and contents are end-to-end encrypted; only sizes are known.
			</p>
			{detail.pouches.length ? (
				<Table label="Pouches" head={['Pouch', 'State', 'Stored', 'Created']} wide={false}>
					{detail.pouches.map((pouch) => (
						<tr key={pouch.id} className={rowClass}>
							<td className={`${cellClass} font-mono text-xs text-meta`}>
								{pouch.id.slice(0, 8)}
							</td>
							<td className={`${cellClass} text-muted`}>{pouch.state}</td>
							<td className={`${cellClass} font-mono text-muted`}>
								{formatBytes(pouch.stored_bytes)}
							</td>
							<td className={`${cellClass} text-muted`}>
								{formatDate(pouch.created_at)}
							</td>
						</tr>
					))}
				</Table>
			) : (
				<p className="py-4 text-center text-[13px] text-meta">No pouches.</p>
			)}
		</Panel>
	);
}

function EventsPanel({ detail }: { detail: UserDetail }) {
	return (
		<Panel title="Security events">
			{detail.security_events.length ? (
				<ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-[13px]">
					{detail.security_events.map((event, index) => (
						<li key={index} className="flex items-center justify-between gap-3">
							<span className="flex min-w-0 items-center gap-2">
								{event.severity === 'info' ? null : (
									<Badge tone={event.severity === 'critical' ? 'danger' : 'warn'}>
										{event.severity}
									</Badge>
								)}
								<span className="truncate font-mono text-xs text-muted">
									{event.kind}
								</span>
							</span>
							<span className="shrink-0 text-xs text-meta">
								{formatRelative(event.created_at)}
							</span>
						</li>
					))}
				</ul>
			) : (
				<p className="py-4 text-center text-[13px] text-meta">Nothing yet.</p>
			)}
		</Panel>
	);
}

function Actions({
	detail,
	action,
	onClose,
}: {
	detail: UserDetail;
	action: Action | null;
	onClose: () => void;
}) {
	const id = encodeURIComponent(detail.user.id);
	const who = detail.user.email;
	const send = useAdminAction((call: () => Promise<unknown>) => call());
	const run = (call: () => Promise<unknown>) => send.mutateAsync(call);
	const open = (kind: Action) =>
		action !== null && JSON.stringify(action) === JSON.stringify(kind);
	const shared = (kind: Action) => ({
		open: open(kind),
		onOpenChange: (next: boolean) => {
			if (!next) onClose();
		},
	});
	return (
		<>
			<GrantDialog {...shared('grant')} userId={id} who={who} run={run} />
			<OverrideDialog {...shared('override')} detail={detail} run={run} />
			<ReasonDialog
				{...shared('clear-override')}
				title="Remove the override?"
				description={`${who} goes back to their plan's limits.`}
				confirmLabel="Remove override"
				onConfirm={(reason) =>
					run(() => adminApi.delete(`/users/${id}/override`, { reason }))
				}
			/>
			<ReasonDialog
				{...shared('suspend')}
				title={`Suspend ${who}?`}
				description="They are signed out everywhere and can't use SkillPouch until the suspension is lifted. Nothing is deleted."
				confirmLabel="Suspend"
				danger
				onConfirm={(reason) => run(() => adminApi.post(`/users/${id}/suspend`, { reason }))}
			/>
			<ReasonDialog
				{...shared('unsuspend')}
				title={`Lift the suspension of ${who}?`}
				confirmLabel="Lift suspension"
				onConfirm={(reason) =>
					run(() => adminApi.post(`/users/${id}/unsuspend`, { reason }))
				}
			/>
			<ReasonDialog
				{...shared('revoke-devices')}
				title="Sign out every computer?"
				description={`Each of ${who}'s computers has to log in again, approved from their browser.`}
				confirmLabel="Sign out all"
				danger
				onConfirm={(reason) =>
					run(() => adminApi.post(`/users/${id}/revoke-devices`, { reason }))
				}
			/>
			<ReasonDialog
				{...shared('make-admin')}
				title={`Make ${who} an admin?`}
				description="They can see every account's details and change plans, limits and access."
				confirmLabel="Make admin"
				danger
				onConfirm={(reason) =>
					run(() => adminApi.post(`/users/${id}/role`, { role: 'admin', reason }))
				}
			/>
			<ReasonDialog
				{...shared('remove-admin')}
				title={`Remove ${who} as admin?`}
				confirmLabel="Remove admin"
				onConfirm={(reason) =>
					run(() => adminApi.post(`/users/${id}/role`, { role: 'user', reason }))
				}
			/>
			<ReasonDialog
				{...shared('delete')}
				title={`Delete ${who}'s account?`}
				description="Everything is deleted for good in 7 days. Until then the user can cancel it from their banner."
				confirmLabel="Delete account"
				danger
				onConfirm={(reason) => run(() => adminApi.post(`/users/${id}/delete`, { reason }))}
			/>
			{typeof action === 'object' && action !== null ? (
				<ReasonDialog
					open
					onOpenChange={(next) => {
						if (!next) onClose();
					}}
					title="Take the plan back?"
					description={`${who} loses this plan now; a paid plan or the default one takes over.`}
					confirmLabel="Take back"
					danger
					onConfirm={(reason) =>
						run(() =>
							adminApi.post(
								`/grants/${encodeURIComponent(action.revokeGrant)}/revoke`,
								{ reason },
							),
						)
					}
				/>
			) : null}
			{send.error && !action ? <ErrorMessage error={send.error} /> : null}
		</>
	);
}

type DialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	run: (call: () => Promise<unknown>) => Promise<unknown>;
};

function GrantDialog({
	userId,
	who,
	run,
	...dialog
}: DialogProps & { userId: string; who: string }) {
	const plans = useAdminPlans();
	const [slug, setSlug] = useState('');
	const [length, setLength] = useState<GrantLength>('forever');
	const [until, setUntil] = useState('');
	const choices = (plans.data?.plans ?? []).filter((plan) => !plan.is_default && plan.is_active);
	const chosen = slug || choices[0]?.slug || '';
	return (
		<ReasonDialog
			{...dialog}
			title={`Give ${who} a plan`}
			description="No payment needed. A grant wins over a cheaper paid plan while it lasts."
			confirmLabel="Give plan"
			ready={Boolean(chosen) && (length !== 'date' || Boolean(until))}
			onConfirm={(reason) =>
				run(() =>
					adminApi.post(`/users/${userId}/grants`, {
						plan_slug: chosen,
						ends_at: grantEnd(length, until),
						reason,
					}),
				)
			}
		>
			<Field label="Plan">
				{(control) => (
					<select
						{...control}
						value={chosen}
						onChange={(event) => setSlug(event.target.value)}
						className="h-9 rounded-md border border-border-strong bg-surface px-3 text-[13px] text-fg"
					>
						{choices.map((plan) => (
							<option key={plan.slug} value={plan.slug}>
								{plan.name}
								{plan.is_public ? '' : ' (hidden)'}
							</option>
						))}
					</select>
				)}
			</Field>
			<div className="flex flex-col gap-1.5">
				<span className="text-[13px] font-medium text-fg">For how long</span>
				<Segmented
					label="For how long"
					value={length}
					onChange={setLength}
					options={GRANT_LENGTHS}
				/>
				<span className="text-xs text-meta">
					{length === 'forever'
						? 'Never ends; take it back here whenever you want.'
						: length === 'date'
							? 'Ends at the end of that day (UTC).'
							: `Ends ${formatDate(grantEnd(length, ''))}.`}
				</span>
			</div>
			{length === 'date' ? (
				<Field label="Until">
					{(control) => (
						<Input
							{...control}
							type="date"
							min={new Date().toISOString().slice(0, 10)}
							value={until}
							onChange={(event) => setUntil(event.target.value)}
						/>
					)}
				</Field>
			) : null}
		</ReasonDialog>
	);
}

function OverrideDialog({ detail, run, ...dialog }: DialogProps & { detail: UserDetail }) {
	const current = detail.override;
	const [pouches, setPouches] = useState(current?.pouch_limit?.toString() ?? '');
	const [gigabytes, setGigabytes] = useState(
		current?.storage_bytes != null ? String(current.storage_bytes / GB) : '',
	);
	const [note, setNote] = useState(current?.note ?? '');
	const pouchLimit = pouches.trim() === '' ? null : Number(pouches);
	const storage = gigabytes.trim() === '' ? null : Math.round(Number(gigabytes) * GB);
	const valid =
		(pouchLimit === null || (Number.isInteger(pouchLimit) && pouchLimit >= 0)) &&
		(storage === null || (Number.isFinite(storage) && storage >= 0)) &&
		(pouchLimit !== null || storage !== null);
	return (
		<ReasonDialog
			{...dialog}
			title="Override limits"
			description="Wins over the plan's limits for this account only. Leave a field empty to keep the plan's."
			confirmLabel="Save override"
			ready={valid}
			onConfirm={(reason) =>
				run(() =>
					adminApi.put(`/users/${encodeURIComponent(detail.user.id)}/override`, {
						pouch_limit: pouchLimit,
						storage_bytes: storage,
						note,
						reason,
					}),
				)
			}
		>
			<div className="grid grid-cols-2 gap-3">
				<Field label="Pouches">
					{(control) => (
						<Input
							{...control}
							inputMode="numeric"
							value={pouches}
							onChange={(event) => setPouches(event.target.value)}
						/>
					)}
				</Field>
				<Field label="Storage (GB)">
					{(control) => (
						<Input
							{...control}
							inputMode="decimal"
							value={gigabytes}
							onChange={(event) => setGigabytes(event.target.value)}
						/>
					)}
				</Field>
			</div>
			<Field label="Note" aside="optional">
				{(control) => (
					<Input
						{...control}
						maxLength={500}
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
				)}
			</Field>
		</ReasonDialog>
	);
}
