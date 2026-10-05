// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `buildServer(deps)` assembles the HTTP API (plan 06). Used by `main.ts` and
 * by every test, so tests exercise exactly the production wiring.
 */
import { randomBytes } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Limits } from '@skillpouch/contracts';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Deps } from './deps';
import { envelopePlugin } from './http/envelope';
import { envelopeSerializerCompiler } from './http/serialization';
import { registerSwagger } from './http/swagger';
import type { ZodApp } from './http/zod-app';
import { registerModules } from './modules/routes';
import type { HealthState } from './modules/health/health.routes';
import { registerAuthentication } from './security/authenticate';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface BuiltServer {
	app: ZodApp;
	health: HealthState;
}

export async function buildServer(deps: Deps): Promise<BuiltServer> {
	const app = Fastify({
		loggerInstance: deps.log as FastifyBaseLogger,
		trustProxy: deps.env.TRUST_PROXY,
		bodyLimit: 1024 * 1024,
		requestIdHeader: false,
		genReqId: (request) => {
			const incoming = request.headers['x-request-id'];
			return typeof incoming === 'string' && REQUEST_ID.test(incoming)
				? incoming
				: `req_${randomBytes(12).toString('base64url')}`;
		},
	}).withTypeProvider<ZodTypeProvider>();

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(envelopeSerializerCompiler);

	// Blob uploads are raw ciphertext.
	app.addContentTypeParser(
		'application/octet-stream',
		{ parseAs: 'buffer', bodyLimit: Limits.blobBatchMaxBytes + 64 * 1024 },
		(_request, body, done) => done(null, body),
	);

	await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
	await app.register(cors, {
		origin: [deps.env.WEB_ORIGIN],
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
		allowedHeaders: [
			'Content-Type',
			'Authorization',
			'DPoP',
			'Skillpouch-Client',
			'Skillpouch-Signature',
			'Skillpouch-Ciphertext-Hash',
			'Idempotency-Key',
			'Last-Event-ID',
		],
		exposedHeaders: ['DPoP-Nonce', 'Skillpouch-Request-Id', 'Skillpouch-Min-Cli', 'Retry-After'],
	});
	await app.register(envelopePlugin);
	await registerSwagger(app, deps.env);
	await registerAuthentication(app, deps);

	const health: HealthState = { draining: false };
	await registerModules(app, deps, health);
	return { app, health };
}
