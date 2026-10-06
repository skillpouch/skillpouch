// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Make active" for a locked pouch. Below the plan limit it simply unlocks;
 * at the limit the user picks which active pouch gets locked in exchange.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { describeError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { useActivatePouch, type PouchView } from '../pouches';
import { PouchMonogram } from './pouch-monogram';

export function MakeActiveDialog({
	pouch,
	pouches,
	pouchLimit,
	onClose,
}: {
	pouch: PouchView | null;
	pouches: PouchView[];
	pouchLimit: number;
	onClose: () => void;
}) {
	const activate = useActivatePouch();
	const active = pouches.filter((entry) => entry.state === 'active');
	const atLimit = active.length >= pouchLimit;
	const [swap, setSwap] = useState<string | null>(null);
	useEffect(() => {
		setSwap(active[0]?.id ?? null);
		activate.reset();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pouch?.id]);

	const confirm = async () => {
		if (!pouch) return;
		await activate.mutateAsync({
			pouchId: pouch.id,
			...(atLimit && swap ? { lockPouchId: swap } : {}),
		});
		onClose();
	};

	return (
		<Dialog open={pouch !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				title={`Make “${pouch?.name ?? ''}” active`}
				description={
					atLimit
						? `Your plan includes ${pouchLimit} active ${pouchLimit === 1 ? 'pouch' : 'pouches'}. Pick one to lock instead — it stays readable here and nothing is deleted.`
						: 'Your computers will start syncing it again.'
				}
				busy={activate.isPending}
				footer={
					<>
						<Button disabled={activate.isPending} onClick={onClose}>
							Cancel
						</Button>
						<Button
							variant="primary"
							loading={activate.isPending}
							disabled={atLimit && !swap}
							onClick={() => void confirm().catch(() => undefined)}
						>
							Make active
						</Button>
					</>
				}
			>
				{atLimit ? (
					<fieldset className="flex flex-col gap-2">
						<legend className="mb-2 text-[13px] text-muted">Pouch to lock</legend>
						{active.map((entry) => (
							<label
								key={entry.id}
								className={cn(
									'flex cursor-pointer items-center gap-3 rounded-md border p-3 text-[13px]',
									swap === entry.id
										? 'border-accent bg-accent-tint'
										: 'border-border',
								)}
							>
								<input
									type="radio"
									name="lock-pouch"
									className="sr-only"
									checked={swap === entry.id}
									onChange={() => setSwap(entry.id)}
								/>
								<PouchMonogram name={entry.name} size={24} />
								{entry.name}
							</label>
						))}
					</fieldset>
				) : null}
				{activate.error ? (
					<p className="mt-3 text-[13px] text-danger" role="alert">
						{describeError(activate.error)}
					</p>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
