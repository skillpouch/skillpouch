// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The centered single-column layout of sign-in, unlock, onboarding and the
 * CLI authorize page: no card, logo on top, footer links at the bottom.
 */
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/cn';
import { PRIVACY_URL, TERMS_URL } from '@/lib/site';

export interface AuthLayoutProps {
	children: ReactNode;
	/** Decorative background (sign-in light rays). */
	background?: ReactNode;
	width?: 'sm' | 'md';
	/** Top-right slot (step counter). */
	aside?: ReactNode;
}

export function AuthLayout({ children, background, width = 'sm', aside }: AuthLayoutProps) {
	return (
		<div className="relative flex min-h-dvh flex-col overflow-hidden">
			{background}
			<header className="relative z-10 flex items-center justify-between px-6 py-5">
				<Logo />
				{aside}
			</header>
			<main className="relative z-10 flex flex-1 items-center justify-center px-5 py-10">
				<div className={cn('w-full', width === 'sm' ? 'max-w-[340px]' : 'max-w-[440px]')}>
					{children}
				</div>
			</main>
			<footer className="relative z-10 flex flex-wrap justify-center gap-x-2 px-6 py-6 text-xs text-meta">
				<span>© SkillPouch</span>
				<span aria-hidden>·</span>
				<a className="hover:text-fg" href="https://docs.skillpouch.net">
					Docs
				</a>
				<span aria-hidden>·</span>
				<a className="hover:text-fg" href="https://github.com/skillpouch">
					GitHub
				</a>
				<span aria-hidden>·</span>
				<a className="hover:text-fg" href={TERMS_URL}>
					Terms
				</a>
				<span aria-hidden>·</span>
				<a className="hover:text-fg" href={PRIVACY_URL}>
					Privacy
				</a>
			</footer>
		</div>
	);
}

/** Title + one-line explanation at the top of an auth step. */
export function AuthHeading({
	title,
	description,
	centered = false,
}: {
	title: ReactNode;
	description?: ReactNode;
	centered?: boolean;
}) {
	return (
		<div className={cn('flex flex-col gap-2', centered && 'text-center')}>
			<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
			{description ? <p className="text-[13px] text-muted">{description}</p> : null}
		</div>
	);
}
