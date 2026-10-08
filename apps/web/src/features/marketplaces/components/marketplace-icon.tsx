// SPDX-License-Identifier: AGPL-3.0-only
import { Lock, Server, Sparkles } from 'lucide-react';
import { GitHubIcon } from '@/features/auth/provider-icons';
import { cn } from '@/lib/cn';
import type { Marketplace } from '../marketplaces';

/** A small square mark: skills.sh, the MCP Registry, or a (private) GitHub repo. */
export function MarketplaceIcon({
	marketplace,
	className,
}: {
	marketplace: Pick<Marketplace, 'source' | 'private'>;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				'relative flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted [&_svg]:size-3.5',
				marketplace.source === 'skills_sh' &&
					'border-accent/30 bg-accent-tint text-accent-text',
				className,
			)}
		>
			{marketplace.source === 'skills_sh' ? (
				<Sparkles />
			) : marketplace.source === 'mcp_registry' ? (
				<Server />
			) : (
				<GitHubIcon />
			)}
			{marketplace.private ? (
				<span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full border border-border bg-bg [&_svg]:size-2">
					<Lock />
				</span>
			) : null}
		</span>
	);
}
