// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { cn } from '@/lib/cn';

/** Profile picture from the OAuth provider, or the first letter of the name. */
export function Avatar({
	name,
	image,
	size = 32,
	className,
}: {
	name: string;
	image?: string | null;
	size?: number;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	const initial = name.trim().charAt(0).toUpperCase() || '?';
	return (
		<span
			className={cn(
				'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-strong bg-surface-2 text-xs font-medium text-fg',
				className,
			)}
			style={{ width: size, height: size }}
		>
			{image && !failed ? (
				<img
					src={image}
					alt=""
					className="size-full object-cover"
					referrerPolicy="no-referrer"
					onError={() => setFailed(true)}
				/>
			) : (
				initial
			)}
		</span>
	);
}
