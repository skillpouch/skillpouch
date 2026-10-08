// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Picks the highlighting for a file from CodeMirror's language list (about
 * 140 languages). Each parser is its own chunk, fetched the first time a file
 * of that language opens. Part of the lazy editor chunk.
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

/** Extensions the list doesn't know, mapped to a language it does. */
const ALIASES: Record<string, string> = {
	mdc: 'Markdown',
	mdx: 'Markdown',
	jsonc: 'JSON',
	json5: 'JSON',
	env: 'Properties files',
};

export function findLanguage(path: string): LanguageDescription | null {
	const filename = path.split('/').pop() ?? path;
	const found = LanguageDescription.matchFilename(languages, filename);
	if (found) return found;
	const extension = /\.([^.]+)$/.exec(filename)?.[1]?.toLowerCase();
	const alias = extension ? ALIASES[extension] : undefined;
	return alias ? (LanguageDescription.matchLanguageName(languages, alias, false) ?? null) : null;
}

/** The language's name and parser; Markdown also highlights its fenced code blocks. */
export async function loadLanguage(
	path: string,
): Promise<{ name: string; support: LanguageSupport | null }> {
	const description = findLanguage(path);
	if (!description) return { name: 'Plain text', support: null };
	if (description.name === 'Markdown') {
		return {
			name: description.name,
			support: markdown({ base: markdownLanguage, codeLanguages: languages }),
		};
	}
	return { name: description.name, support: await description.load() };
}
