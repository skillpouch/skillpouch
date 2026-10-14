// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "New pouch": a signed `create_pouch` with keys sealed to every member. A
 * card shows the pouch as it will appear on the pouches page while you type;
 * at the plan limit the dialog says so instead of offering a form that fails.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useUnlocked } from '@/features/session/session-store';
import { describeError } from '@/lib/api/errors';
import { plural } from '@/lib/format';
import { useCreatePouch, usePouches, validatePouchName, type PouchMetaInput } from '../pouches';
import { PouchMetaFields } from './pouch-meta-form';
import { PouchMonogram } from './pouch-monogram';

const FORM_ID = 'new-pouch';

export function NewPouchDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const { me } = useUnlocked();
	const pouches = usePouches();
	const create = useCreatePouch();
	const [value, setValue] = useState<PouchMetaInput>({ name: '', description: '' });
	const [submitted, setSubmitted] = useState(false);
	const nameError = submitted ? validatePouchName(value.name) : null;

	const { plan_name: planName, pouch_limit: limit } = me.account.entitlements;
	const used = (pouches.data ?? []).filter((pouch) => pouch.state === 'active').length;
	const full = pouches.data !== undefined && used >= limit;

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
		await navigate({ to: '/pouches/$pouchId', params: { pouchId: id } });
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				title="New pouch"
				description="Its own encrypted set of instructions, skills, agents and MCP servers. Each computer syncs one pouch."
				busy={create.isPending}
				footer={
					full ? (
						<>
							<Button onClick={() => close(false)}>Close</Button>
							<Button variant="primary" asChild>
								<Link to="/account/billing" onClick={() => close(false)}>
									See plans
								</Link>
							</Button>
						</>
					) : (
						<>
							<p className="mr-auto hidden items-center gap-1.5 text-xs text-meta sm:flex">
								<Lock className="size-3" aria-hidden />
								Encrypted in this browser
							</p>
							<Button disabled={create.isPending} onClick={() => close(false)}>
								Cancel
							</Button>
							<Button
								type="submit"
								form={FORM_ID}
								variant="primary"
								loading={create.isPending}
							>
								Create pouch
							</Button>
						</>
					)
				}
			>
				{full ? (
					<PouchLimit used={used} limit={limit} planName={planName} />
				) : (
					<form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-5" noValidate>
						<PouchPreview value={value} position={used + 1} limit={limit} />
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
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

/** The new pouch as its card on the pouches page will show it. */
function PouchPreview({
	value,
	position,
	limit,
}: {
	value: PouchMetaInput;
	position: number;
	limit: number;
}) {
	const name = value.name.trim();
	const description = value.description.trim();
	return (
		<div
			className="flex flex-col gap-4 rounded-lg border border-border bg-bg p-4"
			data-testid="new-pouch-preview"
		>
			<div className="flex min-w-0 items-start gap-3">
				<PouchMonogram name={name} />
				<div className="min-w-0 flex-1">
					<p className={name ? 'truncate text-sm font-medium' : 'text-sm text-meta'}>
						{name || 'Untitled pouch'}
					</p>
					<p className="truncate text-[13px] text-muted">
						{description || 'No description'}
					</p>
				</div>
			</div>
			<div className="flex flex-col gap-1.5">
				<div className="flex justify-between font-mono text-[11px] text-meta">
					<span>Pouches</span>
					<span>
						{position} of {limit}
					</span>
				</div>
				<Progress value={position} max={limit} label="Pouches after this one" />
			</div>
		</div>
	);
}

function PouchLimit({ used, limit, planName }: { used: number; limit: number; planName: string }) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg p-4">
				<div className="flex justify-between font-mono text-[11px] text-meta">
					<span>Pouches</span>
					<span>
						{used} of {limit}
					</span>
				</div>
				<Progress value={used} max={limit} label="Pouches" />
			</div>
			<p className="text-[13px] text-muted">
				{planName} includes {plural(limit, 'pouch', 'pouches')}, and you’re using all of
				them. Pick a bigger plan, or delete a pouch you don’t need.
			</p>
		</div>
	);
}
