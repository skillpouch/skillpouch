// SPDX-License-Identifier: AGPL-3.0-only
/** "New project" and "Edit project": name plus an optional description. */
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { describeError } from '@/lib/api/errors';
import { validateProjectName, type ProjectMeta } from '../projects';

export function ProjectDialog({
	open,
	onOpenChange,
	initial,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Editing when given, creating otherwise. */
	initial?: ProjectMeta | undefined;
	onSubmit: (meta: ProjectMeta) => Promise<unknown>;
}) {
	const [value, setValue] = useState<ProjectMeta>({ name: '', description: '' });
	const [submitted, setSubmitted] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const nameError = submitted ? validateProjectName(value.name) : null;

	useEffect(() => {
		if (!open) return;
		setValue(initial ?? { name: '', description: '' });
		setSubmitted(false);
		setError(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setSubmitted(true);
		if (validateProjectName(value.name)) return;
		setBusy(true);
		setError(null);
		try {
			await onSubmit(value);
			onOpenChange(false);
		} catch (caught) {
			setError(caught);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
			<DialogContent
				title={initial ? 'Edit project' : 'New project'}
				description={
					initial
						? undefined
						: 'Run skillpouch init inside a folder to link it. Its skills, MCP servers and instruction files then sync with that folder only.'
				}
				busy={busy}
			>
				<form onSubmit={submit} className="flex flex-col gap-4" noValidate>
					<Field label="Name" error={nameError}>
						{(control) => (
							<Input
								{...control}
								autoFocus
								maxLength={64}
								placeholder="my-app"
								value={value.name}
								onChange={(event) =>
									setValue({ ...value, name: event.target.value })
								}
							/>
						)}
					</Field>
					<Field label="Description" aside="(optional)">
						{(control) => (
							<Textarea
								{...control}
								maxLength={280}
								rows={2}
								value={value.description}
								onChange={(event) =>
									setValue({ ...value, description: event.target.value })
								}
							/>
						)}
					</Field>
					{error ? (
						<p className="text-[13px] text-danger" role="alert">
							{describeError(error)}
						</p>
					) : null}
					<div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
						<Button disabled={busy} onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" loading={busy}>
							{initial ? 'Save' : 'Create project'}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
