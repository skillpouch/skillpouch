// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The plan summary: usage bars, and either the Supporter pitch (Free) or a
 * thank-you with "Manage" (Supporter).
 */
import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatBytes } from '@/lib/format';
import { usePouches } from '../pouches/pouches';
import { useUnlocked } from '../session/session-store';

export function PlanCard() {
	const { me } = useUnlocked();
	const pouches = usePouches();
	const { entitlements, used_bytes, quota_bytes } = me.account;
	const active = (pouches.data ?? []).filter((pouch) => pouch.state === 'active').length;
	const isFree = entitlements.plan_slug === 'free';
	return (
		<section className="rounded-lg border border-border bg-surface p-5" aria-label="Plan">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="flex items-center gap-1.5 text-sm font-medium">
						{isFree ? null : (
							<Sparkles className="size-4 text-accent-text" aria-hidden />
						)}
						{entitlements.plan_name}
					</p>
					<p className="mt-1 text-[13px] text-muted">
						{isFree
							? 'Supporter: 3 pouches, 1 GB, $5/mo — and it keeps SkillPouch running.'
							: 'Thank you for supporting SkillPouch.'}
					</p>
				</div>
				<Button variant={isFree ? 'primary' : 'outline'} size="sm" asChild>
					<Link to="/app/account/billing">{isFree ? 'Upgrade' : 'Manage'}</Link>
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
