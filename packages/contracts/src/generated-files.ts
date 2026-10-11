// SPDX-License-Identifier: AGPL-3.0-only
import { ErrorCodes, errorDocsUrl, type ErrorCode } from './errors/codes';
import { Limits } from './limits';

/**
 * Renders every generated file as `{ relativePathFromPackageRoot: content }`.
 * Kept as a pure function so the test suite can check that the committed
 * files are up to date without writing to disk.
 */
export function renderGeneratedFiles(): Record<string, string> {
	const errors = Object.fromEntries(
		Object.entries(ErrorCodes).map(([code, def]) => [
			code,
			{ ...def, docs_url: errorDocsUrl(code as ErrorCode) },
		]),
	);
	return {
		'generated/errors.json': `${JSON.stringify(errors, null, '\t')}\n`,
		'generated/limits.json': `${JSON.stringify(Limits, null, '\t')}\n`,
	};
}
