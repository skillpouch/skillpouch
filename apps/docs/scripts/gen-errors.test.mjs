// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cell, HINTS, REGISTRY, renderAll, renderErrorPage, renderIndex } from './gen-errors.mjs';

const ERRORS = {
	device_revoked: { status: 401, retryable: false, message: 'This device was revoked.' },
	rate_limited: { status: 429, retryable: true, message: 'Too many | requests.' },
};

describe('renderIndex', () => {
	it('lists every code with its status and links its page', () => {
		const index = renderIndex(ERRORS);
		expect(index).toMatch(/^---\ntitle: "Error codes"\n/);
		expect(index).toContain(
			'| [`device_revoked`](/errors/device_revoked/) | 401 | no | This device was revoked. |',
		);
		expect(index).toContain(
			'| [`rate_limited`](/errors/rate_limited/) | 429 | yes | Too many \\| requests. |',
		);
	});
});

describe('renderErrorPage', () => {
	it('shows the message, status and what to do', () => {
		const page = renderErrorPage('device_revoked', ERRORS.device_revoked);
		expect(page).toContain('title: "device_revoked"');
		expect(page).toContain('> This device was revoked.');
		expect(page).toContain('| 401 | no |');
		expect(page).toContain(`## What to do\n\n${HINTS.device_revoked}`);
	});

	it('says when a code is retryable or deprecated', () => {
		const page = renderErrorPage('rate_limited', { ...ERRORS.rate_limited, deprecated: true });
		expect(page).toContain('yes: the same request can succeed later');
		expect(page).toContain(':::caution');
		expect(page).not.toContain('## What to do');
	});
});

describe('cell', () => {
	it('keeps a table row on one line', () => {
		expect(cell('a | b\nc')).toBe('a \\| b c');
	});
});

describe('the registry', () => {
	const errors = JSON.parse(readFileSync(REGISTRY, 'utf8'));

	it('gets a page per code and an index', () => {
		const files = renderAll(errors);
		expect(Object.keys(files)).toHaveLength(Object.keys(errors).length + 1);
		expect(files['index.md']).toBeDefined();
	});

	it('only has hints for codes that exist', () => {
		for (const code of Object.keys(HINTS)) {
			expect(errors, code).toHaveProperty(code);
		}
	});

	it('sends people to the pages generated here', () => {
		for (const [code, def] of Object.entries(errors)) {
			expect(def.docs_url).toBe(`https://docs.skillpouch.net/errors/${code}`);
		}
	});
});
