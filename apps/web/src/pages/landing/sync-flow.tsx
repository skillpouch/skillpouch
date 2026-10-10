// SPDX-License-Identifier: AGPL-3.0-only
import { Lock } from 'lucide-react';
import type { CSSProperties } from 'react';
import { AssistantIcon } from '@/features/devices/components/assistant-badge';
import { ASSISTANTS, FLOW_ASSISTANTS, ITEM_KINDS } from './landing-content';

const HEIGHT = 336;

/** Curves from evenly spaced rows on one side to the middle of the other. */
function Connectors({ count, fan }: { count: number; fan: 'in' | 'out' }) {
	const rows = Array.from({ length: count }, (_, index) => ((index + 0.5) / count) * HEIGHT);
	const mid = HEIGHT / 2;
	return (
		<svg
			aria-hidden
			viewBox={`0 0 100 ${HEIGHT}`}
			preserveAspectRatio="none"
			className="hidden h-[336px] min-w-12 flex-1 md:block"
		>
			{rows.map((y, index) => {
				const d =
					fan === 'in'
						? `M0 ${y} C55 ${y} 45 ${mid} 100 ${mid}`
						: `M0 ${mid} C55 ${mid} 45 ${y} 100 ${y}`;
				return (
					<g key={index}>
						<path
							d={d}
							fill="none"
							stroke="rgb(255 255 255 / 0.1)"
							strokeWidth={1}
							vectorEffect="non-scaling-stroke"
						/>
						<path
							d={d}
							fill="none"
							pathLength={100}
							stroke="oklch(0.8 0.13 300)"
							strokeWidth={2}
							strokeLinecap="round"
							vectorEffect="non-scaling-stroke"
							className="landing-flow-dash"
							style={
								{
									'--delay': `${(fan === 'in' ? 0 : 1.4) + index * 0.37}s`,
								} as CSSProperties
							}
						/>
					</g>
				);
			})}
		</svg>
	);
}

export function SyncFlow() {
	const others = ASSISTANTS.filter((assistant) => !FLOW_ASSISTANTS.includes(assistant));
	return (
		<section id="how" aria-labelledby="how-title" className="scroll-mt-24 px-5 py-24">
			<div className="mx-auto max-w-[1120px]">
				<h2
					id="how-title"
					className="landing-display max-w-[24ch] text-4xl leading-[1.05] font-semibold sm:text-5xl"
				>
					Write it once. Each assistant gets its own format.
				</h2>
				<p className="mt-5 max-w-[60ch] text-base leading-relaxed text-muted">
					Add items in the web app or let the CLI pick up what is already on your
					computer. SkillPouch writes each one where every assistant you turn on expects
					it, in the format it reads.
				</p>

				<div className="mt-14 flex flex-col items-stretch gap-8 md:flex-row md:items-center md:gap-0">
					<ul className="flex flex-wrap gap-2 md:h-[336px] md:w-44 md:flex-col md:flex-nowrap md:justify-around md:gap-0">
						{ITEM_KINDS.map((kind) => (
							<li
								key={kind}
								className="rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-[13px] text-fg md:self-end"
							>
								{kind}
							</li>
						))}
					</ul>

					<Connectors count={ITEM_KINDS.length} fan="in" />

					<div className="flex flex-col items-center gap-3 self-center">
						<div className="relative grid size-24 place-items-center rounded-[24px] border border-white/15 bg-[linear-gradient(160deg,rgb(40_26_64),rgb(10_8_16))] shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_0_80px_-10px_var(--landing-glow)]">
							<img
								src="/logo.svg"
								alt=""
								className="size-14"
								width={56}
								height={56}
							/>
						</div>
						<p className="text-sm font-medium">Your pouch</p>
						<p className="-mt-2 flex items-center gap-1.5 text-xs text-meta">
							<Lock className="size-3" aria-hidden /> encrypted
						</p>
					</div>

					<Connectors count={FLOW_ASSISTANTS.length} fan="out" />

					<ul className="flex flex-col gap-2 md:h-[336px] md:w-[330px] md:justify-around md:gap-0">
						{FLOW_ASSISTANTS.map((assistant) => (
							<li
								key={assistant.id}
								className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
							>
								<span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/5 text-fg">
									<AssistantIcon id={assistant.id} className="size-4" />
								</span>
								<span className="min-w-0">
									<span className="block text-[13px] font-medium">
										{assistant.name}
									</span>
									<span className="block truncate font-mono text-[11px] text-meta">
										{assistant.path}
									</span>
								</span>
							</li>
						))}
					</ul>
				</div>
				<p className="mt-8 text-[13px] text-meta md:text-right">
					Also {others.map((assistant) => assistant.name).join(', ')}.
				</p>
			</div>
		</section>
	);
}
