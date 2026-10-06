// SPDX-License-Identifier: AGPL-3.0-only
/** "Supporter" badge in the top bar; only for paying (or granted) supporters. */
import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useSession } from '@/features/session/session-store';

export function SupporterPill() {
	const session = useSession();
	if (!('me' in session) || session.me.account.entitlements.plan_slug === 'free') return null;
	return (
		<Link
			to="/app/account/billing"
			className="group relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-full border border-accent/40 px-3 text-[13px] font-medium max-sm:w-8 max-sm:justify-center max-sm:px-0"
			aria-label="Supporter — billing"
		>
			<Sparkles className="size-3.5 text-accent-text" aria-hidden />
			<span className="bg-gradient-to-r from-[#a774f2] via-[#f0a6d8] to-white bg-clip-text text-transparent max-sm:hidden">
				Supporter
			</span>
			<span
				className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full"
				aria-hidden
			/>
		</Link>
	);
}
