// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every item lives in a scope, sealed inside its revision envelope: `global`
 * (projected into the home folder of every assistant) or `project:<id>`
 * (kept inside one project folder, as it is).
 *
 * A project itself is an item of kind `project` in the global scope. Its
 * logical key is the project id that `skillpouch init` writes into the
 * folder's `.skillpouch/project.json`; its `project.json` file holds the
 * display name and description.
 */
export const GLOBAL_SCOPE = 'global';
export const PROJECT_KIND = 'project';
export type ProjectKind = typeof PROJECT_KIND;
export const PROJECT_FILE = 'project.json';

const PROJECT_PREFIX = 'project:';

export function projectScope(projectId: string): string {
	return `${PROJECT_PREFIX}${projectId}`;
}

/** The project id of a project scope, or null for any other scope. */
export function projectIdOf(scope: string): string | null {
	return scope.startsWith(PROJECT_PREFIX) && scope.length > PROJECT_PREFIX.length
		? scope.slice(PROJECT_PREFIX.length)
		: null;
}
