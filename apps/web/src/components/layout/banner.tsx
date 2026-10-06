// SPDX-License-Identifier: AGPL-3.0-only
/** A full-width notice under the top bar (over quota, locked pouch, deletion scheduled). */
import { Info, Lock, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const tones = {
	info: { className: 'bg-surface text-fg', icon: Info },
	warn: { className: 'bg-warn-tint text-fg', icon: TriangleAlert },
	locked: { className: 'bg-surface text-muted', icon: Lock },
} as const;

export interface BannerProps {
	tone?: keyof typeof tones;
	children: ReactNode;
	action?: ReactNode;
}

export function Banner({ tone = 'info', children, action }: BannerProps) {
	const { className, icon: Icon } = tones[tone];
	return (
		<div
			role="status"
			className={cn(
				'flex flex-col gap-3 border-b border-border px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between sm:px-6',
				className,
			)}
		>
			<div className="flex items-start gap-2.5">
				<Icon
					className={cn('mt-0.5 size-4 shrink-0', tone === 'warn' && 'text-warn')}
					aria-hidden
				/>
				<div>{children}</div>
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	);
}
