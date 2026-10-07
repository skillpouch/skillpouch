// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Background of the sign-in page: soft purple light rays from the top
 * (React Bits LightRays, WebGL). People who prefer reduced motion get a
 * still glow instead of the animation.
 */
import { lazy, Suspense } from 'react';

const LightRays = lazy(() => import('./light-rays'));

const reducedMotion =
	typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function SignInBackground() {
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
			<div className="absolute inset-x-0 -top-40 h-[480px] bg-[radial-gradient(ellipse_at_center,rgba(132,66,217,0.18),transparent_65%)]" />
			{reducedMotion ? null : (
				<Suspense fallback={null}>
					<LightRays
						raysOrigin="top-center"
						raysColor="#8442d9"
						raysSpeed={0.6}
						lightSpread={0.9}
						rayLength={1.4}
						fadeDistance={1}
						saturation={1}
						followMouse
						mouseInfluence={0.06}
						noiseAmount={0.05}
						distortion={0.04}
						className="absolute inset-0 opacity-80"
					/>
				</Suspense>
			)}
			<div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black to-transparent" />
		</div>
	);
}
