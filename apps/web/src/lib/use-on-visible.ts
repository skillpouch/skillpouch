// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `onVisible` when the element comes within `margin` of the visible
 * area (inside any scrolling parent too). Used to load the next page before
 * the list runs out. Change `key` (say, the item count) to check again when
 * the element is still in view after a load.
 */
export function useOnVisible<T extends Element>(
	onVisible: () => void,
	{
		enabled = true,
		margin = '600px',
		key,
	}: { enabled?: boolean; margin?: string; key?: unknown } = {},
): RefObject<T | null> {
	const ref = useRef<T>(null);
	const callback = useRef(onVisible);
	callback.current = onVisible;

	useEffect(() => {
		const element = ref.current;
		if (!enabled || !element) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) callback.current();
			},
			{ rootMargin: margin },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [enabled, margin, key]);

	return ref;
}
