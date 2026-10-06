// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/app/account/security` — master password, Recovery Key, how long a
 * trusted browser stays trusted, and the account's security events.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useUnlocked } from '@/features/session/session-store';
import {
	NewPasswordFields,
	passwordProblem,
	type NewPasswordValue,
} from '@/features/vault/components/new-password-fields';
import { RecoveryKeyCard } from '@/features/vault/components/recovery-key-card';
import {
	changeMasterPassword,
	newRecoveryKey,
	replaceRecoveryKey,
} from '@/features/vault/change-secrets';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { SecurityEventRecord, SecuritySettingsRecord } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';

const TRUST_OPTIONS = [7, 14, 30, 60, 90].map((days) => ({
	value: String(days),
	label: `${days} days`,
}));

const EVENT_LABELS: Record<string, string> = {
	'cli.authorized': 'A computer was connected',
	'unlock.failed_streak': 'Several wrong master passwords',
	'browser.enrolled': 'A new browser was trusted',
	'device.revoked': 'A device was revoked',
	'refresh.reuse_detected': 'A device token was reused and the device revoked',
	'client.e2ee_failure': 'A client refused data that didn’t verify',
};

export function SecurityPage() {
	const client = useQueryClient();
	const settings = useQuery({
		queryKey: queryKeys.securitySettings,
		queryFn: () => api.get<SecuritySettingsRecord>('/v1/account/security-settings'),
	});
	const events = useQuery({
		queryKey: queryKeys.securityEvents,
		queryFn: async () =>
			(await api.get<{ events: SecurityEventRecord[] }>('/v1/security/events')).events,
	});
	const updateTrust = useMutation({
		mutationFn: (days: number) =>
			api.patch('/v1/account/security-settings', { browser_trust_days: days }),
		onSuccess: () => {
			toast.success('Saved');
			return client.invalidateQueries({ queryKey: queryKeys.securitySettings });
		},
	});
	const acknowledge = useMutation({
		mutationFn: (id: string) => api.post(`/v1/security/events/${id}/ack`),
		onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.securityEvents }),
	});
	const [changingPassword, setChangingPassword] = useState(false);
	const [replacingKey, setReplacingKey] = useState(false);

	return (
		<>
			<PageHeader
				title="Security"
				description="Your pouches are end-to-end encrypted. These secrets open them; SkillPouch never has them."
			/>
			<div className="flex flex-col divide-y divide-border rounded-lg border border-border">
				<Row
					title="Master password"
					description="Unlocks your pouches on a new browser. Changing it rotates every pouch key."
					action={<Button onClick={() => setChangingPassword(true)}>Change</Button>}
				/>
				<Row
					title="Recovery Key"
					description="12 words that get you back in if you forget your master password."
					action={<Button onClick={() => setReplacingKey(true)}>Create new key</Button>}
				/>
				<Row
					title="Trusted browsers"
					description="A trusted browser unlocks on its own until it goes unused this long."
					action={
						settings.data ? (
							<Segmented
								label="Trust window"
								value={String(settings.data.browser_trust_days)}
								onChange={(value) => updateTrust.mutate(Number(value))}
								options={TRUST_OPTIONS}
								className="max-sm:w-full"
							/>
						) : (
							<Skeleton className="h-8 w-64" />
						)
					}
				/>
			</div>
			<ErrorMessage error={updateTrust.error} className="mt-3" />

			<section className="mt-10" aria-label="Security events">
				<h2 className="mb-3 text-sm font-medium">Security events</h2>
				{events.isPending ? (
					<Skeleton className="h-16" />
				) : (events.data ?? []).length === 0 ? (
					<p className="text-[13px] text-muted">Nothing unusual.</p>
				) : (
					<ul className="divide-y divide-border-soft rounded-lg border border-border">
						{events.data!.map((event) => (
							<li key={event.id} className="flex items-start gap-3 p-4 text-[13px]">
								{event.severity === 'info' ? (
									<ShieldCheck className="mt-0.5 size-4 text-meta" aria-hidden />
								) : (
									<ShieldAlert
										className={cn(
											'mt-0.5 size-4',
											event.severity === 'critical'
												? 'text-danger'
												: 'text-warn',
										)}
										aria-hidden
									/>
								)}
								<div className="flex-1">
									<p>{EVENT_LABELS[event.kind] ?? event.kind}</p>
									<p className="text-xs text-meta">
										{formatRelative(event.created_at)}
									</p>
								</div>
								{event.acknowledged_at || event.severity === 'info' ? null : (
									<Button
										size="sm"
										variant="ghost"
										onClick={() => acknowledge.mutate(event.id)}
									>
										It was me
									</Button>
								)}
							</li>
						))}
					</ul>
				)}
			</section>
			<ChangePasswordDialog open={changingPassword} onOpenChange={setChangingPassword} />
			<NewRecoveryKeyDialog open={replacingKey} onOpenChange={setReplacingKey} />
		</>
	);
}

