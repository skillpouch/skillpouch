// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/app/account/billing` — the plans synced from the billing provider. Paid
 * plans only add room (pouches, storage); every feature is free for everyone.
 * Plan names always come from the API.
 */
import { Check } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import {
	isUpgrade,
	openBillingDocument,
	useBilling,
	useBillingSync,
	useChangePlan,
	useCheckout,
	useInvoices,
	usePlans,
	usePortal,
	type BillingDocument,
} from '@/features/billing/billing';
import { PlanName } from '@/features/billing/plan-badge';
import { DEFAULT_GIFT_NOTE, planStyle } from '@/features/billing/plan-styles';
import { usePouches } from '@/features/pouches/pouches';
import { useUnlocked } from '@/features/session/session-store';
import { describeError } from '@/lib/api/errors';
import type { Invoice, PlanRecord, Subscription } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { formatBytes, formatDate, formatMoney, plural } from '@/lib/format';

const INVOICE_STATUS: Record<Invoice['status'], { label: string; className: string }> = {
	paid: { label: 'Paid', className: 'text-success' },
	refunded: { label: 'Refunded', className: 'text-muted' },
	partially_refunded: { label: 'Partly refunded', className: 'text-muted' },
	pending: { label: 'Pending', className: 'text-muted' },
	failed: { label: 'Failed', className: 'text-danger' },
};

