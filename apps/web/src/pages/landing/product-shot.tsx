// SPDX-License-Identifier: AGPL-3.0-only
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';

/** The web app's file editor in a browser frame; it straightens as it scrolls in. */
export function ProductShot() {
	const ref = useRef<HTMLDivElement>(null);
	const reduce = useReducedMotion();
	const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 0.45'] });
	const rotateX = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 22, 0]);
	const scale = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.92, 1]);
	const glow = useTransform(scrollYProgress, [0, 1], [0.25, 0.8]);

	return (
		<section aria-labelledby="editor-title" className="px-5 pb-28">
			<div className="mx-auto max-w-[1200px]">
				<div className="mx-auto max-w-[720px] text-center">
					<h2
						id="editor-title"
						className="landing-display text-4xl leading-[1.05] font-semibold text-balance sm:text-5xl"
					>
						Everything your assistants know, in one place.
					</h2>
					<p className="mx-auto mt-5 max-w-[58ch] text-base leading-relaxed text-muted">
						Browse every file of every skill, edit with syntax highlighting, or share
						one with a link. Saved changes reach your computers in the background.
					</p>
				</div>

				<div ref={ref} className="relative mt-14 [perspective:1800px]">
					<motion.div
						aria-hidden
						style={{ opacity: glow }}
						className="absolute inset-x-[8%] top-[18%] bottom-[-6%] -z-10 rounded-[50%] bg-accent/45 blur-[110px]"
					/>
					<motion.figure
						style={{ rotateX, scale, transformOrigin: '50% 0%' }}
						className="overflow-hidden rounded-xl border border-white/12 bg-surface shadow-[0_40px_120px_-30px_rgb(132_66_217/0.55),inset_0_1px_0_rgb(255_255_255/0.08)]"
					>
						<div className="flex h-9 items-center gap-2 border-b border-border px-4">
							<span className="size-2.5 rounded-full bg-white/12" />
							<span className="size-2.5 rounded-full bg-white/12" />
							<span className="size-2.5 rounded-full bg-white/12" />
							<span className="mx-auto rounded-md bg-white/5 px-10 py-1 font-mono text-[11px] text-meta">
								skillpouch.net/app
							</span>
						</div>
						<img
							src="/landing/editor.webp"
							alt="The SkillPouch web app showing the pdf skill: a file tree on the left and SKILL.md open with syntax highlighting."
							width={2400}
							height={1500}
							loading="lazy"
							decoding="async"
							className="block h-auto w-full"
						/>
					</motion.figure>
				</div>
			</div>
		</section>
	);
}
