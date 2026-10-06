// SPDX-License-Identifier: AGPL-3.0-only
/**
 * pino JSON logger. Secrets and bodies never reach the logs:
 * credentials, cookies, DPoP proofs, signatures and token fields are redacted.
 */
import pino from 'pino';
import type { Env } from '../config/env';

export function createLogger(env: Env, role: string): pino.Logger {
	return pino({
		level: env.LOG_LEVEL,
		base: { role, version: process.env.SKILLPOUCH_VERSION ?? 'dev' },
		redact: {
			paths: [
				'req.headers.authorization',
				'req.headers.cookie',
				'req.headers.dpop',
				'req.headers["skillpouch-signature"]',
				'res.headers["set-cookie"]',
				'*.token',
				'*.access_token',
				'*.refresh_token',
				'*.secret',
				'*.pepper',
				'body',
			],
			censor: '[redacted]',
		},
		...(env.NODE_ENV === 'development'
			? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
			: {}),
	});
}
