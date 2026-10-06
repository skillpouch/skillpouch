// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Production bundle: one ESM file per entrypoint. Workspace packages
 * (`@skillpouch/*`, shipped as TypeScript sources) are inlined; npm
 * dependencies stay external and are installed in the image.
 */
import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: { main: 'src/main.ts' },
	format: 'esm',
	platform: 'node',
	target: 'node24',
	outDir: 'dist',
	clean: true,
	sourcemap: true,
	deps: { alwaysBundle: [/^@skillpouch\//] },
});
