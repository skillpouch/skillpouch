// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/setup` — first-time onboarding, three steps:
 *   1. master password   2. save the Recovery Key   3. trust this browser
 * The account's encrypted vault is created only when "Finish setup" is pressed.
 */
import { generateRecoveryKey } from '@skillpouch/crypto';
import { useMemo, useState, type FormEvent } from 'react';
import { AuthHeading, AuthLayout } from '@/components/layout/auth-layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { bootstrapSession } from '@/features/session/bootstrap';
import { useSession } from '@/features/session/session-store';
import {
	NewPasswordFields,
	passwordProblem,
	type NewPasswordValue,
} from '@/features/vault/components/new-password-fields';
import { RecoveryKeyCard } from '@/features/vault/components/recovery-key-card';
import { createAccountVault } from '@/features/vault/setup';
import { describeError } from '@/lib/api/errors';
import { browserLabel } from '@/lib/platform';

type Step = 1 | 2 | 3;

export function SetupPage() {
	const session = useSession();
	const [step, setStep] = useState<Step>(1);
	const [password, setPassword] = useState<NewPasswordValue>({ password: '', confirmation: '' });
	const [showErrors, setShowErrors] = useState(false);
	const [saved, setSaved] = useState(false);
	const [trust, setTrust] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const recoveryKey = useMemo(() => generateRecoveryKey(), []);

	if (session.status !== 'setup_required') return null;
	const { me, browser } = session;

	const submitPassword = (event: FormEvent) => {
		event.preventDefault();
		setShowErrors(true);
		if (!passwordProblem(password)) setStep(2);
	};

	const finish = async () => {
		setBusy(true);
		setError(null);
		try {
			await createAccountVault({
				accountId: me.account.id,
				browser,
				password: password.password,
				recoveryKey,
				trustBrowser: trust,
			});
			await bootstrapSession();
		} catch (caught) {
			setError(describeError(caught));
			setBusy(false);
		}
	};

	return (
		<AuthLayout
			width="md"
			aside={<span className="font-mono text-xs text-meta">{step}/3</span>}
		>
			{step === 1 ? (
				<form onSubmit={submitPassword} className="flex flex-col gap-6" noValidate>
					<AuthHeading
						title="Create your master password"
						description="It encrypts your pouches on this device and never leaves it."
					/>
					<NewPasswordFields
						value={password}
						onChange={setPassword}
						showErrors={showErrors}
						autoFocus
					/>
					<div className="rounded-lg border border-border bg-surface p-3 text-[13px]">
						<p className="font-medium text-fg">This password can’t be reset.</p>
						<p className="mt-1 text-muted">
							We never have it, so we can’t recover it for you. If you forget it, only
							your Recovery Key gets you back in.
						</p>
					</div>
					<Button type="submit" variant="primary" size="lg">
						Continue
					</Button>
				</form>
			) : null}

			{step === 2 ? (
				<div className="flex flex-col gap-6">
					<AuthHeading
						title="Save your Recovery Key"
						description="The only way back in if you forget your master password. We can’t show it again."
					/>
					<RecoveryKeyCard words={recoveryKey.words} email={me.user.email} />
					<label className="flex items-center gap-2.5 text-[13px]">
						<Checkbox
							checked={saved}
							onCheckedChange={(value) => setSaved(value === true)}
						/>
						I saved my Recovery Key
					</label>
					<div className="flex gap-2">
						<Button size="lg" onClick={() => setStep(1)}>
							Back
						</Button>
						<Button
							size="lg"
							variant="primary"
							className="flex-1"
							disabled={!saved}
							onClick={() => setStep(3)}
						>
							Continue
						</Button>
					</div>
				</div>
			) : null}

			{step === 3 ? (
				<div className="flex flex-col gap-6">
					<AuthHeading
						title="Trust this browser?"
						description="A trusted browser unlocks on its own. Leave it off on shared computers."
					/>
					<label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface p-4">
						<span className="flex flex-col gap-1">
							<span className="text-[13px] font-medium">Trust this browser</span>
							<span className="text-xs text-muted">
								{browserLabel()}. Expires after 30 days unused.
							</span>
						</span>
						<Switch
							checked={trust}
							onCheckedChange={setTrust}
							aria-label="Trust this browser"
						/>
					</label>
					<p className="text-xs text-meta">
						You can revoke it any time from Account, Devices.
					</p>
					{error ? (
						<p className="text-[13px] text-danger" role="alert">
							{error}
						</p>
					) : null}
					<div className="flex gap-2">
						<Button size="lg" disabled={busy} onClick={() => setStep(2)}>
							Back
						</Button>
						<Button
							size="lg"
							variant="primary"
							className="flex-1"
							loading={busy}
							onClick={() => void finish()}
						>
							{busy ? 'Encrypting…' : 'Finish setup'}
						</Button>
					</div>
				</div>
			) : null}
		</AuthLayout>
	);
}
