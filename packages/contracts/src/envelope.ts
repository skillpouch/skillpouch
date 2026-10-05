// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { errorCodeList } from './errors/codes';

/**
 * Response envelope (plan 17 §2). Every JSON response is either
 * `{ ok: true, data, meta }` or `{ ok: false, error, meta }`.
 */
export const ResponseMeta = z.object({
	request_id: z.string(),
	next_cursor: z.string().nullable().optional(),
});
export type ResponseMeta = z.infer<typeof ResponseMeta>;

export function successEnvelope<T extends z.ZodType>(data: T) {
	return z.object({ ok: z.literal(true), data, meta: ResponseMeta });
}

export const ErrorBody = z.object({
	code: z.enum(errorCodeList as [string, ...string[]]),
	status: z.number().int(),
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional(),
	retryable: z.boolean(),
	docs_url: z.url(),
});

export const ErrorEnvelope = z.object({
	ok: z.literal(false),
	error: ErrorBody,
	meta: ResponseMeta,
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

/** Empty success payload for actions that return nothing interesting. */
export const Empty = z.object({});
