// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Connect a computer": installing the CLI, then a one-time
 * `skillpouch login <token>` command with a 10-minute countdown, and live
 * progress until the computer is connected.
 */
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, TerminalSquare } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Segmented } from '@/components/ui/segmented';
import { Spinner } from '@/components/ui/spinner';
import { queryKeys } from '@/lib/api/query-keys';
import type { CliAuthRequest, ConnectToken } from '@/lib/api/types';
import { formatCountdown } from '@/lib/format';
import { onAccountEvent } from '../../realtime/account-events';
import {
	approveCliRequest,
	cancelConnectToken,
	connectTokenStatus,
	createConnectToken,
	fetchCliRequest,
} from '../cli-login';
import { OS_LABEL } from '../devices';

type Phase =
	| { kind: 'creating' }
	| { kind: 'waiting'; token: ConnectToken }
	| { kind: 'approving'; token: ConnectToken; request: CliAuthRequest | null }
	| { kind: 'connected'; request: CliAuthRequest }
	| { kind: 'expired' }
	| { kind: 'failed'; error: unknown };

export function ConnectCliDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const client = useQueryClient();
	const [phase, setPhase] = useState<Phase>({ kind: 'creating' });
	const [now, setNow] = useState(() => Date.now());
	const phaseRef = useRef(phase);
	phaseRef.current = phase;

	const start = useCallback(async () => {
		setPhase({ kind: 'creating' });
		try {
			setPhase({ kind: 'waiting', token: await createConnectToken() });
		} catch (error) {
			setPhase({ kind: 'failed', error });
		}
	}, []);

	const approve = useCallback(
		async (token: ConnectToken, requestId: string) => {
			const current = phaseRef.current;
			if (current.kind !== 'waiting' || current.token.id !== token.id) return;
			setPhase({ kind: 'approving', token, request: null });
			try {
				const request = await fetchCliRequest(requestId);
				setPhase({ kind: 'approving', token, request });
				await approveCliRequest(request);
				setPhase({ kind: 'connected', request });
				await client.invalidateQueries({ queryKey: queryKeys.devices });
			} catch (error) {
				setPhase({ kind: 'failed', error });
			}
		},
		[client],
	);

	useEffect(() => {
		if (open) void start();
	}, [open, start]);

	// The account stream announces the CLI's request; polling is the fallback.
	useEffect(() => {
		if (phase.kind !== 'waiting') return;
		const { token } = phase;
		const unsubscribe = onAccountEvent((event) => {
			if (
				event.type === 'cli_auth.requested' &&
				event.data.connect_token_id === token.id &&
				typeof event.data.request_id === 'string'
			) {
				void approve(token, event.data.request_id);
			}
		});
		const poll = setInterval(async () => {
			const status = await connectTokenStatus(token.id).catch(() => null);
			if (status?.state === 'requested' && status.request_id)
				void approve(token, status.request_id);
			if (status?.state === 'expired') setPhase({ kind: 'expired' });
		}, 3000);
		const tick = setInterval(() => setNow(Date.now()), 1000);
		return () => {
			unsubscribe();
			clearInterval(poll);
			clearInterval(tick);
		};
	}, [phase, approve]);

	const close = (next: boolean) => {
		if (!next && phaseRef.current.kind === 'waiting') {
			void cancelConnectToken(phaseRef.current.token.id).catch(() => undefined);
		}
		onOpenChange(next);
	};

	const remaining =
		phase.kind === 'waiting' ? new Date(phase.token.expires_at).getTime() - now : 0;
	useEffect(() => {
		if (phase.kind === 'waiting' && remaining <= 0) setPhase({ kind: 'expired' });
	}, [phase.kind, remaining]);

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				title="Connect a computer"
				description="Run these in a terminal on the computer you want to sync. It signs in, links it to your account and keeps syncing in the background."
				busy={phase.kind === 'approving'}
				footer={
					phase.kind === 'connected' ? (
						<Button variant="primary" onClick={() => close(false)}>
							Done
						</Button>
					) : (
						<>
							<Button onClick={() => close(false)}>Cancel</Button>
							{phase.kind === 'expired' || phase.kind === 'failed' ? (
								<Button variant="primary" onClick={() => void start()}>
									New token
								</Button>
							) : null}
						</>
					)
				}
			>
				{phase.kind === 'creating' ? (
					<div className="flex h-24 items-center justify-center text-muted">
						<Spinner />
					</div>
				) : null}
				{phase.kind === 'waiting' || phase.kind === 'approving' ? (
					<div className="flex flex-col gap-4">
						<InstallStep />
						<Step number={2} title="Connect this computer">
							<CommandLine
								command={phase.token.command}
								shown={shortenCommand(phase.token.command)}
								testId="connect-command"
							/>
						</Step>
						<p className="flex justify-between text-xs text-meta">
							<span>This token works once and expires in 10 minutes</span>
							{phase.kind === 'waiting' ? (
								<span className="font-mono" aria-label="Time left">
									{formatCountdown(remaining)}
								</span>
							) : null}
						</p>
						<div className="flex items-center gap-2.5 rounded-lg border border-border p-3 text-[13px] text-muted">
							<Spinner />
							{phase.kind === 'approving' && phase.request
								? `Connecting ${phase.request.device_name}…`
								: 'Waiting for skillpouch on your computer…'}
						</div>
						<p className="text-xs text-meta">
							Locked pouches aren’t synced by your computers.
						</p>
					</div>
				) : null}
				{phase.kind === 'connected' ? (
					<div className="flex items-start gap-3 rounded-lg border border-success/30 p-4">
						<CircleCheck className="mt-0.5 size-5 text-success" aria-hidden />
						<div>
							<p className="text-sm font-medium" data-testid="connected-device">
								{phase.request.device_name} connected
							</p>
							<p className="text-[13px] text-muted">
								{OS_LABEL[phase.request.os]} · {phase.request.arch}
								{phase.request.geo ? ` · ${phase.request.geo}` : ''}. It starts
								syncing now.
							</p>
						</div>
					</div>
				) : null}
				{phase.kind === 'expired' ? (
					<div className="flex items-center gap-3 rounded-lg border border-border p-4 text-[13px] text-muted">
						<TerminalSquare className="size-5" aria-hidden />
						This token expired. Create a new one to connect a computer.
					</div>
				) : null}
				{phase.kind === 'failed' ? <ErrorMessage error={phase.error} /> : null}
			</DialogContent>
		</Dialog>
	);
}

