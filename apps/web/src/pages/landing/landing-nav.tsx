// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/session/session-store';

const SECTIONS = [
	{ href: '#how', label: 'How it works' },
	{ href: '#features', label: 'Features' },
	{ href: '#pricing', label: 'Pricing' },
	{ href: '#faq', label: 'FAQ' },
];

/** Signed-in visitors go straight to the app; everyone else signs in. */
export function SessionActions({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
	const { status } = useSession();
	if (status === 'loading') return <span className="h-8 w-[168px]" aria-hidden />;
	if (status !== 'signed_out' && status !== 'error') {
		return (
			<Button variant="primary" size={size} className="rounded-full" asChild>
				<Link to="/app">Open SkillPouch</Link>
			</Button>
		);
	}
	return (
		<div className="flex items-center gap-1">
			<Button variant="ghost" size={size} className="rounded-full" asChild>
				<Link to="/sign-in">Sign in</Link>
			</Button>
			<Button variant="primary" size={size} className="rounded-full" asChild>
				<Link to="/sign-in">Get started</Link>
			</Button>
		</div>
	);
}

export function LandingNav() {
	return (
		<header className="fixed inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4">
			<nav
				aria-label="Main"
				className="flex w-full max-w-[880px] items-center justify-between gap-4 rounded-full border border-white/10 bg-black/60 py-1.5 pr-1.5 pl-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl"
			>
				<a href="#top" aria-label="SkillPouch, back to top" className="shrink-0">
					<Logo size={22} />
				</a>
				<ul className="hidden items-center gap-1 text-[13px] text-muted md:flex">
					{SECTIONS.map((section) => (
						<li key={section.href}>
							<a
								href={section.href}
								className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/5 hover:text-fg focus-visible:text-fg"
							>
								{section.label}
							</a>
						</li>
					))}
				</ul>
				<SessionActions />
			</nav>
		</header>
	);
}
