// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An error line for forms and dialogs. When the API asks for a fresh
 * sign-in (sensitive actions), it offers the re-authentication right there.
 */
import { describeError, isApiError } from '@/lib/api/errors';
import { reauthenticate } from '@/lib/auth';
import { cn } from '@/lib/cn';

export function ErrorMessage({ error, className }: { error: unknown; className?: string }) {
	if (!error) return null;
	const stepUp = isApiError(error, 'step_up_required');
	return (
		<p className={cn('text-[13px] text-danger', className)} role="alert">
			{describeError(error)}
			{stepUp ? (
				<>
					{' '}
					<button
						type="button"
						className="font-medium text-fg underline underline-offset-4"
						onClick={() => void reauthenticate()}
					>
						Sign in again
					</button>
				</>
			) : null}
		</p>
	);
}
