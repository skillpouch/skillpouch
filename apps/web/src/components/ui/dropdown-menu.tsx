// SPDX-License-Identifier: AGPL-3.0-only
import { DropdownMenu as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;

export function DropdownMenuContent({
	className,
	align = 'end',
	sideOffset = 6,
	...props
}: ComponentProps<typeof Primitive.Content>) {
	return (
		<Primitive.Portal>
			<Primitive.Content
				align={align}
				sideOffset={sideOffset}
				className={cn(
					'z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-xl animate-fade-in',
					className,
				)}
				{...props}
			/>
		</Primitive.Portal>
	);
}

export function DropdownMenuItem({
	className,
	tone = 'default',
	...props
}: ComponentProps<typeof Primitive.Item> & { tone?: 'default' | 'danger' }) {
	return (
		<Primitive.Item
			className={cn(
				'flex min-h-8 cursor-pointer select-none data-[disabled]:cursor-not-allowed items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover max-sm:min-h-11 [&_svg]:size-4 [&_svg]:text-muted',
				tone === 'danger' ? 'text-danger [&_svg]:text-danger' : 'text-fg',
				className,
			)}
			{...props}
		/>
	);
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
	return (
		<Primitive.Label className={cn('px-2 py-1.5 text-xs text-meta', className)} {...props} />
	);
}

export function DropdownMenuSeparator({
	className,
	...props
}: ComponentProps<typeof Primitive.Separator>) {
	return (
		<Primitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
	);
}
