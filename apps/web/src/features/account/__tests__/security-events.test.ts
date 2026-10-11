// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { describeSecurityEvent } from '../security-events';

describe('describeSecurityEvent', () => {
	it('names every kind the API records', () => {
		expect(describeSecurityEvent('browser.trusted')).toBe('A new browser was trusted');
		expect(describeSecurityEvent('unlock.password_changed')).toBe(
			'The master password was changed',
		);
		expect(describeSecurityEvent('refresh_reuse')).toBe(
			'A device token was reused and the device revoked',
		);
		expect(describeSecurityEvent('device.revoked')).toBe('A device was revoked');
	});

	it('covers every client verification failure', () => {
		expect(describeSecurityEvent('client.roster_fork')).toBe(
			'A device refused data that didn’t verify',
		);
	});

	it('never shows a raw code for a kind it doesn’t know', () => {
		expect(describeSecurityEvent('recovery.key_replaced')).toBe('Recovery key replaced');
	});
});
