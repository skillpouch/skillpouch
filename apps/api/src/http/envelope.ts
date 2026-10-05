// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Response envelope + global error handler (plan 17 §2).
 *
 * Handlers return plain data; `preSerialization` wraps it as
 * `{ ok: true, data, meta }`. Failures are `AppError`s (or framework errors),
 * mapped here to `{ ok: false, error, meta }` with the registry's status.
 */
import { ErrorCodes, errorDocsUrl, type ErrorCode } from '@skillpouch/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError, isAppError } from './app-error';
import { NEXT_CURSOR } from './serialization';

export function errorBody(
	code: ErrorCode,
	requestId: string,
	details?: Record<string, unknown>,
	message?: string,
) {
	const def = ErrorCodes[code];
	return {
		ok: false as const,
		error: {
			code,
			status: def.status,
			message: message ?? def.message,
			...(details === undefined ? {} : { details }),
			retryable: def.retryable,
			docs_url: errorDocsUrl(code),
		},
		meta: { request_id: requestId },
	};
}

/** Maps any thrown value to an AppError (unknown errors become `internal_error`). */
export function toAppError(error: unknown): { appError: AppError; unexpected: boolean } {
	if (isAppError(error)) return { appError: error, unexpected: false };
	if (hasZodFastifySchemaValidationErrors(error)) {
		const issues = error.validation.map((issue) => ({
			path: `${error.validationContext ?? 'body'}${issue.instancePath.replaceAll('/', '.')}`,
			message: issue.message ?? 'invalid',
		}));
		return { appError: new AppError('validation_failed', { issues }), unexpected: false };
	}
	const fastifyError = error as Partial<FastifyError>;
	switch (fastifyError.code) {
		case 'FST_ERR_CTP_BODY_TOO_LARGE':
			return { appError: new AppError('payload_too_large'), unexpected: false };
		case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
		case 'FST_ERR_CTP_EMPTY_JSON_BODY':
		case 'FST_ERR_CTP_INVALID_JSON_BODY':
		case 'FST_ERR_VALIDATION':
			return {
				appError: new AppError('validation_failed', { reason: fastifyError.message }),
				unexpected: false,
			};
		default:
			break;
	}
	if (error instanceof SyntaxError && fastifyError.statusCode === 400) {
		return { appError: new AppError('validation_failed', { reason: 'invalid JSON' }), unexpected: false };
	}
	return { appError: new AppError('internal_error', undefined, { cause: error }), unexpected: true };
}

export function sendError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
	const { appError, unexpected } = toAppError(error);
	if (unexpected) {
		request.log.error({ err: error }, 'unhandled error');
	} else if (appError.status >= 500) {
		request.log.warn({ code: appError.code }, 'request failed');
	}
	for (const [name, value] of Object.entries(appError.headers ?? {})) reply.header(name, value);
	return reply
		.code(appError.status)
		.type('application/json; charset=utf-8')
		.send(errorBody(appError.code, request.id, appError.details));
}

export const envelopePlugin = fp(async (app: FastifyInstance) => {
	app.addHook('preSerialization', async (request, reply, payload) => {
		const config = request.routeOptions.config;
		// Plugin routes without config.auth (Swagger UI under /docs) are never wrapped.
		if (reply.statusCode >= 400 || config?.raw || !config?.auth) return payload;
		if (payload !== null && typeof payload === 'object' && NEXT_CURSOR in payload) {
			const nextCursor = (payload as Record<symbol, unknown>)[NEXT_CURSOR] as string | null;
			return { ok: true, data: payload, meta: { request_id: request.id, next_cursor: nextCursor } };
		}
		return { ok: true, data: payload ?? {}, meta: { request_id: request.id } };
	});

	app.addHook('onSend', async (request, reply) => {
		reply.header('Skillpouch-Request-Id', request.id);
	});

	app.setErrorHandler((error, request, reply) => sendError(request, reply, error));

	app.setNotFoundHandler((request, reply) =>
		sendError(request, reply, new AppError('not_found', { route: request.method })),
	);
});
