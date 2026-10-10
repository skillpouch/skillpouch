// SPDX-License-Identifier: AGPL-3.0-only
/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
});
