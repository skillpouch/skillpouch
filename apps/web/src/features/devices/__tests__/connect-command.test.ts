// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { shortenCommand } from '../components/connect-cli-dialog';

describe('shortenCommand', () => {
	it('keeps the start and end of the token and drops the middle', () => {
		const command = 'npx skillpouch login sp_lt_BPBF8Y1HA4TqwVMbkypAodd4GqbnVhZw';
		expect(shortenCommand(command)).toBe('npx skillpouch login sp_lt_BPBF…VhZw');
	});
});
