// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Background of the sign-in page: a slow purple aurora along the top edge
 * (React Bits Aurora, WebGL) in the SkillPouch colors. It never reacts to the
 * mouse; it only drifts. People who prefer reduced motion get a still glow.
 */
import { lazy, Suspense } from 'react';

const Aurora = lazy(() => import('./aurora'));

const reducedMotion =
	typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Deep violet → brand purple → soft pink, the paid-plan palette. */
const COLORS = ['#3b1a78', '#8442d9', '#c77dd6'];

export function SignInBackground() {
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
			{reducedMotion ? (
				<div className="absolute inset-x-0 -top-40 h-[480px] bg-[radial-gradient(ellipse_at_center,rgba(132,66,217,0.18),transparent_65%)]" />
			) : (
				<Suspense fallback={null}>
					<div className="absolute inset-x-0 top-0 h-[70vh] opacity-50">
						<Aurora colorStops={COLORS} amplitude={0.8} blend={0.6} speed={0.4} />
					</div>
				</Suspense>
			)}
			<div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/80 to-transparent" />
		</div>
	);
}
