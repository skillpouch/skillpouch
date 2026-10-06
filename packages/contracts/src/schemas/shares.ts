// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Share links. The browser seals one item with a random key that only exists
 * in the link fragment (`https://skillpouch.net/s/<id>#key=…`), so the server
 * stores and serves ciphertext it cannot open.
 */
import { z } from 'zod';
import { Limits } from '../limits';
import { B64Url, Timestamp, Uuid, b64urlMax } from './common';

export const ShareExpiry = z.enum(['1d', '7d', '30d', 'never']);

export const ShareCreate = z.strictObject({
	/** Chosen by the browser: the id is part of the sealed bundle's AAD. */
	id: Uuid,
	/** Sealed share bundle. */
	bundle: b64urlMax(Limits.shareMaxBytes),
	/** Kind + name sealed with the pouch metadata key, for the Shared links page. */
	label_enc: b64urlMax(Limits.shareLabelMaxBytes),
	expires: ShareExpiry.default('7d'),
	/** The first recipient to add it to a pouch uses the link up. */
	one_time: z.boolean().default(false),
});

/**
 * active   — can be opened;
 * expired  — past `expires_at`;
 * revoked  — the owner revoked it;
 * consumed — a one-time link that was already used.
 */
export const ShareState = z.enum(['active', 'expired', 'revoked', 'consumed']);

export const Share = z.object({
	id: Uuid,
	pouch_id: Uuid,
	label_enc: B64Url,
	state: ShareState,
	one_time: z.boolean(),
	size: z.number().int(),
	views: z.number().int(),
	imports: z.number().int(),
	expires_at: Timestamp.nullable(),
	revoked_at: Timestamp.nullable(),
	last_imported_at: Timestamp.nullable(),
	created_at: Timestamp,
});

export const ShareList = z.object({ shares: z.array(Share) });

/** What anyone holding the link may learn before opening it. */
export const PublicShare = z.object({
	id: Uuid,
	state: ShareState,
	one_time: z.boolean(),
	size: z.number().int(),
	expires_at: Timestamp.nullable(),
	created_at: Timestamp,
});

/** A one-time link hands out its bundle exactly once, to a signed-in recipient. */
export const ShareClaim = z.object({ bundle: B64Url });
