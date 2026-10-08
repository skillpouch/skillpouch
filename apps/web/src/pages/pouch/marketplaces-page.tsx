// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/app/p/:pouchId/marketplaces` — browse skills.sh, the MCP Registry and your
 * GitHub repositories, and add what you pick to this pouch. The selected
 * marketplace lives in the URL (`?m=`).
 */
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import {
	AddMarketplaceDialog,
	type AddMarketplaceTab,
} from '@/features/marketplaces/components/add-marketplace-dialog';
import { MarketplaceBrowser } from '@/features/marketplaces/components/marketplace-browser';
import { useRemoveMarketplace, type Marketplace } from '@/features/marketplaces/marketplaces';
import { usePouch } from '@/features/pouches/pouches';

export interface MarketplacesSearch {
	m?: string;
}

export function MarketplacesPage() {
	const { pouchId } = useParams({ strict: false }) as { pouchId: string };
	const search = useSearch({ strict: false }) as MarketplacesSearch;
	const navigate = useNavigate();
	const pouch = usePouch(pouchId).data;
	const remove = useRemoveMarketplace();
	const [adding, setAdding] = useState<AddMarketplaceTab | null>(null);
	const [removing, setRemoving] = useState<Marketplace | null>(null);

	if (!pouch) return <PageSkeleton variant="list" />;
	const select = (id: string | undefined) =>
		void navigate({
			to: '/app/p/$pouchId/marketplaces',
			params: { pouchId },
			search: id ? { m: id } : {},
			replace: true,
		});

	return (
		<>
			<PageHeader
				title="Marketplaces"
				description="Find skills, agents and MCP servers and add them to this pouch"
				actions={
					<Button variant="primary" onClick={() => setAdding('public')}>
						<Plus /> Add marketplace
					</Button>
				}
			/>
			<MarketplaceBrowser
				pouch={pouch}
				marketplaceId={search.m}
				onMarketplaceChange={select}
				onAddMarketplace={(tab) => setAdding(tab ?? 'public')}
				actions={(marketplace) => (
					<>
						<Button variant="ghost" size="sm" asChild>
							<a href={marketplace.url} target="_blank" rel="noreferrer">
								Open <ExternalLink />
							</a>
						</Button>
						{marketplace.builtin ? null : (
							<Button
								variant="ghost"
								size="sm"
								aria-label={`Remove ${marketplace.name}`}
								onClick={() => setRemoving(marketplace)}
							>
								<Trash2 /> Remove
							</Button>
						)}
					</>
				)}
			/>
			<AddMarketplaceDialog
				open={adding !== null}
				tab={adding ?? 'public'}
				onTabChange={setAdding}
				onOpenChange={(open) => !open && setAdding(null)}
				onAdded={(marketplace) => select(marketplace.id)}
			/>
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(open) => !open && setRemoving(null)}
				title={`Remove ${removing?.name ?? 'marketplace'}?`}
				description="Items you already added stay in your pouches."
				confirmLabel="Remove"
				onConfirm={async () => {
					if (!removing) return;
					await remove.mutateAsync(removing.id);
					select(undefined);
				}}
			/>
		</>
	);
}
