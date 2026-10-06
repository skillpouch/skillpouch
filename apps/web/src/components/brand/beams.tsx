// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Calm purple light beams behind the sign-in column. Pure CSS; static when
 * the user prefers reduced motion.
 */
const BEAMS = [
	{ left: '18%', delay: '0s', duration: '9s', opacity: 0.5 },
	{ left: '34%', delay: '2.5s', duration: '11s', opacity: 0.35 },
	{ left: '52%', delay: '1s', duration: '10s', opacity: 0.6 },
	{ left: '68%', delay: '4s', duration: '12s', opacity: 0.4 },
	{ left: '84%', delay: '3s', duration: '9.5s', opacity: 0.3 },
];

export function Beams() {
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
			<div className="absolute inset-x-0 -top-40 h-[480px] bg-[radial-gradient(ellipse_at_center,rgba(132,66,217,0.18),transparent_65%)]" />
			{BEAMS.map((beam) => (
				<span
					key={beam.left}
					className="absolute top-0 h-[60vh] w-px origin-top -rotate-[18deg] bg-gradient-to-b from-transparent via-[#8442d9] to-transparent motion-safe:animate-[beam_var(--beam-duration)_ease-in-out_infinite]"
					style={
						{
							left: beam.left,
							opacity: beam.opacity,
							animationDelay: beam.delay,
							'--beam-duration': beam.duration,
						} as React.CSSProperties
					}
				/>
			))}
			<div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black to-transparent" />
		</div>
	);
}
