// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A Server-Sent Events reader over `fetch`. `EventSource` can't send the DPoP
 * header every API request needs, so the stream is read by hand.
 */
import { rememberNonce, signedHeaders } from './client';

export interface SseMessage {
	event: string;
	data: string;
	id: string | null;
}

/** Splits an SSE byte stream into messages (spec: blank line ends a message). */
export function createSseParser(onMessage: (message: SseMessage) => void) {
	let buffer = '';
	let event = 'message';
	let data: string[] = [];
	let id: string | null = null;
	return (chunk: string) => {
		buffer += chunk;
		let newline: number;
		while ((newline = buffer.search(/\r?\n/)) >= 0) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + (buffer[newline] === '\r' ? 2 : 1));
			if (line === '') {
				if (data.length) onMessage({ event, data: data.join('\n'), id });
				event = 'message';
				data = [];
				continue;
			}
			if (line.startsWith(':')) continue;
			const colon = line.indexOf(':');
			const field = colon < 0 ? line : line.slice(0, colon);
			const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
			if (field === 'event') event = value;
			else if (field === 'data') data.push(value);
			else if (field === 'id') id = value;
		}
	};
}

/** Opens `path` as an event stream; resolves when the stream ends. */
export async function readEventStream(
	path: string,
	onMessage: (message: SseMessage) => void,
	signal: AbortSignal,
	lastEventId: string | null,
): Promise<void> {
	const headers = await signedHeaders('GET', path);
	headers.set('accept', 'text/event-stream');
	if (lastEventId) headers.set('last-event-id', lastEventId);
	const response = await fetch(path, { headers, credentials: 'same-origin', signal });
	rememberNonce(response);
	if (!response.ok || !response.body) {
		throw new Error(`event stream failed with ${response.status}`);
	}
	const parse = createSseParser(onMessage);
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		parse(value);
	}
}