type Manager = 'npm' | 'pnpm' | 'bun';

/** How each package manager installs the CLI for good (not `npx`: the background sync needs a fixed program). */
export const INSTALL_COMMANDS: Record<Manager, string> = {
	npm: 'npm i -g skillpouch',
	pnpm: 'pnpm add -g skillpouch',
	bun: 'bun add -g skillpouch',
};

function InstallStep() {
	const [manager, setManager] = useState<Manager>('npm');
	return (
		<Step
			number={1}
			title="Install SkillPouch"
			aside={
				<Segmented
					label="Package manager"
					value={manager}
					onChange={setManager}
					options={(Object.keys(INSTALL_COMMANDS) as Manager[]).map((value) => ({
						value,
						label: value,
					}))}
				/>
			}
		>
			<CommandLine command={INSTALL_COMMANDS[manager]} testId="install-command" />
			<p className="text-xs text-meta">Already installed? Skip this; it updates itself.</p>
		</Step>
	);
}

function Step({
	number,
	title,
	aside,
	children,
}: {
	number: number;
	title: string;
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-2" aria-label={title}>
			<div className="flex min-h-7 items-center justify-between gap-3">
				<h3 className="flex items-center gap-2 text-[13px] font-medium">
					<span className="flex size-5 items-center justify-center rounded-full border border-border text-[11px] text-muted">
						{number}
					</span>
					{title}
				</h3>
				{aside}
			</div>
			{children}
		</section>
	);
}

function CommandLine({
	command,
	shown = command,
	testId,
}: {
	command: string;
	shown?: string;
	testId: string;
}) {
	return (
		<div className="flex items-center gap-2 rounded-lg border border-border bg-black p-3 font-mono text-[13px]">
			<span className="text-meta select-none">$</span>
			<code
				className="min-w-0 flex-1 truncate"
				data-testid={testId}
				data-command={command}
				title={command}
			>
				{shown}
			</code>
			<CopyButton value={command} variant="ghost" />
		</div>
	);
}

/**
 * Shows the one-time token as `sp_lt_BPBF…VhZw` so the command fits on one
 * line. Copy still copies the whole command.
 */
export function shortenCommand(command: string): string {
	return command.replace(/(sp_lt_[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+([A-Za-z0-9_-]{4})$/, '$1…$2');
}
