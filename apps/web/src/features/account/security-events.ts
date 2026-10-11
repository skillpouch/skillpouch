// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Readable text for the security events the API records. The kinds are the
 * API's (`security_events.kind`); one it adds later still reads as a sentence
 * rather than a code.
 */
const LABELS: Record<string, string> = {
	'cli.authorized': 'A computer was connected',
	'browser.trusted': 'A new browser was trusted',
	'device.revoked': 'A device was revoked',
	'passkey.added': 'A passkey was added for unlocking',
	'passkey.removed': 'A passkey was removed',
	'unlock.failed_streak': 'Several wrong master passwords',
	'unlock.password_changed': 'The master password was changed',
	refresh_reuse: 'A device token was reused and the device revoked',
};

export function describeSecurityEvent(kind: string): string {
	const label = LABELS[kind];
	if (label) return label;
	// Reported by a client that refused data (`client.<check>`).
	if (kind.startsWith('client.')) return 'A device refused data that didn’t verify';
	const words = kind.replace(/[._]+/g, ' ').trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Security event';
}
