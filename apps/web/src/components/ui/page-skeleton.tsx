// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Placeholders shaped like the page that is about to appear, shown while a
 * page's code or first data loads. The surrounding layout (sidebar, top bar)
 * stays on screen; only the content area shows these.
 */
import { cn } from '@/lib/cn';
import { Skeleton } from './skeleton';

export type PageSkeletonVariant = 'list' | 'cards' | 'settings' | 'overview' | 'form';

function HeaderSkeleton({ actions = false }: { actions?: boolean }) {
	return (
		<div className="mb-6 flex items-end justify-between gap-4">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-7 w-40" />
				<Skeleton className="h-4 w-64 max-w-full" />
			</div>
			{actions ? <Skeleton className="h-8 w-28 max-sm:hidden" /> : null}
		</div>
	);
}

/** Rows of a table or list. */
export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
	return (
		<div className={cn('flex flex-col gap-2', className)} aria-busy>
			{Array.from({ length: rows }, (_, index) => (
				<Skeleton key={index} className="h-12" />
			))}
		</div>
	);
}

export function PageSkeleton({ variant = 'list' }: { variant?: PageSkeletonVariant }) {
	return (
		<div role="status" aria-label="Loading" className="animate-fade-in">
			<HeaderSkeleton actions={variant === 'list' || variant === 'cards'} />
			{variant === 'list' ? (
				<>
					<Skeleton className="mb-4 h-8 w-64 max-w-full" />
					<ListSkeleton />
				</>
			) : null}
			{variant === 'cards' ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: 3 }, (_, index) => (
						<Skeleton key={index} className="h-[168px] rounded-lg" />
					))}
				</div>
			) : null}
			{variant === 'overview' ? (
				<div className="flex flex-col gap-4">
					<Skeleton className="h-32 rounded-lg" />
					<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
						{Array.from({ length: 4 }, (_, index) => (
							<Skeleton key={index} className="h-20 rounded-lg" />
						))}
					</div>
					<ListSkeleton rows={4} />
				</div>
			) : null}
			{variant === 'settings' ? (
				<div className="flex flex-col divide-y divide-border rounded-lg border border-border">
					{Array.from({ length: 3 }, (_, index) => (
						<div key={index} className="flex items-center justify-between gap-4 p-5">
							<div className="flex flex-col gap-2">
								<Skeleton className="h-4 w-32" />
								<Skeleton className="h-4 w-72 max-w-[60vw]" />
							</div>
							<Skeleton className="h-8 w-24" />
						</div>
					))}
				</div>
			) : null}
			{variant === 'form' ? (
				<div className="flex max-w-xl flex-col gap-4">
					<Skeleton className="h-4 w-20" />
					<Skeleton className="h-9" />
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-20" />
					<Skeleton className="h-8 w-20" />
				</div>
			) : null}
		</div>
	);
}

/** A centered auth-style card (sign-in, unlock, authorize, share links). */
export function AuthSkeleton() {
	return (
		<div
			role="status"
			aria-label="Loading"
			className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-4 px-6"
		>
			<Skeleton className="mx-auto size-10 rounded-full" />
			<Skeleton className="mx-auto h-6 w-48" />
			<Skeleton className="h-4" />
			<Skeleton className="h-10" />
			<Skeleton className="h-10" />
		</div>
	);
}

/** The whole signed-in frame, for the first load before the session is known. */
export function ShellSkeleton() {
	return (
		<div role="status" aria-label="Loading SkillPouch" className="flex min-h-dvh">
			<div className="hidden w-[240px] shrink-0 flex-col gap-3 border-r border-border p-4 md:flex">
				<Skeleton className="mb-4 h-6 w-32" />
				{Array.from({ length: 8 }, (_, index) => (
					<Skeleton key={index} className="h-7" />
				))}
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-12 items-center justify-between border-b border-border px-4">
					<Skeleton className="h-6 w-32" />
					<Skeleton className="size-7 rounded-full" />
				</div>
				<div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
					<PageSkeleton variant="cards" />
				</div>
			</div>
		</div>
	);
}
