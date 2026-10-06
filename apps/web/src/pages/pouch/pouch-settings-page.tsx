// SPDX-License-Identifier: AGPL-3.0-only
/** `/app/p/:pouchId/settings` — rename, describe or delete the pouch. */
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { toast } from '@/components/ui/toast';
import { PouchMetaFields } from '@/features/pouches/components/pouch-meta-form';
import {
	useDeletePouch,
	usePouch,
	useRenamePouch,
	validatePouchName,
	type PouchMetaInput,
} from '@/features/pouches/pouches';
import { formatDate } from '@/lib/format';

export function PouchSettingsPage() {
	const { pouchId } = useParams({ strict: false }) as { pouchId: string };
	const navigate = useNavigate();
	const pouch = usePouch(pouchId).data;
	const rename = useRenamePouch(pouchId);
	const remove = useDeletePouch(pouchId);
	const [value, setValue] = useState<PouchMetaInput>({ name: '', description: '' });
	const [submitted, setSubmitted] = useState(false);
	const [confirming, setConfirming] = useState(false);

	const savedName = pouch?.name;
	const savedDescription = pouch?.description;
	useEffect(() => {
		if (savedName !== undefined) {
			setValue({ name: savedName, description: savedDescription ?? '' });
		}
	}, [savedName, savedDescription]);

	if (!pouch) return null;
	const nameError = submitted ? validatePouchName(value.name) : null;
	const unchanged =
		value.name.trim() === pouch.name && value.description.trim() === pouch.description;

	const save = async (event: FormEvent) => {
		event.preventDefault();
		setSubmitted(true);
		if (validatePouchName(value.name)) return;
		await rename.mutateAsync(value);
		toast.success('Pouch updated');
	};

	return (
		<div className="max-w-xl">
			<PageHeader title="Pouch settings" />
			<form
				onSubmit={(event) => void save(event).catch(() => undefined)}
				className="flex flex-col gap-4"
				noValidate
			>
				<PouchMetaFields value={value} onChange={setValue} nameError={nameError} />
				<ErrorMessage error={rename.error} />
				<div>
					<Button
						type="submit"
						variant="primary"
						loading={rename.isPending}
						disabled={unchanged}
					>
						Save
					</Button>
				</div>
				<p className="text-xs text-meta">
					The name and description are encrypted. Only your browsers and computers can
					read them.
				</p>
			</form>
			<section
				className="mt-10 rounded-lg border border-danger/30 p-5"
				aria-label="Danger zone"
			>
				<h2 className="text-sm font-medium">Delete pouch</h2>
				<p className="mt-1 text-[13px] text-muted">
					Your computers stop syncing it and remove its items. You can restore it for 7
					days.
				</p>
				<Button
					className="mt-4"
					variant="danger-outline"
					onClick={() => setConfirming(true)}
				>
					Delete pouch
				</Button>
			</section>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={`Delete “${pouch.name}”?`}
				description={`It’s removed from your computers on their next sync and deleted for good after 7 days (${formatDate(new Date(Date.now() + 7 * 86_400_000))}).`}
				confirmLabel="Delete pouch"
				onConfirm={async () => {
					await remove.mutateAsync({});
					toast.success(`“${pouch.name}” deleted. You can restore it from Pouches.`);
					await navigate({ to: '/app' });
				}}
			/>
		</div>
	);
}
