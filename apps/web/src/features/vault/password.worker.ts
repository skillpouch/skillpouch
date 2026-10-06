// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Argon2id runs here, off the main thread: 64 MiB and three passes take a
 * second or two, and the page must stay responsive meanwhile.
 */
import { passwordSecret, type KdfParams } from '@skillpouch/crypto';

export interface PasswordJob {
	password: string;
	salt: Uint8Array;
	params: KdfParams;
	pepper: Uint8Array;
}

self.onmessage = async (event: MessageEvent<PasswordJob>) => {
	const { password, salt, params, pepper } = event.data;
	try {
		const secret = await passwordSecret(password, salt, params, pepper);
		self.postMessage({ ok: true, secret }, { transfer: [secret.buffer] });
	} catch (error) {
		self.postMessage({ ok: false, message: (error as Error).message });
	}
};
