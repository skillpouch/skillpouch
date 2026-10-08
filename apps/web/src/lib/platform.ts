// SPDX-License-Identifier: AGPL-3.0-only
/** Human labels for the current browser, used for trusted-browser names. */

export function browserName(userAgent = navigator.userAgent): string {
	if (/Edg\//.test(userAgent)) return 'Edge';
	if (/OPR\//.test(userAgent)) return 'Opera';
	if (/Firefox\//.test(userAgent)) return 'Firefox';
	if (/Chrome\//.test(userAgent)) return 'Chrome';
	if (/Safari\//.test(userAgent)) return 'Safari';
	return 'Browser';
}

export function osName(userAgent = navigator.userAgent): string {
	if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
	if (/Android/.test(userAgent)) return 'Android';
	if (/Mac OS X|Macintosh/.test(userAgent)) return 'macOS';
	if (/Windows/.test(userAgent)) return 'Windows';
	if (/Linux|X11/.test(userAgent)) return 'Linux';
	return 'unknown OS';
}

/** `Chrome on macOS`. */
export function browserLabel(userAgent = navigator.userAgent): string {
	return `${browserName(userAgent)} on ${osName(userAgent)}`;
}

/** Apple keyboards use ⌘ where others use Ctrl. */
export function isApple(userAgent = navigator.userAgent): boolean {
	return /Mac|iPhone|iPad/.test(userAgent);
}
