// SPDX-License-Identifier: AGPL-3.0-only
import { Command } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { isApple } from '@/lib/platform';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<kbd
			className={cn(
				'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong px-1 font-mono text-[11px] text-meta',
				className,
			)}
		>
			{children}
		</kbd>
	);
}

/** `mod` is ⌘ on Apple platforms and Ctrl elsewhere. */
export type ShortcutKey = 'mod' | (string & {});

/** A key combination drawn as keycaps, modifiers as their symbols. */
export function Shortcut({ keys, className }: { keys: ShortcutKey[]; className?: string }) {
	const apple = isApple();
	const label = keys
		.map((key) => (key === 'mod' ? (apple ? 'Command' : 'Control') : key))
		.join('+');
	return (
		<span className={cn('inline-flex items-center gap-0.5', className)} aria-label={label}>
			{keys.map((key) => (
				<Kbd key={key}>
					{key === 'mod' ? (
						apple ? (
							<Command className="size-3" aria-hidden />
						) : (
							<span aria-hidden>Ctrl</span>
						)
					) : (
						<span aria-hidden>{key}</span>
					)}
				</Kbd>
			))}
		</span>
	);
}
