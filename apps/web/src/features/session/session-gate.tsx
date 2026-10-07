// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Route guard. Each page declares which session state it needs; anything else
 * is redirected to the page that resolves it (sign in → set up → unlock),
 * remembering where the user wanted to go.
 */
import { Navigate, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AuthSkeleton, ShellSkeleton } from '@/components/ui/page-skeleton';
import { bootstrapSession } from './bootstrap';
import { useSession, type SessionState } from './session-store';

export type GateRequirement = 'signed_out' | 'setup_required' | 'locked' | 'unlocked';

interface Target {
	to: string;
	search?: Record<string, string>;
}

/** Only in-app paths may be redirect targets. */
function isAppPath(path: string): boolean {
	return path.startsWith('/app') || path.startsWith('/cli/') || path.startsWith('/s/');
}

/** Where a user in `state` belongs when the current page doesn't fit. */
function destination(state: SessionState, redirect: string): Target | null {
	switch (state.status) {
		case 'signed_out':
			return { to: '/sign-in', search: { redirect } };
		case 'setup_required':
			return { to: '/setup' };
		case 'locked':
			return { to: '/unlock', search: { redirect } };
		case 'unlocked': {
			if (!isAppPath(redirect)) return { to: '/app' };
			const url = new URL(redirect, location.origin);
			return { to: url.pathname, search: Object.fromEntries(url.searchParams) };
		}
		default:
			return null;
	}
}

/** While the session is resolved or a redirect runs: the frame of where the user is going. */
export function FullPageSpinner() {
	const { pathname } = useLocation();
	return pathname.startsWith('/app') ? <ShellSkeleton /> : <AuthSkeleton />;
}

export function SessionGate({
	require,
	children,
}: {
	require: GateRequirement;
	children: ReactNode;
}) {
	const session = useSession();
	const location = useLocation();
	if (session.status === 'loading') return <FullPageSpinner />;
	if (session.status === 'error') return <SessionError message={session.message} />;
	if (session.status === require) return <>{children}</>;

	const here = `${location.pathname}${location.searchStr}`;
	// Pages that are themselves a step (sign-in, unlock) forward to the saved target.
	const saved = new URLSearchParams(location.searchStr).get('redirect');
	const wanted = require === 'unlocked' ? here : saved && isAppPath(saved) ? saved : '/app';
	const target = destination(session, wanted);
	if (!target || target.to === location.pathname) return <FullPageSpinner />;
	return (
		<Navigate to={target.to} {...(target.search ? { search: target.search } : {})} replace />
	);
}

function SessionError({ message }: { message: string }) {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
			<p className="text-base font-medium">SkillPouch couldn’t load your account.</p>
			<p className="max-w-md text-[13px] text-muted">{message}</p>
			<Button onClick={() => void bootstrapSession()}>Try again</Button>
		</div>
	);
}
