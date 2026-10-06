// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers over decrypted file contents: descriptions for the list,
 * text/binary detection for the viewer, and secret stripping for share links.
 */

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Text if the bytes are valid UTF-8 without NUL bytes; otherwise null (binary). */
export function asText(bytes: Uint8Array): string | null {
	if (bytes.includes(0)) return null;
	try {
		return decoder.decode(bytes);
	} catch {
		return null;
	}
}

function frontmatter(text: string): Record<string, string> {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!match) return {};
	const fields: Record<string, string> = {};
	for (const line of match[1]!.split(/\r?\n/)) {
		const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (pair) fields[pair[1]!.toLowerCase()] = pair[2]!.replace(/^["']|["']$/g, '').trim();
	}
	return fields;
}

/** One-line description: frontmatter/JSON `description`, else the first paragraph line. */
export function describe(path: string, text: string | null): string {
	if (!text) return '';
	if (path.endsWith('.json')) {
		try {
			const parsed = JSON.parse(text) as { description?: unknown };
			return typeof parsed.description === 'string' ? parsed.description.trim() : '';
		} catch {
			return '';
		}
	}
	const fields = frontmatter(text);
	if (fields.description) return fields.description;
	const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
	let fenced = false;
	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
			fenced = !fenced;
			continue;
		}
		if (!fenced && trimmed && !trimmed.startsWith('#')) {
			return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
		}
	}
	return '';
}

export type FileLanguage = 'markdown' | 'json' | 'shell' | 'text';

export function languageOf(path: string): FileLanguage {
	const lower = path.toLowerCase();
	if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown';
	if (lower.endsWith('.json') || lower.endsWith('.jsonc')) return 'json';
	if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'shell';
	return 'text';
}

export const LANGUAGE_LABEL: Record<FileLanguage, string> = {
	markdown: 'Markdown',
	json: 'JSON',
	shell: 'Shell',
	text: 'Plain text',
};

/**
 * Removes secret values (`env`, `headers`) from JSON files before sharing.
 * Returns the cleaned text and the dotted keys that were emptied so the
 * recipient can be asked to fill them in.
 */
export function stripSecrets(
	text: string,
	secretKeys: readonly string[],
): { text: string; stripped: string[] } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { text, stripped: [] };
	}
	const stripped: string[] = [];
	const walk = (value: unknown, path: string[]): unknown => {
		if (Array.isArray(value))
			return value.map((item, index) => walk(item, [...path, String(index)]));
		if (!value || typeof value !== 'object') return value;
		const result: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			if (
				secretKeys.includes(key) &&
				child &&
				typeof child === 'object' &&
				!Array.isArray(child)
			) {
				result[key] = Object.fromEntries(
					Object.keys(child as Record<string, unknown>).map((name) => {
						stripped.push([...path, key, name].join('.'));
						return [name, ''];
					}),
				);
			} else {
				result[key] = walk(child, [...path, key]);
			}
		}
		return result;
	};
	const cleaned = walk(parsed, []);
	return { text: `${JSON.stringify(cleaned, null, 2)}\n`, stripped };
}

/** Puts recipient-provided values back into the keys `stripSecrets` emptied. */
export function fillSecrets(text: string, values: Record<string, string>): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return text;
	}
	for (const [dotted, value] of Object.entries(values)) {
		const parts = dotted.split('.');
		let node = parsed as Record<string, unknown>;
		for (const part of parts.slice(0, -1)) {
			const next = node?.[part];
			if (!next || typeof next !== 'object') {
				node = undefined as unknown as Record<string, unknown>;
				break;
			}
			node = next as Record<string, unknown>;
		}
		if (node) node[parts[parts.length - 1]!] = value;
	}
	return `${JSON.stringify(parsed, null, 2)}\n`;
}
