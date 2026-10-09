// SPDX-License-Identifier: AGPL-3.0-only
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

/**
 * "← Previous step", pinned to the top of whatever scrolls around it. The
 * caller gives it the background of that area, so content slides under it.
 */
export function BackButton({
	children,
	onClick,
	className,
}: {
	children: ReactNode;
	onClick: () => void;
	className?: string;
}) {
	return (
		<div className={cn('sticky top-0 z-20 flex', className)}>
			<Button variant="link" size="sm" className="text-muted" onClick={onClick}>
				<ArrowLeft /> {children}
			</Button>
		</div>
	);
}
