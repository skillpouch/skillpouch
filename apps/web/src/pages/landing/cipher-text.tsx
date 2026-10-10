// SPDX-License-Identifier: AGPL-3.0-only
import { useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Ciphertext-looking text of the same shape, stable for the same input. */
export function fakeCiphertext(text: string, seed = 0): string {
	let hash = 2166136261 ^ seed;
	return Array.from(text, (char) => {
		hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
		return char === '\n' || char === ' ' ? char : ALPHABET[hash % ALPHABET.length];
	}).join('');
}

/**
 * Text that is `progress` of the way from `from` to `to`, left to right, with
 * a few scrambled characters at the edge.
 */
export function blend(from: string, to: string, progress: number, noise = 0): string {
	const edge = Math.round(progress * (from.length + 6)) - 6;
	return Array.from(from, (char, index) => {
		if (index < edge) return to[index] ?? char;
		if (index < edge + 6 && char !== ' ' && char !== '\n') {
			return ALPHABET[(index * 31 + noise * 7) % ALPHABET.length];
		}
		return char;
	}).join('');
}

const PLAIN =
	'name: code-reviewer\ndescription: Reviews a diff\n  for bugs and missing tests.\ntools: Read, Grep, Glob';
const CIPHER = fakeCiphertext(PLAIN, 7);
const STEPS = 28;

/** A snippet that encrypts and decrypts in a loop while visible. */
export function CipherText() {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { amount: 0.5 });
	const reduce = useReducedMotion();
	const [encrypted, setEncrypted] = useState(false);
	const [step, setStep] = useState(STEPS);

	useEffect(() => {
		if (reduce || !inView) return;
		if (step < STEPS) {
			const timer = setTimeout(() => setStep((value) => value + 1), 38);
			return () => clearTimeout(timer);
		}
		const timer = setTimeout(() => {
			setEncrypted((value) => !value);
			setStep(0);
		}, 2600);
		return () => clearTimeout(timer);
	}, [inView, reduce, step]);

	const from = encrypted ? PLAIN : CIPHER;
	const to = encrypted ? CIPHER : PLAIN;
	const text = reduce ? CIPHER : blend(from, to, step / STEPS, step);
	const settledEncrypted = reduce || (encrypted && step >= STEPS / 2);

	return (
		<div ref={ref} className="rounded-lg border border-border bg-black p-4">
			<p className="flex items-center gap-2 text-[11px] text-meta">
				<span
					className={cn(
						'size-1.5 rounded-full transition-colors duration-300',
						settledEncrypted ? 'bg-accent-text' : 'bg-success',
					)}
				/>
				{settledEncrypted ? 'What the server stores' : 'On your computer'}
			</p>
			<pre
				aria-label={
					reduce
						? 'An agent file, encrypted.'
						: 'An agent file, turning into ciphertext and back.'
				}
				className={cn(
					'mt-3 font-mono text-[12px] leading-[1.7] break-all whitespace-pre-wrap transition-colors duration-300',
					settledEncrypted ? 'text-accent-text/80' : 'text-fg',
				)}
			>
				{text}
			</pre>
		</div>
	);
}
