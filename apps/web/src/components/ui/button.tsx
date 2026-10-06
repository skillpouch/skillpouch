// SPDX-License-Identifier: AGPL-3.0-only
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

const buttonVariants = cva(
	'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				/** The one purple action per view. */
				primary: 'bg-accent text-white hover:bg-accent-hover',
				/** High-contrast neutral (e.g. "Continue with GitHub"). */
				inverted: 'bg-fg text-bg hover:bg-white',
				outline: 'border border-border-strong bg-surface text-fg hover:bg-hover',
				ghost: 'text-muted hover:bg-hover hover:text-fg',
				danger: 'bg-danger-solid text-white hover:bg-danger',
				'danger-outline': 'border border-border-strong text-danger hover:bg-danger-tint',
				link: 'h-auto p-0 text-fg underline-offset-4 hover:underline',
			},
			size: {
				sm: 'h-8 px-3 text-[13px]',
				md: 'h-9 px-4 text-[13px]',
				lg: 'h-11 px-5 text-sm',
				icon: 'size-8',
			},
		},
		compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
		defaultVariants: { variant: 'outline', size: 'md' },
	},
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
	/** Render the child element (e.g. a router `Link`) with button styles. */
	asChild?: boolean;
	/** Shows a spinner and disables the button. */
	loading?: boolean;
}

export function Button({
	className,
	variant,
	size,
	asChild = false,
	loading = false,
	disabled,
	children,
	type = 'button',
	...props
}: ButtonProps) {
	if (asChild) {
		return (
			<Slot.Root className={cn(buttonVariants({ variant, size }), className)} {...props}>
				{children}
			</Slot.Root>
		);
	}
	return (
		<button
			type={type}
			className={cn(buttonVariants({ variant, size }), className)}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			{...props}
		>
			{loading ? <Spinner /> : null}
			{children}
		</button>
	);
}

export { buttonVariants };
