// SPDX-License-Identifier: AGPL-3.0-only
/** A small set of mutually exclusive options (expiry, sort order, plan interval). */
import { ToggleGroup } from 'radix-ui';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
	value: T;
	label: string;
}

export interface SegmentedProps<T extends string> {
	value: T;
	onChange: (value: T) => void;
	options: SegmentedOption<T>[];
	label: string;
	className?: string;
}

export function Segmented<T extends string>({
	value,
	onChange,
	options,
	label,
	className,
}: SegmentedProps<T>) {
	return (
		<ToggleGroup.Root
			type="single"
			aria-label={label}
			value={value}
			onValueChange={(next) => next && onChange(next as T)}
			className={cn('flex rounded-md border border-border bg-surface p-0.5', className)}
		>
			{options.map((option) => (
				<ToggleGroup.Item
					key={option.value}
					value={option.value}
					className="h-7 flex-1 rounded-[5px] px-3 text-[13px] text-muted transition-colors hover:text-fg data-[state=on]:bg-[#1c1c1c] data-[state=on]:text-fg max-sm:h-10"
				>
					{option.label}
				</ToggleGroup.Item>
			))}
		</ToggleGroup.Root>
	);
}