function Row({
	title,
	description,
	action,
}: {
	title: string;
	description: string;
	action: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p className="text-[13px] font-medium">{title}</p>
				<p className="mt-0.5 text-[13px] text-muted">{description}</p>
			</div>
			<div className="shrink-0">{action}</div>
		</div>
	);
}

function ChangePasswordDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [value, setValue] = useState<NewPasswordValue>({ password: '', confirmation: '' });
	const [submitted, setSubmitted] = useState(false);
	const change = useMutation({ mutationFn: changeMasterPassword });
	const close = (next: boolean) => {
		if (!next) {
			setValue({ password: '', confirmation: '' });
			setSubmitted(false);
			change.reset();
		}
		onOpenChange(next);
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setSubmitted(true);
		if (passwordProblem(value)) return;
		try {
			await change.mutateAsync(value.password);
			toast.success('Master password changed');
			close(false);
		} catch {
			// Shown in the dialog from the mutation state.
		}
	};
	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				title="Change master password"
				description="Browsers that are already trusted stay unlocked. New browsers need the new password."
				busy={change.isPending}
			>
				<form
					onSubmit={(event) => void submit(event)}
					className="flex flex-col gap-4"
					noValidate
				>
					<NewPasswordFields
						value={value}
						onChange={setValue}
						showErrors={submitted}
						autoFocus
					/>
					<ErrorMessage error={change.error} />
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button disabled={change.isPending} onClick={() => close(false)}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" loading={change.isPending}>
							Change password
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function NewRecoveryKeyDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { me } = useUnlocked();
	const recoveryKey = useMemo(() => (open ? newRecoveryKey() : null), [open]);
	const [saved, setSaved] = useState(false);
	const replace = useMutation({ mutationFn: replaceRecoveryKey });
	const close = (next: boolean) => {
		if (!next) {
			setSaved(false);
			replace.reset();
		}
		onOpenChange(next);
	};
	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				title="Create a new Recovery Key"
				description="Your old Recovery Key stops working as soon as you confirm."
				busy={replace.isPending}
				footer={
					<>
						<Button disabled={replace.isPending} onClick={() => close(false)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							disabled={!saved}
							loading={replace.isPending}
							onClick={() =>
								recoveryKey &&
								replace.mutate(recoveryKey, {
									onSuccess: () => {
										toast.success('New Recovery Key saved');
										close(false);
									},
								})
							}
						>
							Replace Recovery Key
						</Button>
					</>
				}
			>
				{recoveryKey ? (
					<div className="flex flex-col gap-4">
						<RecoveryKeyCard words={recoveryKey.words} email={me.user.email} />
						<label className="flex items-center gap-2.5 text-[13px]">
							<Checkbox
								checked={saved}
								onCheckedChange={(value) => setSaved(value === true)}
							/>
							I saved my new Recovery Key
						</label>
						<ErrorMessage error={replace.error} />
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
