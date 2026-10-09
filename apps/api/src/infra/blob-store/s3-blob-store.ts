// SPDX-License-Identifier: AGPL-3.0-only
/**
 * S3-compatible blob driver (Cloudflare R2, AWS S3, MinIO, Garage): objects
 * live at `<prefix><sa>/<pouch>/<blob_id-hex>` in one bucket, addressed
 * path-style (`<endpoint>/<bucket>/<key>`). Requests are signed with SigV4.
 *
 * Blob ids are content hashes, so a write that finds the object already
 * there is a success: `If-None-Match: *` keeps the first copy.
 */
import { AwsClient } from 'aws4fetch';
import { mapLimited } from '../../lib/map-limited';
import { assertValidKey, type BlobKey, type BlobStore } from './blob-store';

export interface S3Options {
	/** `https://<account>.r2.cloudflarestorage.com` for R2. */
	endpoint: string;
	bucket: string;
	/** `auto` for R2. */
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** Optional key prefix, e.g. `blobs/`, to share a bucket. */
	prefix?: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
}

const DELETE_CONCURRENCY = 16;
const LIST_PAGE = 1000;

export class S3BlobStore implements BlobStore {
	private readonly client: AwsClient;
	private readonly base: string;
	private readonly prefix: string;
	private readonly send: typeof fetch;
	private readonly timeoutMs: number;

	constructor(options: S3Options) {
		this.client = new AwsClient({
			accessKeyId: options.accessKeyId,
			secretAccessKey: options.secretAccessKey,
			region: options.region,
			service: 's3',
		});
		this.base = `${options.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(options.bucket)}`;
		this.prefix = options.prefix ?? '';
		this.send = options.fetch ?? fetch;
		this.timeoutMs = options.timeoutMs ?? 30_000;
	}

	async put(key: BlobKey, body: Uint8Array): Promise<void> {
		const response = await this.request('PUT', this.keyOf(key), {
			body,
			headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
		});
		// 412: already stored. 409: a parallel write of the same object won.
		if (response.status === 412 || response.status === 409) return;
		await expectOk(response, 'put');
	}

	async get(key: BlobKey): Promise<Buffer | null> {
		const response = await this.request('GET', this.keyOf(key));
		if (response.status === 404) return null;
		await expectOk(response, 'get');
		return Buffer.from(await response.arrayBuffer());
	}

	async has(key: BlobKey): Promise<boolean> {
		const response = await this.request('HEAD', this.keyOf(key));
		if (response.status === 404) return false;
		await expectOk(response, 'head');
		return true;
	}

	async delete(key: BlobKey): Promise<void> {
		const response = await this.request('DELETE', this.keyOf(key));
		if (response.status === 404) return;
		await expectOk(response, 'delete');
	}

	async deletePouch(storageAccountId: string, pouchId: string): Promise<void> {
		assertValidKey({ storageAccountId, pouchId, blobIdHex: '0'.repeat(64) });
		const prefix = `${this.prefix}${storageAccountId}/${pouchId}/`;
		let token: string | undefined;
		do {
			const page = await this.list(prefix, token);
			await mapLimited(page.keys, DELETE_CONCURRENCY, async (key) => {
				const response = await this.request('DELETE', key);
				if (response.status !== 404) await expectOk(response, 'delete');
			});
			token = page.next;
		} while (token);
	}

	private keyOf(key: BlobKey): string {
		assertValidKey(key);
		return `${this.prefix}${key.storageAccountId}/${key.pouchId}/${key.blobIdHex}`;
	}

	private async list(
		prefix: string,
		token?: string,
	): Promise<{ keys: string[]; next: string | undefined }> {
		const query = new URLSearchParams({
			'list-type': '2',
			prefix,
			'max-keys': String(LIST_PAGE),
		});
		if (token) query.set('continuation-token', token);
		const response = await this.request('GET', '', undefined, query);
		await expectOk(response, 'list');
		const xml = await response.text();
		const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) =>
			unescapeXml(match[1]!),
		);
		const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
		const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
		return { keys, next: truncated && next ? unescapeXml(next) : undefined };
	}

	private async request(
		method: string,
		key: string,
		init: { body?: Uint8Array; headers?: Record<string, string> } = {},
		query?: URLSearchParams,
	): Promise<Response> {
		const path = key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : '';
		const url = `${this.base}${path}${query ? `?${query}` : ''}`;
		const signed = await this.client.sign(url, {
			method,
			...(init.headers ? { headers: init.headers } : {}),
			...(init.body ? { body: init.body as Uint8Array<ArrayBuffer> } : {}),
		});
		return this.send(signed, { signal: AbortSignal.timeout(this.timeoutMs) });
	}
}

async function expectOk(response: Response, action: string): Promise<void> {
	if (response.ok) return;
	const text = await response.text().catch(() => '');
	const code = /<Code>([^<]*)<\/Code>/.exec(text)?.[1];
	throw new Error(`blob ${action} failed: ${response.status}${code ? ` ${code}` : ''}`);
}

function unescapeXml(text: string): string {
	return text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}
