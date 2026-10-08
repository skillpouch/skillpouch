// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Looks for paid plans: badge, card border, gradient text and sparkle. Each
 * style is a CSS class in `globals.css` (`.plan-style-<id>`) that sets the
 * palette; the shared `.plan-*` classes read it. To add a design, add a class
 * there and an entry here.
 */

export interface PlanStyle {
	id: string;
	/** Plan slugs that use this style. */
	slugs: readonly string[];
	className: string;
	/** Mark before the plan name; the sparkle unless set. */
	mark?: 'sparkle' | 'heart';
	/** Replaces the usual thank-you line. */
	thanks?: string;
	/** Shown above the plans when this plan was given by an admin and nothing can be bought. */
	giftNote?: string;
}

export const PLAN_STYLES: readonly PlanStyle[] = [
	{ id: 'supporter', slugs: ['supporter'], className: 'plan-style-supporter' },
	{ id: 'supporter-plus', slugs: ['supporter-plus'], className: 'plan-style-supporter-plus' },
	{
		id: 'friends-pass',
		slugs: ['friends-pass'],
		className: 'plan-style-friends-pass',
		mark: 'heart',
		thanks: 'Thank you for being a friend of Fenish.',
		giftNote:
			'Friends don’t pay here. Your pass is on the house for as long as we’re friends, so there’s nothing to buy.',
	},
];

export const DEFAULT_GIFT_NOTE =
	'Your plan was given to you by the SkillPouch team, so there’s nothing to buy here.';

const FALLBACK_STYLE = PLAN_STYLES[0]!;

/** The style for a plan; `null` for free plans. Unknown paid plans get the first style. */
export function planStyle(slug: string | null, paid = slug !== null && slug !== 'free') {
	if (!paid) return null;
	return (
		PLAN_STYLES.find((style) => slug !== null && style.slugs.includes(slug)) ?? FALLBACK_STYLE
	);
}
