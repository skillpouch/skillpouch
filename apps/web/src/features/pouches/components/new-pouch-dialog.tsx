// SPDX-License-Identifier: AGPL-3.0-only
/** "New pouch": a signed `create_pouch` with keys sealed to every member. */
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { describeError } from '@/lib/api/errors';
import { useCreatePouch, validatePouchName, type PouchMetaInput } from '../pouches';
import { PouchMetaFields } from './pouch-meta-form';

export function NewPouchDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const create = useCreatePouch();
	const [value, setValue] = useState<PouchMetaInput>({ name: '', description: '' });
	const [submitted, setSubmitted] = useState(false);
	const nameError = submitted ? validatePouchName(value.name) : null;

	const close = (next: boolean) => {
		if (!next) {
			setValue({ name: '', description: '' });
			setSubmitted(false);
			create.reset();
		}
		onOpenChange(next);
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setSubmitted(true);
		if (validatePouchName(value.name)) return;
		const id = await create.mutateAsync(value).catch(() => null);
		if (!id) return;
		close(false);
		await navigate({ to: '/app/p/$pouchId', params: { pouchId: id } });
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				title="New pouch"
				description="A separate encrypted collection, for example one for work and one for personal projects."
				busy={create.isPending}
			>
				<form id="new-pouch" onSubmit={submit} className="flex flex-col gap-4" noValidate>
					<PouchMetaFields
						value={value}
						onChange={setValue}
						nameError={nameError}
						autoFocus
					/>
					{create.error ? (
						<p className="text-[13px] text-danger" role="alert">
							{describeError(create.error)}
						</p>
					) : null}
					<div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
						<Button disabled={create.isPending} onClick={() => close(false)}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" loading={create.isPending}>
							Create pouch
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
