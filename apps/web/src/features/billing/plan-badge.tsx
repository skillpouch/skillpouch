// SPDX-License-Identifier: AGPL-3.0-only
/** A paid plan's name in its style, and the top-bar pill that links to billing. */
import { Link } from '@tanstack/react-router';
import { Sparkle } from '@/components/brand/sparkle';
import { useSession } from '@/features/session/session-store';
import { cn } from '@/lib/cn';
import { planStyle } from './plan-styles';

/** Sparkle and gradient name; plain text for free plans. Wrap in the plan's style class. */
export function PlanName({
	name,
	paid,
	sparkleClassName,
}: {
	name: string;
	paid: boolean;
	sparkleClassName?: string;
}) {
	if (!paid) return <>{name}</>;
	return (
		<>
			<Sparkle className={sparkleClassName} />
			<span className="plan-text">{name}</span>
		</>
	);
}

export function PlanPill() {
	const session = useSession();
	if (!('me' in session)) return null;
	const { plan_slug, plan_name } = session.me.account.entitlements;
	const style = planStyle(plan_slug);
	if (!style) return null;
	return (
		<Link
			to="/app/account/billing"
			className={cn('plan-badge plan-badge-compact plan-shimmer', style.className)}
			aria-label={`${plan_name} plan, open billing`}
		>
			<PlanName name={plan_name} paid />
		</Link>
	);
}
