// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ⌘K: find any ingredient of the open pouch by name and jump to it, or jump
 * to a section. Search runs over decrypted names in memory — names never go
 * to the server, not even as a query string.
 */
import { useNavigate } from '@tanstack/react-router';
import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { cn } from '@/lib/cn';
import { usePouchContents } from '../ingredients/ingredients';
import { KINDS, kindDefinition } from '../ingredients/kinds';

interface Result {
	id: string;
	label: string;
	hint: string;
	icon: (typeof KINDS)[number]['icon'];
	go: () => void;
}

export function CommandPalette({
	pouchId,
	open,
	onOpenChange,
}: {
	pouchId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const contents = usePouchContents(pouchId);
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);

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

	const results = useMemo<Result[]>(() => {
		const needle = query.trim().toLowerCase();
		const close = () => {
			onOpenChange(false);
			setQuery('');
		};
		const items = (contents.data?.ingredients ?? [])
			.filter(
				(item) => !item.deleted && (!needle || item.name.toLowerCase().includes(needle)),
			)
			.slice(0, 30)
			.map<Result>((item) => {
				const kind = kindDefinition(item.kind)!;
				return {
					id: item.id,
					label: item.name,
					hint: kind.singular,
					icon: kind.icon,
					go: () => {
						close();
						void navigate({
							to: '/app/p/$pouchId/$kind',
							params: { pouchId, kind: kind.slug },
							search: { item: item.id },
						});
					},
				};
			});
		const sections = KINDS.filter(
			(kind) => !needle || kind.label.toLowerCase().includes(needle),
		).map<Result>((kind) => ({
			id: `section-${kind.slug}`,
			label: kind.label,
			hint: 'Go to',
			icon: kind.icon,
			go: () => {
				close();
				void navigate({
					to: '/app/p/$pouchId/$kind',
					params: { pouchId, kind: kind.slug },
				});
			},
		}));
		return [...items, ...sections];
	}, [contents.data, query, navigate, pouchId, onOpenChange]);

	useEffect(() => setActive(0), [query]);

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setActive((index) => Math.min(index + 1, results.length - 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setActive((index) => Math.max(index - 1, 0));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			results[active]?.go();
		}
	};

	return (
		<Primitive.Root open={open} onOpenChange={onOpenChange}>
			<Primitive.Portal>
				<Primitive.Overlay className="fixed inset-0 z-50 bg-black/70 animate-fade-in" />
				<Primitive.Content
					aria-describedby={undefined}
					className="fixed top-[12vh] left-1/2 z-50 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface shadow-2xl animate-fade-in"
				>
					<Primitive.Title className="sr-only">Search this pouch</Primitive.Title>
					<div className="flex items-center gap-2 border-b border-border px-3">
						<Search className="size-4 text-meta" aria-hidden />
						<input
							autoFocus
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={onKeyDown}
							placeholder="Search skills, agents, commands…"
							aria-label="Search"
							role="combobox"
							aria-expanded
							aria-controls="command-results"
							aria-activedescendant={results[active]?.id}
							className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-meta"
						/>
					</div>
					<ul
						id="command-results"
						role="listbox"
						className="max-h-[50vh] overflow-y-auto p-1"
					>
						{results.length === 0 ? (
							<li className="px-3 py-6 text-center text-[13px] text-muted">
								No matches
							</li>
						) : null}
						{results.map((result, index) => {
							const Icon = result.icon;
							return (
								<li
									key={result.id}
									id={result.id}
									role="option"
									aria-selected={index === active}
									onMouseEnter={() => setActive(index)}
									onClick={result.go}
									className={cn(
										'flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-[13px]',
										index === active ? 'bg-hover text-fg' : 'text-muted',
									)}
								>
									<Icon className="size-4" aria-hidden />
									<span className="flex-1 truncate text-fg">{result.label}</span>
									<span className="text-xs text-meta">{result.hint}</span>
									{index === active ? (
										<CornerDownLeft className="size-3.5 text-meta" />
									) : null}
								</li>
							);
						})}
					</ul>
				</Primitive.Content>
			</Primitive.Portal>
		</Primitive.Root>
	);
}
