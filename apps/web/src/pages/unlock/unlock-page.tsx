// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/unlock` — this browser is signed in but can't open the pouches yet
 * (a new browser, a trusted one unused for longer than the trust window, or one
 * that was never trusted and asks for the secret after every reload).
 * Passkey first when the account has one and this browser can use it, then
 * the master password; the Recovery Key is the last fallback.
 */
import { Fingerprint } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AuthHeading, AuthLayout } from '@/components/layout/auth-layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/features/account/avatar';
import { bootstrapSession, signOut } from '@/features/session/bootstrap';
import { getSession, useSession, type LockReason } from '@/features/session/session-store';
import { unlockBrowserWithPasskey, usePasskeyOffer } from '@/features/vault/passkeys';
import { unlockBrowser, type UnlockContext, type UnlockMethod } from '@/features/vault/unlock';
import { describeError } from '@/lib/api/errors';

const MEMBERSHIP: Record<LockReason, UnlockContext['membership']> = {
	new_browser: 'none',
	trust_expired: 'expired',
	untrusted: 'untrusted',
};

type Method = UnlockMethod | 'passkey';

const SWITCH_LABEL: Record<Method, string> = {
	passkey: 'Use a passkey instead',
	password: 'Use master password instead',
	recovery: 'Use Recovery Key instead',
};

export function UnlockPage() {
	const session = useSession();
	const offer = usePasskeyOffer();
	const [chosen, setChosen] = useState<Method | null>(null);
	const [secret, setSecret] = useState('');
	const [trust, setTrust] = useState(
		() => session.status !== 'locked' || session.reason !== 'untrusted',
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (session.status !== 'locked') return null;
	const { me, browser, reason } = session;
	const method: Method | null =
		chosen ?? (offer === 'loading' ? null : offer === 'available' ? 'passkey' : 'password');

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (method === null || (method !== 'passkey' && !secret.trim())) return;
		setBusy(true);
		setError(null);
		const context = { accountId: me.account.id, browser, membership: MEMBERSHIP[reason] };
		try {
			if (method === 'passkey') await unlockBrowserWithPasskey(context, { trust });
			else await unlockBrowser(context, method, secret, { trust });
			setSecret('');
			await bootstrapSession({ secretProven: true });
		} catch (caught) {
			setError(describeError(caught));
			setBusy(false);
		}
	};

	const switchTo = (next: Method) => {
		setChosen(next);
		setSecret('');
		setError(null);
	};

	const alternatives: Method[] =
		method === 'passkey'
			? ['password']
			: method === 'password'
				? offer === 'available'
					? ['recovery', 'passkey']
					: ['recovery']
				: offer === 'available'
					? ['password', 'passkey']
					: ['password'];

	return (
		<AuthLayout>
			<form onSubmit={submit} className="flex flex-col gap-6" noValidate>
				<div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
					<Avatar name={me.user.name || me.user.email} image={me.user.image} size={28} />
					<span className="min-w-0 flex-1 truncate text-[13px]">{me.user.email}</span>
					<button
						type="button"
						className="text-xs text-muted hover:text-fg"
						onClick={() => void signOut(getSession())}
					>
						Not you?
					</button>
				</div>
				<AuthHeading
					title="Unlock SkillPouch"
					description={
						reason === 'trust_expired'
							? 'This browser wasn’t used for a while. Unlock it once to trust it again.'
							: 'Your pouches are encrypted. Unlock them on this browser.'
					}
				/>
				{method === null ? (
					<div role="status" aria-label="Loading" className="flex flex-col gap-6">
						<Skeleton className="h-10" />
						<Skeleton className="h-5 w-36" />
						<Skeleton className="h-11" />
					</div>
				) : (
					<>
						{method === 'passkey' ? (
							<div className="flex flex-col gap-2">
								<p className="text-[13px] text-muted">
									Use Touch ID, Windows Hello, your phone or a security key.
								</p>
								{error ? (
									<p className="text-[13px] text-danger" role="alert">
										{error}
									</p>
								) : null}
							</div>
						) : method === 'password' ? (
							<Field label="Master password" error={error}>
								{(control) => (
									<Input
										{...control}
										type="password"
										autoComplete="current-password"
										autoFocus
										value={secret}
										onChange={(event) => setSecret(event.target.value)}
									/>
								)}
							</Field>
						) : (
							<Field
								label="Recovery Key"
								hint="All 12 words, separated by spaces."
								error={error}
							>
								{(control) => (
									<Textarea
										{...control}
										autoFocus
										spellCheck={false}
										autoCapitalize="none"
										autoComplete="off"
										rows={3}
										className="font-mono"
										value={secret}
										onChange={(event) => setSecret(event.target.value)}
									/>
								)}
							</Field>
						)}
						<label className="flex items-center gap-2.5 text-[13px] text-muted">
							<Checkbox
								checked={trust}
								onCheckedChange={(value) => setTrust(value === true)}
							/>
							Trust this browser
						</label>
						<Button
							type="submit"
							variant="primary"
							size="lg"
							loading={busy}
							disabled={method !== 'passkey' && !secret.trim()}
						>
							{method === 'passkey' && !busy ? <Fingerprint aria-hidden /> : null}
							{busy
								? method === 'passkey'
									? 'Waiting for your passkey…'
									: 'Unlocking…'
								: method === 'passkey'
									? 'Unlock with passkey'
									: 'Unlock'}
						</Button>
						<div className="flex flex-col items-center gap-2">
							{alternatives.map((next) => (
								<button
									key={next}
									type="button"
									disabled={busy}
									onClick={() => switchTo(next)}
									className="text-center text-[13px] text-muted underline-offset-4 hover:text-fg hover:underline disabled:opacity-50"
								>
									{SWITCH_LABEL[next]}
								</button>
							))}
						</div>
					</>
				)}
			</form>
		</AuthLayout>
	);
}
