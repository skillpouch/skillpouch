// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clean, NOTES, OUT_DIR, parseCommands, parseHelp, renderPage } from './gen-cli.mjs';

const ROOT_HELP = `Sync your AI assistant skills

Usage: skillpouch [COMMAND]

Commands:
  login      Connect this computer to your SkillPouch account
  select     Choose what this computer syncs: assistants and kinds, on or off. Without options, lists the current choice
  help       Print this message or the help of the given subcommand(s)

Options:
  -h, --help     Print help
`;

const LOGIN_HELP = `Connect this computer to your SkillPouch account

Usage: skillpouch login [OPTIONS] [TOKEN]

Arguments:
  [TOKEN]  One-time token

Options:
      --name <NAME>  Name shown on your Devices page
      --no-browser   Print the approval link
  -h, --help         Print help
  -V, --version      Print version
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

describe('parseHelp', () => {
	it('splits a help text into about, usage, arguments and options', () => {
		const parsed = parseHelp(LOGIN_HELP);
		expect(parsed.about).toBe('Connect this computer to your SkillPouch account');
		expect(parsed.usage).toBe('skillpouch login [OPTIONS] [TOKEN]');
		expect(parsed.arguments).toEqual([{ name: '[TOKEN]', about: 'One-time token' }]);
		expect(parsed.options).toEqual([
			{ name: '--name <NAME>', about: 'Name shown on your Devices page' },
			{ name: '--no-browser', about: 'Print the approval link' },
		]);
	});
});

describe('renderPage', () => {
	it('turns the help of a command into usage and tables', () => {
		const page = renderPage({ command: 'login', help: LOGIN_HELP });
		expect(page).toMatch(
			/^---\ntitle: "skillpouch login"\ndescription: "Connect this computer to your SkillPouch account."\n---\n/,
		);
		expect(page).toContain('## Usage\n\n```sh\nskillpouch login [OPTIONS] [TOKEN]\n```');
		expect(page).toContain('| `[TOKEN]` | One-time token. |');
		expect(page).toContain('| `--no-browser` | Print the approval link. |');
		expect(page).not.toContain('`-h, --help`');
		expect(page).toContain(NOTES.login[0]);
	});

	it('lists subcommands, with a section only for those that take options', () => {
		const page = renderPage({
			command: 'daemon',
			help: 'The background sync\n\nUsage: skillpouch daemon <COMMAND>\n\nCommands:\n  start  Start it\n  stop   Stop it\n  help   Print this message\n',
			subcommands: [
				{
					name: 'start',
					help: 'Start it\n\nUsage: skillpouch daemon start\n\nOptions:\n      --now  Right away\n',
				},
				{ name: 'stop', help: 'Stop it\n\nUsage: skillpouch daemon stop\n' },
			],
		});
		expect(page).toContain('| `skillpouch daemon stop` | Stop it. |');
		expect(page).toContain('## `skillpouch daemon start`');
		expect(page).toContain('| `--now` | Right away. |');
		expect(page).not.toContain('## `skillpouch daemon stop`');
		expect(page).not.toContain('daemon help');
	});

	it('links every command from the overview', () => {
		const page = renderPage({ command: '', help: ROOT_HELP });
		expect(page).toContain('title: "skillpouch"');
		expect(page).toContain('| [`skillpouch login`](/cli/login/) | Connect this computer');
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
