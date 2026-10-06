// SPDX-License-Identifier: AGPL-3.0-only
import { lazy, Suspense } from 'react';
import { LoadingBlock } from '@/components/ui/spinner';
import type { CodeMirrorProps } from './codemirror';

const CodeMirror = lazy(() => import('./codemirror'));

/** The file editor/viewer; CodeMirror is code-split and loads on first use. */
export function CodeEditor(props: CodeMirrorProps) {
	return (
		<Suspense fallback={<LoadingBlock label="Loading editor" />}>
			<CodeMirror {...props} />
		</Suspense>
	);
}
