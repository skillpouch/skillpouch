// SPDX-License-Identifier: AGPL-3.0-only
/** Copy and data for the landing page, plus the few pure helpers it needs. */
import { formatBytes, plural } from '@/lib/format';

export const INSTALL_COMMAND = 'npm i -g skillpouch';
export const CONTACT_EMAIL = 'info@skillpouch.net';
export const SOURCE_URL = 'https://github.com/skillpouch/skillpouch';

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
}

export const FAQS: readonly Faq[] = [
	{
		question: 'Which assistants does it work with?',
		answer: `${ASSISTANTS.map((assistant) => assistant.name).join(', ')}. SkillPouch writes each item in the format and folder that assistant expects, so one MCP server or one set of instructions works in all of them.`,
	},
	{
		question: 'Can SkillPouch read what I sync?',
		answer: 'No. Files and item names are encrypted on your computer or in your browser before they are uploaded. The server stores ciphertext and never sees your master password or your Recovery Key.',
	},
	{
		question: 'What if I forget my master password?',
		answer: 'Use your Recovery Key, or open SkillPouch on a computer or browser you already trust. If you lose all of them, nobody can recover your data, including us. That is the price of end-to-end encryption.',
	},
	{
		question: 'What happens when two computers change the same file?',
		answer: 'SkillPouch marks a conflict instead of guessing, and you pick the version to keep in the web app. The other computers follow your choice.',
	},
	{
		question: 'Does the token usage page see my prompts?',
		answer: 'No. The CLI reads token counts from each assistant’s own logs and sends only the totals per day and model. Your prompts and replies never leave your computer.',
	},
	{
		question: 'Can I run it on my own server?',
		answer: 'Yes. SkillPouch is open source under the AGPL and can be self-hosted. The CLI and the web app work the same against your own server.',
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
