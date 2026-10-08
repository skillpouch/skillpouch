// SPDX-License-Identifier: AGPL-3.0-only
/** Pure helpers behind marketplaces: frontmatter, MCP configs, repo names, detection. */
import { describe, expect, it } from 'vitest';
import { detectItems } from '../../src/modules/import/github.service';
import { readFrontmatter } from '../../src/modules/marketplaces/frontmatter';
import { mcpServersOf, normalizeRepo } from '../../src/modules/marketplaces/marketplaces.service';
import { shortServerName, toServerConfig } from '../../src/modules/marketplaces/mcp-registry';
import { descriptionFromPage } from '../../src/modules/marketplaces/skills-sh';

const blob = (path: string, size = 10) => ({ path, type: 'blob' as const, size });

describe('readFrontmatter', () => {
	it('reads plain, quoted and folded values', () => {
		expect(
			readFrontmatter('---\nname: pdf\ndescription: "Fill PDF forms"\n---\n# PDF'),
		).toEqual({ name: 'pdf', description: 'Fill PDF forms' });
		expect(
			readFrontmatter('---\nname: x\ndescription: >\n  Line one\n  line two\nother: 1\n---'),
		).toEqual({ name: 'x', description: 'Line one line two' });
	});

	it('ignores files without frontmatter and clips long descriptions', () => {
		expect(readFrontmatter('# Title\ndescription: no')).toEqual({
			name: null,
			description: null,
		});
		const long = readFrontmatter(`---\ndescription: ${'a'.repeat(500)}\n---`).description!;
		expect(long).toHaveLength(300);
		expect(long.endsWith('…')).toBe(true);
	});
});

describe('MCP Registry entries', () => {
	it('prefers a local package and leaves secrets empty', () => {
		const config = toServerConfig({
			name: 'io.github.acme/Weather MCP',
			description: 'Weather',
			packages: [
				{
					registryType: 'npm',
					identifier: '@acme/weather',
					transport: { type: 'stdio' },
					environmentVariables: [
						{ name: 'API_KEY' },
						{ name: 'UNITS', default: 'metric' },
					],
				},
			],
			remotes: [{ type: 'streamable-http', url: 'https://weather.example/mcp' }],
		});
		expect(config).toEqual({
			name: 'weather-mcp',
			description: 'Weather',
			command: 'npx',
			args: ['-y', '@acme/weather'],
			env: { API_KEY: '', UNITS: 'metric' },
		});
	});

	it('falls back to the remote, and to nothing', () => {
		expect(
			toServerConfig({
				name: 'a/b',
				remotes: [
					{ type: 'sse', url: 'https://x/sse', headers: [{ name: 'Authorization' }] },
				],
			}),
		).toEqual({
			name: 'b',
			description: '',
			type: 'sse',
			url: 'https://x/sse',
			headers: { Authorization: '' },
		});
		expect(
			toServerConfig({ name: 'a/b', packages: [{ registryType: 'nuget', identifier: 'x' }] }),
		).toBeNull();
		expect(shortServerName('com.example/')).toBe('mcp-server');
	});
});

describe('normalizeRepo', () => {
	it('accepts owner/name and GitHub URLs', () => {
		expect(normalizeRepo('acme/skills')).toBe('acme/skills');
		expect(normalizeRepo(' https://github.com/acme/skills.git ')).toBe('acme/skills');
		expect(normalizeRepo('github.com/acme/skills/tree/main/pdf')).toBe('acme/skills');
	});

	it('rejects anything else', () => {
		for (const input of ['https://evil.example/a/b', 'a', '../x', 'a/b/c']) {
			expect(() => normalizeRepo(input)).toThrow();
		}
	});
});

describe('mcpServersOf', () => {
	it('reads Claude and VS Code layouts and skips junk', () => {
		const servers = (value: unknown) => mcpServersOf(Buffer.from(JSON.stringify(value)));
		expect(Object.keys(servers({ mcpServers: { a: { command: 'x' }, b: 'bad' } }))).toEqual([
			'a',
		]);
		expect(Object.keys(servers({ servers: { c: { url: 'https://c' } } }))).toEqual(['c']);
		expect(mcpServersOf(Buffer.from('not json'))).toEqual({});
	});
});

describe('detectItems: files inside skills', () => {
	it('keeps a skill folder’s AGENTS.md and MCP file with the skill', () => {
		const items = detectItems([
			blob('AGENTS.md'),
			blob('skills/react/SKILL.md'),
			blob('skills/react/AGENTS.md'),
			blob('skills/react/.mcp.json'),
		]);
		expect(items.map((item) => [item.kind, item.path])).toEqual([
			['instructions', 'AGENTS.md'],
			['skill', 'skills/react'],
		]);
	});
});

describe('detectItems: agents and commands', () => {
	it('finds one agent or command per markdown file, except inside plugins', () => {
		const items = detectItems([
			blob('agents/reviewer.md'),
			blob('agents/README.md'),
			blob('.claude/commands/ship.md'),
			blob('plugins/x/.claude-plugin/plugin.json'),
			blob('plugins/x/agents/inner.md'),
		]);
		expect(items.map((item) => [item.kind, item.name])).toEqual([
			['command', 'ship'],
			['agent', 'reviewer'],
			['plugin', 'x'],
		]);
	});
});

describe('descriptionFromPage', () => {
	it('reads the skill page meta description and decodes entities', () => {
		expect(
			descriptionFromPage(
				'<meta name="description" content="Find a skill for &quot;X&quot; &amp; more&#8230;"/>',
			),
		).toBe('Find a skill for "X" & more…');
	});

	it('ignores the stand-in text of skills without a description', () => {
		expect(
			descriptionFromPage(
				'<meta name="description" content="pdf — an installable skill for AI agents, published by acme/skills."/>',
			),
		).toBeNull();
		expect(descriptionFromPage('<html></html>')).toBeNull();
	});
});