export function BillingPage() {
	const { me } = useUnlocked();
	const plans = usePlans();
	const billing = useBilling();
	const invoices = useInvoices(billing.data?.available === true);
	useBillingSync(billing.data?.available === true);
	const checkout = useCheckout();
	const portal = usePortal();
	const pouches = usePouches();
	const [downgrading, setDowngrading] = useState(false);
	const [switchingTo, setSwitchingTo] = useState<PlanRecord | null>(null);

	const current = me.account.entitlements;
	const currentStyle = planStyle(current.plan_slug);
	const subscription = billing.data?.subscriptions.find((entry) =>
		['active', 'trialing', 'past_due'].includes(entry.status),
	);
	const activePouches = (pouches.data ?? []).filter((pouch) => pouch.state === 'active').length;
	const freePlan = plans.data?.find((plan) => plan.price_cents === 0);
	const freeName = freePlan?.name ?? 'the free plan';
	const available = billing.data?.available === true;
	// Plans missing from the public list can only be given by an admin; while on
	// one, nothing can be bought (the server refuses too).
	const gifted =
		plans.data !== undefined &&
		(current.source === 'grant' || current.source === 'override') &&
		!plans.data.some((plan) => plan.slug === current.plan_slug);

	/**
	 * Free users check out; subscribers switch their subscription instead
	 * (moving to the free plan means canceling it).
	 */
	const tileAction = (plan: PlanRecord): TileAction | null => {
		if (plan.slug === current.plan_slug) return null;
		const paid = plan.price_cents > 0;
		if (subscription) {
			if (subscription.cancel_at_period_end) return null;
			if (!paid)
				return { label: `Switch to ${plan.name}`, onClick: () => setDowngrading(true) };
			const upgrade = isUpgrade(plan, subscription);
			return {
				label: `${upgrade ? 'Upgrade' : 'Switch'} to ${plan.name}`,
				primary: upgrade,
				disabled: !available,
				onClick: () => setSwitchingTo(plan),
			};
		}
		if (!paid) return null;
		return {
			label: `Become a ${plan.name}`,
			primary: true,
			disabled: !available,
			loading: checkout.isPending && checkout.variables === plan.slug,
			onClick: () => checkout.mutate(plan.slug),
		};
	};

	return (
		<>
			<PageHeader
				title="Billing"
				description="SkillPouch is free for everyone. Paid plans add room and keep it running."
			/>
			{currentStyle ? (
				<section className={cn('plan-shimmer mb-8', currentStyle.className)}>
					<p className="flex items-center gap-2 text-lg font-medium">
						<PlanName
							name={`You’re a ${current.plan_name}`}
							style={currentStyle}
							markClassName="size-4"
						/>
					</p>
					<p className="mt-1 text-[13px] text-muted">
						{currentStyle.thanks ?? 'Thank you. Your support keeps SkillPouch running.'}
					</p>
					{subscription ? (
						<p className="mt-0.5 text-[13px] text-muted">
							{`${formatMoney(subscription.amount_cents)}/${subscription.interval ?? 'month'} · ${subscription.cancel_at_period_end ? 'Ends' : 'Renews'} on ${formatDate(subscription.current_period_end)}`}
						</p>
					) : current.source === 'grant' && !currentStyle.thanks ? (
						<p className="mt-0.5 text-[13px] text-muted">
							Granted by the SkillPouch team.
						</p>
					) : null}
				</section>
			) : null}
			<section className="mb-8 grid gap-6 sm:grid-cols-2" aria-label="Usage">
				<UsageBar
					label="Storage"
					value={me.account.used_bytes}
					max={me.account.quota_bytes}
					text={`${formatBytes(me.account.used_bytes)} of ${formatBytes(me.account.quota_bytes)}`}
				/>
				<UsageBar
					label="Pouches"
					value={activePouches}
					max={current.pouch_limit}
					text={`${activePouches} of ${current.pouch_limit}`}
				/>
			</section>
			{subscription ? (
				<div className="mb-8 flex flex-wrap gap-2">
					<Button loading={portal.isPending} onClick={() => portal.mutate()}>
						Manage subscription
					</Button>
					{subscription.cancel_at_period_end ? null : (
						<Button variant="danger-outline" onClick={() => setDowngrading(true)}>
							Cancel subscription
						</Button>
					)}
				</div>
			) : null}
			<ErrorMessage
				error={portal.error ?? checkout.error ?? billing.error}
				className="mb-4"
			/>
			{gifted ? (
				<p className="mb-4 text-[13px] text-muted">
					{currentStyle?.giftNote ?? DEFAULT_GIFT_NOTE}
				</p>
			) : null}
			<section
				className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4"
				aria-label="Plans"
			>
				{plans.isPending ? (
					<>
						<Skeleton className="h-56 rounded-lg" />
						<Skeleton className="h-56 rounded-lg" />
					</>
				) : (
					(plans.data ?? []).map((plan) => (
						<PlanTile
							key={plan.slug}
							plan={plan}
							current={plan.slug === current.plan_slug}
							locked={gifted}
							action={tileAction(plan)}
						/>
					))
				)}
			</section>
			<p className="mt-4 text-xs text-meta">
				Payments are handled by Polar. Nothing is ever deleted when you downgrade: extra
				pouches become read-only.
				{subscription?.cancel_at_period_end
					? ' To switch plans, resume your subscription in Manage subscription first.'
					: ''}
				{billing.data && !billing.data.available
					? ' Billing isn’t set up on this server.'
					: ''}
			</p>
			{billing.data?.available ? (
				<section className="mt-10" aria-label="Invoices">
					<h2 className="mb-3 text-sm font-medium">Invoices</h2>
					{invoices.isPending ? (
						<Skeleton className="h-16" />
					) : (invoices.data ?? []).length === 0 ? (
						<p className="text-[13px] text-muted">No invoices yet.</p>
					) : (
						<ul className="divide-y divide-border-soft rounded-lg border border-border text-[13px]">
							{invoices.data!.map((invoice) => (
								<li
									key={invoice.id}
									className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
								>
									<span className="w-28 text-muted">
										{formatDate(invoice.created_at)}
									</span>
									<span className="flex-1">{invoice.description}</span>
									<span className="font-mono">
										{formatMoney(invoice.amount_cents, invoice.currency)}
									</span>
									<span
										className={cn(
											'w-24',
											INVOICE_STATUS[invoice.status].className,
										)}
									>
										{INVOICE_STATUS[invoice.status].label}
									</span>
									<span className="flex gap-3">
										{invoice.receipt_available ? (
											<DocumentButton
												invoiceId={invoice.id}
												document="receipt"
											/>
										) : null}
										{invoice.invoice_available ? (
											<DocumentButton
												invoiceId={invoice.id}
												document="invoice"
											/>
										) : null}
									</span>
								</li>
							))}
						</ul>
					)}
				</section>
			) : null}
			<Dialog open={downgrading} onOpenChange={setDowngrading}>
				<DialogContent
					title="What happens when you downgrade"
					description={
						subscription?.current_period_end
							? `You keep ${current.plan_name} until ${formatDate(subscription.current_period_end)}. After that your account moves to ${freeName}.`
							: `Your account moves to ${freeName} at the end of the billing period.`
					}
					footer={
						<>
							<Button
								variant="danger-outline"
								loading={portal.isPending}
								onClick={() => portal.mutate()}
							>
								Cancel subscription
							</Button>
							<Button variant="primary" onClick={() => setDowngrading(false)}>
								Keep {current.plan_name}
							</Button>
						</>
					}
				>
					<DowngradeEffects
						plan={freePlan}
						activePouches={activePouches}
						usedBytes={me.account.used_bytes}
					/>
				</DialogContent>
			</Dialog>
			{switchingTo && subscription ? (
				<PlanChangeDialog
					plan={switchingTo}
					subscription={subscription}
					currentName={current.plan_name}
					activePouches={activePouches}
					usedBytes={me.account.used_bytes}
					onClose={() => setSwitchingTo(null)}
				/>
			) : null}
		</>
	);
}

