// SPDX-License-Identifier: AGPL-3.0-only
import { useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { INSTALL_COMMAND } from '@/components/landing-content';

export type TerminalLine =
	| { kind: 'command'; text: string }
	| { kind: 'output'; text: string; tone?: 'meta' | 'success' | 'accent' };

export const LOGIN_SCRIPT: readonly TerminalLine[] = [
	{ kind: 'command', text: INSTALL_COMMAND },
	{ kind: 'command', text: 'skillpouch login' },
	{ kind: 'output', text: 'Waiting for you to approve laptop', tone: 'meta' },
	{ kind: 'output', text: 'Opened skillpouch.net/cli/authorize', tone: 'accent' },
	{ kind: 'output', text: 'Check that it shows 2605 · 3825', tone: 'meta' },
	{ kind: 'output', text: '✓ Logged in as Ada Lovelace', tone: 'success' },
	{ kind: 'output', text: 'Supporter plan · this computer is laptop', tone: 'meta' },
];

/** Typing steps: one per character of a command, one per output line. */
export function scriptSteps(script: readonly TerminalLine[]): number {
	return script.reduce(
		(total, line) => total + (line.kind === 'command' ? line.text.length : 1),
		0,
	);
}

/** The lines visible after `step` steps; the last command may be partly typed. */
export function visibleLines(script: readonly TerminalLine[], step: number): TerminalLine[] {
	const lines: TerminalLine[] = [];
	let left = step;
	for (const line of script) {
		if (left <= 0) break;
		if (line.kind === 'command') {
			lines.push({ kind: 'command', text: line.text.slice(0, left) });
			left -= line.text.length;
		} else {
			lines.push(line);
			left -= 1;
		}
	}
	return lines;
}

const TONES = {
	meta: 'text-meta',
	success: 'text-success',
	accent: 'text-accent-text',
} as const;

/** Types `skillpouch login` the first time it scrolls into view. */
export function InstallTerminal() {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { once: true, amount: 0.6 });
	const reduce = useReducedMotion();
	const total = scriptSteps(LOGIN_SCRIPT);
	const [step, setStep] = useState(0);
	const shown = reduce ? total : step;

	useEffect(() => {
		if (reduce || !inView || step >= total) return;
		const next = visibleLines(LOGIN_SCRIPT, step + 1).at(-1);
		const typing = next?.kind === 'command' && next.text.length > 1;
		const delay = typing ? 45 + Math.random() * 50 : next?.kind === 'output' ? 420 : 500;
		const timer = setTimeout(() => setStep((value) => value + 1), delay);
		return () => clearTimeout(timer);
	}, [inView, reduce, step, total]);

	const lines = visibleLines(LOGIN_SCRIPT, shown);
	const done = shown >= total;
	return (
		<div
			ref={ref}
			className="h-full min-h-[208px] overflow-hidden rounded-lg border border-border bg-black p-4 font-mono text-[11.5px] leading-[1.7]"
			role="img"
			aria-label={`Terminal: ${INSTALL_COMMAND}, then skillpouch login, approved in the browser.`}
		>
			{lines.map((line, index) =>
				line.kind === 'command' ? (
					<p key={index} className="whitespace-pre-wrap text-fg">
						<span className="text-accent-text">$ </span>
						{line.text}
						{index === lines.length - 1 && !done ? <Caret /> : null}
					</p>
				) : (
					<p
						key={index}
						className={cn('whitespace-pre-wrap', TONES[line.tone ?? 'meta'])}
					>
						{line.text}
					</p>
				),
			)}
			{done || lines.length === 0 || lines.at(-1)?.kind === 'output' ? (
				<p className="text-fg">
					<span className="text-accent-text">$ </span>
					<Caret />
				</p>
			) : null}
		</div>
	);
}

function Caret() {
	return (
		<span className="landing-caret ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] bg-fg/80" />
	);
}
