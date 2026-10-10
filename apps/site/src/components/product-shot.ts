// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How far the product shot has scrolled in, 0 to 1: from its top entering at
 * the bottom of the viewport to its top reaching 45% down the viewport.
 */
export function shotProgress(top: number, viewportHeight: number): number {
	const progress = (viewportHeight - top) / (viewportHeight * 0.55);
	return Math.min(1, Math.max(0, progress));
}
