// SPDX-License-Identifier: AGPL-3.0-only
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
	return (
		<div className={cn('animate-pulse-soft rounded-md bg-[#141414]', className)} aria-hidden />
	);
}
