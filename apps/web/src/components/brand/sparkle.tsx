// SPDX-License-Identifier: AGPL-3.0-only
/** The four-point sparkle that marks Supporter everywhere (badge, billing, plan cards). */
import { cn } from '@/lib/cn';

export function Sparkle({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 16 16"
			className={cn('supporter-sparkle size-3.5 shrink-0', className)}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.4}
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M8 1.5l1.7 4.8 4.8 1.7-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7L8 1.5Z" />
		</svg>
	);
}
