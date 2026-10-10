// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { cn } from '@/lib/cn';

export interface TuiTab {
	id: string;
	label: string;
	src: string;
	alt: string;
}

/** Screenshots of the terminal UI's tabs, switched like the real thing. */
export function TerminalUi({ tabs }: { tabs: readonly TuiTab[] }) {
	const [tab, setTab] = useState(tabs[0]?.id);
	return (
		<div className="flex h-full flex-col gap-3">
			<div role="group" aria-label="Terminal UI screen" className="flex gap-1 self-start">
				{tabs.map((item) => (
					<button
						key={item.id}
						type="button"
						aria-pressed={tab === item.id}
						onClick={() => setTab(item.id)}
						className={cn(
							'rounded-full px-3 py-1 text-xs transition-colors',
							tab === item.id
								? 'bg-white/10 text-fg'
								: 'text-meta hover:bg-white/5 hover:text-fg',
						)}
					>
						{item.label}
					</button>
				))}
			</div>
			<div className="relative grid">
				{tabs.map((item) => (
					<img
						key={item.id}
						src={item.src}
						alt={tab === item.id ? item.alt : ''}
						aria-hidden={tab !== item.id}
						width={1600}
						height={1033}
						loading="lazy"
						decoding="async"
						className={cn(
							'col-start-1 row-start-1 h-auto w-full drop-shadow-[0_24px_48px_rgb(132_66_217/0.18)] transition-opacity duration-300',
							tab === item.id ? 'opacity-100' : 'opacity-0',
						)}
					/>
				))}
			</div>
		</div>
	);
}
