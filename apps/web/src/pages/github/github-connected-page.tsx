// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/github/connected` — where GitHub returns after installing or authorizing
 * the SkillPouch GitHub App. The code is only used when the `state` matches
 * the one this tab sent; otherwise one click re-authorizes with a fresh state.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AuthLayout } from '@/components/layout/auth-layout';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Skeleton } from '@/components/ui/skeleton';
import {
	connectGithub,
	startGithubConnect,
	takeGithubReturn,
	useInvalidateMarketplaces,
	useMarketplaces,
} from '@/features/marketplaces/marketplaces';
import { safeRedirect } from '@/lib/auth';
import { plural } from '@/lib/format';

export interface GithubConnectedSearch {
	code?: string;
	state?: string;
}

export function GithubConnectedPage() {
	const { code, state } = useSearch({ strict: false }) as GithubConnectedSearch;
	const navigate = useNavigate();
	const invalidate = useInvalidateMarketplaces();
	const list = useMarketplaces();
	const [error, setError] = useState<unknown>(null);
	const [unverified, setUnverified] = useState(false);
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		const returnTo = takeGithubReturn(state ?? null);
		if (!code || !returnTo) {
			setUnverified(true);
			return;
		}
		connectGithub(code)
			.then(async ({ connections }) => {
				await invalidate();
				toast.success(
					connections.length > 0
						? `GitHub connected: ${plural(connections.length, 'account')}`
						: 'GitHub authorized, but no installation you own was found',
				);
				void navigate({ to: safeRedirect(returnTo), replace: true });
			})
			.catch(setError);
	}, [code, state, invalidate, navigate]);

	const retry = () => {
		if (list.data) startGithubConnect(list.data.github, '/app', 'authorize');
	};

	return (
		<AuthLayout>
			<div className="flex flex-col items-center gap-4 text-center">
				<h1 className="text-lg font-semibold">Connecting GitHub</h1>
				{error ? (
					<>
						<ErrorMessage error={error} />
						<Button onClick={retry} disabled={!list.data}>
							Try again
						</Button>
					</>
				) : unverified ? (
					<>
						<p className="text-[13px] text-muted">
							GitHub sent you back without the check this browser expected. Finish
							connecting from here.
						</p>
						<Button
							variant="primary"
							onClick={retry}
							disabled={!list.data?.github.available}
						>
							Finish connecting
						</Button>
					</>
				) : (
					<div
						className="flex w-full flex-col items-center gap-2"
						aria-label="Connecting"
					>
						<Skeleton className="h-4 w-56" />
						<Skeleton className="h-9 w-40" />
					</div>
				)}
			</div>
		</AuthLayout>
	);
}
