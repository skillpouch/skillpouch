// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clean, NOTES, OUT_DIR, parseCommands, renderPage } from './gen-cli.mjs';

const ROOT_HELP = `Sync your AI assistant skills

Usage: skillpouch [COMMAND]

Commands:
  login      Connect this computer to your SkillPouch account
  select     Choose what this computer syncs: assistants and kinds, on or off. Without options, lists the current choice
  help       Print this message or the help of the given subcommand(s)

Options:
  -h, --help     Print help
`;

describe('parseCommands', () => {
	it('lists the commands of a clap help text, without help', () => {
		expect(parseCommands(ROOT_HELP)).toEqual([
			{ name: 'login', about: 'Connect this computer to your SkillPouch account' },
			{
				name: 'select',
				about: 'Choose what this computer syncs: assistants and kinds, on or off. Without options, lists the current choice',
			},
		]);
	});

	it('finds none in a command without subcommands', () => {
		expect(
			parseCommands('Stop it\n\nUsage: skillpouch daemon stop\n\nOptions:\n  -h, --help'),
		).toEqual([]);
	});
});

describe('clean', () => {
	it('drops colour codes and trailing spaces', () => {
		expect(clean('\u001b[1mUsage:\u001b[0m skillpouch   \n\n')).toBe('Usage: skillpouch');
	});
});

describe('renderPage', () => {
	it('titles the page after the command and quotes its help', () => {
		const page = renderPage({
			command: 'daemon',
			help: 'The background sync\n\nUsage: skillpouch daemon <COMMAND>\n',
			version: 'skillpouch 1.2.3\n',
			subcommands: [{ name: 'stop', help: 'Stop it\n' }],
		});
		expect(page).toMatch(
			/^---\ntitle: "skillpouch daemon"\ndescription: "The background sync"\n---\n/,
		);
		expect(page).toContain(
			'```text\nThe background sync\n\nUsage: skillpouch daemon <COMMAND>\n```',
		);
		expect(page).toContain('## `skillpouch daemon stop`\n\n```text\nStop it\n```');
		expect(page).toContain(NOTES.daemon[0]);
		expect(page).toContain('_Generated from `skillpouch 1.2.3`._');
	});

	it('links every command from the overview', () => {
		const page = renderPage({ command: '', help: ROOT_HELP, version: 'skillpouch 1.2.3' });
		expect(page).toContain('title: "skillpouch"');
		expect(page).toContain('- [`skillpouch login`](/cli/login/): Connect this computer');
		expect(page).not.toContain('skillpouch help`]');
	});
});

describe('the committed CLI pages', () => {
	it('cover every command the overview lists', () => {
		const overview = readFileSync(join(OUT_DIR, 'index.md'), 'utf8');
		const linked = [...overview.matchAll(/\]\(\/cli\/([a-z-]+)\/\)/g)].map((match) => match[1]);
		expect(linked.length).toBeGreaterThan(5);
		for (const name of linked) {
			expect(existsSync(join(OUT_DIR, `${name}.md`)), name).toBe(true);
		}
	});
});
