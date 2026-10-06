// SPDX-License-Identifier: AGPL-3.0-only
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
	'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
	{
		variants: {
			tone: {
				neutral: 'border-border-strong text-muted',
				accent: 'border-accent/40 bg-accent-tint text-accent-text',
				success: 'border-success/30 text-success',
				warn: 'border-warn/30 bg-warn-tint text-warn',
				danger: 'border-danger/30 bg-danger-tint text-danger',
			},
		},
		defaultVariants: { tone: 'neutral' },
	},
);

export function Badge({
	className,
	tone,
	...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
	return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
