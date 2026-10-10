// SPDX-License-Identifier: AGPL-3.0-only
/** The web app's button look on a plain link (links into the app are full page loads). */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
	'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 [&_svg]:size-4 [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				primary: 'bg-accent text-white hover:bg-accent-hover',
				outline: 'border border-border-strong bg-surface text-fg hover:bg-hover',
				ghost: 'text-muted hover:bg-hover hover:text-fg',
			},
			size: {
				sm: 'h-8 px-3 text-[13px]',
				lg: 'h-11 px-5 text-sm',
			},
		},
		defaultVariants: { variant: 'outline', size: 'sm' },
	},
);

export function ButtonLink({
	href,
	variant,
	size,
	className,
	children,
}: VariantProps<typeof buttonVariants> & {
	href: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<a href={href} className={cn(buttonVariants({ variant, size }), className)}>
			{/* Trimmed to cap height and baseline, so flex centering centres the letters. */}
			<span className="trim-to-caps">{children}</span>
		</a>
	);
}
