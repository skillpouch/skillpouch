// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/unlock` — this browser is signed in but can't open the pouches yet
 * (a new browser, or a trusted one unused for longer than the trust window).
 * Master password first; the Recovery Key is the fallback.
 */
import { useState, type FormEvent } from 'react';
import { AuthHeading, AuthLayout } from '@/components/layout/auth-layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Avatar } from '@/features/account/avatar';
import { bootstrapSession, signOut } from '@/features/session/bootstrap';
import { getSession, useSession } from '@/features/session/session-store';
import { unlockBrowser, type UnlockMethod } from '@/features/vault/unlock';
import { describeError } from '@/lib/api/errors';

export function UnlockPage() {
	const session = useSession();
	const [method, setMethod] = useState<UnlockMethod>('password');
	const [secret, setSecret] = useState('');
	const [trust, setTrust] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (session.status !== 'locked') return null;
	const { me, browser, reason } = session;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!secret.trim()) return;
		setBusy(true);
		setError(null);
		try {
			await unlockBrowser(
				{ accountId: me.account.id, browser, trustExpired: reason === 'trust_expired' },
				method,
				secret,
				{ trust },
			);
			setSecret('');
			await bootstrapSession();
		} catch (caught) {
			setError(describeError(caught));
			setBusy(false);
		}
	};

	const switchMethod = () => {
		setMethod((current) => (current === 'password' ? 'recovery' : 'password'));
		setSecret('');
		setError(null);
	};

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
				{method === 'password' ? (
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
					disabled={!secret.trim()}
				>
					{busy ? 'Unlocking…' : 'Unlock'}
				</Button>
				<button
					type="button"
					onClick={switchMethod}
					className="text-center text-[13px] text-muted underline-offset-4 hover:text-fg hover:underline"
				>
					{method === 'password'
						? 'Use Recovery Key instead'
						: 'Use master password instead'}
				</button>
			</form>
		</AuthLayout>
	);
}
