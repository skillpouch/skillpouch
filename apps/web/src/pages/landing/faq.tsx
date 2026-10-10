// SPDX-License-Identifier: AGPL-3.0-only
import { Plus } from 'lucide-react';
import { CONTACT_EMAIL, FAQS } from './landing-content';

export function Faq() {
	return (
		<section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 px-5 py-24">
			<div className="mx-auto grid max-w-[1120px] gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
				<div className="lg:sticky lg:top-28 lg:self-start">
					<h2
						id="faq-title"
						className="landing-display text-4xl leading-[1.05] font-semibold sm:text-5xl"
					>
						Questions, answered.
					</h2>
					<p className="mt-5 text-base leading-relaxed text-muted">
						Anything else? Write to{' '}
						<a
							href={`mailto:${CONTACT_EMAIL}`}
							className="text-fg underline underline-offset-4 hover:text-accent-text"
						>
							{CONTACT_EMAIL}
						</a>
						.
					</p>
				</div>
				<div className="divide-y divide-border border-y border-border">
					{FAQS.map((faq) => (
						<details key={faq.question} className="group">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-[15px] font-medium text-fg transition-colors hover:text-accent-text [&::-webkit-details-marker]:hidden">
								{faq.question}
								<Plus
									className="size-4 shrink-0 text-meta transition-transform duration-200 group-open:rotate-45"
									aria-hidden
								/>
							</summary>
							<p className="-mt-1 max-w-[62ch] pb-6 text-sm leading-relaxed text-muted">
								{faq.answer}
							</p>
						</details>
					))}
				</div>
			</div>
		</section>
	);
}
