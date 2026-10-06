// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/cli/authorize?request=…` — opened by `skillpouch login` on a computer.
 * The user compares the confirm code with the terminal and authorizes; this
 * browser then adds the computer's keys to the account.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { CircleCheck, CircleX } from 'lucide-react';
import { AuthHeading, AuthLayout } from '@/components/layout/auth-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { LoadingBlock } from '@/components/ui/spinner';
import {
	approveCliRequest,
	confirmCodeOf,
	denyCliRequest,
	fetchCliRequest,
} from '@/features/devices/cli-login';
import { assistantLabel, OS_LABEL } from '@/features/devices/devices';
import { formatRelative } from '@/lib/format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function CliAuthorizePage() {
	const { request: requestId } = useSearch({ strict: false }) as { request?: string };
	const valid = !!requestId && UUID.test(requestId);
	const request = useQuery({
		queryKey: ['cli-auth', requestId],
		queryFn: () => fetchCliRequest(requestId!),
		enabled: valid,
		refetchInterval: (query) => (query.state.data?.state === 'open' ? 5000 : false),
	});
	const approve = useMutation({ mutationFn: approveCliRequest });
	const deny = useMutation({ mutationFn: denyCliRequest });

	const body = () => {
		if (!valid)
			return (
				<Outcome
					tone="error"
					title="This link is incomplete"
					text="Run skillpouch login again."
				/>
			);
		if (request.isPending) return <LoadingBlock />;
		if (request.error) return <ErrorMessage error={request.error} />;
		const data = request.data!;
		if (approve.isSuccess || data.state === 'approved' || data.state === 'redeemed') {
			return (
				<Outcome
					tone="ok"
					title={`${data.device_name} is connected`}
					text="You can return to your terminal."
				/>
			);
		}
		if (deny.isSuccess || data.state === 'denied') {
			return (
				<Outcome
					tone="error"
					title="Request denied"
					text="The computer was not connected."
				/>
			);
		}
		if (data.state === 'expired' || new Date(data.expires_at) < new Date()) {
			return (
				<Outcome
					tone="error"
					title="This request expired"
					text="Run skillpouch login again."
				/>
			);
		}
		return (
			<div className="flex flex-col gap-6">
				<AuthHeading
					title="Authorize this computer?"
					description="It will be able to read and change all your pouches."
				/>
				<dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-[13px]">
					<dt className="text-meta">Computer</dt>
					<dd className="font-medium">{data.device_name}</dd>
					<dt className="text-meta">System</dt>
					<dd>
						{OS_LABEL[data.os]} · {data.arch} · skillpouch v{data.cli_version}
					</dd>
					{data.geo ? (
						<>
							<dt className="text-meta">Location</dt>
							<dd>{data.geo}</dd>
						</>
					) : null}
					<dt className="text-meta">Requested</dt>
					<dd>{formatRelative(data.created_at)}</dd>
					{data.assistants.length > 0 ? (
						<>
							<dt className="text-meta">Assistants</dt>
							<dd className="flex flex-wrap gap-1.5">
								{data.assistants.map((assistant) => (
									<Badge key={assistant}>{assistantLabel(assistant)}</Badge>
								))}
							</dd>
						</>
					) : null}
				</dl>
				<div className="flex flex-col items-center gap-2 rounded-lg border border-accent/40 p-5">
					<p className="text-xs text-muted">Confirm code</p>
					<p className="font-mono text-3xl tracking-[0.2em]" data-testid="confirm-code">
						{confirmCodeOf(data)}
					</p>
					<p className="text-center text-xs text-muted">
						Make sure your terminal shows the same code. If it doesn’t, deny.
					</p>
				</div>
				<ErrorMessage error={approve.error ?? deny.error} />
				<div className="flex gap-2">
					<Button
						size="lg"
						disabled={approve.isPending}
						loading={deny.isPending}
						onClick={() => deny.mutate(data.request_id)}
					>
						Deny
					</Button>
					<Button
						size="lg"
						variant="primary"
						className="flex-1"
						loading={approve.isPending}
						disabled={deny.isPending}
						onClick={() => approve.mutate(data)}
					>
						Authorize
					</Button>
				</div>
			</div>
		);
	};

	return <AuthLayout width="md">{body()}</AuthLayout>;
}

function Outcome({ tone, title, text }: { tone: 'ok' | 'error'; title: string; text: string }) {
	const Icon = tone === 'ok' ? CircleCheck : CircleX;
	return (
		<div className="flex flex-col items-center gap-3 text-center">
			<Icon
				className={tone === 'ok' ? 'size-8 text-success' : 'size-8 text-muted'}
				aria-hidden
			/>
			<h1 className="text-xl font-semibold">{title}</h1>
			<p className="text-[13px] text-muted">{text}</p>
		</div>
	);
}
