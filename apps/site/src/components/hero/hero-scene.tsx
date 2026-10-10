// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The hero's living background: the React Bits "Dither" scene tuned to the
 * brand palette (see dither.tsx). Nothing is mounted until the hero is on
 * screen and motion is allowed, so the page paints fast, no-JS, reduced
 * motion and scrolled-past states stay a calm black.
 */
import { useEffect, useRef, useState } from 'react';
import Dither from './dither';

export function HeroScene() {
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
		</div>
	);
}
