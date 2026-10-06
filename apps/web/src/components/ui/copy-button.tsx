// SPDX-License-Identifier: AGPL-3.0-only
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, type ButtonProps } from './button';

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
	value: string;
	label?: string;
}

/** Copies `value`; the label flips to "Copied" for a moment. */
export function CopyButton({ value, label = 'Copy', ...props }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<Button
			size="sm"
			{...props}
			onClick={async () => {
				await navigator.clipboard.writeText(value);
				setCopied(true);
			}}
		>
			{copied ? <Check /> : <Copy />}
			{copied ? 'Copied' : label}
		</Button>
	);
}
