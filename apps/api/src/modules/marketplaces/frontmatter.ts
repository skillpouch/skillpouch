// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reads `name` and `description` from a markdown file's YAML frontmatter —
 * enough YAML for SKILL.md and agent files (plain, quoted and folded `>` / `|`
 * values), without pulling in a YAML parser for untrusted input.
 */
const MAX_DESCRIPTION = 300;

export interface Frontmatter {
	name: string | null;
	description: string | null;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'")) {
		const quote = trimmed[0];
		if (trimmed.endsWith(quote)) return trimmed.slice(1, -1);
	}
	return trimmed;
}

function clip(value: string): string | null {
	const text = value.replace(/\s+/g, ' ').trim();
	if (!text) return null;
	return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

export function readFrontmatter(markdown: string): Frontmatter {
	const result: Frontmatter = { name: null, description: null };
	const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
	if (lines[0]?.trim() !== '---') return result;
	const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
	if (end < 0) return result;
	const body = lines.slice(1, end);
	for (let index = 0; index < body.length; index++) {
		const match = /^(name|description):\s*(.*)$/.exec(body[index] ?? '');
		if (!match) continue;
		const key = match[1] as keyof Frontmatter;
		let value = match[2] ?? '';
		if (/^[>|][+-]?$/.test(value.trim())) {
			const block: string[] = [];
			while (index + 1 < body.length && /^(\s+|$)/.test(body[index + 1] ?? '')) {
				index += 1;
				block.push((body[index] ?? '').trim());
			}
			value = block.join(' ');
		} else {
			value = unquote(value);
		}
		result[key] = key === 'description' ? clip(value) : value.trim() || null;
	}
	return result;
}
