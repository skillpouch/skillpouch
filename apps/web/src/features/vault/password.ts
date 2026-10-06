// SPDX-License-Identifier: AGPL-3.0-only
/** Master-password stretching, in a worker when the platform has one. */
import { passwordSecret, type KdfParams } from '@skillpouch/crypto';
import type { PasswordJob } from './password.worker';

export async function derivePasswordSecret(job: PasswordJob): Promise<Uint8Array> {
	if (typeof Worker === 'undefined') {
		return passwordSecret(job.password, job.salt, job.params, job.pepper);
	}
	const worker = new Worker(new URL('./password.worker.ts', import.meta.url), { type: 'module' });
	try {
		return await new Promise<Uint8Array>((resolve, reject) => {
			worker.onmessage = (
				event: MessageEvent<
					{ ok: true; secret: Uint8Array } | { ok: false; message: string }
				>,
			) =>
				event.data.ok ? resolve(event.data.secret) : reject(new Error(event.data.message));
			worker.onerror = (event) =>
				reject(new Error(event.message || 'password worker failed'));
			worker.postMessage(job);
		});
	} finally {
		worker.terminate();
	}
}

export type { KdfParams };
