// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A plugin brings only what the plugin itself uses, not every file next to
 * it: repositories like DietrichGebert/ponytail keep a copy of each skill and
 * command for every assistant, plus docs, tests and benchmarks.
 */
import { describe, expect, it } from 'vitest';
import {
	GithubImporter,
	detectItems,
	inPluginLayout,
	pluginReferences,
} from '../../src/modules/import/github.service';

/** Files of a fake repository; anything not listed reads as `x`. */
function fakeGithub(contents: Record<string, string>, paths: string[]) {
	const downloaded: string[] = [];
	const http: typeof fetch = async (input) => {
		const url = new URL(String(input));
		const json = (value: unknown) => new Response(JSON.stringify(value));
		if (url.host === 'raw.githubusercontent.com') {
			const path = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
			downloaded.push(path);
			return new Response(contents[path] ?? 'x');
		}
		const kind = url.pathname.split('/')[4];
		if (kind === 'commits') return json({ sha: 'abc' });
		if (kind === 'git') {
			return json({ tree: paths.map((path) => ({ path, type: 'blob', size: 1 })) });
		}
		return json({ default_branch: 'main' });
	};
	return { http, downloaded };
}

/** The shape of DietrichGebert/ponytail, trimmed. */
const PONYTAIL = [
	'.agents/rules/ponytail.md',
	'.claude-plugin/marketplace.json',
	'.claude-plugin/plugin.json',
	'.clinerules/ponytail.md',
	'.codex-plugin/plugin.json',
	'.cursor/rules/ponytail.mdc',
	'.github/workflows/test.yml',
	'.openclaw/skills/ponytail/SKILL.md',
	'.opencode/command/ponytail.md',
	'.opencode/plugins/ponytail.mjs',
	'.windsurf/rules/ponytail.md',
	'AGENTS.md',
	'LICENSE',
	'README.md',
	'assets/logo.png',
	'benchmarks/run.js',
	'commands/ponytail.toml',
	'hooks/claude-codex-hooks.json',
	'hooks/ponytail-activate.js',
	'i18n/README.es.md',
	'package.json',
	'skills/ponytail-review/SKILL.md',
	'skills/ponytail/SKILL.md',
	'tests/hooks.test.js',
];

const PONYTAIL_PLUGIN = [
	'.claude-plugin/marketplace.json',
	'.claude-plugin/plugin.json',
	'LICENSE',
	'README.md',
	'hooks/claude-codex-hooks.json',
	'hooks/ponytail-activate.js',
	'skills/ponytail-review/SKILL.md',
	'skills/ponytail/SKILL.md',
];

const PONYTAIL_CONTENTS = {
	'.claude-plugin/plugin.json': JSON.stringify({
		name: 'ponytail',
		hooks: './hooks/claude-codex-hooks.json',
	}),
};

