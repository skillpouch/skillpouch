// SPDX-License-Identifier: AGPL-3.0-only
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { INSTALL_COMMAND } from '../landing-content';

/** The install command as a button that copies it. */
export function InstallCommand({ className }: { className?: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<button
			type="button"
			onClick={async () => {
				await navigator.clipboard.writeText(INSTALL_COMMAND);
				setCopied(true);
			}}
			aria-label={copied ? 'Copied install command' : `Copy ${INSTALL_COMMAND}`}
			className={cn(
				'group inline-flex h-11 items-center gap-3 rounded-full border border-white/12 bg-black/50 pr-2 pl-5 font-mono text-[13px] text-fg backdrop-blur-md transition-colors hover:border-white/25 active:scale-[0.98]',
				className,
			)}
		>
			<span>
				<span className="text-meta select-none">$ </span>
				{INSTALL_COMMAND}
			</span>
			<span className="grid size-7 place-items-center rounded-full bg-white/6 text-muted transition-colors group-hover:text-fg">
				{copied ? (
					<Check className="size-3.5 text-success" />
				) : (
					<Copy className="size-3.5" />
				)}
			</span>
		</button>
	);
}
