// SPDX-License-Identifier: AGPL-3.0-only
/** `/app/account` — who you're signed in as, and deleting the account. */
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Avatar } from '@/features/account/avatar';
import {
	GithubRepositoryAccess,
	SignInMethods,
} from '@/features/account/components/connected-accounts';
import { bootstrapSession } from '@/features/session/bootstrap';
import { useUnlocked } from '@/features/session/session-store';
import { api } from '@/lib/api/client';
import { formatBytes } from '@/lib/format';

export function ProfilePage() {
	const { me } = useUnlocked();
	const [deleting, setDeleting] = useState(false);
	return (
		<>
			<PageHeader title="Profile" />
			<section className="flex items-center gap-4 rounded-lg border border-border p-5">
				<Avatar name={me.user.name || me.user.email} image={me.user.image} size={48} />
				<div className="min-w-0">
					<p className="truncate text-sm font-medium">{me.user.name}</p>
					<p className="truncate text-[13px] text-muted">{me.user.email}</p>
					<p className="mt-1 text-xs text-meta">
						{me.account.entitlements.plan_name} · {formatBytes(me.account.used_bytes)}{' '}
						used
					</p>
				</div>
			</section>
			<p className="mt-3 text-xs text-meta">
				Your name, email and picture come from the account you signed in with (GitHub or
				Google).
			</p>
			<SignInMethods />
			<GithubRepositoryAccess />
			<section
				className="mt-10 rounded-lg border border-danger/30 p-5"
				aria-label="Delete account"
			>
				<h2 className="text-sm font-medium">Delete account</h2>
				<p className="mt-1 text-[13px] text-muted">
					Deletes every pouch, device and share link. You have 7 days to change your mind.
				</p>
				<Button
					className="mt-4"
					variant="danger-outline"
					disabled={me.account.delete_after !== null}
					onClick={() => setDeleting(true)}
				>
					{me.account.delete_after ? 'Deletion scheduled' : 'Delete account'}
				</Button>
			</section>
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title="Delete your account?"
				description="Everything is deleted for good after 7 days. Until then you can cancel from the banner at the top."
				confirmLabel="Delete account"
				onConfirm={async () => {
					await api.delete('/v1/account');
					await bootstrapSession();
				}}
			/>
		</>
	);
}