describe('plugin files', () => {
	it('keeps the plugin layout and leaves other assistants’ copies behind', () => {
		const plugin = detectItems(
			PONYTAIL.map((path) => ({ path, type: 'blob' as const, size: 1 })),
		).find((item) => item.kind === 'plugin')!;
		expect(plugin.path).toBe('.');
		expect(plugin.files.map((file) => file.path)).toEqual(PONYTAIL_PLUGIN);
		expect(plugin.extra!.map((file) => file.path)).toEqual(
			PONYTAIL.filter((path) => !PONYTAIL_PLUGIN.includes(path)),
		);
	});

	it('knows which paths belong to a plugin', () => {
		for (const path of [
			'.claude-plugin/plugin.json',
			'skills/a/SKILL.md',
			'skills/a/scripts/run.py',
			'commands/review.md',
			'commands/git/commit.md',
			'agents/reviewer.md',
			'hooks/hooks.json',
			'bin/tool',
			'output-styles/terse.md',
			'.mcp.json',
			'.lsp.json',
			'settings.json',
			'README.md',
			'LICENSE',
		]) {
			expect(inPluginLayout(path), path).toBe(true);
		}
		for (const path of [
			'commands/review.toml',
			'scripts/release.js',
			'agents/reviewer.yaml',
			'.opencode/command/review.md',
			'.cursor/rules/x.mdc',
			'tests/hooks.test.js',
			'assets/logo.png',
			'package.json',
			'AGENTS.md',
			'docs/README.md',
		]) {
			expect(inPluginLayout(path), path).toBe(false);
		}
	});

	it('finds custom paths in the manifest and scripts hooks run', () => {
		expect(
			pluginReferences([
				{
					path: '.claude-plugin/plugin.json',
					content: JSON.stringify({
						commands: ['./custom/cmd.md', './more/'],
						agents: './team/reviewer.md',
						mcpServers: { db: { command: 'node', args: ['./servers/db.js'] } },
						skills: '.',
						icon: '../outside.png',
					}),
				},
				{
					path: 'hooks/hooks.json',
					content: JSON.stringify({
						hooks: {
							PostToolUse: [
								{
									hooks: [
										{
											type: 'command',
											command: '"${CLAUDE_PLUGIN_ROOT}"/tools/lint/run.sh',
										},
										{
											type: 'command',
											command: '${CLAUDE_PLUGIN_ROOT}/check.py',
										},
									],
								},
							],
						},
					}),
				},
				{ path: 'skills/a/SKILL.md', content: '${CLAUDE_PLUGIN_ROOT}/ignored/x.sh' },
			]),
		).toEqual([
			'check.py',
			'custom/cmd.md',
			'more',
			'servers/db.js',
			'team/reviewer.md',
			'tools/lint',
		]);
	});

	it('downloads only the plugin’s files from the marketplace', async () => {
		const github = fakeGithub(PONYTAIL_CONTENTS, PONYTAIL);
		const importer = new GithubImporter(github.http);
		const snapshot = await importer.snapshot('dietrichgebert/ponytail');
		const plugin = snapshot.items.find((item) => item.kind === 'plugin')!;
		const { files, truncated } = await importer.readItem(snapshot, plugin);
		expect(files.map((file) => file.path)).toEqual(PONYTAIL_PLUGIN);
		expect(github.downloaded.sort()).toEqual(PONYTAIL_PLUGIN);
		expect(truncated).toBe(false);
	});

	it('follows the manifest to a hook file and on to its scripts', async () => {
		const paths = [
			'.claude-plugin/plugin.json',
			'config/hooks.json',
			'tools/run.sh',
			'tools/lib.sh',
			'docs/guide.md',
		];
		const github = fakeGithub(
			{
				'.claude-plugin/plugin.json': JSON.stringify({ hooks: './config/hooks.json' }),
				'config/hooks.json': JSON.stringify({
					hooks: {
						Stop: [
							{
								hooks: [
									{
										type: 'command',
										command: '${CLAUDE_PLUGIN_ROOT}/tools/run.sh',
									},
								],
							},
						],
					},
				}),
			},
			paths,
		);
		const importer = new GithubImporter(github.http);
		const snapshot = await importer.snapshot('acme/plugin');
		const { files } = await importer.readItem(snapshot, snapshot.items[0]!);
		expect(files.map((file) => file.path)).toEqual([
			'.claude-plugin/plugin.json',
			'config/hooks.json',
			'tools/run.sh',
			'tools/lib.sh',
		]);
	});

	it('brings the same files through Add from GitHub', async () => {
		const github = fakeGithub(PONYTAIL_CONTENTS, PONYTAIL);
		const importer = new GithubImporter(github.http);
		const result = await importer.scan('dietrichgebert/ponytail', 'main');
		const plugin = result.items.find((item) => item.kind === 'plugin')!;
		expect(plugin.files.map((file) => file.path)).toEqual(PONYTAIL_PLUGIN);
		expect(result.items.map((item) => [item.kind, item.path])).toEqual([
			['plugin', '.'],
			['marketplace', '.claude-plugin/marketplace.json'],
			['instructions', 'AGENTS.md'],
		]);
	});
});
