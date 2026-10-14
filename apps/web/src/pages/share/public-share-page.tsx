// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/s/:shareId#key=…` — someone shared an ingredient. The key never leaves
 * this page; the bundle is decrypted here. Anyone can look at a reusable
 * link; adding it to a pouch needs an unlocked SkillPouch account.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { CircleX, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { unb64, type ShareBundle } from '@skillpouch/crypto';
import { AuthHeading, AuthLayout } from '@/components/layout/auth-layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { LoadingBlock } from '@/components/ui/spinner';
import { CodeEditor } from '@/features/ingredients/components/code-editor';
import { asText } from '@/features/ingredients/content';
import { kindDefinition } from '@/features/ingredients/kinds';
import { usePouches, type PouchView } from '@/features/pouches/pouches';
import { useSession } from '@/features/session/session-store';
import { importBundle, type DuplicateChoice } from '@/features/shares/import';
import {
	claimOneTimeShare,
	fetchPublicShare,
	keyFromHash,
	openReusableShare,
} from '@/features/shares/shares';
import { isApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { formatBytes, formatDate } from '@/lib/format';

const STORED_KEY = (id: string) => `skillpouch.share-key.${id}`;

/** The link key, kept for the sign-in round trip (OAuth drops the `#fragment`). */
function useShareKey(shareId: string): string | null {
	return useMemo(() => {
		const fromHash = keyFromHash(location.hash);
		if (fromHash) {
			sessionStorage.setItem(STORED_KEY(shareId), fromHash);
			return fromHash;
		}
		return sessionStorage.getItem(STORED_KEY(shareId));
	}, [shareId]);
}

const UNAVAILABLE: Record<string, string> = {
	expired: 'This link expired.',
	revoked: 'The owner revoked this link.',
	consumed: 'This one-time link was already used.',
};

export function PublicSharePage() {
	const { shareId } = useParams({ strict: false }) as { shareId: string };
	const session = useSession();
	const key = useShareKey(shareId);
	const meta = useQuery({
		queryKey: ['public-share', shareId],
		queryFn: () => fetchPublicShare(shareId),
	});
	const [bundle, setBundle] = useState<ShareBundle | null>(null);
	const [opening, setOpening] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const [importing, setImporting] = useState(false);
	const [imported, setImported] = useState<{ pouch: PouchView; name: string } | null>(null);

	// Reusable links open right away; one-time links only on an explicit click.
	useEffect(() => {
		if (!key || !meta.data || meta.data.state !== 'active' || meta.data.one_time || bundle)
			return;
		openReusableShare(shareId, key).then(setBundle, setError);
	}, [key, meta.data, shareId, bundle]);

	const openOneTime = async () => {
		if (!key) return;
		setOpening(true);
		setError(null);
		try {
			setBundle(await claimOneTimeShare(shareId, key));
			// The link is used up now; go straight to choosing a pouch.
			setImporting(true);
		} catch (caught) {
			setError(caught);
		} finally {
			setOpening(false);
		}
	};

	const here = `/s/${shareId}`;
	const content = () => {
		if (!key) {
			return (
				<Unavailable text="The key is missing from this link. Ask for the full link, including the part after #." />
			);
		}
		if (meta.isPending) return <LoadingBlock />;
		if (meta.error) {
			return (
				<Unavailable
					text={
						isApiError(meta.error, 'not_found')
							? 'This link doesn’t exist.'
							: 'This link can’t be opened right now.'
					}
				/>
			);
		}
		if (meta.data!.state !== 'active' && !bundle) {
			return (
				<Unavailable text={UNAVAILABLE[meta.data!.state] ?? 'This link no longer works.'} />
			);
		}
		if (imported) {
			const kind = kindDefinition(bundle?.kind ?? '');
			return (
				<div className="flex flex-col items-center gap-4 text-center">
					<AuthHeading
						centered
						title={`Added to ${imported.pouch.name}`}
						description="It will appear on your computers within a few seconds."
					/>
					<Button variant="primary" asChild>
						<Link
							to="/pouches/$pouchId/$kind"
							params={{ pouchId: imported.pouch.id, kind: kind?.slug ?? 'skills' }}
						>
							Open in pouch
						</Link>
					</Button>
				</div>
			);
		}
		if (!bundle) {
			if (meta.data!.one_time) {
				return (
					<div className="flex flex-col gap-5">
						<AuthHeading
							title="Someone shared an item with you"
							description="This link can be opened once. Opening it uses it up."
						/>
						{session.status === 'unlocked' ? (
							<Button
								variant="primary"
								size="lg"
								loading={opening}
								onClick={() => void openOneTime()}
							>
								Open and add to my pouch
							</Button>
						) : (
							<SignInPrompt here={here} locked={session.status === 'locked'} />
						)}
						<ErrorMessage error={error} />
					</div>
				);
			}
			return error ? <ErrorMessage error={error} /> : <LoadingBlock label="Decrypting" />;
		}
		const kind = kindDefinition(bundle.kind);
		return (
			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-1">
					<p className="text-xs text-meta">
						{kind?.singular ?? bundle.kind} · shared {formatDate(bundle.shared_at)}
					</p>
					<h1 className="font-mono text-xl font-semibold">{bundle.name}</h1>
					{bundle.description ? (
						<p className="text-[13px] text-muted">{bundle.description}</p>
					) : null}
				</div>
				<BundlePreview bundle={bundle} />
				{session.status === 'unlocked' ? (
					<Button variant="primary" size="lg" onClick={() => setImporting(true)}>
						Add to my pouch
					</Button>
				) : (
					<SignInPrompt here={here} locked={session.status === 'locked'} />
				)}
				<p className="flex items-center gap-1.5 text-xs text-meta">
					<Lock className="size-3" aria-hidden />
					Decrypted in your browser with the key from the link. SkillPouch can’t read what
					was shared.
				</p>
			</div>
		);
	};

	return (
		<AuthLayout width="md">
			{content()}
			{bundle && session.status === 'unlocked' ? (
				<ImportDialog
					open={importing}
					onOpenChange={setImporting}
					shareId={shareId}
					oneTime={meta.data?.one_time ?? false}
					bundle={bundle}
					onImported={(pouch, name) => {
						setImporting(false);
						setImported({ pouch, name });
						sessionStorage.removeItem(STORED_KEY(shareId));
					}}
				/>
			) : null}
			{meta.data ? (
				<p className="mt-8 text-center text-xs text-meta">
					{formatBytes(meta.data.size)}
					{meta.data.expires_at
						? ` · link expires ${formatDate(meta.data.expires_at)}`
						: ''}
				</p>
			) : null}
		</AuthLayout>
	);
}

function Unavailable({ text }: { text: string }) {
	return (
		<div className="flex flex-col items-center gap-3 text-center">
			<CircleX className="size-8 text-muted" aria-hidden />
			<h1 className="text-xl font-semibold">Link unavailable</h1>
			<p className="text-[13px] text-muted">{text}</p>
		</div>
	);
}

function SignInPrompt({ here, locked }: { here: string; locked: boolean }) {
	return (
		<Button variant="primary" size="lg" asChild>
			<Link to={locked ? '/unlock' : '/sign-in'} search={{ redirect: here }}>
				{locked ? 'Unlock to add it to your pouch' : 'Sign in to add it to your pouch'}
			</Link>
		</Button>
	);
}

function BundlePreview({ bundle }: { bundle: ShareBundle }) {
	const kind = kindDefinition(bundle.kind);
	const initial =
		bundle.files.find((file) => file.path === kind?.mainFile)?.path ?? bundle.files[0]?.path;
	const [active, setActive] = useState(initial);
	const file = bundle.files.find((entry) => entry.path === active);
	const text = file ? asText(unb64(file.content)) : null;
	return (
		<div className="overflow-hidden rounded-lg border border-border">
			{bundle.files.length > 1 ? (
				<div className="flex gap-1 overflow-x-auto border-b border-border p-1.5">
					{bundle.files.map((entry) => (
						<button
							key={entry.path}
							type="button"
							onClick={() => setActive(entry.path)}
							className={cn(
								'shrink-0 rounded px-2 py-1 font-mono text-xs',
								entry.path === active
									? 'bg-hover text-fg'
									: 'text-muted hover:text-fg',
							)}
						>
							{entry.path}
						</button>
					))}
				</div>
			) : null}
			<div className="h-72">
				{file && text !== null ? (
					<CodeEditor
						value={text}
						path={file.path}
						readOnly
						label={`Contents of ${file.path}`}
					/>
				) : (
					<p className="p-4 text-[13px] text-muted">
						Preview not available for this file type.
					</p>
				)}
			</div>
		</div>
	);
}

function ImportDialog({
	open,
	onOpenChange,
	shareId,
	oneTime,
	bundle,
	onImported,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shareId: string;
	oneTime: boolean;
	bundle: ShareBundle;
	onImported: (pouch: PouchView, name: string) => void;
}) {
	const pouches = usePouches();
	const writable = (pouches.data ?? []).filter((pouch) => pouch.state === 'active');
	const [pouchId, setPouchId] = useState<string | null>(null);
	const kind = kindDefinition(bundle.kind);
	// A pouch has one set of instructions: an import extends or replaces it.
	const [duplicateLabel, duplicateOptions] = kind?.single
		? [
				`If the pouch has ${kind.label.toLowerCase()}`,
				[
					{ value: 'append' as const, label: 'Add to the end' },
					{ value: 'replace' as const, label: 'Replace' },
				],
			]
		: [
				'If an item with this name exists',
				[
					{ value: 'keep_both' as const, label: 'Keep both' },
					{ value: 'replace' as const, label: 'Replace' },
				],
			];
	const [duplicate, setDuplicate] = useState<DuplicateChoice>(duplicateOptions[0]!.value);
	const [reviewed, setReviewed] = useState(false);
	const [secrets, setSecrets] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const target = writable.find((pouch) => pouch.id === (pouchId ?? writable[0]?.id));

	const submit = async () => {
		if (!target) return;
		setBusy(true);
		setError(null);
		try {
			const { name } = await importBundle({
				shareId,
				oneTime,
				bundle,
				pouch: target,
				duplicate,
				secrets,
			});
			onImported(target, name);
		} catch (caught) {
			setError(caught);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Add to which pouch?"
				busy={busy}
				footer={
					<>
						<Button disabled={busy} onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							loading={busy}
							disabled={!target || (kind?.runsCommands && !reviewed)}
							onClick={() => void submit()}
						>
							Add to pouch
						</Button>
					</>
				}
			>
				<div className="flex flex-col gap-5">
					{writable.length === 0 ? (
						<p className="text-[13px] text-muted">
							You have no active pouch to add it to.
						</p>
					) : (
						<fieldset className="flex flex-col gap-2">
							<legend className="sr-only">Pouch</legend>
							{writable.map((pouch) => (
								<label
									key={pouch.id}
									className={cn(
										'flex cursor-pointer items-center gap-3 rounded-md border p-3 text-[13px]',
										target?.id === pouch.id
											? 'border-accent bg-accent-tint'
											: 'border-border',
									)}
								>
									<input
										type="radio"
										name="target-pouch"
										className="sr-only"
										checked={target?.id === pouch.id}
										onChange={() => setPouchId(pouch.id)}
									/>
									{pouch.name}
								</label>
							))}
						</fieldset>
					)}
					<div className="flex flex-col gap-2">
						<span className="text-[13px] font-medium">{duplicateLabel}</span>
						<Segmented
							label={duplicateLabel}
							value={duplicate}
							onChange={setDuplicate}
							options={duplicateOptions}
						/>
					</div>
					{bundle.stripped.length > 0 ? (
						<div className="flex flex-col gap-3">
							<p className="text-[13px] text-muted">
								The sender removed these secret values. Fill them in, or leave them
								empty and add them later.
							</p>
							{bundle.stripped.map((key) => (
								<Field
									key={key}
									label={
										<span className="font-mono text-xs">
											{key.split(':').pop()}
										</span>
									}
								>
									{(control) => (
										<Input
											{...control}
											type="password"
											autoComplete="off"
											value={secrets[key] ?? ''}
											onChange={(event) =>
												setSecrets({
													...secrets,
													[key]: event.target.value,
												})
											}
										/>
									)}
								</Field>
							))}
						</div>
					) : null}
					{kind?.runsCommands ? (
						<div className="rounded-md border border-warn/30 bg-warn-tint p-3 text-[13px]">
							<p className="font-medium">
								{kind.label} run commands on your computer.
							</p>
							<p className="mt-1 text-muted">Review before adding.</p>
							<label className="mt-3 flex items-center gap-2.5">
								<Checkbox
									checked={reviewed}
									onCheckedChange={(value) => setReviewed(value === true)}
								/>
								I reviewed this command
							</label>
						</div>
					) : null}
					<ErrorMessage error={error} />
				</div>
			</DialogContent>
		</Dialog>
	);
}
