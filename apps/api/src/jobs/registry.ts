// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every background job, its schedule and handler. The worker
 * process registers them with pg-boss; tests call the handlers directly.
 * Handlers are idempotent and safe to run concurrently on several workers.
 */
import type { Deps } from '../deps';
import {
	applyPendingBillingEvents,
	reconcileSubscriptions,
} from '../modules/billing/billing.service';
import { syncPlansFromProvider } from '../modules/billing/plan-sync';
import { gcBlobs, gcPending } from './gc';
import {
	expireBrowserTrust,
	expireCliAuthRequests,
	expireShares,
	flagStaleDevices,
	purgeEphemeral,
	recalcUsage,
	refreshAllEntitlements,
	verifyBlobSample,
} from './housekeeping';
import { purgeDeletedAccounts, purgeDeletedPouches, resetEncryptedAccounts } from './purge';
import { expireRevisions, purgeEvents, purgeReceipts } from './retention';

export interface JobDefinition {
	name: string;
	/** Cron (UTC). */
	cron: string;
	run: (deps: Deps) => Promise<unknown>;
}

export const JOBS: JobDefinition[] = [
	{ name: 'retention.revisions', cron: '7 * * * *', run: expireRevisions },
	{ name: 'retention.events', cron: '17 3 * * *', run: purgeEvents },
	{ name: 'retention.receipts', cron: '27 3 * * *', run: purgeReceipts },
	{ name: 'gc.blobs', cron: '37 * * * *', run: gcBlobs },
	{ name: 'gc.pending', cron: '47 * * * *', run: gcPending },
	{ name: 'usage.recalc', cron: '15 4 * * *', run: recalcUsage },
	{ name: 'blobs.verify', cron: '30 5 * * 0', run: (deps) => verifyBlobSample(deps) },
	{ name: 'cli-auth.expire', cron: '*/5 * * * *', run: expireCliAuthRequests },
	{ name: 'shares.expire', cron: '*/15 * * * *', run: expireShares },
	{ name: 'browsers.trust-expire', cron: '12 * * * *', run: expireBrowserTrust },
	{ name: 'housekeeping.ephemeral', cron: '*/10 * * * *', run: purgeEphemeral },
	{ name: 'pouch.delete', cron: '22 * * * *', run: purgeDeletedPouches },
	{ name: 'account.reset-encryption', cron: '32 * * * *', run: resetEncryptedAccounts },
	{ name: 'account.delete', cron: '42 * * * *', run: purgeDeletedAccounts },
	{ name: 'entitlements.refresh', cron: '0 2 * * *', run: refreshAllEntitlements },
	{ name: 'billing.apply', cron: '*/5 * * * *', run: applyPendingBillingEvents },
	{ name: 'billing.plans', cron: '3 * * * *', run: syncPlansFromProvider },
	{ name: 'billing.reconcile', cron: '45 2 * * *', run: reconcileSubscriptions },
	{ name: 'devices.stale', cron: '50 2 * * *', run: flagStaleDevices },
];
