// SPDX-License-Identifier: AGPL-3.0-only
import { ErrorCodes, type ErrorCode } from '@skillpouch/contracts';

/**
 * The only way route and service code fails. The error-handler
 * plugin turns it into the error envelope; the HTTP status comes from the
 * central registry, so it can never disagree with the code.
 */
export class AppError extends Error {
	readonly code: ErrorCode;
	readonly status: number;
	readonly details: Record<string, unknown> | undefined;
	/** Extra response headers, e.g. `DPoP-Nonce` or `Retry-After`. */
	readonly headers: Record<string, string> | undefined;

	constructor(
		code: ErrorCode,
		details?: Record<string, unknown>,
		options?: { headers?: Record<string, string>; cause?: unknown },
	) {
		super(
			ErrorCodes[code].message,
			options?.cause === undefined ? undefined : { cause: options.cause },
		);
		this.name = 'AppError';
		this.code = code;
		this.status = ErrorCodes[code].status;
		this.details = details;
		this.headers = options?.headers;
	}
}

export function isAppError(error: unknown): error is AppError {
	return error instanceof AppError;
}
