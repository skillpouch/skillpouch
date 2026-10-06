// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Modal dialogs. Centered on desktop, a bottom sheet on phones. Focus is
 * trapped and restored by Radix; Escape and the overlay close it unless the
 * dialog is busy.
 */
import { X } from 'lucide-react';
import { Dialog as Primitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

export interface DialogContentProps extends Omit<
	ComponentProps<typeof Primitive.Content>,
	'title'
> {
	title: ReactNode;
	description?: ReactNode;
	/** Wider dialogs for pickers (Free up space). */
	size?: 'sm' | 'md' | 'lg';
	/** Prevents closing while an action runs. */
	busy?: boolean;
	footer?: ReactNode;
	hideClose?: boolean;
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-3xl' } as const;

export function DialogContent({
	title,
	description,
	size = 'md',
	busy = false,
	footer,
	hideClose = false,
	className,
	children,
	...props
}: DialogContentProps) {
	const block = (event: Event) => {
		if (busy) event.preventDefault();
	};
	return (
		<Primitive.Portal>
			<Primitive.Overlay className="fixed inset-0 z-50 bg-black/70 animate-fade-in" />
			<Primitive.Content
				onEscapeKeyDown={block}
				onPointerDownOutside={block}
				className={cn(
					'fixed z-50 flex max-h-[92dvh] w-full flex-col border border-border bg-surface shadow-2xl focus:outline-none',
					'inset-x-0 bottom-0 rounded-t-lg pb-[env(safe-area-inset-bottom)] animate-slide-up',
					'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:pb-0 sm:animate-fade-in',
					widths[size],
					className,
				)}
				{...(description ? {} : { 'aria-describedby': undefined })}
				{...props}
			>
				<div className="flex items-start justify-between gap-4 px-6 pt-5">
					<div className="flex flex-col gap-1">
						<Primitive.Title className="text-base font-semibold text-fg">
							{title}
						</Primitive.Title>
						{description ? (
							<Primitive.Description className="text-[13px] text-muted">
								{description}
							</Primitive.Description>
						) : null}
					</div>
					{hideClose ? null : (
						<Primitive.Close
							className="-mr-2 rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
							aria-label="Close"
							disabled={busy}
						>
							<X className="size-4" />
						</Primitive.Close>
					)}
				</div>
				{children ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
				) : (
					<div className="h-4" />
				)}
				{footer ? (
					<div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
						{footer}
					</div>
				) : null}
			</Primitive.Content>
		</Primitive.Portal>
	);
}
