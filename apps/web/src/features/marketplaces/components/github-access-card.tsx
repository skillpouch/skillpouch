// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where private repositories start: connect GitHub, or, once connected, add
 * one and change which repositories SkillPouch may read.
 */
import { Link, useLocation } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SIGN_IN_METHODS_ID, useIsLinked } from '@/features/account/linked-accounts';
import { GitHubIcon } from '@/features/auth/provider-icons';
import { cn } from '@/lib/cn';
import { startGithubConnect, type MarketplaceList } from '../marketplaces';

export function GithubAccessCard({
	github,
	onAddRepository,
	className,
}: {
	github: MarketplaceList['github'];
	onAddRepository: () => void;
	className?: string;
}) {
	const location = useLocation();
	const linked = useIsLinked('github');
	const connected = github.connections.length > 0;
	const accounts = github.connections.map((entry) => entry.account).join(', ');

	return (
		<section
			aria-label="Private repositories"
			className={cn('flex flex-col gap-3 rounded-lg border border-border p-3.5', className)}
		>
			<div className="flex items-center gap-2 text-[13px] font-medium text-fg">
				<Lock className="size-3.5 text-meta" aria-hidden />
				Private repositories
			</div>
			{linked === false ? (
				<>
					<p className="text-xs text-muted">
						Link your GitHub account to your profile first, then connect your private
						repositories here.
					</p>
					<Button size="sm" variant="outline" asChild>
						<Link to="/app/account" hash={SIGN_IN_METHODS_ID}>
							<GitHubIcon /> Link GitHub on your profile
						</Link>
					</Button>
				</>
			) : !github.available ? (
				<p className="text-xs text-muted">Not available on this server yet.</p>
			) : connected ? (
				<>
					<p className="text-xs text-muted">
						Connected to GitHub as <span className="text-fg">{accounts}</span>.
					</p>
					<div className="flex flex-col gap-1.5">
						<Button size="sm" variant="outline" onClick={onAddRepository}>
							Add a private repository
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="text-muted"
							onClick={() => startGithubConnect(github, location.href)}
						>
							Choose repositories on GitHub
						</Button>
					</div>
				</>
			) : (
				<>
					<p className="text-xs text-muted">
						Connect GitHub to browse repositories only you can see. Read-only, and only
						the ones you pick.
					</p>
					<Button
						size="sm"
						variant="outline"
						onClick={() => startGithubConnect(github, location.href)}
					>
						<GitHubIcon /> Connect GitHub
					</Button>
				</>
			)}
		</section>
	);
}
