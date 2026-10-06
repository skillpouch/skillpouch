// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Side panels: `right` for item details and the editor (full screen on
 * phones), `left` for the mobile navigation drawer.
 */
import { X } from 'lucide-react';
import { Dialog as Primitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Sheet = Primitive.Root;
export const SheetClose = Primitive.Close;

export interface SheetContentProps extends Omit<ComponentProps<typeof Primitive.Content>, 'title'> {
	side?: 'right' | 'left';
	/** Visually hidden when the panel draws its own header. */
	title: ReactNode;
	hideTitle?: boolean;
	size?: 'md' | 'xl';
}

export function SheetContent({
	side = 'right',
	title,
	hideTitle = false,
	size = 'xl',
	className,
	children,
	...props
}: SheetContentProps) {
	return (
		<Primitive.Portal>
			<Primitive.Overlay className="fixed inset-0 z-50 bg-black/60 animate-fade-in" />
			<Primitive.Content
				aria-describedby={undefined}
				className={cn(
					'fixed inset-y-0 z-50 flex flex-col border-border bg-bg shadow-2xl focus:outline-none',
					side === 'right'
						? cn(
								'right-0 w-full border-l animate-slide-in-right',
								size === 'xl' ? 'md:w-[min(1040px,92vw)]' : 'md:w-[480px]',
							)
						: 'left-0 w-[86vw] max-w-[320px] border-r animate-slide-in-left',
					className,
				)}
				{...props}
			>
				<Primitive.Title
					className={hideTitle ? 'sr-only' : 'px-5 pt-5 text-base font-semibold'}
				>
					{title}
				</Primitive.Title>
				{children}
			</Primitive.Content>
		</Primitive.Portal>
	);
}

export function SheetCloseButton({ className }: { className?: string }) {
	return (
		<Primitive.Close
			className={cn('rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg', className)}
			aria-label="Close"
		>
			<X className="size-4" />
		</Primitive.Close>
	);
}
