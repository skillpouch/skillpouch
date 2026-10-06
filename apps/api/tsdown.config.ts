// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Production bundle: one ESM file per entrypoint. Workspace packages
 * (`@skillpouch/*`, shipped as TypeScript sources) are inlined; npm
 * dependencies stay external and are installed in the image. The SQL
 * migrations are copied to `dist/migrations`.
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
	// Ship the SQL migrations next to the bundle so `API_ROLE=migrate` and
	// `/readyz` work without `SKILLPOUCH_MIGRATIONS_DIR`.
	copy: [{ from: '../../packages/db/migrations', to: 'dist' }],
});
