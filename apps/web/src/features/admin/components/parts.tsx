// SPDX-License-Identifier: AGPL-3.0-only
/** Building blocks shared by the admin pages: panels, figures, tables, the reason dialog. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatChange, REASON_MIN } from '../admin';

export function Panel({
	title,
	aside,
	children,
	className,
}: {
	title?: ReactNode;
	aside?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn(
				'flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4',
				className,
			)}
			aria-label={typeof title === 'string' ? title : undefined}
		>
			{title || aside ? (
				<div className="flex min-h-7 items-center justify-between gap-3">
					{title ? <h2 className="text-sm font-medium text-fg">{title}</h2> : <span />}
					{aside}
				</div>
			) : null}
			{children}
		</section>
	);
}

/** One headline number, with how it moved against the period before. */
export function Figure({
	label,
	value,
	ratio,
	hint,
	loading,
}: {
	label: string;
	value: ReactNode;
	ratio?: number | null | undefined;
	hint?: ReactNode;
	loading?: boolean;
}) {
	return (
		<div
			className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-4"
			role="group"
			aria-label={label}
		>
			<span className="text-xs text-meta">{label}</span>
			{loading ? (
				<Skeleton className="h-7 w-24" />
			) : (
				<span className="truncate font-mono text-2xl tracking-tight text-fg">{value}</span>
			)}
			<span className="flex min-h-4 items-center gap-2 text-xs text-meta">
				{ratio !== undefined && !loading ? (
					<span
						className={cn(
							'font-mono',
							ratio === null || ratio > 0
								? 'text-success'
								: ratio < 0
									? 'text-danger'
									: 'text-meta',
						)}
					>
						{formatChange(ratio)}
					</span>
				) : null}
				{hint}
			</span>
		</div>
	);
}

export function FigureGrid({ children }: { children: ReactNode }) {
	return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** A plain data table; on phones it scrolls sideways. */
export function Table({
	head,
	children,
	label,
	wide = true,
}: {
	head: ReactNode[];
	children: ReactNode;
	label: string;
	/** Keeps its columns readable by scrolling on narrow screens. */
	wide?: boolean;
}) {
	return (
		<div className="-mx-4 overflow-x-auto px-4">
			<table
				className={cn('w-full border-collapse text-[13px]', wide && 'min-w-[640px]')}
				aria-label={label}
			>
				<thead>
					<tr className="border-b border-border text-left text-xs whitespace-nowrap text-meta">
						{head.map((cell, index) => (
							<th key={index} className="py-2.5 pr-4 font-normal last:pr-0">
								{cell}
							</th>
						))}
					</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</div>
	);
}

export const rowClass = 'border-b border-border-soft last:border-0';
export const cellClass = 'py-2.5 pr-4 align-middle whitespace-nowrap last:pr-0';

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
	return (
		<div className="flex flex-col gap-2" aria-hidden>
			{Array.from({ length: rows }, (_, index) => (
				<Skeleton key={index} className="h-9 w-full" />
			))}
		</div>
	);
}

export function LoadMore({
	hasMore,
	loading,
	onMore,
}: {
	hasMore: boolean;
	loading: boolean;
	onMore: () => void;
}) {
	if (!hasMore) return null;
	return (
		<div className="flex justify-center pt-2">
			<Button size="sm" onClick={onMore} disabled={loading}>
				{loading ? 'Loading…' : 'Load more'}
			</Button>
		</div>
	);
}

/**
 * Confirms an admin change and asks why; the reason goes to the audit log.
 * `children` holds the change's own fields.
 */
export function ReasonDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	danger,
	ready = true,
	children,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	confirmLabel: string;
	danger?: boolean;
	ready?: boolean;
	children?: ReactNode;
	onConfirm: (reason: string) => Promise<unknown>;
}) {
	const [reason, setReason] = useState('');
	const [error, setError] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (open) {
			setReason('');
			setError(null);
		}
	}, [open]);
	const valid = reason.trim().length >= REASON_MIN && ready;
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!valid) return;
		setBusy(true);
		setError(null);
		try {
			await onConfirm(reason.trim());
			onOpenChange(false);
		} catch (caught) {
			setError(caught);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title={title} description={description} busy={busy}>
				<form onSubmit={submit} className="flex flex-col gap-4" noValidate>
					{children}
					<Field label="Reason" hint="Kept in the audit log with your name.">
						{(control) => (
							<Textarea
								{...control}
								rows={2}
								maxLength={500}
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								placeholder="Why are you doing this?"
							/>
						)}
					</Field>
					<ErrorMessage error={error} />
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button onClick={() => onOpenChange(false)} disabled={busy}>
							Cancel
						</Button>
						<Button
							type="submit"
							variant={danger ? 'danger' : 'primary'}
							disabled={!valid || busy}
						>
							{busy ? 'Working…' : confirmLabel}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
