// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The central error-code registry. This object is the single
 * source of truth for every error the API can return:
 *
 * - wire codes are `lower_snake_case` and are never renamed or reused;
 * - `status` is the HTTP status the API answers with;
 * - `retryable` tells clients whether retrying the same request can succeed;
 * - `message` is a short default text — clients branch on `code`, never on it.
 *
 * Adding a code: add it here (grouped by module), give it a `details` schema in
 * `details.ts` if it carries details, and document it in `docs/errors.md`
 * (the docs test fails otherwise).
 */
export interface ErrorDef {
	readonly status: number;
	readonly retryable: boolean;
	readonly message: string;
	readonly deprecated?: boolean;
}

export const ErrorCodes = {
	// --- authentication & sessions -------------------------------------------
	unauthenticated: { status: 401, retryable: false, message: 'Sign in required.' },
	session_unbound: {
		status: 401,
		retryable: false,
		message: 'Bind this browser session to its key first.',
	},
	session_already_bound: {
		status: 409,
		retryable: false,
		message: 'This session is already bound to a key.',
	},
	token_invalid: { status: 401, retryable: false, message: 'Invalid or expired access token.' },
	refresh_invalid: { status: 401, retryable: false, message: 'Invalid refresh token.' },
	refresh_reused: {
		status: 401,
		retryable: false,
		message: 'Refresh token reuse detected; this device was revoked.',
	},
	device_revoked: { status: 401, retryable: false, message: 'This device was revoked.' },
	device_suspended: { status: 403, retryable: false, message: 'This device is suspended.' },
	account_suspended: { status: 403, retryable: false, message: 'This account is suspended.' },
	dpop_invalid: { status: 401, retryable: false, message: 'Invalid proof of possession.' },
	dpop_nonce_required: {
		status: 401,
		retryable: true,
		message: 'Retry with the server nonce.',
	},
	dpop_replay: { status: 401, retryable: false, message: 'Proof of possession was replayed.' },
	signature_invalid: { status: 401, retryable: false, message: 'Request signature is invalid.' },
	csrf_rejected: { status: 403, retryable: false, message: 'Cross-site request rejected.' },
	step_up_required: { status: 403, retryable: false, message: 'Sign in again to continue.' },
	forbidden: { status: 403, retryable: false, message: 'Not allowed.' },

	// --- CLI authorization --------------------------------------------
	cli_auth_expired: { status: 410, retryable: false, message: 'This login request expired.' },
	cli_auth_denied: { status: 403, retryable: false, message: 'This login request was denied.' },
	cli_auth_final: {
		status: 409,
		retryable: false,
		message: 'This login request was already handled.',
	},
	connect_token_invalid: {
		status: 401,
		retryable: false,
		message:
			'This connect token is invalid, expired or already used. Create a new one on the web.',
	},
	pkce_invalid: { status: 401, retryable: false, message: 'PKCE verification failed.' },

	// --- roster / E2EE structure -----------------------------------------
	roster_exists: {
		status: 409,
		retryable: false,
		message: 'This account is already initialized.',
	},
	roster_missing: {
		status: 409,
		retryable: false,
		message: 'Finish account setup in the browser first.',
	},
	roster_conflict: {
		status: 409,
		retryable: true,
		message: 'The roster changed; fetch it and retry.',
	},
	roster_invalid: { status: 422, retryable: false, message: 'Roster statement is malformed.' },
	member_inactive: {
		status: 403,
		retryable: false,
		message: 'The signing member is not an active member.',
	},
	key_gen_invalid: { status: 422, retryable: false, message: 'Invalid key generation.' },
	unlock_not_ready: {
		status: 409,
		retryable: false,
		message: 'Master-password unlock is not set up for this account yet.',
	},
	unlock_rate_limited: {
		status: 429,
		retryable: true,
		message: 'Too many unlock attempts. Try again later or use your Recovery Key.',
	},
	unlock_grant_required: {
		status: 403,
		retryable: false,
		message: 'Prove the unlock secret first (master password or passkey).',
	},
	browser_trust_expired: {
		status: 403,
		retryable: false,
		message: 'This browser was not used for too long. Unlock it again.',
	},
	webauthn_invalid: {
		status: 400,
		retryable: false,
		message: 'The passkey response could not be verified.',
	},

	// --- pouches & sync (04, 16) -----------------------------------------------
	not_found: { status: 404, retryable: false, message: 'Not found.' },
	pouch_limit_reached: {
		status: 403,
		retryable: false,
		message: 'Pouch limit reached for your plan.',
	},
	pouch_read_only: { status: 409, retryable: false, message: 'This pouch is read-only.' },
	pouch_locked: {
		status: 409,
		retryable: false,
		message:
			'This pouch is locked because your plan includes fewer pouches. Choose the active pouch or upgrade on skillpouch.net.',
	},
	artifact_not_deleted: {
		status: 409,
		retryable: false,
		message: 'Delete the item first, then free its space.',
	},
	quota_exceeded: { status: 413, retryable: false, message: 'Storage quota exceeded.' },
	precondition_failed: {
		status: 412,
		retryable: false,
		message: 'Base revision is out of date.',
	},
	epoch_mismatch: {
		status: 409,
		retryable: false,
		message: 'Server restored; rebase required.',
	},
	cursor_expired: { status: 410, retryable: false, message: 'History expired; rebase required.' },
	operation_id_reused: {
		status: 409,
		retryable: false,
		message: 'Operation ID reused with a different body.',
	},
	blob_missing: { status: 422, retryable: false, message: 'Referenced blob not uploaded.' },
	blob_too_large: { status: 413, retryable: false, message: 'Blob exceeds the size limit.' },
	ciphertext_hash_mismatch: {
		status: 422,
		retryable: true,
		message: 'Upload corrupted in transit.',
	},
	envelope_invalid: {
		status: 422,
		retryable: false,
		message: 'Encrypted payload is malformed.',
	},
	snapshot_expired: {
		status: 410,
		retryable: false,
		message: 'Snapshot lease expired; start again.',
	},

	// --- billing & admin ---------------------------------------------------
	billing_unavailable: {
		status: 503,
		retryable: false,
		message: 'Billing is not configured.',
	},
	upstream_unavailable: {
		status: 502,
		retryable: true,
		message: 'An upstream service (e.g. GitHub) did not answer as expected.',
	},
	webhook_invalid: { status: 401, retryable: false, message: 'Webhook signature invalid.' },
	last_admin: { status: 409, retryable: false, message: 'The last admin cannot be demoted.' },

	// --- generic ----------------------------------------------------------------
	validation_failed: { status: 400, retryable: false, message: 'Invalid request.' },
	payload_too_large: { status: 413, retryable: false, message: 'Request body too large.' },
	rate_limited: { status: 429, retryable: true, message: 'Too many requests.' },
	maintenance_write_pause: {
		status: 503,
		retryable: true,
		message: 'Brief maintenance, retrying.',
	},
	internal_error: { status: 500, retryable: true, message: 'Something went wrong.' },
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ErrorCodes;

export const errorCodeList = Object.keys(ErrorCodes) as ErrorCode[];

export function isErrorCode(value: string): value is ErrorCode {
	return Object.hasOwn(ErrorCodes, value);
}

/** Public documentation page for an error code. */
export function errorDocsUrl(code: ErrorCode): string {
	return `https://docs.skillpouch.net/errors/${code}`;
}
