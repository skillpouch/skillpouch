// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/sign-in` — GitHub or Google. `?from=cli` adds a line for people who
 * arrived from the terminal; `?error=cancelled` shows why they are back, and
 * a session notice (revoked browser, ended session) says why they were signed out.
 */
import { Link, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { SignInBackground } from '@/components/brand/sign-in-background';
import { AuthLayout } from '@/components/layout/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	devSignIn,
	rememberProvider,
	safeRedirect,
	startOAuth,
	type OAuthProvider,
} from '@/lib/auth';
import { GitHubIcon, GoogleIcon } from '@/features/auth/provider-icons';
import { bootstrapSession } from '@/features/session/bootstrap';
import { useSession } from '@/features/session/session-store';
import { describeError } from '@/lib/api/errors';

export interface SignInSearch {
	redirect?: string;
	from?: string;
	error?: string;
}

export function SignInPage() {
	const search = useSearch({ strict: false }) as SignInSearch;
	const session = useSession();
	const notice = session.status === 'signed_out' ? session.notice : undefined;
	const [pending, setPending] = useState<OAuthProvider | null>(null);
	const [error, setError] = useState<string | null>(
		search.error ? 'Sign-in was cancelled. Try again.' : null,
	);
	const redirect = safeRedirect(search.redirect);

	const signIn = async (provider: OAuthProvider) => {
		setPending(provider);
		setError(null);
		try {
			rememberProvider(provider);
			await startOAuth(provider, redirect);
		} catch (caught) {
			setError(describeError(caught));
			setPending(null);
		}
	};

	return (
		<AuthLayout background={<SignInBackground />}>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2 text-center">
					<h1 className="text-2xl font-semibold tracking-tight">Sign in to SkillPouch</h1>
					<p className="text-[13px] text-muted">
						Your skills, agents and instructions — synced and end-to-end encrypted.
					</p>
					{search.from === 'cli' ? (
						<p className="text-[13px] text-accent-text">
							Sign in to connect your terminal
						</p>
					) : null}
				</div>
				<div className="flex flex-col gap-2.5">
					<Button
						variant="inverted"
						size="lg"
						loading={pending === 'github'}
						disabled={pending !== null}
						onClick={() => void signIn('github')}
					>
						{pending === 'github' ? null : <GitHubIcon />}
						Continue with GitHub
					</Button>
					<Button
						size="lg"
						loading={pending === 'google'}
						disabled={pending !== null}
						onClick={() => void signIn('google')}
					>
						{pending === 'google' ? null : <GoogleIcon />}
						Continue with Google
					</Button>
				</div>
				{error ? (
					<p className="text-center text-[13px] text-danger" role="alert">
						{error}
					</p>
				) : notice ? (
					<p className="text-center text-[13px] text-warn" role="status">
						{notice}
					</p>
				) : null}
				{import.meta.env.DEV ? <DevSignIn /> : null}
				<p className="text-center text-xs text-meta">
					By continuing you agree to the{' '}
					<Link className="underline hover:text-fg" to="/terms">
						Terms
					</Link>{' '}
					and{' '}
					<Link className="underline hover:text-fg" to="/privacy">
						Privacy Policy
					</Link>
					.
				</p>
			</div>
		</AuthLayout>
	);
}

/** Local development only (never bundled into a production build). */
function DevSignIn() {
	const [email, setEmail] = useState('dev@skillpouch.test');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await devSignIn(email);
			rememberProvider(`dev:${email}`);
			// The session gate forwards to `redirect` once the session is known.
			await bootstrapSession();
		} catch (caught) {
			setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};
	return (
		<form
			onSubmit={submit}
			className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong p-3"
			aria-label="Development sign-in"
		>
			<p className="text-xs text-meta">Development sign-in</p>
			<div className="flex gap-2">
				<Input
					type="email"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					aria-label="Email"
					required
				/>
				<Button type="submit" loading={busy}>
					Sign in
				</Button>
			</div>
			{error ? <p className="text-xs text-danger">{error}</p> : null}
		</form>
	);
}
