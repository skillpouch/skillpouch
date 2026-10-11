// SPDX-License-Identifier: AGPL-3.0-only
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_VIDEO, PAGES_FILE_LIMIT_BYTES } from '../sections/demo-video/demo-video';

const publicFile = (path: string) =>
	fileURLToPath(new URL(`../../../public${path}`, import.meta.url));

describe('demo video', () => {
	it('ships with its poster and fits a Cloudflare Pages deploy', () => {
		for (const path of [DEMO_VIDEO.src, DEMO_VIDEO.poster]) {
			expect(statSync(publicFile(path)).size).toBeLessThan(PAGES_FILE_LIMIT_BYTES);
		}
	});
});
