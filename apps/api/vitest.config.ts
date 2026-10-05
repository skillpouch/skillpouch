import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		testTimeout: 30_000,
		hookTimeout: 60_000,
		projects: [
			{ extends: true, test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
			{ extends: true, test: { name: 'integration', include: ['test/integration/**/*.test.ts'] } },
			{ extends: true, test: { name: 'e2e', include: ['test/e2e/**/*.test.ts'] } },
		],
	},
});
