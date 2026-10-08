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
	openBillingDocument,
	useBilling,
	useBillingSync,
	useCheckout,
	useInvoices,
	usePlans,
	usePortal,
	type BillingDocument,
} from '@/features/billing/billing';
import { PlanName } from '@/features/billing/plan-badge';
import { planStyle } from '@/features/billing/plan-styles';
import { usePouches } from '@/features/pouches/pouches';
import { useUnlocked } from '@/features/session/session-store';
import { describeError } from '@/lib/api/errors';
import type { Invoice, PlanRecord } from '@/lib/api/types';
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

	const current = me.account.entitlements;
	const currentStyle = planStyle(current.plan_slug);
	const subscription = billing.data?.subscriptions.find((entry) =>
		['active', 'trialing', 'past_due'].includes(entry.status),
	);
	const activePouches = (pouches.data ?? []).filter((pouch) => pouch.state === 'active').length;
	const freePlan = plans.data?.find((plan) => plan.price_cents === 0);
	const freeName = freePlan?.name ?? 'the free plan';

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
							paid
							sparkleClassName="size-4"
						/>
					</p>
					<p className="mt-1 text-[13px] text-muted">
						Thank you. Your support keeps SkillPouch running.
						{subscription
							? ` ${formatMoney(subscription.amount_cents)}/${subscription.interval ?? 'month'} · ${subscription.cancel_at_period_end ? 'Ends' : 'Renews'} on ${formatDate(subscription.current_period_end)}`
							: current.source === 'grant'
								? ' Granted by the SkillPouch team.'
								: ''}
					</p>
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
							available={billing.data?.available === true}
							loading={checkout.isPending && checkout.variables === plan.slug}
							onUpgrade={() => checkout.mutate(plan.slug)}
						/>
					))
				)}
			</section>
			<p className="mt-4 text-xs text-meta">
				Payments are handled by Polar. Nothing is ever deleted when you downgrade: extra
				pouches become read-only.
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
					<ul className="flex flex-col gap-3 text-[13px]">
						{freePlan && activePouches > freePlan.pouch_limit ? (
							<li className="border-l border-border-strong pl-3">
								<strong className="font-medium">
									{activePouches - freePlan.pouch_limit} of your {activePouches}{' '}
									pouches will be locked
								</strong>{' '}
								<span className="text-muted">
									(you choose which stays active). Locked pouches stay readable
									here; your computers stop syncing them.
								</span>
							</li>
						) : null}
						{freePlan && me.account.used_bytes > freePlan.storage_bytes ? (
							<li className="border-l border-border-strong pl-3">
								<strong className="font-medium">
									You use {formatBytes(me.account.used_bytes)}; {freeName}{' '}
									includes {formatBytes(freePlan.storage_bytes)}
								</strong>{' '}
								<span className="text-muted">
									— you’ll need to free up{' '}
									{formatBytes(me.account.used_bytes - freePlan.storage_bytes)}{' '}
									before new changes sync.
								</span>
							</li>
						) : null}
						<li className="border-l border-border-strong pl-3">
							<strong className="font-medium">
								Nothing is deleted automatically.
							</strong>{' '}
							<span className="text-muted">
								Upgrading again unlocks everything instantly.
							</span>
						</li>
					</ul>
				</DialogContent>
			</Dialog>
		</>
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

function PlanTile({
	plan,
	current,
	available,
	loading,
	onUpgrade,
}: {
	plan: PlanRecord;
	current: boolean;
	available: boolean;
	loading: boolean;
	onUpgrade: () => void;
}) {
	const paid = plan.price_cents > 0;
	const style = planStyle(plan.slug, paid);
	return (
		<article
			className={cn(
				'flex flex-col gap-4 rounded-lg border p-5',
				style ? ['plan-card plan-shimmer', style.className] : 'border-border',
			)}
			aria-label={plan.name}
		>
			<div className="flex items-start justify-between">
				<p className="flex items-center gap-1.5 text-sm font-medium">
					<PlanName name={plan.name} paid={paid} sparkleClassName="size-4" />
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
			{paid && !current ? (
				<Button
					variant="primary"
					className="mt-auto"
					loading={loading}
					disabled={!available}
					onClick={onUpgrade}
				>
					Become a {plan.name}
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
