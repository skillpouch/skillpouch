// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { curves, slice } from '../sections/sync-flow/flow-canvas';

describe('sync diagram curves', () => {
	it('fan in from each row to the middle of the far side', () => {
		const lines = curves(3, 'in', 100, 300);
		expect(lines).toHaveLength(3);
		expect(lines[0]!.points[0]).toEqual([0, 50]);
		expect(lines[0]!.points.at(-1)).toEqual([100, 150]);
		// The middle row is a straight line.
		expect(lines[1]!.total).toBeCloseTo(100, 5);
	});

	it('cuts a dash of the asked length, even past the ends', () => {
		const [line] = curves(1, 'out', 200, 100);
		const dash = slice(line!, 40, 62);
		const length = dash
			.slice(1)
			.reduce((sum, [x, y], i) => sum + Math.hypot(x - dash[i]![0], y - dash[i]![1]), 0);
		expect(length).toBeCloseTo(22, 1);
		expect(slice(line!, -30, -5)).toEqual([]);
		expect(slice(line!, line!.total - 5, line!.total + 20).at(-1)).toEqual(line!.points.at(-1));
	});
});
