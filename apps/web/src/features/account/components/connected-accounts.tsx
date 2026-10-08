// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How you sign in (GitHub, Google — link both to use either) and the GitHub
 * App connection that lets marketplaces read your private repositories.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Skeleton } from '@/components/ui/skeleton';
import { GitHubIcon, GoogleIcon } from '@/features/auth/provider-icons';
import {
	startGithubConnect,
	useDisconnectGithub,
	useMarketplaces,
} from '@/features/marketplaces/marketplaces';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { linkAccount, unlinkAccount, type OAuthProvider } from '@/lib/auth';
import { SIGN_IN_METHODS_ID, useLinkedAccounts } from '../linked-accounts';

const PROVIDERS: { id: OAuthProvider; label: string; icon: ReactNode }[] = [
	{ id: 'github', label: 'GitHub', icon: <GitHubIcon /> },
	{ id: 'google', label: 'Google', icon: <GoogleIcon /> },
];

function Row({
	icon,
	title,
	detail,
	action,
}: {
	icon: ReactNode;
	title: string;
	detail: ReactNode;
	action: ReactNode;
}) {
	return (
		<li className="flex items-center gap-3 px-5 py-3.5">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border [&_svg]:size-4">
				{icon}
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-[13px] font-medium">{title}</p>
				<div className="truncate text-xs text-muted">{detail}</div>
			</div>
			{action}
		</li>
	);
}

export function SignInMethods() {
	const location = useLocation();
	const client = useQueryClient();
	const accounts = useLinkedAccounts();
	const unlink = useMutation({
		mutationFn: unlinkAccount,
		onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.linkedAccounts }),
		onError: (error) => toast.error(describeError(error)),
	});
	const linked = new Set((accounts.data ?? []).map((account) => account.providerId));
	const link = (provider: OAuthProvider) =>
		linkAccount(provider, location.href).catch((error: unknown) =>
			toast.error(describeError(error)),
		);

	return (
		<section id={SIGN_IN_METHODS_ID} className="mt-10 scroll-mt-6" aria-label="Sign-in methods">
			<h2 className="text-sm font-medium">Sign-in methods</h2>
			<p className="mt-1 text-[13px] text-muted">
				Link both to sign in to this account with either one.
			</p>
			{accounts.error ? <ErrorMessage error={accounts.error} className="mt-3" /> : null}
			<ul className="mt-3 divide-y divide-border rounded-lg border border-border">
				{PROVIDERS.map((provider) => (
					<Row
						key={provider.id}
						icon={provider.icon}
						title={provider.label}
						detail={
							accounts.isPending ? (
								<Skeleton className="h-3 w-16" />
							) : linked.has(provider.id) ? (
								'Linked'
							) : (
								'Not linked'
							)
						}
						action={
							accounts.isPending ? null : linked.has(provider.id) ? (
								<Button
									size="sm"
									variant="ghost"
									disabled={linked.size < 2}
									loading={unlink.isPending && unlink.variables === provider.id}
									onClick={() => unlink.mutate(provider.id)}
									title={linked.size < 2 ? 'Your only sign-in method' : undefined}
								>
									Unlink
								</Button>
							) : (
								<Button size="sm" onClick={() => void link(provider.id)}>
									Link {provider.label}
								</Button>
							)
						}
					/>
				))}
			</ul>
		</section>
	);
}

export function GithubRepositoryAccess() {
	const location = useLocation();
	const list = useMarketplaces();
	const disconnect = useDisconnectGithub();
	const [confirming, setConfirming] = useState(false);
	const github = list.data?.github;
	if (!github?.available) return null;
	const connections = github.connections;

	return (
		<section className="mt-10" aria-label="GitHub repositories">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2 className="text-sm font-medium">GitHub repositories</h2>
					<p className="mt-1 text-[13px] text-muted">
						Read-only access for marketplaces from your private repositories.
					</p>
				</div>
				<div className="flex shrink-0 gap-2">
					{connections.length > 0 ? (
						<Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
							Disconnect
						</Button>
					) : null}
					<Button size="sm" onClick={() => startGithubConnect(github, location.href)}>
						<GitHubIcon /> {connections.length > 0 ? 'Change access' : 'Connect GitHub'}
					</Button>
				</div>
			</div>
			{connections.length > 0 ? (
				<ul className="mt-3 divide-y divide-border rounded-lg border border-border">
					{connections.map((connection) => (
						<Row
							key={connection.installation_id}
							icon={<GitHubIcon />}
							title={connection.account}
							detail={
								connection.type === 'User' ? 'Personal account' : 'Organization'
							}
							action={<Badge tone="success">Connected</Badge>}
						/>
					))}
				</ul>
			) : null}
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title="Disconnect GitHub?"
				description="Marketplaces from private repositories are removed. Items you added stay. To revoke access fully, uninstall the SkillPouch app in your GitHub settings."
				confirmLabel="Disconnect"
				onConfirm={() => disconnect.mutateAsync().then(() => undefined)}
			/>
		</section>
	);
}
