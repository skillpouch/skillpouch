// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account-wide notices shown on every signed-in page: over the storage limit
 * (uploads paused) and a scheduled account deletion.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Banner } from '@/components/layout/banner';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { FreeUpSpaceDialog } from '@/features/storage/free-up-space-dialog';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { formatBytes, formatDate } from '@/lib/format';
import { bootstrapSession } from '../session/bootstrap';
import { useUnlocked } from '../session/session-store';

export function AccountBanners() {
	const { me } = useUnlocked();
	const client = useQueryClient();
	const [freeing, setFreeing] = useState(false);
	const over = me.account.used_bytes > me.account.quota_bytes;

	const cancelDeletion = async () => {
		try {
			await api.post('/v1/account/restore');
			await bootstrapSession();
			await client.invalidateQueries();
			toast.success('Account deletion cancelled');
		} catch (error) {
			toast.error(describeError(error));
		}
	};

	return (
		<>
			{me.account.delete_after ? (
				<Banner
					tone="warn"
					action={
						<Button size="sm" onClick={() => void cancelDeletion()}>
							Cancel deletion
						</Button>
					}
				>
					Your account will be deleted on {formatDate(me.account.delete_after)}.
				</Banner>
			) : null}
			{over ? (
				<Banner
					tone="warn"
					action={
						<Button size="sm" onClick={() => setFreeing(true)}>
							Free up space
						</Button>
					}
				>
					You’re using <strong>{formatBytes(me.account.used_bytes)}</strong> of{' '}
					{formatBytes(me.account.quota_bytes)}. New changes won’t sync until you free up
					space.
				</Banner>
			) : null}
			<FreeUpSpaceDialog open={freeing} onOpenChange={setFreeing} />
		</>
	);
}
