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
}

export const PLAN_STYLES: readonly PlanStyle[] = [
	{ id: 'supporter', slugs: ['supporter'], className: 'plan-style-supporter' },
	{ id: 'supporter-plus', slugs: ['supporter-plus'], className: 'plan-style-supporter-plus' },
];

const FALLBACK_STYLE = PLAN_STYLES[0]!;

/** The style for a plan; `null` for free plans. Unknown paid plans get the first style. */
export function planStyle(slug: string | null, paid = slug !== null && slug !== 'free') {
	if (!paid) return null;
	return (
		PLAN_STYLES.find((style) => slug !== null && style.slugs.includes(slug)) ?? FALLBACK_STYLE
	);
}
