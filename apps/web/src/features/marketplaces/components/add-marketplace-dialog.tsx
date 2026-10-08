// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Add a GitHub repository as a marketplace: type or paste a public one, or
 * pick from the private repositories the GitHub App can read (connecting
 * GitHub first when needed).
 */
import { Link, useLocation } from '@tanstack/react-router';
import { Check, Lock, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { SIGN_IN_METHODS_ID, useIsLinked } from '@/features/account/linked-accounts';
import { GitHubIcon } from '@/features/auth/provider-icons';
import { kindDefinition, type IngredientKind } from '@/features/ingredients/kinds';
import { cn } from '@/lib/cn';
import {
	parseRepoInput,
	startGithubConnect,
	useAddMarketplace,
	useGithubRepositories,
	useMarketplaces,
	type Marketplace,
	type MarketplaceList,
} from '../marketplaces';

export type AddMarketplaceTab = 'public' | 'private';

const TABS: { value: AddMarketplaceTab; label: string }[] = [
	{ value: 'public', label: 'Public repository' },
	{ value: 'private', label: 'Private repository' },
];

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
	tab,
	onTabChange,
	onOpenChange,
	onAdded,
}: {
	open: boolean;
	tab: AddMarketplaceTab;
	onTabChange: (tab: AddMarketplaceTab) => void;
	onOpenChange: (open: boolean) => void;
	onAdded?: (marketplace: Marketplace) => void;
}) {
	const add = useAddMarketplace();
	const finish = (marketplace: Marketplace) => {
		onOpenChange(false);
		onAdded?.(marketplace);
	};
	const addRepo = (repo: string) => add.mutate(repo, { onSuccess: finish });

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
				<div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 pt-4 pb-6">
					<Segmented
						label="Repository type"
						value={tab}
						onChange={(next) => {
							add.reset();
							onTabChange(next);
						}}
						options={TABS}
						className="self-start max-sm:self-stretch"
					/>
					{tab === 'public' ? (
						<PublicRepository
							busy={add.isPending}
							error={add.error}
							onCancel={() => onOpenChange(false)}
							onAdd={addRepo}
						/>
					) : (
						<PrivateRepositories
							busy={add.isPending}
							error={add.error}
							onAdd={addRepo}
						/>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function PublicRepository({
	busy,
	error,
	onCancel,
	onAdd,
}: {
	busy: boolean;
	error: Error | null;
	onCancel: () => void;
	onAdd: (repo: string) => void;
}) {
	const [text, setText] = useState('');
	const repo = parseRepoInput(text);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (repo) onAdd(repo);
	};

	return (
		<form className="flex flex-col gap-5" onSubmit={submit}>
			<div className="flex flex-col gap-2">
				<label htmlFor="marketplace-repo" className="text-[13px] font-medium">
					Repository
				</label>
				<div className="relative">
					<span className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-meta [&_svg]:size-4">
						<GitHubIcon />
					</span>
					<Input
						id="marketplace-repo"
						autoFocus
						autoComplete="off"
						spellCheck={false}
						placeholder="owner/name or a GitHub link"
						value={text}
						onChange={(event) => setText(event.target.value)}
						className="h-10 pl-9 font-mono text-[13px]"
					/>
				</div>
				<p className={cn('min-h-4 text-xs', repo ? 'text-muted' : 'text-meta')}>
					{repo ? (
						<span className="flex items-center gap-1.5">
							<Check className="size-3.5 text-success" aria-hidden />
							github.com/<span className="text-fg">{repo}</span>
						</span>
					) : text.trim() ? (
						'Use owner/name, like anthropics/skills.'
					) : (
						'Paste a link or type owner/name.'
					)}
				</p>
			</div>

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

			{error ? <ErrorMessage error={error} /> : null}
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

function PrivateRepositories({
	busy,
	error,
	onAdd,
}: {
	busy: boolean;
	error: Error | null;
	onAdd: (repo: string) => void;
}) {
	const list = useMarketplaces();
	const linked = useIsLinked('github');
	const github = list.data?.github;
	if (!github || linked === undefined) return <Skeleton className="h-48 w-full" />;
	if (!linked) {
		return (
			<EmptyState
				icon={Lock}
				title="Link your GitHub account first"
				description="Private repositories come from the GitHub account linked to your profile. Link it there, then come back."
				action={
					<Button variant="primary" asChild>
						<Link to="/app/account" hash={SIGN_IN_METHODS_ID}>
							<GitHubIcon /> Link GitHub on your profile
						</Link>
					</Button>
				}
			/>
		);
	}
	if (!github.available) {
		return (
			<EmptyState
				icon={Lock}
				title="Private repositories aren’t available here yet"
				description="This server isn’t connected to GitHub. Public repositories still work."
			/>
		);
	}
	if (github.connections.length === 0) return <ConnectGithub github={github} />;
	return (
		<RepositoryPicker
			github={github}
			added={
				new Set((list.data?.marketplaces ?? []).map((entry) => entry.repo?.toLowerCase()))
			}
			busy={busy}
			error={error}
			onAdd={onAdd}
		/>
	);
}

function ConnectGithub({ github }: { github: MarketplaceList['github'] }) {
	const location = useLocation();
	return (
		<div className="flex flex-col items-center gap-5 rounded-lg border border-border px-6 py-8 text-center">
			<span className="flex size-12 items-center justify-center rounded-full border border-border bg-bg text-fg [&_svg]:size-6">
				<GitHubIcon />
			</span>
			<div className="flex flex-col gap-1">
				<p className="text-sm font-medium">Connect GitHub</p>
				<p className="max-w-sm text-[13px] text-muted">
					On GitHub you choose which repositories SkillPouch may read. Then you come back
					here.
				</p>
			</div>
			<ul className="flex flex-col gap-1.5 text-left text-[13px] text-muted">
				{[
					'Read-only: SkillPouch never writes to your repositories',
					'Only the repositories you pick',
					'Disconnect any time from your profile',
				].map((line) => (
					<li key={line} className="flex items-center gap-2">
						<Check className="size-3.5 shrink-0 text-success" aria-hidden />
						{line}
					</li>
				))}
			</ul>
			<Button variant="primary" onClick={() => startGithubConnect(github, location.href)}>
				<GitHubIcon /> Connect GitHub
			</Button>
		</div>
	);
}

function RepositoryPicker({
	github,
	added,
	busy,
	error,
	onAdd,
}: {
	github: MarketplaceList['github'];
	added: Set<string | undefined>;
	busy: boolean;
	error: Error | null;
	onAdd: (repo: string) => void;
}) {
	const location = useLocation();
	const repos = useGithubRepositories(true);
	const [filter, setFilter] = useState('');
	const [picked, setPicked] = useState<string | null>(null);
	const needle = filter.trim().toLowerCase();
	const shown = (repos.data?.repositories ?? []).filter((repo) =>
		repo.full_name.toLowerCase().includes(needle),
	);
	const accounts = github.connections.map((entry) => entry.account).join(', ');

	return (
		<div className="flex flex-col gap-3">
			<div className="relative">
				<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-meta" />
				<Input
					aria-label="Filter repositories"
					placeholder="Filter repositories"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					className="h-10 pl-9"
				/>
			</div>
			{repos.isPending ? (
				<div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border">
					{[0, 1, 2, 3].map((index) => (
						<div key={index} className="flex items-center gap-3 px-3 py-2.5">
							<Skeleton className="size-4" />
							<Skeleton className="h-3 w-48" />
						</div>
					))}
				</div>
			) : repos.error ? (
				<ErrorMessage error={repos.error} />
			) : shown.length === 0 ? (
				<p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">
					{needle
						? 'No repository matches.'
						: 'No repositories yet. Choose some on GitHub.'}
				</p>
			) : (
				<ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
					{shown.map((repo) => {
						const isAdded = added.has(repo.full_name.toLowerCase());
						return (
							<li
								key={repo.full_name}
								className="flex items-center gap-3 px-3 py-2.5"
							>
								{repo.private ? (
									<Lock
										className="size-3.5 shrink-0 text-meta"
										aria-label="Private"
									/>
								) : (
									<span className="size-3.5 shrink-0 text-meta [&_svg]:size-3.5">
										<GitHubIcon />
									</span>
								)}
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-[13px] text-fg">
										{repo.full_name}
									</span>
									{repo.description ? (
										<span className="truncate text-xs text-meta">
											{repo.description}
										</span>
									) : null}
								</span>
								{isAdded ? (
									<Badge>Added</Badge>
								) : (
									<Button
										size="sm"
										variant="outline"
										aria-label={`Add ${repo.full_name}`}
										loading={busy && picked === repo.full_name}
										disabled={busy}
										onClick={() => {
											setPicked(repo.full_name);
											onAdd(repo.full_name);
										}}
									>
										Add
									</Button>
								)}
							</li>
						);
					})}
				</ul>
			)}
			{error ? <ErrorMessage error={error} /> : null}
			<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-meta">
				<span>
					Connected as <span className="text-muted">{accounts}</span>
				</span>
				<Button
					variant="link"
					size="sm"
					className="text-muted"
					onClick={() => startGithubConnect(github, location.href)}
				>
					Choose repositories on GitHub
				</Button>
			</div>
		</div>
	);
}
