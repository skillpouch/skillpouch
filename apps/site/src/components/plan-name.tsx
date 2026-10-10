// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A paid plan's name in its style, as in the web app (features/billing): each
 * style is a `.plan-style-<id>` class in global.css.
 */
import { Heart } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface PlanStyle {
	slugs: readonly string[];
	className: string;
	mark?: 'sparkle' | 'heart';
}

const PLAN_STYLES: readonly PlanStyle[] = [
	{ slugs: ['supporter'], className: 'plan-style-supporter' },
	{ slugs: ['supporter-plus'], className: 'plan-style-supporter-plus' },
	{ slugs: ['friends-pass'], className: 'plan-style-friends-pass', mark: 'heart' },
];

/** The style for a plan; `null` for free plans. Unknown paid plans get the first style. */
export function planStyle(slug: string, paid: boolean): PlanStyle | null {
	if (!paid) return null;
	return PLAN_STYLES.find((style) => style.slugs.includes(slug)) ?? PLAN_STYLES[0]!;
}

function Sparkle({ className }: { className?: string | undefined }) {
	return (
		<svg
			viewBox="0 0 16 16"
			className={cn('plan-sparkle size-3.5 shrink-0', className)}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.4}
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M8 1.5l1.7 4.8 4.8 1.7-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7L8 1.5Z" />
		</svg>
	);
}

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
			{style.mark === 'heart' ? (
				<Heart
					className={cn('plan-sparkle size-3.5 shrink-0', markClassName)}
					strokeWidth={1.6}
					aria-hidden
				/>
			) : (
				<Sparkle className={markClassName} />
			)}
			<span className="plan-text">{name}</span>
		</>
	);
}
