// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ⌘K on every signed-in page: pages, pouches, computers, browsers, invoices
 * and, inside a pouch, its items. Search runs over decrypted
 * names in memory — names never go to the server, not even as a query string.
 */
import { useNavigate } from '@tanstack/react-router';
import { CornerDownLeft, Search } from 'lucide-react';
import { Dialog as Primitive } from 'radix-ui';
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { useBilling, useInvoices } from '../billing/billing';
import { useDevices } from '../devices/devices';
import { usePouchContents } from '../ingredients/ingredients';
import { usePouches } from '../pouches/pouches';
import { searchEverything, type SearchSources } from './search-index';

export function CommandPalette({
	pouchId,
	open,
	onOpenChange,
}: {
	/** The open pouch, whose items are searched too. */
	pouchId?: string | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				onOpenChange(!open);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onOpenChange]);

	const close = () => onOpenChange(false);
	return (
		<Primitive.Root open={open} onOpenChange={onOpenChange}>
			<Primitive.Portal>
				<Primitive.Overlay className="fixed inset-0 z-50 bg-black/70 animate-fade-in" />
				<Primitive.Content
					aria-describedby={undefined}
					className="fixed top-[12vh] left-1/2 z-50 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface shadow-2xl animate-fade-in"
				>
					<Primitive.Title className="sr-only">Search</Primitive.Title>
					{/* Mounted only while open, so its data loads on demand. */}
					{pouchId ? (
						<PouchPalette pouchId={pouchId} onClose={close} />
					) : (
						<Palette onClose={close} />
					)}
				</Primitive.Content>
			</Primitive.Portal>
		</Primitive.Root>
	);
}

function PouchPalette({ pouchId, onClose }: { pouchId: string; onClose: () => void }) {
	const contents = usePouchContents(pouchId);
	const pouch = useMemo(
		() => ({
			id: pouchId,
			ingredients: contents.data?.ingredients ?? [],
		}),
		[pouchId, contents.data],
	);
	return <Palette pouch={pouch} onClose={onClose} />;
}

function Palette({ pouch, onClose }: { pouch?: SearchSources['pouch']; onClose: () => void }) {
	const navigate = useNavigate();
	const pouches = usePouches();
	const devices = useDevices();
	const billing = useBilling();
	const invoices = useInvoices(billing.data?.available === true);
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);

	const results = useMemo(
		() =>
			searchEverything(
				{
					...(pouch ? { pouch } : {}),
					pouches: pouches.data ?? [],
					devices: devices.data,
					invoices: invoices.data,
				},
				query,
			),
		[pouch, pouches.data, devices.data, invoices.data, query],
	);

	useEffect(() => setActive(0), [query]);

	const go = (index: number) => {
		const result = results[index];
		if (!result) return;
		onClose();
		void navigate({ href: result.href });
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setActive((index) => Math.min(index + 1, results.length - 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setActive((index) => Math.max(index - 1, 0));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			go(active);
		}
	};

	return (
		<>
			<div className="flex items-center gap-2 border-b border-border px-3">
				<Search className="size-4 text-meta" aria-hidden />
				<input
					autoFocus
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={
						pouch
							? 'Search items, pouches, devices, billing…'
							: 'Search pouches, devices, billing, settings…'
					}
					aria-label="Search"
					role="combobox"
					aria-expanded
					aria-controls="command-results"
					aria-activedescendant={results[active]?.id}
					className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-meta"
				/>
			</div>
			<ul id="command-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-1">
				{results.length === 0 ? (
					<li className="px-3 py-6 text-center text-[13px] text-muted">No matches</li>
				) : null}
				{results.map((result, index) => {
					const Icon = result.icon;
					const startsGroup = results[index - 1]?.group !== result.group;
					return (
						<Fragment key={result.id}>
							{startsGroup ? (
								<li
									role="presentation"
									className="px-3 pt-2.5 pb-1 text-[11px] font-medium text-meta"
								>
									{result.group}
								</li>
							) : null}
							<li
								id={result.id}
								role="option"
								aria-selected={index === active}
								onMouseEnter={() => setActive(index)}
								onClick={() => go(index)}
								className={cn(
									'flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-[13px]',
									index === active ? 'bg-hover text-fg' : 'text-muted',
								)}
							>
								<Icon className="size-4 shrink-0" aria-hidden />
								<span className="flex-1 truncate text-fg">{result.label}</span>
								<span className="shrink-0 truncate text-xs text-meta">
									{result.hint}
								</span>
								{index === active ? (
									<CornerDownLeft className="size-3.5 shrink-0 text-meta" />
								) : null}
							</li>
						</Fragment>
					);
				})}
			</ul>
		</>
	);
}
