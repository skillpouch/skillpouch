// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Security page → Passkeys: add a passkey that unlocks new browsers (WebAuthn
 * PRF), rename it, remove it. Adding and removing need a fresh sign-in.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ellipsis, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PromptDialog } from '@/components/ui/prompt-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { queryKeys } from '@/lib/api/query-keys';
import type { PasskeyRecord } from '@/lib/api/types';
import { formatDate, formatRelative } from '@/lib/format';
import { addPasskey, removePasskey, renamePasskey, usePasskeys, usePrfSupport } from '../passkeys';

const nameOf = (passkey: PasskeyRecord) => passkey.label ?? 'Passkey';

export function PasskeysSection() {
	const client = useQueryClient();
	const support = usePrfSupport();
	const passkeys = usePasskeys();
	const [adding, setAdding] = useState(false);
	const [renaming, setRenaming] = useState<PasskeyRecord | null>(null);
	const [removing, setRemoving] = useState<PasskeyRecord | null>(null);
	const refresh = () =>
		Promise.all([
			client.invalidateQueries({ queryKey: queryKeys.unlockParams }),
			client.invalidateQueries({ queryKey: queryKeys.securityEvents }),
		]);
	const rename = useMutation({
		mutationFn: ({ id, label }: { id: string; label: string }) => renamePasskey(id, label),
		onSuccess: () => {
			toast.success('Passkey renamed');
			return refresh();
		},
	});

	return (
		<div className="p-5" aria-label="Passkeys" role="group">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="text-[13px] font-medium">Passkeys</p>
					<p className="mt-0.5 text-[13px] text-muted">
						{support === 'unsupported'
							? 'This browser can’t unlock with a passkey. Recent Chrome, Edge, Safari and Firefox can.'
							: 'Unlock a new browser with Touch ID, Windows Hello, your phone or a security key. Signing in stays with GitHub or Google.'}
					</p>
				</div>
				<div className="shrink-0">
					<Button
						disabled={support === undefined || support === 'unsupported'}
						onClick={() => setAdding(true)}
					>
						<Plus aria-hidden /> Add passkey
					</Button>
				</div>
			</div>
			{passkeys.isPending ? (
				<Skeleton className="mt-4 h-[66px] rounded-lg" />
			) : passkeys.data && passkeys.data.length > 0 ? (
				<ul className="mt-4 divide-y divide-border-soft rounded-lg border border-border">
					{passkeys.data.map((passkey) => (
						<li
							key={passkey.id}
							className="flex items-start gap-3 p-4"
							aria-label={nameOf(passkey)}
						>
							<KeyRound className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
							<div className="min-w-0 flex-1">
								<p className="truncate text-[13px] font-medium">
									{nameOf(passkey)}
								</p>
								<p className="mt-1.5 text-xs text-meta">
									Added {formatDate(passkey.created_at)} ·{' '}
									{passkey.last_used_at
										? `last unlocked ${formatRelative(passkey.last_used_at)}`
										: 'not used yet'}
								</p>
							</div>
							<DropdownMenu>
								<DropdownMenuTrigger
									aria-label={`Actions for ${nameOf(passkey)}`}
									className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
								>
									<Ellipsis className="size-4" />
								</DropdownMenuTrigger>
								<DropdownMenuContent>
									<DropdownMenuItem onSelect={() => setRenaming(passkey)}>
										<Pencil /> Rename
									</DropdownMenuItem>
									<DropdownMenuItem
										tone="danger"
										onSelect={() => setRemoving(passkey)}
									>
										<Trash2 /> Remove
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</li>
					))}
				</ul>
			) : null}
			<ErrorMessage error={rename.error} className="mt-3" />

			<AddPasskeyDialog open={adding} onOpenChange={setAdding} onAdded={refresh} />
			<PromptDialog
				open={renaming !== null}
				onOpenChange={(open) => !open && setRenaming(null)}
				title="Rename passkey"
				label="Name"
				initialValue={renaming?.label ?? ''}
				submitLabel="Rename"
				validate={(value) =>
					value.length === 0
						? 'Give it a name.'
						: value.length > 80
							? 'Keep it under 80 characters.'
							: null
				}
				onSubmit={(label) => renaming && rename.mutate({ id: renaming.id, label })}
			/>
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(open) => !open && setRemoving(null)}
				title="Remove passkey?"
				description={
					removing
						? `${nameOf(removing)} will stop unlocking SkillPouch. Every pouch key is rotated, so it can’t open anything saved from now on.`
						: undefined
				}
				confirmLabel="Remove passkey"
				onConfirm={async () => {
					if (!removing) return;
					await removePasskey(removing);
					toast.success('Passkey removed');
					await refresh();
				}}
			/>
		</div>
	);
}

function AddPasskeyDialog({
	open,
	onOpenChange,
	onAdded,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdded: () => Promise<unknown>;
}) {
	const [label, setLabel] = useState('');
	const add = useMutation({ mutationFn: (name: string) => addPasskey(name) });
	const close = (next: boolean) => {
		if (!next) {
			setLabel('');
			add.reset();
		}
		onOpenChange(next);
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		try {
			await add.mutateAsync(label.trim() || 'Passkey');
			toast.success('Passkey added');
			await onAdded();
			close(false);
		} catch {
			// Shown in the dialog from the mutation state.
		}
	};
	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				title="Add a passkey"
				description="Your browser asks you to create a passkey, and may ask once more to confirm it. Only passkeys that support the PRF extension can unlock."
				busy={add.isPending}
			>
				<form
					onSubmit={(event) => void submit(event)}
					className="flex flex-col gap-4"
					noValidate
				>
					<Field label="Name" hint="So you can tell your passkeys apart.">
						{(control) => (
							<Input
								{...control}
								autoFocus
								maxLength={80}
								placeholder="MacBook Touch ID"
								value={label}
								onChange={(event) => setLabel(event.target.value)}
							/>
						)}
					</Field>
					<ErrorMessage error={add.error} />
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button disabled={add.isPending} onClick={() => close(false)}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" loading={add.isPending}>
							{add.isPending ? 'Waiting for your passkey…' : 'Continue'}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
