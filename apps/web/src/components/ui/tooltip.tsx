// SPDX-License-Identifier: AGPL-3.0-only
import { Tooltip as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';

export const TooltipProvider = Primitive.Provider;

export function Tooltip({
	content,
	children,
	side = 'right',
}: {
	content: ReactNode;
	children: ReactNode;
	side?: 'top' | 'right' | 'bottom' | 'left';
}) {
	return (
		<Primitive.Root delayDuration={300}>
			<Primitive.Trigger asChild>{children}</Primitive.Trigger>
			<Primitive.Portal>
				<Primitive.Content
					side={side}
					sideOffset={6}
					className="z-50 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-fg shadow-lg animate-fade-in"
				>
					{content}
				</Primitive.Content>
			</Primitive.Portal>
		</Primitive.Root>
	);
}
