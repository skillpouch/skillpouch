// SPDX-License-Identifier: AGPL-3.0-only
/** Create a share link for one ingredient, then copy it. */
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import type { Ingredient } from '../../ingredients/ingredients';
import { kindDefinition } from '../../ingredients/kinds';
import { useCreateShare, type ShareExpiry } from '../shares';

const EXPIRY_OPTIONS: { value: ShareExpiry; label: string }[] = [
	{ value: '1d', label: '1 day' },
	{ value: '7d', label: '7 days' },
	{ value: '30d', label: '30 days' },
	{ value: 'never', label: 'Never' },
];

export function ShareDialog({
	pouchId,
	ingredient,
	description,
	onClose,
}: {
	pouchId: string;
	ingredient: Ingredient | null;
	description: string;
	onClose: () => void;
}) {
	const create = useCreateShare(pouchId);
	const [expires, setExpires] = useState<ShareExpiry>('7d');
	const [oneTime, setOneTime] = useState(false);
	useEffect(() => {
		if (ingredient) {
			create.reset();
			setExpires('7d');
			setOneTime(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ingredient?.id]);

	const kind = ingredient ? kindDefinition(ingredient.kind) : undefined;
	const created = create.data;

	return (
		<Dialog open={ingredient !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				title={`Share ${ingredient?.name ?? ''}`}
				description="Shares a snapshot of the current version. Later edits are not shared."
				busy={create.isPending}
				footer={
					created ? (
						<>
							<Button variant="ghost" asChild>
								<Link
									to="/pouches/$pouchId/shared"
									params={{ pouchId }}
									onClick={onClose}
								>
									Manage links
								</Link>
							</Button>
							<Button variant="primary" onClick={onClose}>
								Done
							</Button>
						</>
					) : (
						<>
							<Button disabled={create.isPending} onClick={onClose}>
								Cancel
							</Button>
							<Button
								variant="primary"
								loading={create.isPending}
								onClick={() =>
									ingredient &&
									create.mutate({ ingredient, description, expires, oneTime })
								}
							>
								Create link
							</Button>
						</>
					)
				}
			>
				{created ? (
					<div className="flex flex-col gap-3">
						<label className="text-[13px] font-medium" htmlFor="share-link">
							Link
						</label>
						<div className="flex gap-2">
							<Input
								id="share-link"
								readOnly
								value={created.url}
								className="font-mono text-xs"
								onFocus={(event) => event.target.select()}
							/>
							<CopyButton value={created.url} variant="primary" />
						</div>
						<p className="text-xs text-meta">
							The key is in the link itself. SkillPouch can’t read what you share.
						</p>
						{created.stripped.length > 0 ? (
							<p className="text-xs text-warn">
								{created.stripped.length} secret value
								{created.stripped.length === 1 ? ' was' : 's were'} removed. The
								recipient fills them in.
							</p>
						) : null}
					</div>
				) : (
					<div className="flex flex-col gap-5">
						<div className="flex flex-col gap-2">
							<span className="text-[13px] font-medium">Expires</span>
							<Segmented
								label="Expires"
								value={expires}
								onChange={setExpires}
								options={EXPIRY_OPTIONS}
							/>
						</div>
						<label className="flex items-start justify-between gap-4">
							<span className="flex flex-col gap-0.5">
								<span className="text-[13px] font-medium">
									Allow only one import
								</span>
								<span className="text-xs text-muted">
									The link stops working after the first person adds it.
								</span>
							</span>
							<Switch
								checked={oneTime}
								onCheckedChange={setOneTime}
								aria-label="Allow only one import"
							/>
						</label>
						{kind?.secretKeys ? (
							<p className="rounded-md border border-border bg-surface p-3 text-xs text-muted">
								Secret values ({kind.secretKeys.join(', ')}) are removed before
								sharing.
							</p>
						) : null}
						<p className="text-xs text-meta">
							The key is in the link itself. SkillPouch can’t read what you share.
						</p>
						<ErrorMessage error={create.error} />
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
