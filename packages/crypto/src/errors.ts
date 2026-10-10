// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every verification or decryption failure surfaces as a `CryptoError` with
 * a stable `kind`. The kinds match the client security report the web app
 * sends to the API (`POST /v1/security/reports`), so a failure can be
 * reported without translating it.
 */
export type CryptoErrorKind =
	| 'signature_invalid'
	| 'roster_fork'
	| 'roster_rollback'
	| 'revision_rollback'
	| 'aead_failure'
	| 'blob_id_mismatch'
	| 'envelope_mismatch'
	| 'format_unsupported'
	| 'wrong_secret';

export class CryptoError extends Error {
	constructor(
		readonly kind: CryptoErrorKind,
		message: string,
	) {
		super(message);
		this.name = 'CryptoError';
	}
}

/** Kinds that mean "someone tampered with data" rather than "user typed the wrong secret". */
export function isTamperSignal(error: unknown): error is CryptoError {
	return error instanceof CryptoError && error.kind !== 'wrong_secret';
}
