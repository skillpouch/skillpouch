// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { INSTALL_COMMANDS, shortenCommand } from '../components/connect-cli-dialog';

describe('shortenCommand', () => {
	it('keeps the start and end of the token and drops the middle', () => {
		const command = 'skillpouch login sp_lt_BPBF8Y1HA4TqwVMbkypAodd4GqbnVhZw';
		expect(shortenCommand(command)).toBe('skillpouch login sp_lt_BPBF…VhZw');
	});
});

describe('INSTALL_COMMANDS', () => {
	it('installs for good, never a throwaway npx copy', () => {
		for (const command of Object.values(INSTALL_COMMANDS)) {
			expect(command).toMatch(/ -g skillpouch$/);
			expect(command).not.toContain('npx');
		}
	});
});
