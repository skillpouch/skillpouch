// SPDX-License-Identifier: AGPL-3.0-only
/** Small, dependency-free charts for the admin dashboard. */
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface BarPoint {
	label: string;
	value: number;
}

/**
 * Columns, one per point, with the hovered one's label and value above.
 * Long ranges group several days into one column so bars stay readable.
 */
export function BarChart({
	points,
	format,
	label,
	height = 160,
	maxBars = 60,
}: {
	points: BarPoint[];
	format: (value: number) => string;
	label: string;
	height?: number;
	maxBars?: number;
}) {
	const bars = bucket(points, maxBars);
	const [hovered, setHovered] = useState<number | null>(null);
	const peak = Math.max(...bars.map((bar) => bar.value), 0);
	const shown = hovered === null ? null : bars[hovered];
	return (
		<figure className="flex flex-col gap-2" aria-label={label}>
			<figcaption className="flex h-5 items-baseline justify-between gap-3 text-xs text-meta">
				<span>
					{shown ? shown.label : `${bars[0]?.label ?? ''} – ${bars.at(-1)?.label ?? ''}`}
				</span>
				<span className="font-mono text-fg">
					{shown ? format(shown.value) : `peak ${format(peak)}`}
				</span>
			</figcaption>
			<div
				className="flex items-end gap-[2px]"
				style={{ height }}
				onMouseLeave={() => setHovered(null)}
				role="img"
				aria-label={`${label}: ${bars.map((bar) => `${bar.label} ${format(bar.value)}`).join(', ')}`}
			>
				{bars.map((bar, index) => {
					const ratio = peak > 0 ? bar.value / peak : 0;
					return (
						<div
							key={bar.label}
							className="flex h-full min-w-0 flex-1 cursor-default items-end"
							onMouseEnter={() => setHovered(index)}
						>
							<div
								className={cn(
									'w-full rounded-t-[2px] transition-colors',
									bar.value > 0 ? 'bg-accent/70' : 'bg-[#161616]',
									hovered === index && 'bg-accent',
								)}
								style={{
									height: bar.value > 0 ? `max(${ratio * 100}%, 2px)` : '2px',
								}}
							/>
						</div>
					);
				})}
			</div>
		</figure>
	);
}

/** Groups neighbouring points so there are at most `max` (sums the values). */
export function bucket(points: BarPoint[], max: number): BarPoint[] {
	if (points.length <= max) return points;
	const size = Math.ceil(points.length / max);
	const out: BarPoint[] = [];
	for (let start = 0; start < points.length; start += size) {
		const group = points.slice(start, start + size);
		const first = group[0]!.label;
		const last = group.at(-1)!.label;
		out.push({
			label: first === last ? first : `${first} – ${last}`,
			value: group.reduce((sum, point) => sum + point.value, 0),
		});
	}
	return out;
}

/** A ranked list with a bar behind each share. */
export function Breakdown({
	rows,
	format,
	empty = 'Nothing yet.',
	label,
}: {
	rows: { name: ReactNode; key: string; value: number }[];
	format: (value: number) => string;
	empty?: string;
	label: string;
}) {
	const total = rows.reduce((sum, row) => sum + row.value, 0);
	if (!rows.length) return <p className="py-6 text-center text-[13px] text-meta">{empty}</p>;
	return (
		<ul className="flex flex-col gap-1" aria-label={label}>
			{rows.map((row) => {
				const share = total > 0 ? row.value / total : 0;
				return (
					<li key={row.key} className="relative overflow-hidden rounded-md px-2.5 py-1.5">
						<div
							className="absolute inset-y-0 left-0 bg-accent-tint"
							style={{ width: `${share * 100}%` }}
							aria-hidden
						/>
						<div className="relative flex items-center justify-between gap-3 text-[13px]">
							<span className="min-w-0 truncate text-fg">{row.name}</span>
							<span className="shrink-0 font-mono text-muted">
								{format(row.value)}
								<span className="ml-2 inline-block w-10 text-right text-meta">
									{Math.round(share * 100)}%
								</span>
							</span>
						</div>
					</li>
				);
			})}
		</ul>
	);
}
