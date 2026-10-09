// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Add skill → From GitHub": a repository that *is* a skill (agent, MCP
 * server, …) is added straight to the pouch. One that holds several is a
 * marketplace: we offer to add it to your marketplaces and browse it there.
 */
import { FolderSearch, Store } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Skeleton } from '@/components/ui/skeleton';
import type { KindDefinition } from '@/features/ingredients/kinds';
import type { PouchView } from '@/features/pouches/pouches';
import {
	fetchRepositoryItem,
	kindCount,
	noun,
	parseRepoInput,
	repositoryOffer,
	useAddMarketplace,
	useInstalled,
	useRepository,
	type RepositoryView,
} from '../marketplaces';
import { ItemPreview } from './item-preview';
import { RepoError, RepoField } from './repo-field';
import { useItemActions, type ItemAdded } from './use-item-actions';

export function GithubImport({
	pouch,
	kind,
	onAdded,
	onBrowse,
}: {
	pouch: PouchView;
	kind: KindDefinition;
	onAdded: ItemAdded;
	/** Opens the marketplace browser on this marketplace. */
	onBrowse: (marketplaceId: string) => void;
}) {
	const [text, setText] = useState('');
	const [submitted, setSubmitted] = useState<string | null>(null);
	const repo = parseRepoInput(text);
	const repository = useRepository(submitted);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (repo) setSubmitted(repo);
	};

	return (
		<div className="flex flex-col gap-6">
			<form className="flex flex-col gap-3 sm:flex-row sm:items-start" onSubmit={submit}>
				<div className="min-w-0 flex-1">
					<RepoField
						id="github-import-repo"
						text={text}
						repo={repo}
						onChange={(next) => {
							setText(next);
							if (parseRepoInput(next) !== submitted) setSubmitted(null);
						}}
					/>
				</div>
				<Button
					type="submit"
					variant="primary"
					className="h-10 sm:mt-[26px]"
					disabled={!repo}
					loading={submitted !== null && repository.isFetching}
				>
					Find
				</Button>
			</form>

			{submitted === null ? (
				<p className="text-[13px] text-muted">
					Paste a repository that is a {noun(kind.singular)}. One with many of them is a
					marketplace; we’ll offer to add it to your marketplaces instead.
				</p>
			) : repository.isPending ? (
				<RepositorySkeleton />
			) : repository.error ? (
				<RepoError error={repository.error} />
			) : (
				<RepositoryResult
					key={repository.data.repo}
					pouch={pouch}
					kind={kind}
					repository={repository.data}
					onAdded={onAdded}
					onBrowse={onBrowse}
				/>
			)}
		</div>
	);
}

function RepositoryResult({
	pouch,
	kind,
	repository,
	onAdded,
	onBrowse,
}: {
	pouch: PouchView;
	kind: KindDefinition;
	repository: RepositoryView;
	onAdded: ItemAdded;
	onBrowse: (marketplaceId: string) => void;
}) {
	const installed = useInstalled(pouch.id);
	const adding = useItemActions(pouch, onAdded);
	const offer = repositoryOffer(repository, kind.kind);

	if (offer.type === 'item') {
		return (
			<ItemPreview
				source={{
					id: `github:${repository.repo}`,
					name: repository.repo,
					load: (key) => fetchRepositoryItem(repository.repo, key),
				}}
				item={offer.item}
				canAdd={pouch.state === 'active'}
				installed={installed(offer.item)}
				busy={adding.busyKey === offer.item.key}
				disabled={adding.busyKey !== null}
				onAdd={(content) => void adding.add(offer.item.key, async () => content)}
				onRemove={(ingredient) => void adding.remove(offer.item.key, ingredient)}
			/>
		);
	}
	if (offer.type === 'marketplace') {
		return (
			<MarketplaceOffer
				repository={repository}
				count={offer.count}
				kind={kind}
				onBrowse={onBrowse}
			/>
		);
	}
	return (
		<Notice
			icon={<FolderSearch />}
			title={`No ${noun(kind.label)} in ${repository.repo}`}
			description={
				offer.others.length > 0
					? `It has ${offer.others.map((other) => kindCount(other.kind, other.count)).join(', ')}. Add it from the matching page.`
					: 'We didn’t find anything we can add in this repository.'
			}
		/>
	);
}

function MarketplaceOffer({
	repository,
	count,
	kind,
	onBrowse,
}: {
	repository: RepositoryView;
	count: number;
	kind: KindDefinition;
	onBrowse: (marketplaceId: string) => void;
}) {
	const add = useAddMarketplace();
	const existing = repository.marketplace_id;
	return (
		<Notice
			icon={<Store />}
			title="This is a marketplace repository"
			description={
				existing
					? `${repository.repo} has ${kindCount(kind.kind, count)} and is already one of your marketplaces. Browse it to pick one.`
					: `${repository.repo} has ${kindCount(kind.kind, count)}. Add it to your marketplaces to browse them and pick the ones you want.`
			}
			action={
				<>
					{add.error ? <ErrorMessage error={add.error} /> : null}
					{existing ? (
						<Button variant="primary" onClick={() => onBrowse(existing)}>
							Browse it
						</Button>
					) : (
						<Button
							variant="primary"
							loading={add.isPending}
							onClick={() =>
								add.mutate(repository.repo, {
									onSuccess: (marketplace) => onBrowse(marketplace.id),
								})
							}
						>
							<Store /> Add to my marketplaces
						</Button>
					)}
				</>
			}
		/>
	);
}

function Notice({
	icon,
	title,
	description,
	action,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<section
			aria-label={title}
			className="flex flex-col gap-4 rounded-lg border border-border p-5 sm:flex-row sm:items-start"
		>
			<span
				aria-hidden
				className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-accent-text [&_svg]:size-5"
			>
				{icon}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<h3 className="text-sm font-medium text-fg">{title}</h3>
				<p className="text-[13px] text-muted">{description}</p>
				{action ? (
					<div className="mt-3 flex flex-wrap items-center gap-3">{action}</div>
				) : null}
			</div>
		</section>
	);
}

function RepositorySkeleton() {
	return (
		<div className="flex items-start gap-3" role="status" aria-label="Reading the repository">
			<Skeleton className="size-10" />
			<div className="flex flex-1 flex-col gap-2 pt-1">
				<Skeleton className="h-4 w-48" />
				<Skeleton className="h-3 w-72" />
				<Skeleton className="mt-3 h-48 w-full" />
			</div>
		</div>
	);
}
