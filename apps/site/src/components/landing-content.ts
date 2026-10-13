// SPDX-License-Identifier: AGPL-3.0-only
/** Copy and data for the landing page, plus the few pure helpers it needs. */
import { formatBytes, plural } from '@/lib/format';
import { DOCS_URL } from '@/lib/links';

export const INSTALL_COMMAND = 'npm i -g skillpouch';
export const CONTACT_EMAIL = 'info@skillpouch.net';
export const SOURCE_URL = 'https://github.com/skillpouch/skillpouch';
export const CLI_SOURCE_URL = 'https://github.com/skillpouch/skillpouch-cli';
export const CLI_RELEASES_URL = `${CLI_SOURCE_URL}/releases`;
export const NPM_URL = 'https://www.npmjs.com/package/skillpouch';
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
export const DISCORD_URL = 'https://discord.gg/u8eEJZEGhc';

export interface Assistant {
	/** Matches `AssistantIcon` ids; assistants without a mark show their name only. */
	id: string;
	name: string;
	/** A file SkillPouch writes for this assistant. */
	path: string;
}

export const ASSISTANTS: readonly Assistant[] = [
	{ id: 'claude-code', name: 'Claude Code', path: '~/.claude/CLAUDE.md' },
	{ id: 'codex', name: 'Codex', path: '~/.codex/AGENTS.md' },
	{ id: 'opencode', name: 'OpenCode', path: '~/.config/opencode/AGENTS.md' },
	{ id: 'gemini-cli', name: 'Gemini CLI', path: '~/.gemini/GEMINI.md' },
	{ id: 'antigravity', name: 'Antigravity', path: '~/.gemini/config/mcp_config.json' },
	{ id: 'copilot', name: 'Copilot CLI', path: '~/.copilot/copilot-instructions.md' },
	{ id: 'cursor', name: 'Cursor', path: '~/.cursor/mcp.json' },
	{
		id: 'windsurf',
		name: 'Windsurf',
		path: '~/.codeium/windsurf/memories/global_rules.md',
	},
	{ id: 'qwen-code', name: 'Qwen Code', path: '~/.qwen/QWEN.md' },
	{ id: 'factory', name: 'Factory Droid', path: '~/.factory/mcp.json' },
	{ id: 'crush', name: 'Crush', path: '~/.config/crush/CRUSH.md' },
];

/** The assistants drawn in the sync diagram (the rest are listed under it). */
export const FLOW_ASSISTANTS = ASSISTANTS.filter((assistant) =>
	['claude-code', 'codex', 'opencode', 'gemini-cli', 'copilot', 'cursor'].includes(assistant.id),
);

export const ITEM_KINDS = [
	'Instructions',
	'Skills',
	'Agents',
	'Commands',
	'MCP servers',
	'Hooks',
	'Plugins',
] as const;

export interface Faq {
	question: string;
	answer: string;
	/** Also shown in the home page's short FAQ (the FAQ page shows them all). */
	home?: boolean;
	/** Where the FAQ page sends readers for the details. */
	more?: { href: string; label: string };
}

