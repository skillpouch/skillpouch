// SPDX-License-Identifier: AGPL-3.0-only
import { AssistantIcon } from '@/features/devices/components/assistant-badge';
import { ASSISTANTS } from './landing-content';

export function AssistantsStrip() {
	return (
		<section aria-labelledby="works-with" className="px-5 pt-6 pb-20">
			<h2 id="works-with" className="text-center text-[13px] text-meta">
				Works with the assistants you already use
			</h2>
			<ul className="mx-auto mt-6 flex max-w-[1240px] flex-wrap justify-center gap-x-7 gap-y-4">
				{ASSISTANTS.map((assistant) => (
					<li
						key={assistant.id}
						className="flex items-center gap-2 text-[15px] font-medium text-muted transition-colors hover:text-fg"
					>
						<AssistantIcon id={assistant.id} className="size-5" />
						{assistant.name}
					</li>
				))}
			</ul>
		</section>
	);
}
