// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sync/health status: green = fine, grey pulse = in progress, amber =
 * needs attention, red = conflict or failure. Purple is reserved for actions.
 */
import { cn } from '@/lib/cn';

export type StatusTone = 'ok' | 'busy' | 'warn' | 'error' | 'idle';

const dot: Record<StatusTone, string> = {
	ok: 'bg-success',
	busy: 'bg-muted animate-pulse-soft',
	warn: 'bg-warn',
	error: 'bg-danger',
	idle: 'bg-[#444]',
};

const text: Record<StatusTone, string> = {
	ok: 'text-success',
	busy: 'text-muted',
	warn: 'text-warn',
	error: 'text-danger',
	idle: 'text-meta',
};

export function StatusDot({
	tone,
	label,
	className,
}: {
	tone: StatusTone;
	label: string;
	className?: string;
}) {
	return (
		<span className={cn('inline-flex items-center gap-1.5 text-[13px]', text[tone], className)}>
			<span className={cn('size-1.5 rounded-full', dot[tone])} aria-hidden />
			{label}
		</span>
	);
}
