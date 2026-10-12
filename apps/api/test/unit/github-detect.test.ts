// SPDX-License-Identifier: AGPL-3.0-only
/** Repository detection for "Add from GitHub" — pure function. */
import { describe, expect, it } from 'vitest';
import { detectItems } from '../../src/modules/import/github.service';

const blob = (path: string, size = 10) => ({ path, type: 'blob' as const, size });

describe('detectItems', () => {
	it('finds skills, plugins, marketplaces, instructions and MCP manifests', () => {
		const items = detectItems([
			blob('skills/pdf/SKILL.md'),
			blob('skills/pdf/scripts/run.py'),
			blob('plugins/review/.claude-plugin/plugin.json'),
			blob('plugins/review/skills/lint/SKILL.md'),
			blob('.claude-plugin/marketplace.json'),
			blob('AGENTS.md'),
			blob('servers/github/.mcp.json'),
			blob('README.md'),
		]);
		expect(items.map((item) => [item.kind, item.path])).toEqual([
			['marketplace', '.claude-plugin/marketplace.json'],
			['instructions', 'AGENTS.md'],
			['plugin', 'plugins/review'],
			['mcp_server', 'servers/github/.mcp.json'],
			['skill', 'skills/pdf'],
		]);
		expect(items.find((item) => item.kind === 'skill')!.files.map((file) => file.path)).toEqual(
			['skills/pdf/SKILL.md', 'skills/pdf/scripts/run.py'],
		);
	});

	it('treats a repository-root SKILL.md as one skill', () => {
		const items = detectItems([blob('SKILL.md'), blob('helper.sh')]);
		expect(items).toEqual([
			expect.objectContaining({
				kind: 'skill',
				path: '.',
				files: [blob('SKILL.md'), blob('helper.sh')],
			}),
		]);
	});

	it('names an item at the repository root after the repository', () => {
		const tree = [blob('.claude-plugin/plugin.json'), blob('skills/lazy/SKILL.md')];
		expect(detectItems(tree, 'dietrichgebert/ponytail')).toEqual([
			expect.objectContaining({ kind: 'plugin', path: '.', name: 'ponytail' }),
		]);
		expect(detectItems(tree)).toEqual([
			expect.objectContaining({ kind: 'plugin', name: 'repository' }),
		]);
	});
});
