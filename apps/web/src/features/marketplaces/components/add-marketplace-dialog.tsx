// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Add a GitHub repository as a marketplace. Private repositories work the
 * same way once GitHub is connected; a missing one says how to get there.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { kindDefinition, type IngredientKind } from '@/features/ingredients/kinds';
import { parseRepoInput, useAddMarketplace, type Marketplace } from '../marketplaces';
import { RepoError, RepoField } from './repo-field';

/** What a repository can hold, and where we find it. */
const DETECTED: { kind: IngredientKind; where: string }[] = [
	{ kind: 'skill', where: 'folders with SKILL.md' },
	{ kind: 'agent', where: 'agents/*.md' },
	{ kind: 'command', where: 'commands/*.md' },
	{ kind: 'mcp_server', where: '.mcp.json' },
	{ kind: 'instructions', where: 'AGENTS.md, CLAUDE.md' },
	{ kind: 'plugin', where: '.claude-plugin/' },
];

export function AddMarketplaceDialog({
	open,
	onOpenChange,
	onAdded,
	initialRepo = '',
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdded?: (marketplace: Marketplace) => void;
	initialRepo?: string;
}) {
	const add = useAddMarketplace();
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) add.reset();
				onOpenChange(next);
			}}
		>
			<DialogContent
				title="Add a marketplace"
				description="Browse a GitHub repository like any other marketplace."
				busy={add.isPending}
				size="lg"
			>
				{open ? (
					<RepositoryForm
						initialRepo={initialRepo}
						busy={add.isPending}
						error={add.error}
						onCancel={() => onOpenChange(false)}
						onAdd={(repo) =>
							add.mutate(repo, {
								onSuccess: (marketplace) => {
									onOpenChange(false);
									onAdded?.(marketplace);
								},
							})
						}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RepositoryForm({
	initialRepo,
	busy,
	error,
	onCancel,
	onAdd,
}: {
	initialRepo: string;
	busy: boolean;
	error: Error | null;
	onCancel: () => void;
	onAdd: (repo: string) => void;
}) {
	const [text, setText] = useState(initialRepo);
	const repo = parseRepoInput(text);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (repo) onAdd(repo);
	};

	return (
		<form className="flex flex-col gap-5 pb-2" onSubmit={submit}>
			<RepoField id="marketplace-repo" text={text} repo={repo} onChange={setText} />

			<div className="flex flex-col gap-2.5 rounded-lg border border-border p-4">
				<p className="text-xs text-meta">We look for</p>
				<ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
					{DETECTED.map(({ kind, where }) => {
						const definition = kindDefinition(kind);
						const Icon = definition?.icon;
						return (
							<li key={kind} className="flex items-center gap-2.5 text-[13px]">
								<span className="flex size-6 shrink-0 items-center justify-center rounded border border-border text-muted [&_svg]:size-3.5">
									{Icon ? <Icon aria-hidden /> : null}
								</span>
								<span className="min-w-0">
									<span className="text-fg">{definition?.label}</span>{' '}
									<span className="font-mono text-[11px] text-meta">{where}</span>
								</span>
							</li>
						);
					})}
				</ul>
			</div>

			{error ? <RepoError error={error} /> : null}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" variant="primary" loading={busy} disabled={!repo}>
					Add marketplace
				</Button>
			</div>
		</form>
	);
}
