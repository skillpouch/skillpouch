// SPDX-License-Identifier: AGPL-3.0-only
/** Top-bar pouch picker: jump between pouches, see which are locked, create one. */
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePouches } from '../pouches';
import { NewPouchDialog } from './new-pouch-dialog';
import { PouchMonogram } from './pouch-monogram';

export function PouchSwitcher({ pouchId }: { pouchId: string }) {
	const navigate = useNavigate();
	const { data: pouches } = usePouches();
	const [creating, setCreating] = useState(false);
	const visible = (pouches ?? []).filter((pouch) => pouch.state !== 'deleted');
	const current = visible.find((pouch) => pouch.id === pouchId);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-hover">
					<PouchMonogram name={current?.name ?? '…'} size={22} />
					<span className="truncate font-medium">{current?.name ?? 'Pouch'}</span>
					{current?.state === 'locked' ? (
						<Lock className="size-3.5 text-meta" aria-label="Locked" />
					) : null}
					<ChevronsUpDown className="size-3.5 shrink-0 text-meta" aria-hidden />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-64">
					<DropdownMenuLabel>Pouches</DropdownMenuLabel>
					{visible.map((pouch) => (
						<DropdownMenuItem
							key={pouch.id}
							onSelect={() =>
								void navigate({
									to: '/app/p/$pouchId',
									params: { pouchId: pouch.id },
								})
							}
						>
							<PouchMonogram name={pouch.name} size={20} />
							<span className="flex-1 truncate">{pouch.name}</span>
							{pouch.state === 'locked' ? <Lock aria-label="Locked" /> : null}
							{pouch.id === pouchId ? <Check aria-label="Current" /> : null}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={() => setCreating(true)}>
						<Plus /> New pouch
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => void navigate({ to: '/app' })}>
						All pouches
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<NewPouchDialog open={creating} onOpenChange={setCreating} />
		</>
	);
}
