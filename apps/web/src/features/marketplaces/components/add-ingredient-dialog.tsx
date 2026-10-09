// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Add skill" (agent, MCP server, …): write one yourself, pick one from a
 * marketplace, or take a GitHub repository that is one, without leaving the page.
 */
import { ChevronRight, PenLine, Store } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BackButton } from '@/components/ui/back-button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { GitHubIcon } from '@/features/auth/provider-icons';
import type { KindDefinition } from '@/features/ingredients/kinds';
import type { PouchView } from '@/features/pouches/pouches';
import { noun, offering, useMarketplaces, type MarketplaceItem } from '../marketplaces';
import { AddMarketplaceDialog } from './add-marketplace-dialog';
import { GithubImport } from './github-import';
import { MarketplaceBrowser } from './marketplace-browser';

type Step = 'choose' | 'browse' | 'github';

export function AddIngredientDialog({
	open,
	onOpenChange,
	pouch,
	kind,
	onWrite,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pouch: PouchView;
	kind: KindDefinition;
	onWrite: () => void;
}) {
	const [step, setStep] = useState<Step>('choose');
	const [marketplaceId, setMarketplaceId] = useState<string | undefined>();
	const [addingMarketplace, setAddingMarketplace] = useState(false);
	const [preview, setPreview] = useState<MarketplaceItem | null>(null);
	const singular = noun(kind.singular);
	const close = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			setStep('choose');
			setPreview(null);
		}
	};
	const list = useMarketplaces();
	const available = list.data ? offering(list.data.marketplaces, kind.kind) : [];
	const browsing = available.find((entry) => entry.id === marketplaceId) ?? available[0];
	// Back always goes one step: from a preview to its list, from a list to the choices.
	const back =
		step === 'browse' && preview
			? { label: browsing?.name ?? 'Back', go: () => setPreview(null) }
			: { label: 'All ways to add', go: () => setStep('choose') };
	const titles: Record<Step, string> = {
		choose: `Add ${singular}`,
		browse: `Add ${singular} from a marketplace`,
		github: `Add ${singular} from GitHub`,
	};

	return (
		<>
			<Dialog open={open} onOpenChange={close}>
				<DialogContent
					title={titles[step]}
					description={step === 'choose' ? 'Where does it come from?' : undefined}
					size={step === 'choose' ? 'md' : 'lg'}
					className={step === 'browse' ? 'sm:h-[min(84dvh,760px)]' : undefined}
				>
					{step === 'choose' ? (
						<Choices
							kind={kind}
							onWrite={() => {
								close(false);
								onWrite();
							}}
							onStep={setStep}
						/>
					) : (
						<div className="flex flex-col gap-4 pb-2">
							<BackButton
								onClick={back.go}
								className="-top-4 -mx-6 -mt-4 -mb-2 bg-surface px-6 pt-4 pb-2"
							>
								{back.label}
							</BackButton>
							{step === 'browse' ? (
								<MarketplaceBrowser
									pouch={pouch}
									layout="compact"
									kind={kind}
									marketplaceId={marketplaceId}
									onMarketplaceChange={(id) => {
										setMarketplaceId(id);
										setPreview(null);
									}}
									preview={preview}
									onPreviewChange={setPreview}
									onAddMarketplace={() => setAddingMarketplace(true)}
									onAdded={() => close(false)}
								/>
							) : (
								<GithubImport
									pouch={pouch}
									kind={kind}
									onAdded={() => close(false)}
									onBrowse={(id) => {
										setMarketplaceId(id);
										setStep('browse');
									}}
								/>
							)}
						</div>
					)}
				</DialogContent>
			</Dialog>
			<AddMarketplaceDialog
				open={addingMarketplace}
				onOpenChange={setAddingMarketplace}
				onAdded={(marketplace) => setMarketplaceId(marketplace.id)}
			/>
		</>
	);
}

function Choices({
	kind,
	onWrite,
	onStep,
}: {
	kind: KindDefinition;
	onWrite: () => void;
	onStep: (step: Step) => void;
}) {
	const list = useMarketplaces();
	const singular = noun(kind.singular);
	// Hooks run commands, so they are only ever written by hand.
	const shared = kind.kind !== 'hook';
	const names = list.data
		? offering(list.data.marketplaces, kind.kind).map((entry) => entry.name)
		: [];
	const browseDescription =
		names.length === 0
			? 'Directories and the repositories you added.'
			: names.length <= 2
				? `${names.join(' and ')}.`
				: `${names.slice(0, 2).join(', ')} and ${names.length - 2} more.`;

	return (
		<ul className="-mx-2 flex flex-col gap-1 pb-2">
			<Choice
				icon={<PenLine />}
				title="Write it yourself"
				description={`Start from a blank ${singular} in the editor.`}
				onClick={onWrite}
			/>
			{shared ? (
				<>
					<Choice
						icon={<Store />}
						title="From a marketplace"
						description={browseDescription}
						onClick={() => onStep('browse')}
					/>
					<Choice
						icon={<GitHubIcon />}
						title="From GitHub"
						description={`A repository that is a ${singular}, public or private.`}
						onClick={() => onStep('github')}
					/>
				</>
			) : null}
		</ul>
	);
}

function Choice({
	icon,
	title,
	description,
	onClick,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	onClick: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={onClick}
				className="group flex w-full cursor-pointer items-center gap-3.5 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
			>
				<span
					aria-hidden
					className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-muted transition-colors group-hover:border-accent/40 group-hover:text-accent-text [&_svg]:size-[18px]"
				>
					{icon}
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="text-sm font-medium text-fg">{title}</span>
					<span className="truncate text-[13px] text-muted">{description}</span>
				</span>
				<ChevronRight
					aria-hidden
					className="size-4 shrink-0 text-meta transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
				/>
			</button>
		</li>
	);
}
