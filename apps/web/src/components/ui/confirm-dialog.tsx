// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Are you sure?" for destructive actions. Owns the pending state so callers
 * just pass an async `onConfirm`; errors stay in the dialog.
 */
import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogContent } from './dialog';
import { ErrorMessage } from './error-message';

export interface ConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	confirmLabel: string;
	tone?: 'danger' | 'primary';
	onConfirm: () => Promise<void> | void;
	children?: ReactNode;
}

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	tone = 'danger',
	onConfirm,
	children,
}: ConfirmDialogProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const confirm = async () => {
		setBusy(true);
		setError(null);
		try {
			await onConfirm();
			onOpenChange(false);
		} catch (caught) {
			setError(caught);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setError(null);
				onOpenChange(next);
			}}
		>
			<DialogContent
				title={title}
				description={description}
				size="sm"
				busy={busy}
				footer={
					<>
						<Button disabled={busy} onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							variant={tone === 'danger' ? 'danger' : 'primary'}
							loading={busy}
							onClick={confirm}
						>
							{confirmLabel}
						</Button>
					</>
				}
			>
				{children}
				<ErrorMessage error={error} className="mt-2" />
			</DialogContent>
		</Dialog>
	);
}
