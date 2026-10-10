// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The hero's living background: a React Bits scene tuned to the brand palette.
 * `variant` picks between "beams" (undulating dark curtains lit purple) and
 * "dither" (dithered purple waves); see beams.tsx and dither.tsx. Nothing is
 * mounted until the hero is on screen and motion is allowed, so the poster
 * image behind it covers the first paint, no-JS, reduced motion and
 * scrolled-past states.
 */
import { useEffect, useRef, useState } from 'react';
import { Beams } from './beams';
import Dither from './dither';

export type HeroSceneVariant = 'beams' | 'dither';

export function HeroScene({ variant = 'dither' }: { variant?: HeroSceneVariant }) {
	const ref = useRef<HTMLDivElement>(null);
	const [live, setLive] = useState(false);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
		let onScreen = false;
		const update = () => setLive(onScreen && !motion.matches);
		const seen = new IntersectionObserver(([entry]) => {
			onScreen = Boolean(entry?.isIntersecting);
			update();
		});
		seen.observe(el);
		motion.addEventListener('change', update);
		return () => {
			seen.disconnect();
			motion.removeEventListener('change', update);
		};
	}, []);

	if (!live) return <div ref={ref} aria-hidden className="absolute inset-0 -z-20 size-full" />;

	return (
		<div ref={ref} aria-hidden className="absolute inset-0 -z-20 size-full">
			{variant === 'dither' ? (
				<Dither
					waveColor={[0.518, 0.259, 0.851]}
					backgroundColor={[0, 0, 0]}
					colorNum={4}
					pixelSize={2}
					waveSpeed={0.05}
					waveFrequency={3}
					waveAmplitude={0.3}
					enableMouseInteraction={false}
				/>
			) : (
				<Beams
					beamWidth={2}
					beamHeight={15}
					beamNumber={12}
					lightColor="#8442d9"
					beamColor="#000000"
					backgroundColor="#000000"
					speed={2}
					noiseIntensity={1.75}
					scale={0.2}
					rotation={45}
				/>
			)}
		</div>
	);
}