/** Confirms moving a subscription to another paid plan; it applies at once. */
function PlanChangeDialog({
	plan,
	subscription,
	currentName,
	activePouches,
	usedBytes,
	onClose,
}: {
	plan: PlanRecord;
	subscription: Subscription;
	currentName: string;
	activePouches: number;
	usedBytes: number;
	onClose: () => void;
}) {
	const change = useChangePlan();
	const upgrade = isUpgrade(plan, subscription);
	const price = `${formatMoney(plan.price_cents, plan.currency)}/${plan.interval ?? 'month'}`;
	const then = subscription.current_period_end
		? `then ${price} from ${formatDate(subscription.current_period_end)}`
		: `then ${price}`;
	return (
		<Dialog open onOpenChange={(open) => (open ? null : onClose())}>
			<DialogContent
				title={`${upgrade ? 'Upgrade' : 'Switch'} to ${plan.name}`}
				description={
					upgrade
						? `${plan.name} starts right away. You pay the prorated difference for the rest of this billing period now, ${then}.`
						: `${plan.name} starts right away. What you haven’t used of ${currentName} is credited to your next bill, ${then}.`
				}
				busy={change.isPending}
				footer={
					<>
						<Button variant="ghost" disabled={change.isPending} onClick={onClose}>
							Keep {currentName}
						</Button>
						<Button
							variant="primary"
							loading={change.isPending}
							onClick={() =>
								change.mutate(plan.slug, {
									onSuccess: () => {
										toast.success(`You’re now on ${plan.name}.`);
										onClose();
									},
								})
							}
						>
							{upgrade ? 'Upgrade and pay now' : `Switch to ${plan.name}`}
						</Button>
					</>
				}
			>
				{upgrade ? null : (
					<DowngradeEffects
						plan={plan}
						activePouches={activePouches}
						usedBytes={usedBytes}
					/>
				)}
				<ErrorMessage error={change.error} className={upgrade ? '' : 'mt-4'} />
			</DialogContent>
		</Dialog>
	);
}

