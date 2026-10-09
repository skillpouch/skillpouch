// SPDX-License-Identifier: AGPL-3.0-only
/**
 * API errors. Code paths branch on `code` (from the contracts registry),
 * never on the message. `describeError` turns any thrown value into a
 * sentence that can be shown to the user.
 */
import type { ErrorCode } from '@skillpouch/contracts';
import { CryptoError } from '@skillpouch/crypto';

export class ApiError extends Error {
	constructor(
		readonly code: ErrorCode | 'network_error' | (string & {}),
		readonly status: number,
		message: string,
		readonly details: Record<string, unknown> = {},
		readonly retryable = false,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export function networkError(cause: unknown): ApiError {
	const error = new ApiError(
		'network_error',
		0,
		'Can’t reach SkillPouch. Check your connection and try again.',
		{},
		true,
	);
	error.cause = cause;
	return error;
}

export function isApiError(error: unknown, code?: string): error is ApiError {
	return error instanceof ApiError && (code === undefined || error.code === code);
}

/** Friendlier wording for the errors people actually run into in the web app. */
const MESSAGES: Partial<Record<string, string>> = {
	unauthenticated: 'Your session ended. Sign in again.',
	quota_exceeded: 'You’re out of storage. Free up space or upgrade.',
	pouch_limit_reached: 'Your plan’s pouch limit is reached.',
	last_pouch: 'You can’t delete your only pouch.',
	pouch_locked: 'This pouch is locked on your current plan.',
	rate_limited: 'Too many attempts. Wait a moment and try again.',
	unlock_rate_limited: 'Too many unlock attempts. Try again later or use your Recovery Key.',
	step_up_required: 'For your security, sign in again to do this.',
	maintenance_write_pause: 'SkillPouch is under short maintenance. Try again in a minute.',
	connect_token_invalid: 'This token expired or was already used.',
	share_unavailable: 'This link no longer works.',
};

export function describeError(error: unknown): string {
	if (error instanceof ApiError) return MESSAGES[error.code] ?? error.message;
	if (error instanceof CryptoError) {
		return error.kind === 'wrong_secret'
			? error.message
			: 'Something about this data doesn’t verify. It was not opened.';
	}
	if (error instanceof Error && error.message) return error.message;
	return 'Something went wrong.';
}
