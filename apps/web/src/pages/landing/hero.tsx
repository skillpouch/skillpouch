// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { Check, Copy } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { INSTALL_COMMAND } from './landing-content';

const EASE = [0.16, 1, 0.3, 1] as const;

/** The install command as a button that copies it. */
export function InstallCommand({ className }: { className?: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<button
			type="button"
			onClick={async () => {
				await navigator.clipboard.writeText(INSTALL_COMMAND);
				setCopied(true);
			}}
			aria-label={copied ? 'Copied install command' : `Copy ${INSTALL_COMMAND}`}
			className={cn(
				'group inline-flex h-11 items-center gap-3 rounded-full border border-white/12 bg-black/50 pr-2 pl-5 font-mono text-[13px] text-fg backdrop-blur-md transition-colors hover:border-white/25 active:scale-[0.98]',
				className,
			)}
		>
			<span>
				<span className="text-meta select-none">$ </span>
				{INSTALL_COMMAND}
			</span>
			<span className="grid size-7 place-items-center rounded-full bg-white/6 text-muted transition-colors group-hover:text-fg">
				{copied ? (
					<Check className="size-3.5 text-success" />
				) : (
					<Copy className="size-3.5" />
				)}
			</span>
		</button>
	);
}

export function Hero() {
	const reduce = useReducedMotion();
	const rise = (delay: number) =>
		reduce
			? {}
			: {
					initial: { opacity: 0, y: 18, filter: 'blur(6px)' },
					animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
					transition: { duration: 0.9, delay, ease: EASE },
				};
	return (
		<section
			id="top"
			className="relative isolate flex min-h-[100dvh] flex-col items-center overflow-hidden px-5"
		>
			<img
				src="/landing/hero.webp"
				alt=""
				width={1916}
				height={821}
				fetchPriority="high"
				decoding="async"
				className="absolute inset-0 -z-20 size-full object-cover object-bottom"
			/>
			<div
				aria-hidden
				className="absolute inset-x-0 top-0 -z-10 h-2/3 bg-[radial-gradient(ellipse_at_50%_30%,rgb(0_0_0/0.75),transparent_70%)]"
			/>
			<div
				aria-hidden
				className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-b from-transparent to-bg"
			/>

			<div className="relative flex max-w-[860px] flex-col items-center pt-32 text-center sm:pt-36">
				<div
					aria-hidden
					className="absolute inset-x-[-10%] top-[46%] bottom-[-20%] -z-10 rounded-[50%] bg-black/80 blur-2xl"
				/>
				<motion.h1
					{...rise(0.05)}
					className="landing-display text-[44px] leading-[1.02] font-semibold text-balance text-fg sm:text-6xl lg:text-[76px]"
				>
					Your AI coding setup, on every computer.
				</motion.h1>
				<motion.p
					{...rise(0.18)}
					className="mt-6 max-w-[56ch] text-base leading-relaxed text-pretty text-[#b4b4b4] sm:text-lg"
				>
					Skills, agents, MCP servers and instructions sync across Claude Code, Codex,
					Cursor and more. End-to-end encrypted.
				</motion.p>
				<motion.div
					{...rise(0.3)}
					className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
				>
					<Button
						variant="primary"
						size="lg"
						className="h-11 rounded-full px-6 shadow-[0_8px_32px_-8px_var(--landing-glow)] active:scale-[0.98]"
						asChild
					>
						<Link to="/sign-in">Get started</Link>
					</Button>
					<InstallCommand />
				</motion.div>
			</div>

			<motion.div
				aria-hidden
				className="absolute left-1/2 grid size-[92px] -translate-x-1/2 translate-y-1/2 place-items-center sm:size-[104px]"
				style={{ bottom: 'max(26.3%, 11.27vw)' }}
				{...(reduce
					? {}
					: {
							initial: { opacity: 0, scale: 0.6 },
							animate: { opacity: 1, scale: 1 },
							transition: {
								type: 'spring',
								stiffness: 120,
								damping: 16,
								delay: 0.55,
							},
						})}
			>
				<div className="landing-halo absolute -inset-16 rounded-full" />
				<div className="landing-float relative grid size-full place-items-center rounded-[26px] border border-white/15 bg-[linear-gradient(160deg,rgb(40_26_64/0.9),rgb(8_6_14/0.95))] shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_20px_60px_-12px_var(--landing-glow)] backdrop-blur-md">
					<img src="/logo.svg" alt="" className="size-[58%]" width={60} height={60} />
				</div>
			</motion.div>
		</section>
	);
}