/** What moving to a smaller plan means for this account; nothing is ever deleted. */
function DowngradeEffects({
	plan,
	activePouches,
	usedBytes,
}: {
	plan: PlanRecord | undefined;
	activePouches: number;
	usedBytes: number;
}) {
	return (
		<ul className="flex flex-col gap-3 text-[13px]">
			{plan && activePouches > plan.pouch_limit ? (
				<li className="border-l border-border-strong pl-3">
					<strong className="font-medium">
						{activePouches - plan.pouch_limit} of your {activePouches} pouches will be
						locked
					</strong>{' '}
					<span className="text-muted">
						(you choose which stays active). Locked pouches stay readable here; your
						computers stop syncing them.
					</span>
				</li>
			) : null}
			{plan && usedBytes > plan.storage_bytes ? (
				<li className="border-l border-border-strong pl-3">
					<strong className="font-medium">
						You use {formatBytes(usedBytes)}; {plan.name} includes{' '}
						{formatBytes(plan.storage_bytes)}
					</strong>{' '}
					<span className="text-muted">
						— you’ll need to free up {formatBytes(usedBytes - plan.storage_bytes)}{' '}
						before new changes sync.
					</span>
				</li>
			) : null}
			<li className="border-l border-border-strong pl-3">
				<strong className="font-medium">Nothing is deleted automatically.</strong>{' '}
				<span className="text-muted">Upgrading again unlocks everything instantly.</span>
			</li>
		</ul>
	);
}

function UsageBar({
	label,
	value,
	max,
	text,
}: {
	label: string;
	value: number;
	max: number;
	text: string;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex justify-between text-xs">
				<span className="text-muted">{label}</span>
				<span className="font-mono">{text}</span>
			</div>
			<Progress value={value} max={max} label={label} />
		</div>
	);
}

interface TileAction {
	label: string;
	onClick: () => void;
	primary?: boolean;
	disabled?: boolean;
	loading?: boolean;
}

function PlanTile({
	plan,
	current,
	locked,
	action,
}: {
	plan: PlanRecord;
	current: boolean;
	/** On a plan given by an admin: shown, but nothing can be bought. */
	locked: boolean;
	action: TileAction | null;
}) {
	const paid = plan.price_cents > 0;
	const style = planStyle(plan.slug, paid);
	return (
		<article
			className={cn(
				'flex flex-col gap-4 rounded-lg border p-5',
				style ? ['plan-card plan-shimmer', style.className] : 'border-border',
				locked && 'opacity-50',
			)}
			aria-label={plan.name}
			aria-disabled={locked || undefined}
		>
			<div className="flex items-start justify-between">
				<p className="flex items-center gap-1.5 text-sm font-medium">
					<PlanName name={plan.name} style={style} markClassName="size-4" />
				</p>
				{current ? <Badge>Current plan</Badge> : null}
			</div>
			<p className="text-3xl font-semibold tracking-tight">
				{paid ? formatMoney(plan.price_cents, plan.currency) : '$0'}
				{paid ? (
					<span className="text-sm font-normal text-muted">
						/{plan.interval ?? 'month'}
					</span>
				) : null}
			</p>
			<ul className="flex flex-col gap-2 text-[13px] text-muted">
				{[
					plural(plan.pouch_limit, 'pouch', 'pouches'),
					`${formatBytes(plan.storage_bytes)} storage`,
					'All features',
					'Unlimited devices',
				].map((line) => (
					<li key={line} className="flex items-center gap-2">
						<Check className="size-3.5 text-meta" aria-hidden /> {line}
					</li>
				))}
			</ul>
			{action ? (
				<Button
					variant={action.primary ? 'primary' : 'outline'}
					className="mt-auto"
					loading={action.loading ?? false}
					disabled={locked || (action.disabled ?? false)}
					onClick={action.onClick}
				>
					{action.label}
				</Button>
			) : null}
		</article>
	);
}

/** Opens a charge's receipt or invoice; the first invoice takes a few seconds to render. */
function DocumentButton({ invoiceId, document }: { invoiceId: string; document: BillingDocument }) {
	const [opening, setOpening] = useState(false);
	return (
		<button
			type="button"
			className="cursor-pointer text-xs text-muted underline hover:text-fg disabled:cursor-default disabled:no-underline"
			disabled={opening}
			onClick={() => {
				setOpening(true);
				openBillingDocument(invoiceId, document)
					.catch((error) => toast.error(describeError(error)))
					.finally(() => setOpening(false));
			}}
		>
			{opening ? 'Preparing…' : document === 'invoice' ? 'Invoice' : 'Receipt'}
		</button>
	);
}
