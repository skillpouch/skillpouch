// SPDX-License-Identifier: AGPL-3.0-only
/** Name + optional description, shared by "New pouch" and pouch settings. */
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import type { PouchMetaInput } from '../pouches';

export function PouchMetaFields({
	value,
	onChange,
	nameError,
	autoFocus = false,
}: {
	value: PouchMetaInput;
	onChange: (value: PouchMetaInput) => void;
	nameError?: string | null | undefined;
	autoFocus?: boolean;
}) {
	return (
		<div className="flex flex-col gap-4">
			<Field label="Name" error={nameError}>
				{(control) => (
					<Input
						{...control}
						autoFocus={autoFocus}
						maxLength={64}
						placeholder="Work"
						value={value.name}
						onChange={(event) => onChange({ ...value, name: event.target.value })}
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
							onChange({ ...value, description: event.target.value })
						}
					/>
				)}
			</Field>
		</div>
	);
}
