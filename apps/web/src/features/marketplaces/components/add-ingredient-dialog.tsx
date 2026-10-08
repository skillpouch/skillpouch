// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Add skill" (agent, MCP server, …): write one yourself, or pick one from a
 * marketplace without leaving the page.
 */
import { PenLine, Store } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { KindDefinition } from '@/features/ingredients/kinds';
import type { PouchView } from '@/features/pouches/pouches';
import { AddMarketplaceDialog, type AddMarketplaceTab } from './add-marketplace-dialog';
import { MarketplaceBrowser } from './marketplace-browser';

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
	const [step, setStep] = useState<'choose' | 'browse'>('choose');
	const [marketplaceId, setMarketplaceId] = useState<string | undefined>();
	const [addingMarketplace, setAddingMarketplace] = useState<AddMarketplaceTab | null>(null);
	const singular = kind.singular.toLowerCase();
	const close = (next: boolean) => {
		onOpenChange(next);
		if (!next) setStep('choose');
	};

	return (
		<>
			<Dialog open={open} onOpenChange={close}>
				<DialogContent
					title={
						step === 'choose' ? `Add ${singular}` : `Add ${singular} from a marketplace`
					}
					size={step === 'choose' ? 'md' : 'lg'}
					className={step === 'browse' ? 'sm:h-[min(84dvh,760px)]' : undefined}
				>
					{step === 'choose' ? (
						<div className="grid gap-3 px-6 pt-4 pb-6 sm:grid-cols-2">
							<Choice
								icon={<PenLine />}
								title="Write it yourself"
								description={`Start from a blank ${singular}.`}
								onClick={() => {
									close(false);
									onWrite();
								}}
							/>
							<Choice
								icon={<Store />}
								title="From a marketplace"
								description="skills.sh, the MCP Registry or your GitHub repositories."
								onClick={() => setStep('browse')}
							/>
						</div>
					) : (
						<div className="min-h-0 overflow-y-auto px-6 pt-4 pb-6">
							<MarketplaceBrowser
								pouch={pouch}
								layout="compact"
								kind={kind}
								marketplaceId={marketplaceId}
								onMarketplaceChange={setMarketplaceId}
								onAddMarketplace={(tab) => setAddingMarketplace(tab ?? 'public')}
								onAdded={() => close(false)}
							/>
						</div>
					)}
				</DialogContent>
			</Dialog>
			<AddMarketplaceDialog
				open={addingMarketplace !== null}
				tab={addingMarketplace ?? 'public'}
				onTabChange={setAddingMarketplace}
				onOpenChange={(next) => !next && setAddingMarketplace(null)}
				onAdded={(marketplace) => setMarketplaceId(marketplace.id)}
			/>
		</>
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
		<button
			type="button"
			onClick={onClick}
			className="flex cursor-pointer flex-col items-start gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:border-accent/50 hover:bg-hover [&_svg]:size-5 [&_svg]:text-accent-text"
		>
			{icon}
			<span className="text-sm font-medium text-fg">{title}</span>
			<span className="text-[13px] text-muted">{description}</span>
		</button>
	);
}
