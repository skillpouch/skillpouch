// SPDX-License-Identifier: AGPL-3.0-only
/** The square initial that stands for a pouch. */
export function PouchMonogram({ name, size = 32 }: { name: string; size?: number }) {
	return (
		<span
			aria-hidden
			className="inline-flex shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-2 font-medium text-fg"
			style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
		>
			{name.trim().charAt(0).toUpperCase() || 'P'}
		</span>
	);
}
