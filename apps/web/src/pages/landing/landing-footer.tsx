// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { InstallCommand } from './hero';
import { CONTACT_EMAIL, SOURCE_URL } from './landing-content';

export function ClosingCta() {
	return (
		<section aria-labelledby="closing-title" className="px-5 pt-12 pb-24">
			<div className="relative isolate mx-auto max-w-[1120px] overflow-hidden rounded-3xl border border-white/10 px-6 py-20 text-center sm:py-24">
				<img
					src="/landing/hero.webp"
					alt=""
					width={1916}
					height={821}
					loading="lazy"
					decoding="async"
					className="absolute inset-0 -z-10 size-full object-cover object-[50%_85%] opacity-70"
				/>
				<div
					aria-hidden
					className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_35%,rgb(0_0_0/0.85),rgb(0_0_0/0.35)_75%)]"
				/>
				<h2
					id="closing-title"
					className="landing-display mx-auto max-w-[16ch] text-4xl leading-[1.05] font-semibold sm:text-6xl"
				>
					Set it up once. Use it everywhere.
				</h2>
				<p className="mx-auto mt-5 max-w-[46ch] text-base leading-relaxed text-[#b4b4b4]">
					Sign in with GitHub or Google, then connect your computers from the terminal.
				</p>
				<div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
					<Button
						variant="primary"
						size="lg"
						className="h-11 rounded-full px-6 shadow-[0_8px_32px_-8px_var(--landing-glow)] active:scale-[0.98]"
						asChild
					>
						<Link to="/sign-in">Get started</Link>
					</Button>
					<InstallCommand />
				</div>
			</div>
		</section>
	);
}

export function LandingFooter() {
	return (
		<footer className="border-t border-border px-5 py-10">
			<div className="mx-auto flex max-w-[1120px] flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-col gap-2">
					<Logo />
					<p className="text-xs text-meta">
						© {new Date().getFullYear()} SkillPouch. Open source under the AGPL.
					</p>
				</div>
				<nav
					aria-label="Footer"
					className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted"
				>
					<a className="hover:text-fg" href={SOURCE_URL} rel="noreferrer" target="_blank">
						Source code
					</a>
					<Link className="hover:text-fg" to="/terms">
						Terms
					</Link>
					<Link className="hover:text-fg" to="/privacy">
						Privacy
					</Link>
					<a className="hover:text-fg" href={`mailto:${CONTACT_EMAIL}`}>
						{CONTACT_EMAIL}
					</a>
				</nav>
			</div>
		</footer>
	);
}
