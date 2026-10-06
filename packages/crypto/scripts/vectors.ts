// SPDX-License-Identifier: AGPL-3.0-only
/** Regenerates `vectors/v1.json` (only when a format deliberately changes). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeVectors } from '../src/vectors';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'v1.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(await computeVectors(), null, '\t')}\n`);
console.log(`wrote ${target}`);
