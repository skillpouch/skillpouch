// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The connectors of the sync diagram: curves from evenly spaced rows to the
 * middle, with a bright dash travelling along each. Drawn on one canvas by
 * one animation loop at a constant speed along each curve, and only while
 * the diagram is on screen.
 */
import { useEffect, useRef } from 'react';

const LINE = 'rgb(255 255 255 / 0.1)';
const DASH = 'oklch(0.8 0.13 300)';
/** Dash speed and length in CSS pixels. */
const SPEED = 110;
const DASH_LENGTH = 22;
/** Samples per curve for the length table. */
const SAMPLES = 64;

type Point = [number, number];

/** Point on a cubic Bézier at `t`. */
function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return [
		a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
		a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
	];
}

export interface Curve {
	points: Point[];
	/** Distance along the curve at each point. */
	lengths: number[];
	total: number;
}

/** The connectors for `count` rows over a `width` × `height` box. */
export function curves(count: number, fan: 'in' | 'out', width: number, height: number): Curve[] {
	const mid = height / 2;
	return Array.from({ length: count }, (_, index) => {
		const y = ((index + 0.5) / count) * height;
		const [from, to]: [number, number] = fan === 'in' ? [y, mid] : [mid, y];
		const p0: Point = [0, from];
		const p1: Point = [width * 0.55, from];
		const p2: Point = [width * 0.45, to];
		const p3: Point = [width, to];
		const points: Point[] = [];
		const lengths: number[] = [];
		let total = 0;
		for (let step = 0; step <= SAMPLES; step++) {
			const point = bezier(p0, p1, p2, p3, step / SAMPLES);
			const last = points.at(-1);
			if (last) total += Math.hypot(point[0] - last[0], point[1] - last[1]);
			points.push(point);
			lengths.push(total);
		}
		return { points, lengths, total };
	});
}

/** The part of `curve` between distances `from` and `to`, as points. */
export function slice(curve: Curve, from: number, to: number): Point[] {
	const start = Math.max(0, from);
	const end = Math.min(curve.total, to);
	if (end <= start) return [];
	const at = (distance: number): Point => {
		let index = 1;
		while (index < curve.lengths.length - 1 && curve.lengths[index]! < distance) index++;
		const before = curve.lengths[index - 1]!;
		const span = curve.lengths[index]! - before || 1;
		const t = (distance - before) / span;
		const [x0, y0] = curve.points[index - 1]!;
		const [x1, y1] = curve.points[index]!;
		return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
	};
	const out: Point[] = [at(start)];
	curve.lengths.forEach((length, index) => {
		if (length > start && length < end) out.push(curve.points[index]!);
	});
	out.push(at(end));
	return out;
}

export function FlowCanvas({
	count,
	fan,
	height,
	offset,
}: {
	count: number;
	fan: 'in' | 'out';
	height: number;
	/** Seconds this side's dashes start after the other's. */
	offset: number;
}) {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = ref.current;
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return;
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		let lines: Curve[] = [];
		let width = 0;
		let frame = 0;
		let visible = false;
		const started = performance.now();

		const draw = (now: number) => {
			context.clearRect(0, 0, width, height);
			context.lineCap = 'round';
			context.lineWidth = 1;
			context.strokeStyle = LINE;
			for (const line of lines) {
				context.beginPath();
				line.points.forEach(([x, y], index) =>
					index ? context.lineTo(x, y) : context.moveTo(x, y),
				);
				context.stroke();
			}
			if (still) return;
			context.lineWidth = 2;
			context.strokeStyle = DASH;
			const elapsed = (now - started) / 1000;
			lines.forEach((line, index) => {
				// A lap is the curve plus a pause off its end, same for every curve.
				const lap = line.total + DASH_LENGTH + 120;
				const head = ((elapsed + offset + index * 0.37) * SPEED) % lap;
				const points = slice(line, head - DASH_LENGTH, head);
				if (points.length < 2) return;
				context.beginPath();
				points.forEach(([x, y], i) => (i ? context.lineTo(x, y) : context.moveTo(x, y)));
				context.stroke();
			});
		};

		const loop = (now: number) => {
			draw(now);
			frame = visible ? requestAnimationFrame(loop) : 0;
		};

		const resize = () => {
			const ratio = window.devicePixelRatio || 1;
			width = canvas.clientWidth;
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			lines = curves(count, fan, width, height);
			draw(performance.now());
		};

		const sized = new ResizeObserver(resize);
		sized.observe(canvas);
		const seen = new IntersectionObserver(([entry]) => {
			visible = Boolean(entry?.isIntersecting) && !still;
			if (visible && !frame) frame = requestAnimationFrame(loop);
		});
		seen.observe(canvas);
		resize();
		return () => {
			sized.disconnect();
			seen.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [count, fan, height, offset]);

	return (
		<canvas
			ref={ref}
			aria-hidden
			className="hidden min-w-12 flex-1 md:block"
			style={{ height }}
		/>
	);
}
