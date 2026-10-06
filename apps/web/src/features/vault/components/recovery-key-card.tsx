// SPDX-License-Identifier: AGPL-3.0-only
/** The 12 Recovery Key words, numbered, with Download and Copy. */
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { recoveryKeyFile } from '../setup';

export function RecoveryKeyCard({ words, email }: { words: string[]; email: string }) {
	const download = () => {
		const url = URL.createObjectURL(recoveryKeyFile(words, email));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'skillpouch-recovery-key.txt';
		link.click();
		URL.revokeObjectURL(url);
	};
	return (
		<div className="flex flex-col gap-3">
			<ol
				aria-label="Recovery Key"
				data-testid="recovery-key"
				className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 font-mono text-[13px] sm:grid-cols-3"
			>
				{words.map((word, index) => (
					<li key={index} className="flex gap-2">
						<span className="w-5 text-right text-meta select-none">{index + 1}</span>
						<span className="text-fg">{word}</span>
					</li>
				))}
			</ol>
			<div className="flex gap-2">
				<Button size="sm" onClick={download}>
					<Download /> Download
				</Button>
				<CopyButton value={words.join(' ')} />
			</div>
		</div>
	);
}
