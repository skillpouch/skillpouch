// SPDX-License-Identifier: AGPL-3.0-only
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

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

/** Centered spinner for a whole region (route loading, first fetch). */
export function LoadingBlock({ label }: { label?: string | undefined }) {
	return (
		<div className="flex min-h-40 items-center justify-center text-muted">
			<Spinner label={label} className="size-5" />
		</div>
	);
}
