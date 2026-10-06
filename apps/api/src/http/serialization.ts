// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Envelope-aware Zod serialization (plan 17 §2).
 *
 * Routes declare the *data* schema of a successful response and handlers
 * return plain data, so handler types stay simple. This module makes the
 * serializer and the OpenAPI document see the full envelope
 * `{ ok: true, data, meta }` for every 2xx response, except schemas marked
 * with `rawSchema()` (documented exceptions such as health checks).
 */
import { ResponseMeta } from '@skillpouch/contracts';
import type { FastifySchema, FastifySerializerCompiler } from 'fastify';
import { jsonSchemaTransform, serializerCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';

const rawSchemas = new WeakSet<object>();

/** Marks a response schema as "not wrapped in the envelope". */
export function rawSchema<T extends z.ZodType>(schema: T): T {
	rawSchemas.add(schema);
	return schema;
}

function wrap(schema: unknown, status: string): unknown {
	if (!(schema instanceof z.ZodType) || rawSchemas.has(schema) || !status.startsWith('2'))
		return schema;
	return z.object({ ok: z.literal(true), data: schema, meta: ResponseMeta });
}

export const envelopeSerializerCompiler: FastifySerializerCompiler<z.ZodType> = (routeSchema) =>
	serializerCompiler({
		...routeSchema,
		schema: wrap(routeSchema.schema, String(routeSchema.httpStatus)) as z.ZodType,
	});

/** Swagger transform: documents the wrapped envelope for 2xx responses. */
export const envelopeJsonSchemaTransform: typeof jsonSchemaTransform = (input) => {
	const schema = input.schema as FastifySchema & { response?: Record<string, unknown> };
	if (schema?.response) {
		const response = Object.fromEntries(
			Object.entries(schema.response).map(([status, value]) => [status, wrap(value, status)]),
		);
		return jsonSchemaTransform({ ...input, schema: { ...schema, response } });
	}
	return jsonSchemaTransform(input);
};

/** Paginated data: `{ items }` plus a cursor the envelope moves to `meta.next_cursor`. */
export const NEXT_CURSOR = Symbol('next_cursor');

export function paginated<T>(items: T[], nextCursor: string | null): { items: T[] } {
	return Object.assign({ items }, { [NEXT_CURSOR]: nextCursor });
}
