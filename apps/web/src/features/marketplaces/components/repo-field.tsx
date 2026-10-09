// SPDX-License-Identifier: AGPL-3.0-only
/** The GitHub repository field both "Add marketplace" and "Add from GitHub" use. */
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ErrorMessage } from '@/components/ui/error-message';
import { SIGN_IN_METHODS_ID, useIsLinked } from '@/features/account/linked-accounts';
import { GitHubIcon } from '@/features/auth/provider-icons';
import { isApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';

export function RepoField({
	id,
	text,
	repo,
	onChange,
}: {
	id: string;
	text: string;
	/** `owner/name` parsed from `text`, or null. */
	repo: string | null;
	onChange: (text: string) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<label htmlFor={id} className="text-[13px] font-medium">
				Repository
			</label>
			<div className="relative">
				<span className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-meta [&_svg]:size-4">
					<GitHubIcon />
				</span>
				<Input
					id={id}
					autoFocus
					autoComplete="off"
					spellCheck={false}
					placeholder="owner/name or a GitHub link"
					value={text}
					onChange={(event) => onChange(event.target.value)}
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
	);
}

/**
 * Why a repository couldn't be read. A missing one may be private: without a
 * linked GitHub account we can't see those, so say how to fix that.
 */
export function RepoError({ error }: { error: unknown }) {
	const linked = useIsLinked('github');
	if (!isApiError(error, 'not_found')) return <ErrorMessage error={error} />;
	return (
		<p className="text-[13px] text-danger" role="alert">
			Repository not found.
			{linked === false ? (
				<>
					{' '}
					<span className="text-muted">If it’s a private repository, </span>
					<Link
						to="/app/account"
						hash={SIGN_IN_METHODS_ID}
						className="text-fg underline underline-offset-4 hover:text-accent-text"
					>
						link your GitHub account
					</Link>
					<span className="text-muted"> first.</span>
				</>
			) : null}
		</p>
	);
}
