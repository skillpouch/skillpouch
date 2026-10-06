// SPDX-License-Identifier: AGPL-3.0-only
import { cn } from '@/lib/cn';

export interface ProgressProps {
	value: number;
	max: number;
	label: string;
	tone?: 'neutral' | 'warn' | 'danger';
	/** Marks a position on the track (e.g. the plan limit when over it). */
	marker?: number | undefined;
	className?: string;
}

/** A thin usage bar. Over the limit it fills completely in the warning colour. */
export function Progress({ value, max, label, tone, marker, className }: ProgressProps) {
	const ratio = max > 0 ? Math.min(value / max, 1) : 0;
	const resolved = tone ?? (value > max ? 'warn' : ratio > 0.9 ? 'warn' : 'neutral');
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={Math.min(value, max)}
			className={cn(
				'relative h-1.5 w-full overflow-hidden rounded-full bg-[#1c1c1c]',
				className,
			)}
		>
			<div
				className={cn(
					'h-full rounded-full transition-[width] duration-200',
					resolved === 'neutral' && 'bg-fg/70',
					resolved === 'warn' && 'bg-warn',
					resolved === 'danger' && 'bg-danger',
				)}
				style={{ width: `${ratio * 100}%` }}
			/>
			{marker !== undefined && marker > 0 && marker < 1 ? (
				<span
					className="absolute inset-y-0 w-0.5 bg-white"
					style={{ left: `${marker * 100}%` }}
					aria-hidden
				/>
			) : null}
		</div>
	);
}
