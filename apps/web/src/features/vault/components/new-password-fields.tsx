// SPDX-License-Identifier: AGPL-3.0-only
/** "New master password" + confirmation, with the local strength rules. */
import { checkNewPassword } from '@skillpouch/crypto';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export interface NewPasswordValue {
	password: string;
	confirmation: string;
}

const REASONS = {
	too_short: 'Use at least 12 characters.',
	too_simple: 'Too easy to guess. Mix words, numbers or symbols.',
	mismatch: 'The passwords don’t match.',
} as const;

/** `null` when valid, otherwise the message for the first problem. */
export function passwordProblem(value: NewPasswordValue): {
	password?: string;
	confirmation?: string;
} | null {
	const result = checkNewPassword(value.password, value.confirmation);
	if (result.ok) return null;
	return result.reason === 'mismatch'
		? { confirmation: REASONS.mismatch }
		: { password: REASONS[result.reason!] };
}

export function NewPasswordFields({
	value,
	onChange,
	showErrors,
	autoFocus = false,
}: {
	value: NewPasswordValue;
	onChange: (value: NewPasswordValue) => void;
	showErrors: boolean;
	autoFocus?: boolean;
}) {
	const [visible, setVisible] = useState(false);
	const problem = showErrors ? passwordProblem(value) : null;
	return (
		<div className="flex flex-col gap-4">
			<Field
				label="Master password"
				aside="12+ chars"
				hint="Use at least 12 characters."
				error={problem?.password}
			>
				{(control) => (
					<div className="relative">
						<Input
							{...control}
							type={visible ? 'text' : 'password'}
							autoComplete="new-password"
							autoFocus={autoFocus}
							value={value.password}
							onChange={(event) =>
								onChange({ ...value, password: event.target.value })
							}
							className="pr-10"
						/>
						<button
							type="button"
							onClick={() => setVisible((shown) => !shown)}
							className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-meta hover:text-fg"
							aria-label={visible ? 'Hide password' : 'Show password'}
						>
							{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
						</button>
					</div>
				)}
			</Field>
			<Field label="Confirm password" error={problem?.confirmation}>
				{(control) => (
					<Input
						{...control}
						type={visible ? 'text' : 'password'}
						autoComplete="new-password"
						value={value.confirmation}
						onChange={(event) =>
							onChange({ ...value, confirmation: event.target.value })
						}
					/>
				)}
			</Field>
		</div>
	);
}
