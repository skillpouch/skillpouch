// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

export const LEGAL_CONTACT = 'info@skillpouch.net';
export const LEGAL_UPDATED = 'October 8, 2026';

/** Public, readable page for the Terms and the Privacy Policy. */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="flex items-center px-6 py-5">
				<Link to="/sign-in" aria-label="SkillPouch">
					<Logo />
				</Link>
			</header>
			<main className="mx-auto w-full max-w-[680px] flex-1 px-6 pt-8 pb-16">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				<p className="mt-2 text-xs text-meta">Last updated {LEGAL_UPDATED}</p>
				<div className="mt-8 flex flex-col gap-8 text-sm leading-relaxed text-muted">
					{children}
				</div>
			</main>
			<footer className="flex flex-wrap justify-center gap-x-2 px-6 py-6 text-xs text-meta">
				<span>© SkillPouch</span>
				<span aria-hidden>·</span>
				<Link className="hover:text-fg" to="/terms">
					Terms
				</Link>
				<span aria-hidden>·</span>
				<Link className="hover:text-fg" to="/privacy">
					Privacy
				</Link>
			</footer>
		</div>
	);
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-base font-medium text-fg">{title}</h2>
			{children}
		</section>
	);
}

export function LegalList({ items }: { items: ReactNode[] }) {
	return (
		<ul className="flex list-disc flex-col gap-1.5 pl-5">
			{items.map((item, index) => (
				<li key={index}>{item}</li>
			))}
		</ul>
	);
}

export function ContactLink() {
	return (
		<a className="text-fg underline hover:text-accent-text" href={`mailto:${LEGAL_CONTACT}`}>
			{LEGAL_CONTACT}
		</a>
	);
}
