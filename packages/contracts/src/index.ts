// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @skillpouch/contracts — everything that crosses the wire between the API,
 * the web app and the CLI. Plan references: 17 (envelope, errors), 04 (sync),
 * 15 (E2EE formats), 08 (auth).
 */
export * from './errors/codes';
export * from './envelope';
export * from './limits';
export * from './canonical-json';
export * from './encoding';
export * from './sealed';
export * from './schemas/common';
export * from './schemas/roster';
export * from './schemas/auth';
export * from './schemas/account';
export * from './schemas/sync';
export * from './schemas/admin';
