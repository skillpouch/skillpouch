// SPDX-License-Identifier: AGPL-3.0-only
import { cn } from '@/lib/cn';

/** The pouch mark, optionally followed by the wordmark. */
export function Logo({
	withWordmark = true,
	size = 20,
	className,
	wordmarkClassName,
}: {
	withWordmark?: boolean;
	size?: number;
	className?: string;
	wordmarkClassName?: string;
}) {
	return (
		<span className={cn('inline-flex items-center gap-2', className)}>
			<img
				src="/logo.svg"
				alt={withWordmark ? '' : 'SkillPouch'}
				width={size}
				height={size}
			/>
			{withWordmark ? (
				<span
					className={cn(
						'text-[15px] font-semibold tracking-tight text-fg',
						wordmarkClassName,
					)}
				>
					SkillPouch
				</span>
			) : null}
		</span>
	);
}
