// SPDX-License-Identifier: AGPL-3.0-only
import { Switch as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Switch({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
	return (
		<Primitive.Root
			className={cn(
				'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border-strong bg-[#222] transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50',
				className,
			)}
			{...props}
		>
			<Primitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[17px]" />
		</Primitive.Root>
	);
}
