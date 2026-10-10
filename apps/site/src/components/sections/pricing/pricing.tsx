// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { PLANS_URL, SIGN_IN_URL } from '@/lib/links';
import { formatPrice, planLines, type Plan } from '@/components/landing-content';
import { PlanName, planStyle } from './plan-name';
import { ButtonLink } from '@/components/ui/button-link';

/** The public plans, read when the page loads so prices are always current. */
async function loadPlans(): Promise<Plan[]> {
	const response = await fetch(PLANS_URL, { credentials: 'omit' });
	if (!response.ok) throw new Error(`plans: ${response.status}`);
	const body = (await response.json()) as { data?: { plans?: Plan[] } };
	return body.data?.plans ?? [];
}

function PlanColumn({ plan }: { plan: Plan }) {
	const style = planStyle(plan.slug, plan.price_cents > 0);
	const paid = style !== null;
	return (
		<li
			className={cn(
				'flex flex-col rounded-2xl border bg-surface p-7',
				paid ? ['plan-card plan-shimmer', style.className] : 'border-border',
			)}
		>
			<h3 className="flex items-center gap-1.5 text-[15px] font-medium">
				<PlanName name={plan.name} style={style} markClassName="size-4" />
			</h3>
			<p className="mt-5 flex items-baseline gap-1.5">
				<span className="landing-display text-5xl font-semibold">
					{formatPrice(plan.price_cents, plan.currency)}
				</span>
				<span className="text-sm text-meta">
					{plan.interval ? `/ ${plan.interval}` : 'forever'}
				</span>
			</p>
			{plan.description ? (
				<p className="mt-2 text-sm text-muted">{plan.description}</p>
			) : null}
			<ul className="mt-6 flex flex-1 flex-col gap-2.5 text-sm text-fg">
				{planLines(plan).map((line) => (
					<li key={line} className="flex items-center gap-2.5">
						<Check className="size-4 shrink-0 text-accent-text" aria-hidden />
						{line}
					</li>
				))}
			</ul>
			<ButtonLink
				href={SIGN_IN_URL}
				variant={paid ? 'outline' : 'primary'}
				size="lg"
				className="mt-8 rounded-full active:scale-[0.98]"
			>
				Get started
			</ButtonLink>
		</li>
	);
}

export function Pricing() {
	const [plans, setPlans] = useState<Plan[] | 'loading' | 'failed'>('loading');
	useEffect(() => {
		loadPlans()
			.then(setPlans)
			.catch(() => setPlans('failed'));
	}, []);

	return (
		<section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-24 px-5 py-24">
			<div className="mx-auto max-w-[1120px]">
				<div className="mx-auto max-w-[640px] text-center">
					<h2
						id="pricing-title"
						className="landing-display text-4xl leading-[1.05] font-semibold sm:text-5xl"
					>
						Free to use. Paid plans add room.
					</h2>
					<p className="mt-5 text-base leading-relaxed text-muted">
						Every plan has every feature. Pay for more pouches and storage, and to keep
						SkillPouch running.
					</p>
				</div>

				{plans === 'loading' ? (
					<ul className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3" aria-hidden>
						{[0, 1, 2].map((index) => (
							<li key={index}>
								<div className="h-[372px] animate-pulse-soft rounded-2xl bg-[#141414]" />
							</li>
						))}
					</ul>
				) : plans !== 'failed' && plans.length ? (
					<ul
						className={cn(
							'mx-auto mt-14 grid grid-cols-1 gap-4',
							plans.length >= 3 ? 'md:grid-cols-3' : 'max-w-[760px] md:grid-cols-2',
						)}
					>
						{plans.map((plan) => (
							<PlanColumn key={plan.slug} plan={plan} />
						))}
					</ul>
				) : (
					<p className="mt-14 text-center text-sm text-muted">
						Plans could not be loaded right now. You can see them after you{' '}
						<a href={SIGN_IN_URL} className="text-fg underline underline-offset-4">
							sign in
						</a>
						.
					</p>
				)}

				<p className="mt-8 text-center text-[13px] text-meta">
					Prices in US dollars. Paid plans are sold through Polar, our merchant of record,
					and you can cancel any time.
				</p>
			</div>
		</section>
	);
}
