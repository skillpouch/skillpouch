// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A labelled form control with optional hint and error. The control receives
 * `id`, `aria-describedby` and `aria-invalid` through the render prop, so
 * screen readers announce the hint and the error with the field.
 */
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FieldControlProps {
	id: string;
	'aria-describedby'?: string;
	'aria-invalid'?: boolean;
}

export interface FieldProps {
	label: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	/** Shown after the label, e.g. "(optional)" or a counter. */
	aside?: ReactNode;
	className?: string;
	children: (control: FieldControlProps) => ReactNode;
}

export function Field({ label, hint, error, aside, className, children }: FieldProps) {
	const id = useId();
	const hintId = hint ? `${id}-hint` : undefined;
	const errorId = error ? `${id}-error` : undefined;
	const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
	return (
		<div className={cn('flex flex-col gap-1.5', className)}>
			<div className="flex items-baseline justify-between gap-2">
				<label htmlFor={id} className="text-[13px] font-medium text-fg">
					{label}
				</label>
				{aside ? <span className="text-xs text-meta">{aside}</span> : null}
			</div>
			{children({
				id,
				...(describedBy ? { 'aria-describedby': describedBy } : {}),
				...(error ? { 'aria-invalid': true } : {}),
			})}
			{error ? (
				<p id={errorId} className="text-xs text-danger" role="alert">
					{error}
				</p>
			) : hint ? (
				<p id={hintId} className="text-xs text-meta">
					{hint}
				</p>
			) : null}
		</div>
	);
}
