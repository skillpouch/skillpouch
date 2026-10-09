// SPDX-License-Identifier: AGPL-3.0-only
/** The S3 blob driver against an in-memory bucket, and copying a filesystem store into it. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyBlobs } from '../../src/infra/blob-store/copy-blobs';
import { FsBlobStore } from '../../src/infra/blob-store/fs-blob-store';
import { S3BlobStore } from '../../src/infra/blob-store/s3-blob-store';

const ACCOUNT = '01a1199b-9363-7871-9a8b-45bd1b7076a9';
const POUCH = '1bc28e69-0000-4000-8000-000000000001';
const OTHER_POUCH = '1bc28e69-0000-4000-8000-000000000002';

function key(n: number, pouchId = POUCH) {
	return { storageAccountId: ACCOUNT, pouchId, blobIdHex: n.toString(16).padStart(64, '0') };
}

/** Just enough of S3 for the driver: objects, conditional PUT and paged ListObjectsV2. */
function fakeBucket(pageSize = 1000) {
	const objects = new Map<string, Uint8Array>();
	const seen: Request[] = [];
	const send = (async (input: Request) => {
		seen.push(input);
		const url = new URL(input.url);
		if (!url.pathname.startsWith('/bucket')) return new Response(null, { status: 404 });
		const name = decodeURIComponent(url.pathname.slice('/bucket/'.length));
		if (url.searchParams.get('list-type') === '2') {
			const prefix = url.searchParams.get('prefix') ?? '';
			const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
			// Like S3, the token is a position in key order, so deletes don't shift pages.
			const after = url.searchParams.get('continuation-token') ?? '';
			const rest = all.filter((k) => k > after);
			const page = rest.slice(0, pageSize);
			const more = rest.length > pageSize;
			const xml = `<ListBucketResult>${page.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${page.at(-1)}</NextContinuationToken>` : ''}</ListBucketResult>`;
			return new Response(xml, { status: 200 });
		}
		const object = objects.get(name);
		switch (input.method) {
			case 'PUT':
				if (input.headers.get('if-none-match') === '*' && object) {
					return new Response('<Error><Code>PreconditionFailed</Code></Error>', {
						status: 412,
					});
				}
				objects.set(name, new Uint8Array(await input.arrayBuffer()));
				return new Response(null, { status: 200 });
			case 'GET':
			case 'HEAD':
				return object
					? new Response(input.method === 'GET' ? Buffer.from(object) : null, {
							status: 200,
						})
					: new Response(null, { status: 404 });
			case 'DELETE':
				objects.delete(name);
				return new Response(null, { status: 204 });
			default:
				return new Response(null, { status: 405 });
		}
	}) as typeof fetch;
	const store = new S3BlobStore({
		endpoint: 'https://acct.r2.cloudflarestorage.com/',
		bucket: 'bucket',
		region: 'auto',
		accessKeyId: 'id',
		secretAccessKey: 'secret',
		fetch: send,
	});
	return { store, objects, seen };
}

describe('S3BlobStore', () => {
	it('stores, reads and deletes blobs with signed requests', async () => {
		const { store, objects, seen } = fakeBucket();
		await store.put(key(1), new Uint8Array([1, 2, 3]));
		expect([...objects.keys()]).toEqual([`${ACCOUNT}/${POUCH}/${key(1).blobIdHex}`]);
		expect(await store.has(key(1))).toBe(true);
		expect(await store.get(key(1))).toEqual(Buffer.from([1, 2, 3]));
		expect(await store.get(key(2))).toBeNull();
		expect(await store.has(key(2))).toBe(false);
		await store.delete(key(1));
		await store.delete(key(1));
		expect(objects.size).toBe(0);
		const auth = seen[0]!.headers.get('authorization')!;
		expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request/);
		expect(seen[0]!.url).toBe(
			`https://acct.r2.cloudflarestorage.com/bucket/${ACCOUNT}/${POUCH}/${key(1).blobIdHex}`,
		);
	});

	it('keeps the first copy when a blob is written twice', async () => {
		const { store, objects } = fakeBucket();
		await store.put(key(1), new Uint8Array([1]));
		await store.put(key(1), new Uint8Array([9]));
		expect([...objects.values()]).toEqual([new Uint8Array([1])]);
	});

	it('deletes every page of a pouch and nothing else', async () => {
		const { store, objects } = fakeBucket(3);
		for (let n = 1; n <= 8; n++) await store.put(key(n), new Uint8Array([n]));
		await store.put(key(1, OTHER_POUCH), new Uint8Array([1]));
		await store.deletePouch(ACCOUNT, POUCH);
		expect([...objects.keys()]).toEqual([`${ACCOUNT}/${OTHER_POUCH}/${key(1).blobIdHex}`]);
	});

	it('reports failures with the S3 error code', async () => {
		const failing = new S3BlobStore({
			endpoint: 'https://s3.example',
			bucket: 'b',
			region: 'auto',
			accessKeyId: 'id',
			secretAccessKey: 'secret',
			fetch: (async () =>
				new Response('<Error><Code>AccessDenied</Code></Error>', {
					status: 403,
				})) as typeof fetch,
		});
		await expect(failing.get(key(1))).rejects.toThrow('blob get failed: 403 AccessDenied');
	});

	it('refuses keys that could leave their tenant prefix', async () => {
		const { store } = fakeBucket();
		await expect(store.get({ ...key(1), pouchId: '../x' })).rejects.toThrow('invalid blob key');
	});
});

describe('copyBlobs', () => {
	it('copies a filesystem store into the bucket, and a second run copies nothing', async () => {
		const root = mkdtempSync(join(tmpdir(), 'sp-blobs-'));
		const source = new FsBlobStore(root);
		for (let n = 1; n <= 300; n++) await source.put(key(n), new Uint8Array([n % 256]));
		await source.put(key(7, OTHER_POUCH), new Uint8Array([7]));
		const { store, objects } = fakeBucket();

		const first = await copyBlobs(root, store);
		expect(first).toEqual({ copied: 301, skipped: 0 });
		expect(await store.get(key(300))).toEqual(Buffer.from([300 % 256]));
		expect(await store.get(key(7, OTHER_POUCH))).toEqual(Buffer.from([7]));

		const again = await copyBlobs(root, store);
		expect(again).toEqual({ copied: 0, skipped: 301 });
		expect(objects.size).toBe(301);
	});
});
