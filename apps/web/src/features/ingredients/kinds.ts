// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ingredient types a pouch holds. They are assistant-agnostic: a skill is
 * a skill whether Claude Code, OpenCode or Codex reads it — the CLI writes
 * each one into the native location and format of every assistant it finds.
 *
 * Every ingredient is a small folder with one *main file* (the one the editor
 * opens first and the description is read from) and optional extra files.
 */
import {
	Bot,
	FileText,
	Layers,
	Package,
	Server,
	SlidersHorizontal,
	SquareTerminal,
	Webhook,
	type LucideIcon,
} from 'lucide-react';

export type IngredientKind =
	'skill' | 'instructions' | 'agent' | 'command' | 'mcp_server' | 'hook' | 'plugin' | 'setting';

export interface KindDefinition {
	kind: IngredientKind;
	/** URL segment: `/app/p/:pouchId/skills`. */
	slug: string;
	label: string;
	singular: string;
	icon: LucideIcon;
	mainFile: string;
	/** Starter content for "Add …". */
	template: (name: string) => string;
	/** Short helper text on the empty list. */
	blurb: string;
	/** Commands run on your computers: importing one needs an explicit review. */
	runsCommands?: boolean;
	/** JSON values under these keys are secrets: stripped from share links. */
	secretKeys?: readonly string[];
	/** A pouch holds at most one of this kind, always under this name. */
	single?: string;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const KINDS: readonly KindDefinition[] = [
	{
		kind: 'instructions',
		slug: 'instructions',
		label: 'Instructions',
		singular: 'Instructions',
		icon: FileText,
		mainFile: 'INSTRUCTIONS.md',
		blurb: 'Rules every assistant follows on all your computers. They are linked into AGENTS.md, CLAUDE.md, GEMINI.md and the rest, so editing any of them edits these.',
		template: () => '# Instructions\n\n',
		single: 'instructions',
	},
	{
		kind: 'skill',
		slug: 'skills',
		label: 'Skills',
		singular: 'Skill',
		icon: Layers,
		mainFile: 'SKILL.md',
		blurb: 'Reusable know-how your assistants load when a task needs it.',
		template: (name) =>
			`---\nname: ${name}\ndescription: What this skill does and when to use it.\n---\n\n# ${name}\n\n`,
	},
	{
		kind: 'agent',
		slug: 'agents',
		label: 'Agents',
		singular: 'Agent',
		icon: Bot,
		mainFile: 'AGENT.md',
		blurb: 'Specialised sub-agents with their own prompt and tools.',
		template: (name) =>
			`---\nname: ${name}\ndescription: When to hand work to this agent.\n---\n\nYou are ${name}.\n`,
	},
	{
		kind: 'command',
		slug: 'commands',
		label: 'Commands',
		singular: 'Command',
		icon: SquareTerminal,
		mainFile: 'COMMAND.md',
		blurb: 'Slash commands you can run in any assistant.',
		template: (name) =>
			`---\ndescription: What /${name} does.\n---\n\nDo the following: $ARGUMENTS\n`,
	},
	{
		kind: 'mcp_server',
		slug: 'mcp-servers',
		label: 'MCP Servers',
		singular: 'MCP server',
		icon: Server,
		mainFile: 'server.json',
		blurb: 'Tool servers your assistants can connect to.',
		runsCommands: true,
		secretKeys: ['env', 'headers'],
		template: (name) =>
			json({ name, description: '', command: 'npx', args: ['-y', `${name}`], env: {} }),
	},
	{
		kind: 'hook',
		slug: 'hooks',
		label: 'Hooks',
		singular: 'Hook',
		icon: Webhook,
		mainFile: 'hook.json',
		blurb: 'Commands that run automatically on assistant events.',
		runsCommands: true,
		secretKeys: ['env'],
		template: (name) =>
			json({ name, description: '', event: 'PostToolUse', matcher: '*', command: '' }),
	},
	{
		kind: 'plugin',
		slug: 'plugins',
		label: 'Plugins',
		singular: 'Plugin',
		icon: Package,
		mainFile: 'plugin.json',
		blurb: 'Plugin and marketplace references, installed by each assistant.',
		template: (name) => json({ name, description: '', source: '' }),
	},
	{
		kind: 'setting',
		// `/settings` is the pouch's own settings page.
		slug: 'assistant-settings',
		label: 'Settings',
		singular: 'Settings',
		icon: SlidersHorizontal,
		mainFile: 'setting.json',
		blurb: "One assistant's settings, including custom providers and API keys, synced by the CLI.",
		template: (name) => json({ harness: name, files: {} }),
	},
];

const BY_KIND = new Map(KINDS.map((definition) => [definition.kind, definition]));
const BY_SLUG = new Map(KINDS.map((definition) => [definition.slug, definition]));

export function kindDefinition(kind: string): KindDefinition | undefined {
	return BY_KIND.get(kind as IngredientKind);
}

export function kindBySlug(slug: string): KindDefinition | undefined {
	return BY_SLUG.get(slug);
}

export function isIngredientKind(kind: string): kind is IngredientKind {
	return BY_KIND.has(kind as IngredientKind);
}

/** Names become folder and file names on every OS: keep them portable. */
export const NAME_MAX = 64;
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateName(name: string): string | null {
	if (!name) return 'Give it a name.';
	if (name.length > NAME_MAX) return `Use at most ${NAME_MAX} characters.`;
	if (!NAME_PATTERN.test(name)) {
		return 'Use letters, numbers, dots, dashes and underscores. Start with a letter or number.';
	}
	return null;
}

/** File paths inside an ingredient: relative, forward slashes, no `..`. */
export function validatePath(path: string): string | null {
	if (!path) return 'Give the file a name.';
	if (path.length > 255) return 'Path is too long.';
	if (path.startsWith('/') || path.includes('\\')) return 'Use a relative path with “/”.';
	const parts = path.split('/');
	if (parts.some((part) => part === '' || part === '.' || part === '..')) {
		return 'Path segments can’t be empty, “.” or “..”.';
	}
	// eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
	if (/[\u0000-\u001f<>:"|?*]/.test(path)) return 'Path contains characters some systems reject.';
	return null;
}
