// SPDX-License-Identifier: AGPL-3.0-only
import { Check, Minus } from 'lucide-react';
import { Checkbox as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Checkbox({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
	return (
		<Primitive.Root
			className={cn(
				'peer flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[#444] bg-surface transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:opacity-50',
				className,
			)}
			{...props}
		>
			<Primitive.Indicator className="text-white">
				{props.checked === 'indeterminate' ? (
					<Minus className="size-3" strokeWidth={3} />
				) : (
					<Check className="size-3" strokeWidth={3} />
				)}
			</Primitive.Indicator>
		</Primitive.Root>
	);
}
