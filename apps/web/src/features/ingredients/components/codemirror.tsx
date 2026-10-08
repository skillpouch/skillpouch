// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CodeMirror 6 with the app's quiet dark theme. Loaded lazily (see
 * `code-editor.tsx`), so the editor's weight only arrives when a file opens.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { loadLanguage } from './code-languages';

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

/** A dark palette around the app's purple, readable for any language. */
const highlight = HighlightStyle.define([
	{
		tag: [
			tags.keyword,
			tags.controlKeyword,
			tags.moduleKeyword,
			tags.operatorKeyword,
			tags.definitionKeyword,
			tags.modifier,
			tags.self,
		],
		color: '#c4a1ff',
	},
	{ tag: [tags.string, tags.special(tags.string), tags.docString], color: '#a8d8a0' },
	{ tag: [tags.regexp, tags.escape, tags.character], color: '#7fd4d4' },
	{ tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit], color: '#f2b880' },
	{
		tag: [
			tags.function(tags.variableName),
			tags.function(tags.definition(tags.variableName)),
			tags.function(tags.propertyName),
			tags.macroName,
		],
		color: '#82aaff',
	},
	{
		tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName)],
		color: '#ffd580',
	},
	{ tag: [tags.propertyName, tags.attributeName, tags.labelName], color: '#d9c7ff' },
	{ tag: [tags.tagName, tags.angleBracket], color: '#f28b9b' },
	{ tag: [tags.variableName, tags.definition(tags.variableName)], color: '#e6e6e6' },
	{ tag: [tags.constant(tags.variableName), tags.standard(tags.variableName)], color: '#f2b880' },
	{ tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: '#9a9a9a' },
	{
		tag: [tags.comment, tags.lineComment, tags.blockComment],
		color: '#6b6b6b',
		fontStyle: 'italic',
	},
	{ tag: [tags.meta, tags.processingInstruction, tags.annotation], color: '#8a8a8a' },
	{ tag: tags.heading, color: '#c4a1ff', fontWeight: '600' },
	{ tag: [tags.quote, tags.contentSeparator], color: '#8a8a8a' },
	{ tag: tags.monospace, color: '#a8d8a0' },
	{ tag: tags.emphasis, fontStyle: 'italic' },
	{ tag: tags.strong, fontWeight: '600' },
	{ tag: tags.strikethrough, textDecoration: 'line-through' },
	{ tag: [tags.link, tags.url], color: '#b48cf2', textDecoration: 'underline' },
	{ tag: tags.inserted, color: '#a8d8a0' },
	{ tag: tags.deleted, color: '#f28b9b' },
	{ tag: tags.invalid, color: '#ff6b6b' },
]);

export interface CodeMirrorProps {
	value: string;
	/** Picks the highlighting, by extension or file name. */
	path: string;
	readOnly: boolean;
	/** Reports the detected language's name (for a status bar). */
	onLanguage?: ((name: string) => void) | undefined;
	onChange?: ((value: string) => void) | undefined;
	onCursor?: ((position: { line: number; column: number }) => void) | undefined;
	label: string;
}

export default function CodeMirror({
	value,
	path,
	readOnly,
	onChange,
	onCursor,
	onLanguage,
	label,
}: CodeMirrorProps) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	const language = useRef(new Compartment());
	const callbacks = useRef({ onChange, onCursor, onLanguage });
	callbacks.current = { onChange, onCursor, onLanguage };

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
				language.current.of([]),
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
		// The view is rebuilt only when the mode changes; text and language flow in below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [readOnly, label]);

	useEffect(() => {
		let current = true;
		void loadLanguage(path)
			.catch(() => ({ name: 'Plain text', support: null }))
			.then(({ name, support }) => {
				if (!current) return;
				view.current?.dispatch({
					effects: language.current.reconfigure(support ?? []),
				});
				callbacks.current.onLanguage?.(name);
			});
		return () => {
			current = false;
		};
	}, [path, readOnly, label]);

	useEffect(() => {
		const current = view.current;
		if (current && current.state.doc.toString() !== value) {
			current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
		}
	}, [value]);

	return <div ref={host} className="h-full min-h-0" data-testid="code-editor" />;
}
