// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/admin/plans` — what each plan gives. Paid plans' names and prices follow
 * their Polar products; limits are set here and apply to everyone on the plan.
 */
import { Layers, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { adminApi, useAdminAction, useAdminPlans, type Plan } from '@/features/admin/admin';
import {
	cellClass,
	ReasonDialog,
	rowClass,
	Table,
	TableSkeleton,
} from '@/features/admin/components/parts';
import { formatBytes, formatMoney } from '@/lib/format';

const GB = 1024 ** 3;

export function AdminPlansPage() {
	const plans = useAdminPlans();
	const [editing, setEditing] = useState<Plan | 'new' | null>(null);
	const list = plans.data?.plans ?? [];
	return (
		<>
			<PageHeader
				title="Plans"
				description="Paid plans take their name and price from Polar. Limits changed here apply to everyone on the plan."
				actions={
					<Button onClick={() => setEditing('new')}>
						<Plus /> New plan
					</Button>
				}
			/>
			<ErrorMessage error={plans.error} className="mb-4" />
			{plans.isPending ? (
				<TableSkeleton rows={4} />
			) : list.length ? (
				<Table
					label="Plans"
					head={['Plan', 'Price', 'Pouches', 'Storage', 'Polar product', '', '']}
				>
					{list.map((plan) => (
						<tr key={plan.id} className={rowClass}>
							<td className={cellClass}>
								<span className="flex flex-col">
									<span className="text-fg">{plan.name}</span>
									<span className="font-mono text-xs text-meta">{plan.slug}</span>
								</span>
							</td>
							<td className={`${cellClass} font-mono text-muted`}>
								{plan.price_cents
									? `${formatMoney(plan.price_cents, plan.currency)}/${plan.interval ?? 'month'}`
									: 'Free'}
							</td>
							<td className={`${cellClass} font-mono text-muted`}>
								{plan.pouch_limit}
							</td>
							<td className={`${cellClass} font-mono text-muted`}>
								{formatBytes(plan.storage_bytes)}
							</td>
							<td className={`${cellClass} font-mono text-xs text-meta`}>
								{plan.polar_product_id ?? '—'}
							</td>
							<td className={cellClass}>
								<span className="inline-flex gap-1.5">
									{plan.is_default ? <Badge tone="accent">default</Badge> : null}
									{plan.is_public ? null : <Badge>hidden</Badge>}
									{plan.is_active ? null : <Badge tone="danger">retired</Badge>}
								</span>
							</td>
							<td className={`${cellClass} text-right`}>
								<Button size="sm" variant="ghost" onClick={() => setEditing(plan)}>
									Edit
								</Button>
							</td>
						</tr>
					))}
				</Table>
			) : (
				<EmptyState icon={Layers} title="No plans" />
			)}
			{editing ? (
				<PlanDialog
					plan={editing === 'new' ? null : editing}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</>
	);
}

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
	const save = useAdminAction((body: Record<string, unknown>) =>
		plan ? adminApi.put(`/plans/${plan.id}`, body) : adminApi.post('/plans', body),
	);
	const [slug, setSlug] = useState('');
	const [name, setName] = useState(plan?.name ?? '');
	const [price, setPrice] = useState(plan ? String(plan.price_cents / 100) : '0');
	const [interval, setInterval] = useState<'month' | 'year'>(plan?.interval ?? 'month');
	const [pouches, setPouches] = useState(String(plan?.pouch_limit ?? 3));
	const [gigabytes, setGigabytes] = useState(String((plan?.storage_bytes ?? GB) / GB));
	const [isPublic, setPublic] = useState(plan?.is_public ?? true);
	const [isActive, setActive] = useState(plan?.is_active ?? true);
	const priceCents = Math.round(Number(price) * 100);
	const pouchLimit = Number(pouches);
	const storage = Math.round(Number(gigabytes) * GB);
	const valid =
		name.trim().length > 0 &&
		(plan !== null || /^[a-z0-9-]{2,64}$/.test(slug)) &&
		Number.isInteger(priceCents) &&
		priceCents >= 0 &&
		Number.isInteger(pouchLimit) &&
		pouchLimit >= 0 &&
		Number.isFinite(storage) &&
		storage >= 0;
	return (
		<ReasonDialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={plan ? `Edit ${plan.name}` : 'New plan'}
			description={
				plan
					? 'New limits apply to everyone on this plan right away.'
					: 'A paid plan also gets a Polar product, so it can be bought.'
			}
			confirmLabel={plan ? 'Save plan' : 'Create plan'}
			ready={valid}
			onConfirm={(reason) =>
				save.mutateAsync({
					...(plan ? {} : { slug }),
					name: name.trim(),
					description: plan?.description ?? '',
					price_cents: priceCents,
					currency: plan?.currency ?? 'usd',
					interval: priceCents > 0 ? interval : null,
					pouch_limit: pouchLimit,
					storage_bytes: storage,
					is_public: isPublic,
					is_active: isActive,
					sort: plan?.sort ?? 0,
					reason,
				})
			}
		>
			{plan ? null : (
				<Field
					label="Slug"
					hint="Lowercase letters, digits and dashes. Can't be changed later."
				>
					{(control) => (
						<Input
							{...control}
							value={slug}
							onChange={(event) => setSlug(event.target.value.toLowerCase())}
							spellCheck={false}
						/>
					)}
				</Field>
			)}
			<Field label="Name">
				{(control) => (
					<Input
						{...control}
						value={name}
						maxLength={100}
						onChange={(event) => setName(event.target.value)}
					/>
				)}
			</Field>
			<div className="grid grid-cols-2 gap-3">
				<Field label="Price (USD)">
					{(control) => (
						<Input
							{...control}
							inputMode="decimal"
							value={price}
							onChange={(event) => setPrice(event.target.value)}
						/>
					)}
				</Field>
				<Field label="Billed">
					{(control) => (
						<select
							{...control}
							value={interval}
							disabled={priceCents === 0}
							onChange={(event) =>
								setInterval(event.target.value as 'month' | 'year')
							}
							className="h-9 rounded-md border border-border-strong bg-surface px-3 text-[13px] text-fg disabled:opacity-50"
						>
							<option value="month">Monthly</option>
							<option value="year">Yearly</option>
						</select>
					)}
				</Field>
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
			<label className="flex items-center justify-between gap-3 text-[13px]">
				<span>
					Shown on the billing page
					<span className="block text-xs text-meta">Hidden plans can only be given.</span>
				</span>
				<Switch checked={isPublic} onCheckedChange={setPublic} aria-label="Shown" />
			</label>
			<label className="flex items-center justify-between gap-3 text-[13px]">
				<span>
					Available
					<span className="block text-xs text-meta">
						Retired plans keep their users but take no new ones.
					</span>
				</span>
				<Switch checked={isActive} onCheckedChange={setActive} aria-label="Available" />
			</label>
		</ReasonDialog>
	);
}
