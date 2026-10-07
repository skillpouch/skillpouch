// SPDX-License-Identifier: AGPL-3.0-only
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Skeleton } from './skeleton';

export function Spinner({
	className,
	label,
}: {
	className?: string | undefined;
	label?: string | undefined;
}) {
	return (
		<LoaderCircle
			className={cn('size-4 animate-spin text-current', className)}
			aria-label={label ?? 'Loading'}
			role="status"
		/>
	);
}

/**
 * Placeholder for a region whose content is loading (first fetch, decrypting,
 * editor code): skeleton lines rather than a spinner, so nothing jumps.
 */
export function LoadingBlock({ label }: { label?: string | undefined }) {
	return (
		<div role="status" className="flex min-h-40 flex-col gap-3 p-4">
			<span className="sr-only">{label ?? 'Loading'}</span>
			{['w-2/3', 'w-full', 'w-5/6', 'w-1/2', 'w-3/4'].map((width) => (
				<Skeleton key={width} className={cn('h-4', width)} />
			))}
		</div>
	);
}
