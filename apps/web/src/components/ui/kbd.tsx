// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<kbd
			className={cn(
				'rounded border border-border-strong px-1.5 font-mono text-[11px] text-meta',
				className,
			)}
		>
			{children}
		</kbd>
	);
}
