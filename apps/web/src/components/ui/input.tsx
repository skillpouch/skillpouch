// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const fieldBase =
	'w-full rounded-md border border-border-strong bg-surface px-3 text-[13px] text-fg placeholder:text-meta transition-colors duration-150 hover:border-[#333] focus-visible:border-accent focus-visible:outline-none disabled:opacity-50 aria-invalid:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
	return <input className={cn(fieldBase, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
	return <textarea className={cn(fieldBase, 'min-h-20 resize-y py-2', className)} {...props} />;
}
