// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { ButtonLink } from './ui/button-link';

/** Whether this browser has a session, from the same check the web app makes. */
async function signedIn(): Promise<boolean> {
	const response = await fetch('/v1/auth/get-session', { credentials: 'same-origin' });
	if (!response.ok) return false;
	const body = (await response.json().catch(() => null)) as { user?: unknown } | null;
	return Boolean(body?.user);
}

/** Signed-in visitors go straight to the app; everyone else (and the static HTML) signs in. */
export function SessionActions() {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		signedIn()
			.then(setOpen)
			.catch(() => setOpen(false));
	}, []);

	if (open) {
		return (
			<ButtonLink href="/app" variant="primary" className="rounded-full">
				Open SkillPouch
			</ButtonLink>
		);
	}
	return (
		<div className="flex items-center gap-1">
			<ButtonLink href="/sign-in" variant="ghost" className="rounded-full">
				Sign in
			</ButtonLink>
			<ButtonLink href="/sign-in" variant="primary" className="rounded-full">
				Get started
			</ButtonLink>
		</div>
	);
}
