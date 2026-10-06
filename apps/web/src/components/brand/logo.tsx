// SPDX-License-Identifier: AGPL-3.0-only
import { cn } from '@/lib/cn';

/** The pouch mark, optionally followed by the wordmark. */
export function Logo({
	withWordmark = true,
	size = 20,
	className,
}: {
	withWordmark?: boolean;
	size?: number;
	className?: string;
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
				<span className="text-[15px] font-semibold tracking-tight text-fg">SkillPouch</span>
			) : null}
		</span>
	);
}
