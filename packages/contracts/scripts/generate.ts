// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generates the artifacts other repositories consume (17 §3, 04 §9):
 *   generated/errors.json — the error registry (the CLI generates its Rust enum from it)
 *   generated/limits.json — protocol limits (compared with the CLI's `limits.rs`)
 *   ../../docs/errors.md  — human-readable error reference
 *
 * Run: `pnpm contracts:generate`. CI fails when the committed files are stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGeneratedFiles } from '../src/generated-files';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const [relativePath, content] of Object.entries(renderGeneratedFiles())) {
	const target = join(packageRoot, relativePath);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
	console.log(`wrote ${relativePath}`);
}
