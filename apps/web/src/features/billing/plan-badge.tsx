// SPDX-License-Identifier: AGPL-3.0-only
/** A paid plan's name in its style, and the top-bar pill that links to billing. */
import { Link } from '@tanstack/react-router';
import { Heart } from 'lucide-react';
import { Sparkle } from '@/components/brand/sparkle';
import { useSession } from '@/features/session/session-store';
import { cn } from '@/lib/cn';
import { planStyle, type PlanStyle } from './plan-styles';

/** The style's mark and gradient name; plain text without a style. Wrap in the style's class. */
export function PlanName({
	name,
	style,
	markClassName,
}: {
	name: string;
	style: PlanStyle | null;
	markClassName?: string;
}) {
	if (!style) return <>{name}</>;
	return (
		<>
			<PlanMark style={style} className={markClassName} />
			<span className="plan-text">{name}</span>
		</>
	);
}

function PlanMark({ style, className }: { style: PlanStyle; className?: string | undefined }) {
	return style.mark === 'heart' ? (
		<Heart
			className={cn('plan-sparkle size-3.5 shrink-0', className)}
			strokeWidth={1.6}
			aria-hidden
		/>
	) : (
		<Sparkle className={className} />
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
			<PlanMark style={style} />
			<span className="plan-badge-label">
				<span>
					<span className="plan-text">{plan_name}</span>
				</span>
			</span>
		</Link>
	);
}
