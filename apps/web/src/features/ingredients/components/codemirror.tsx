// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CodeMirror 6 with the app's quiet dark theme. Loaded lazily (see
 * `code-editor.tsx`), so the editor's weight only arrives when a file opens.
 */
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import type { FileLanguage } from '../content';

const theme = EditorView.theme(
	{
		'&': { height: '100%', backgroundColor: '#000', color: '#d4d4d4', fontSize: '13px' },
		'.cm-content': { fontFamily: 'var(--font-mono)', caretColor: '#ededed', padding: '12px 0' },
		'.cm-gutters': { backgroundColor: '#000', color: '#444', border: 'none' },
		'.cm-activeLine': { backgroundColor: '#0d0d0d' },
		'.cm-activeLineGutter': { backgroundColor: '#0d0d0d', color: '#888' },
		'.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
			backgroundColor: 'rgba(132, 66, 217, 0.3) !important',
		},
		'&.cm-focused': { outline: 'none' },
		'.cm-cursor': { borderLeftColor: '#ededed' },
		'.cm-scroller': { overflow: 'auto' },
	},
	{ dark: true },
);

const highlight = HighlightStyle.define([
	{ tag: [tags.keyword, tags.heading, tags.bool], color: '#b48cf2' },
	{ tag: [tags.string, tags.special(tags.string)], color: '#c9c9c9' },
	{ tag: [tags.propertyName, tags.attributeName], color: '#e0e0e0' },
	{ tag: [tags.number], color: '#d4b3ff' },
	{ tag: [tags.comment, tags.meta], color: '#666' },
	{ tag: tags.emphasis, fontStyle: 'italic' },
	{ tag: tags.strong, fontWeight: '600' },
	{ tag: tags.link, color: '#b48cf2', textDecoration: 'underline' },
]);

function languageExtension(language: FileLanguage): Extension[] {
	if (language === 'markdown') return [markdown()];
	if (language === 'json') return [json()];
	return [];
}

export interface CodeMirrorProps {
	value: string;
	language: FileLanguage;
	readOnly: boolean;
	onChange?: ((value: string) => void) | undefined;
	onCursor?: ((position: { line: number; column: number }) => void) | undefined;
	label: string;
}

export default function CodeMirror({
	value,
	language,
	readOnly,
	onChange,
	onCursor,
	label,
}: CodeMirrorProps) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	const callbacks = useRef({ onChange, onCursor });
	callbacks.current = { onChange, onCursor };

	useEffect(() => {
		const state = EditorState.create({
			doc: value,
			extensions: [
				basicSetup,
				theme,
				syntaxHighlighting(highlight),
				EditorView.lineWrapping,
				EditorState.readOnly.of(readOnly),
				EditorView.editable.of(!readOnly),
				EditorView.contentAttributes.of({ 'aria-label': label }),
				...languageExtension(language),
				EditorView.updateListener.of((update) => {
					if (update.docChanged)
						callbacks.current.onChange?.(update.state.doc.toString());
					if (update.selectionSet || update.docChanged) {
						const head = update.state.selection.main.head;
						const line = update.state.doc.lineAt(head);
						callbacks.current.onCursor?.({
							line: line.number,
							column: head - line.from + 1,
						});
					}
				}),
			],
		});
		view.current = new EditorView({ state, parent: host.current! });
		return () => {
			view.current?.destroy();
			view.current = null;
		};
		// The view is rebuilt only when the language or mode changes; text flows in below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [language, readOnly, label]);

	useEffect(() => {
		const current = view.current;
		if (current && current.state.doc.toString() !== value) {
			current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
		}
	}, [value]);

	return <div ref={host} className="h-full min-h-0" data-testid="code-editor" />;
}
