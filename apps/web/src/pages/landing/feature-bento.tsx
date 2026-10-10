// SPDX-License-Identifier: AGPL-3.0-only
import { Bell, Code2, Layers, Link2, MonitorSmartphone, Split } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CipherText } from './cipher-text';
import { InstallTerminal } from './install-terminal';

function Cell({
	title,
	children,
	visual,
	className,
}: {
	title: string;
	children: ReactNode;
	visual: ReactNode;
	className?: string;
}) {
	return (
		<article
			className={cn(
				'relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]',
				className,
			)}
		>
			<h3 className="text-[17px] font-semibold tracking-tight text-fg">{title}</h3>
			<p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">{children}</p>
			<div className="mt-6 flex-1">{visual}</div>
		</article>
	);
}

const TUI_TABS = [
	{
		id: 'overview',
		label: 'Overview',
		src: '/landing/tui-overview.webp',
		alt: 'The SkillPouch terminal UI: the pouch mascot, the active pouch, plan meters and a grid of daily token usage.',
	},
	{
		id: 'usage',
		label: 'Usage',
		src: '/landing/tui-usage.webp',
		alt: 'The terminal UI usage tab: a bar chart of tokens per day and totals by model and assistant.',
	},
] as const;

function TerminalUi() {
	const [tab, setTab] = useState<(typeof TUI_TABS)[number]['id']>('overview');
	return (
		<div className="flex h-full flex-col gap-3">
			<div role="group" aria-label="Terminal UI screen" className="flex gap-1 self-start">
				{TUI_TABS.map((item) => (
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
				{TUI_TABS.map((item) => (
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

/** A crop of an app screenshot past its sidebar, bleeding off the cell's corner. */
function Screenshot({ src, alt, className }: { src: string; alt: string; className: string }) {
	return (
		<div className="relative -mr-6 -mb-6 h-full min-h-[260px] overflow-hidden rounded-tl-lg border-t border-l border-border-strong [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">
			<img
				src={src}
				alt={alt}
				width={1800}
				height={1125}
				loading="lazy"
				decoding="async"
				className={cn('absolute top-[-3%] w-[165%] max-w-none', className)}
			/>
		</div>
	);
}

const EXTRAS = [
	{
		icon: Layers,
		title: 'More than one pouch',
		text: 'Keep work and personal setups apart. Each computer uses one pouch at a time.',
	},
	{
		icon: Link2,
		title: 'Share links',
		text: 'Send a skill or an agent to anyone with a link they can open in a browser.',
	},
	{
		icon: Split,
		title: 'Conflicts you settle',
		text: 'When two computers change the same file, you pick the version to keep.',
	},
	{
		icon: Bell,
		title: 'Desktop notifications',
		text: 'The CLI sends a desktop notification when something needs your attention.',
	},
	{
		icon: MonitorSmartphone,
		title: 'Every device in one list',
		text: 'See which computers and browsers can open your pouches, and remove any of them.',
	},
	{
		icon: Code2,
		title: 'Open source',
		text: 'AGPL licensed. Read the code, or run SkillPouch on your own server.',
	},
];

export function FeatureBento() {
	return (
		<section id="features" aria-labelledby="features-title" className="scroll-mt-24 px-5 py-24">
			<div className="mx-auto max-w-[1120px]">
				<h2
					id="features-title"
					className="landing-display max-w-[20ch] text-4xl leading-[1.05] font-semibold sm:text-5xl"
				>
					A terminal app, a web app, and nothing to babysit.
				</h2>

				<div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
					<Cell
						title="Sync that runs on its own"
						className="md:col-span-2 lg:col-span-4 lg:row-span-2"
						visual={<TerminalUi />}
					>
						Log in once and sync starts with your computer, keeps itself up to date, and
						runs in the background. Run{' '}
						<code className="font-mono text-[13px] text-fg">skillpouch</code> to open
						the terminal UI with your pouches, computers and token usage.
					</Cell>
					<Cell
						title="Encrypted before it leaves"
						className="lg:col-span-2"
						visual={<CipherText />}
					>
						Files and item names are encrypted on your computer or in your browser. The
						server never sees your master password or Recovery Key.
					</Cell>
					<Cell
						title="Two commands to start"
						className="lg:col-span-2"
						visual={<InstallTerminal />}
					>
						Install the CLI, log in, and approve the computer in your browser.
					</Cell>
					<Cell
						title="Marketplaces built in"
						className="lg:col-span-3"
						visual={
							<Screenshot
								src="/landing/marketplaces.webp"
								className="left-[-30%]"
								alt="The marketplaces page listing popular skills from skills.sh, each with an Add button."
							/>
						}
					>
						Add skills and MCP servers from skills.sh, the official MCP Registry and
						GitHub repositories, private ones included.
					</Cell>
					<Cell
						title="Token usage across computers"
						className="lg:col-span-3"
						visual={
							<Screenshot
								src="/landing/usage.webp"
								className="left-[-60%]"
								alt="The usage page: token totals, a calendar of daily usage, and breakdowns by model and assistant."
							/>
						}
					>
						Tokens per day, model and assistant, added up across your computers without
						counting anything twice. Only the counts leave your computer.
					</Cell>
				</div>

				<ul className="mt-16 grid grid-cols-1 gap-x-10 gap-y-8 border-t border-border pt-10 sm:grid-cols-2 lg:grid-cols-3">
					{EXTRAS.map(({ icon: Icon, title, text }) => (
						<li key={title} className="flex gap-3">
							<Icon className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
							<div>
								<h3 className="text-sm font-medium text-fg">{title}</h3>
								<p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
							</div>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
