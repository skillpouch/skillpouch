// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
	title: ReactNode;
	description?: ReactNode;
	/** Buttons on the right (stacked under the title on phones). */
	actions?: ReactNode;
	className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
	return (
		<header
			className={cn(
				'mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
				className,
			)}
		>
			<div className="flex min-w-0 flex-col gap-1">
				<h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{title}</h1>
				{description ? <p className="text-[13px] text-muted">{description}</p> : null}
			</div>
			{actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
		</header>
	);
}
