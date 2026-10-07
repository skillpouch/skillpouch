// SPDX-License-Identifier: AGPL-3.0-only
/** "Supporter" badge in the top bar; only for paying (or granted) supporters. */
import { Link } from '@tanstack/react-router';
import { Sparkle } from '@/components/brand/sparkle';
import { useSession } from '@/features/session/session-store';

export function SupporterPill() {
	const session = useSession();
	if (!('me' in session) || session.me.account.entitlements.plan_slug === 'free') return null;
	return (
		<Link
			to="/app/account/billing"
			className="supporter-badge supporter-badge-compact supporter-shimmer"
			aria-label="Supporter plan, open billing"
		>
			<Sparkle />
			<span className="supporter-text">Supporter</span>
		</Link>
	);
}
