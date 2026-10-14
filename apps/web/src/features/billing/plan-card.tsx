// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The plan summary: usage bars, and either the pitch for the cheapest paid
 * plan (free plans) or a thank-you with "Manage" (paid plans).
 */
import { cn } from '@/lib/cn';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatMoney, plural } from '@/lib/format';
import { usePouches } from '../pouches/pouches';
import { useUnlocked } from '../session/session-store';
import { cheapestPaidPlan, usePlans } from './billing';
import { PlanName } from './plan-badge';
import { planStyle } from './plan-styles';

export function PlanCard() {
	const { me } = useUnlocked();
	const pouches = usePouches();
	const { entitlements, used_bytes, quota_bytes } = me.account;
	const active = (pouches.data ?? []).filter((pouch) => pouch.state === 'active').length;
	const style = planStyle(entitlements.plan_slug);
	const isFree = style === null;
	const pitch = cheapestPaidPlan(usePlans().data);
	return (
		<section
			className={cn(
				'rounded-lg border bg-surface p-5',
				isFree ? 'border-border' : ['plan-card plan-shimmer', style.className],
			)}
			aria-label="Plan"
		>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="flex items-center gap-1.5 text-sm font-medium">
						<PlanName
							name={entitlements.plan_name}
							style={style}
							markClassName="size-4"
						/>
					</p>
					<p className="mt-1 text-[13px] text-muted">
						{!isFree
							? (style.thanks ?? 'Thank you for supporting SkillPouch.')
							: pitch
								? `${pitch.name}: ${plural(pitch.pouch_limit, 'pouch', 'pouches')}, ${formatBytes(pitch.storage_bytes)}, ${formatMoney(pitch.price_cents, pitch.currency)}/${pitch.interval ?? 'month'} — and it keeps SkillPouch running.`
								: 'More room, and it keeps SkillPouch running.'}
					</p>
				</div>
				<Button variant={isFree ? 'primary' : 'outline'} size="sm" asChild>
					<Link to="/account/billing">{isFree ? 'Upgrade' : 'Manage'}</Link>
				</Button>
			</div>
			<div className="mt-5 grid gap-4 sm:grid-cols-2">
				<Usage
					label="Storage"
					value={`${formatBytes(used_bytes)} of ${formatBytes(quota_bytes)}`}
				>
					<Progress value={used_bytes} max={quota_bytes} label="Storage used" />
				</Usage>
				<Usage label="Pouches" value={`${active} of ${entitlements.pouch_limit}`}>
					<Progress
						value={active}
						max={entitlements.pouch_limit}
						label="Pouches used"
						tone="neutral"
					/>
				</Usage>
			</div>
		</section>
	);
}

function Usage({
	label,
	value,
	children,
}: {
	label: string;
	value: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex justify-between text-xs">
				<span className="text-muted">{label}</span>
				<span className="font-mono text-fg">{value}</span>
			</div>
			{children}
		</div>
	);
}
