// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/app/account/billing` — Free or Supporter. Supporter only adds room
 * (pouches, storage); every feature is free for everyone.
 */
import { Check, Sparkles } from 'lucide-react';
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
	openInvoicePdf,
	useBilling,
	useCheckout,
	useInvoices,
	usePlans,
	usePortal,
} from '@/features/billing/billing';
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
	const checkout = useCheckout();
	const portal = usePortal();
	const pouches = usePouches();
	const [downgrading, setDowngrading] = useState(false);

	const current = me.account.entitlements;
	const isFree = current.plan_slug === 'free';
	const subscription = billing.data?.subscriptions.find((entry) =>
		['active', 'trialing', 'past_due'].includes(entry.status),
	);
	const activePouches = (pouches.data ?? []).filter((pouch) => pouch.state === 'active').length;
	const freePlan = plans.data?.find((plan) => plan.slug === 'free');

	return (
		<>
			<PageHeader
				title="Billing"
				description="SkillPouch is free for everyone. Supporter adds room and keeps it running."
			/>
			{!isFree ? (
				<section className="mb-8">
					<p className="flex items-center gap-2 text-lg font-medium">
						<Sparkles className="size-4 text-accent-text" aria-hidden />
						<span className="bg-gradient-to-r from-[#a774f2] via-[#f0a6d8] to-white bg-clip-text text-transparent">
							You’re a {current.plan_name}
						</span>
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
			<section className="grid gap-4 sm:grid-cols-2" aria-label="Plans">
				{plans.isPending ? (
					<>
						<Skeleton className="h-56" />
						<Skeleton className="h-56" />
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
									{invoice.invoice_available ? (
										<button
											type="button"
											className="text-xs text-muted underline hover:text-fg"
											onClick={() =>
												void openInvoicePdf(invoice.id).catch((error) =>
													toast.error(describeError(error)),
												)
											}
										>
											PDF
										</button>
									) : null}
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
							? `You keep ${current.plan_name} until ${formatDate(subscription.current_period_end)}. After that your account moves to Free.`
							: 'Your account moves to Free at the end of the billing period.'
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
									You use {formatBytes(me.account.used_bytes)}; Free includes{' '}
									{formatBytes(freePlan.storage_bytes)}
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
	return (
		<article
			className={cn(
				'flex flex-col gap-4 rounded-lg border p-5',
				paid
					? 'border-accent/40 bg-[radial-gradient(ellipse_at_top,rgba(132,66,217,0.12),transparent_70%)]'
					: 'border-border',
			)}
			aria-label={plan.name}
		>
			<div className="flex items-start justify-between">
				<p className="flex items-center gap-1.5 text-sm font-medium">
					{paid ? <Sparkles className="size-4 text-accent-text" aria-hidden /> : null}
					{plan.name}
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
