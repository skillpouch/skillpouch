// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one HTTP client of the web app.
 *
 * - Same origin as the API (`/v1/...`); the session cookie rides along.
 * - Every request is signed with a DPoP proof once this browser has a key.
 *   The server rotates nonces; a stale one is retried once transparently.
 * - Writes carry `Skillpouch-Client: web/...` (the API's CSRF check).
 * - JSON responses are unwrapped from `{ ok, data }`; errors become `ApiError`.
 */
import { ApiError, networkError } from './errors';
import { createDpopProof, type DpopKey } from './dpop';

const CLIENT_HEADER = `web/${import.meta.env.VITE_APP_VERSION ?? '0.1.0'}`;

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
	query?: Record<string, QueryValue>;
	/** JSON body; ignored when `bytes` is set. */
	body?: unknown;
	/** Raw request body (`application/octet-stream`). */
	bytes?: Uint8Array;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

let dpopKey: DpopKey | null = null;
let nonce: string | null = null;

/** Called once the browser key is loaded (or cleared on sign-out). */
export function setDpopKey(key: DpopKey | null): void {
	dpopKey = key;
}

export function hasDpopKey(): boolean {
	return dpopKey !== null;
}

export function buildPath(path: string, query?: Record<string, QueryValue>): string {
	if (!query) return path;
	const params = new URLSearchParams();
	for (const [name, value] of Object.entries(query)) {
		if (value !== undefined && value !== null) params.set(name, String(value));
	}
	const text = params.toString();
	return text ? `${path}?${text}` : path;
}

/** Headers for a request made outside `fetchApi` (the SSE stream reads its own body). */
export async function signedHeaders(method: string, path: string): Promise<Headers> {
	const headers = new Headers({ 'skillpouch-client': CLIENT_HEADER });
	if (dpopKey) {
		const url = `${location.origin}${path.split('?')[0]}`;
		headers.set('dpop', await createDpopProof(dpopKey, method, url, nonce));
	}
	return headers;
}

/** Remembers the newest server nonce from any response. */
export function rememberNonce(response: Response): void {
	const value = response.headers.get('dpop-nonce');
	if (value) nonce = value;
}

async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
	const headers = await signedHeaders(method, path);
	for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
	let body: BodyInit | undefined;
	if (options.bytes) {
		body = options.bytes as Uint8Array<ArrayBuffer>;
		headers.set('content-type', 'application/octet-stream');
	} else if (options.body !== undefined) {
		body = JSON.stringify(options.body);
		headers.set('content-type', 'application/json');
	}
	try {
		const response = await fetch(path, {
			method,
			headers,
			credentials: 'same-origin',
			...(body === undefined ? {} : { body }),
			...(options.signal ? { signal: options.signal } : {}),
		});
		rememberNonce(response);
		return response;
	} catch (error) {
		if ((error as Error).name === 'AbortError') throw error;
		throw networkError(error);
	}
}

async function readError(response: Response): Promise<ApiError> {
	try {
		const json = (await response.json()) as {
			error?: {
				code: string;
				message: string;
				details?: Record<string, unknown>;
				retryable?: boolean;
			};
		};
		if (json.error) {
			return new ApiError(
				json.error.code,
				response.status,
				json.error.message,
				json.error.details ?? {},
				json.error.retryable ?? false,
			);
		}
	} catch {
		// Not JSON (proxy error page, network middlebox): fall through.
	}
	return new ApiError('internal_error', response.status, response.statusText || 'Request failed');
}

/** Resolves true once the user signed in again (see `features/session/step-up`). */
type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

export function setStepUpHandler(handler: StepUpHandler | null): void {
	stepUpHandler = handler;
}

/**
 * Sends a request, retrying once when the server asks for a fresh DPoP nonce,
 * and once more after a fresh sign-in when the action needs one. Step-up is
 * checked before any handler runs, so the retry never repeats a side effect.
 */
export async function fetchApi(
	method: string,
	path: string,
	options: RequestOptions = {},
): Promise<Response> {
	const url = buildPath(path, options.query);
	let response = await send(method, url, options);
	if (!response.ok) {
		const error = await readError(response.clone());
		if (error.code === 'dpop_nonce_required') response = await send(method, url, options);
	}
	if (!response.ok && stepUpHandler) {
		const error = await readError(response.clone());
		if (error.code === 'step_up_required' && (await stepUpHandler())) {
			response = await send(method, url, options);
		}
	}
	if (!response.ok) throw await readError(response);
	return response;
}

async function json<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
	const response = await fetchApi(method, path, options);
	const envelope = (await response.json()) as { data: T };
	return envelope.data;
}

/** Typed JSON helpers. `T` is the `data` of the success envelope. */
export const api = {
	get: <T>(path: string, options?: RequestOptions) => json<T>('GET', path, options),
	post: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
		json<T>('POST', path, { ...options, body }),
	put: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
		json<T>('PUT', path, { ...options, body }),
	patch: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
		json<T>('PATCH', path, { ...options, body }),
	delete: <T>(path: string, options?: RequestOptions) => json<T>('DELETE', path, options),
	/** A list page: `data` plus the cursor of the next page (null on the last one). */
	page: async <T>(path: string, options?: RequestOptions) => {
		const response = await fetchApi('GET', path, options);
		const envelope = (await response.json()) as {
			data: T;
			meta?: { next_cursor?: string | null };
		};
		return { data: envelope.data, nextCursor: envelope.meta?.next_cursor ?? null };
	},
	/** Binary download (blobs, share bundles). */
	bytes: async (method: string, path: string, options?: RequestOptions) =>
		new Uint8Array(await (await fetchApi(method, path, options)).arrayBuffer()),
};
