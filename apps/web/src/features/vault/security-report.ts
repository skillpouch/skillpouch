// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When something the server sent fails verification — a signature, the
 * roster chain, a ciphertext, a blob id, a key envelope — the data is never
 * used, and the failure is reported (`POST /v1/security/reports`) so the
 * operator is paged: an honest server never causes one.
 *
 * Each distinct failure is reported once per page; a wrong secret is the
 * user's typo, not tampering, and is never reported.
 */
import { CryptoError, type CryptoErrorKind } from '@skillpouch/crypto';
import { api } from '@/lib/api/client';

const REPORTED_KINDS: ReadonlySet<CryptoErrorKind> = new Set([
	'signature_invalid',
	'roster_fork',
	'roster_rollback',
	'aead_failure',
	'blob_id_mismatch',
	'envelope_mismatch',
]);

const sent = new Set<string>();

export interface ReportContext {
	/** What was being verified: `roster`, `key_envelopes`, `revision`, `blob`… */
	where: string;
	pouchId?: string;
}

export function reportTamper(error: unknown, context: ReportContext): void {
	if (!(error instanceof CryptoError) || !REPORTED_KINDS.has(error.kind)) return;
	const key = `${error.kind}|${context.pouchId ?? ''}|${error.message}`;
	if (sent.has(key)) return;
	sent.add(key);
	api.post('/v1/security/reports', {
		kind: error.kind,
		...(context.pouchId ? { pouch_id: context.pouchId } : {}),
		details: { where: context.where, message: error.message.slice(0, 200) },
	}).catch(() => sent.delete(key));
}

/** Runs `work`; a verification failure it throws is reported, then rethrown. */
export async function reportingTamper<T>(
	context: ReportContext,
	work: () => Promise<T>,
): Promise<T> {
	try {
		return await work();
	} catch (error) {
		reportTamper(error, context);
		throw error;
	}
}

/** Forgets what was reported (another account signs in). */
export function resetTamperReports(): void {
	sent.clear();
}
