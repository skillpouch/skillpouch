// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stateless DPoP nonces (08 §3.2): `<bucket>.<HMAC(secret, bucket)>`, where a
 * bucket is a fixed time window. Valid for the current and the previous
 * bucket, so every API replica accepts every other replica's nonces without
 * shared state.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Limits } from '@skillpouch/contracts';

export class NonceService {
	private readonly bucketMs = Limits.dpopNonceBucketSeconds * 1000;

	constructor(
		private readonly secret: string,
		private readonly now: () => Date = () => new Date(),
	) {}

	current(): string {
		return this.forBucket(this.bucket());
	}

	isValid(nonce: unknown): boolean {
		if (typeof nonce !== 'string') return false;
		const [bucketText] = nonce.split('.', 1);
		const bucket = Number(bucketText);
		const now = this.bucket();
		if (!Number.isInteger(bucket) || (bucket !== now && bucket !== now - 1)) return false;
		const expected = Buffer.from(this.forBucket(bucket));
		const given = Buffer.from(nonce);
		return expected.length === given.length && timingSafeEqual(expected, given);
	}

	private bucket(): number {
		return Math.floor(this.now().getTime() / this.bucketMs);
	}

	private forBucket(bucket: number): string {
		const mac = createHmac('sha256', this.secret)
			.update(`dpop-nonce:${bucket}`)
			.digest('base64url');
		return `${bucket}.${mac.slice(0, 22)}`;
	}
}
