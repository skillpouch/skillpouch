// SPDX-License-Identifier: AGPL-3.0-only
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
	icon?: LucideIcon;
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
	return (
		<div
			className={cn(
				'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center',
				className,
			)}
		>
			{Icon ? <Icon className="mb-1 size-5 text-meta" aria-hidden /> : null}
			<p className="text-sm font-medium text-fg">{title}</p>
			{description ? <p className="max-w-sm text-[13px] text-muted">{description}</p> : null}
			{action ? <div className="mt-3">{action}</div> : null}
		</div>
	);
}
