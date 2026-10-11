// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page-blocking dialog of a step-up sign-in. The action that needed it
 * waits behind this dialog and continues on its own once the user signed in.
 */
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { lastProvider, reauthenticate } from '@/lib/auth';
import { cancelStepUp, startStepUp, useStepUp, type StepUpState } from './step-up';

function providerName(): string {
	const provider = lastProvider();
	if (typeof provider === 'object') return 'your dev account';
	return provider === 'google' ? 'Google' : 'GitHub';
}

function describe(state: StepUpState, provider: string): string {
	switch (state.phase) {
		case 'waiting':
			return `Finish signing in with ${provider} in the window that opened. This page waits for you.`;
		case 'finishing':
			return 'Signed in. Finishing up…';
		case 'closed':
			return 'The sign-in window was closed before you finished.';
		case 'blocked':
			return 'Your browser blocked the sign-in window. Allow pop-ups for this site, or sign in in this tab (anything you haven’t saved on this page is lost).';
		case 'failed':
			return state.message;
		default:
			return `This action needs a fresh sign-in. A small window opens for ${provider}; your work on this page stays as it is.`;
	}
}

export function StepUpDialog() {
	const state = useStepUp();
	if (state.phase === 'idle') return null;
	const provider = providerName();
	const busy = state.phase === 'waiting' || state.phase === 'finishing';
	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : cancelStepUp())}>
			<DialogContent
				size="sm"
				title="Confirm it’s you"
				description={describe(state, provider)}
				hideClose
				busy={busy}
				footer={
					<>
						<Button onClick={cancelStepUp} disabled={state.phase === 'finishing'}>
							Cancel
						</Button>
						{state.phase === 'blocked' ? (
							<Button variant="primary" onClick={() => void reauthenticate()}>
								Sign in in this tab
							</Button>
						) : busy ? (
							<Button variant="primary" loading>
								Waiting…
							</Button>
						) : (
							<Button variant="primary" onClick={startStepUp}>
								{state.phase === 'prompt'
									? `Continue with ${provider}`
									: 'Try again'}
							</Button>
						)}
					</>
				}
			/>
		</Dialog>
	);
}