export const FAQS: readonly Faq[] = [
	{
		question: 'What is SkillPouch?',
		answer: `SkillPouch keeps your AI coding setup (instructions, skills, agents, commands, MCP servers, hooks, plugins and assistant settings) the same on every computer and in every assistant. A command-line tool on each computer syncs it in the background, and a web app lets you browse, edit and share items. Everything is end-to-end encrypted.`,
		more: { href: `${DOCS_URL}/getting-started/overview/`, label: 'How SkillPouch works' },
	},
	{
		question: 'Which assistants does it work with?',
		answer: `${ASSISTANTS.map((assistant) => assistant.name).join(', ')}. SkillPouch writes each item in the format and folder that assistant expects, so one MCP server or one set of instructions works in all of them.`,
		home: true,
		more: { href: `${DOCS_URL}/assistants/`, label: 'What syncs where, per assistant' },
	},
	{
		question: 'How do I install it?',
		answer: `Run \`${INSTALL_COMMAND}\` (pnpm and bun work too), then \`skillpouch login\` and approve the computer in your browser. The installer needs Node.js 18 or newer, and the CLI runs on Linux, macOS and Windows, on x64 and arm64.`,
		more: { href: `${DOCS_URL}/getting-started/install/`, label: 'Install guide' },
	},
	{
		question: 'Can I use the same setup on several computers?',
		answer: 'Yes, that is what it is for. Install the CLI on each computer and pick the same pouch. A change on one computer reaches the others within moments while they are online, and a computer that was offline catches up when it comes back.',
		more: {
			href: `${DOCS_URL}/getting-started/second-computer/`,
			label: 'Connect a second computer',
		},
	},
	{
		question: 'Can SkillPouch read what I sync?',
		answer: 'No. Files and item names are encrypted on your computer or in your browser before they are uploaded. The server stores ciphertext and never sees your master password or your Recovery Key.',
		home: true,
		more: { href: `${DOCS_URL}/security/`, label: 'Security model' },
	},
	{
		question: 'What if I forget my master password?',
		answer: 'Use your Recovery Key, or open SkillPouch on a computer or browser you already trust. If you lose all of them, nobody can recover your data, including us. That is the price of end-to-end encryption.',
		home: true,
	},
	{
		question: 'What happens when two computers change the same file?',
		answer: 'SkillPouch marks a conflict instead of guessing, and you pick the version to keep in the web app. The other computers follow your choice.',
		home: true,
		more: { href: `${DOCS_URL}/web/conflicts/`, label: 'Resolving conflicts' },
	},
	{
		question: 'Does it sync API keys and login tokens?',
		answer: 'Assistant settings can include values such as custom providers and API keys; they stay encrypted in your pouch and are blanked out of share links. Credential files such as auth.json, .credentials.json and oauth_creds.json are never synced.',
		more: { href: `${DOCS_URL}/assistants/#settings-sync`, label: 'Settings sync' },
	},
	{
		question: 'Does it work with my dotfiles repository?',
		answer: 'Yes. If an assistant’s folder is part of a git checkout, SkillPouch only reads it and never writes there, so the checkout stays clean.',
		more: { href: '/compare/', label: 'SkillPouch and dotfiles compared' },
	},
	{
		question: 'Does the token usage page see my prompts?',
		answer: 'No. The CLI reads token counts from each assistant’s own logs and sends only the totals per day and model. Your prompts and replies never leave your computer.',
		home: true,
	},
	{
		question: 'Is SkillPouch free?',
		answer: 'Yes, there is a free plan, and every plan has every feature. Paid plans add more pouches and storage. They are sold through Polar, our merchant of record, and you can cancel any time.',
		home: true,
		more: { href: '/#pricing', label: 'Current plans' },
	},
	{
		question: 'Is SkillPouch open source?',
		answer: `Yes, under the AGPL-3.0. The server, web app and docs are at ${SOURCE_URL}, and the CLI is at ${CLI_SOURCE_URL}.`,
		more: { href: SOURCE_URL, label: 'Source code on GitHub' },
	},
	{
		question: 'Can I run it on my own server?',
		answer: 'Yes. SkillPouch is open source under the AGPL and can be self-hosted. The CLI and the web app work the same against your own server.',
		home: true,
		more: { href: `${DOCS_URL}/self-hosting/`, label: 'Self-hosting guide' },
	},
];

/** A public plan as `GET /v1/plans` returns it (the `Plan` contract). */
export interface Plan {
	slug: string;
	name: string;
	description: string;
	price_cents: number;
	currency: string;
	interval: 'month' | 'year' | null;
	pouch_limit: number;
	storage_bytes: number;
}

/** `$3` for whole amounts, `$4.50` otherwise. */
export function formatPrice(cents: number, currency = 'usd'): string {
	return new Intl.NumberFormat('en', {
		style: 'currency',
		currency: currency.toUpperCase(),
		minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
	}).format(cents / 100);
}

/** What a plan includes, as short lines for its pricing card. */
export function planLines(plan: Plan): string[] {
	return [
		plural(plan.pouch_limit, 'pouch', 'pouches'),
		`${formatBytes(plan.storage_bytes)} of encrypted storage`,
		'Every feature, every assistant',
	];
}
