// SPDX-License-Identifier: AGPL-3.0-only
/** A one-field dialog (new file name, rename). `validate` returns an error or null. */
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from './button';
import { Dialog, DialogContent } from './dialog';
import { Field } from './field';
import { Input } from './input';

export interface PromptDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: string;
	label: string;
	initialValue?: string;
	submitLabel: string;
	validate?: (value: string) => string | null;
	onSubmit: (value: string) => void;
}

export function PromptDialog({
	open,
	onOpenChange,
	title,
	description,
	label,
	initialValue = '',
	submitLabel,
	validate,
	onSubmit,
}: PromptDialogProps) {
	const [value, setValue] = useState(initialValue);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (open) {
			setValue(initialValue);
			setError(null);
		}
	}, [open, initialValue]);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		const trimmed = value.trim();
		const problem = validate?.(trimmed) ?? null;
		if (problem) {
			setError(problem);
			return;
		}
		try {
			onSubmit(trimmed);
			onOpenChange(false);
		} catch (caught) {
			setError((caught as Error).message);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title={title} description={description} size="sm">
				<form onSubmit={submit} className="flex flex-col gap-4" noValidate>
					<Field label={label} error={error}>
						{(control) => (
							<Input
								{...control}
								autoFocus
								value={value}
								onChange={(event) => setValue(event.target.value)}
								spellCheck={false}
							/>
						)}
					</Field>
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button onClick={() => onOpenChange(false)}>Cancel</Button>
						<Button type="submit" variant="primary">
							{submitLabel}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
