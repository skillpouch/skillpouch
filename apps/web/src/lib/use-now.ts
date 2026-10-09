// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';

/** The current time, refreshed every `intervalMs`, for countdowns. */
export function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs]);
	return now;
}
