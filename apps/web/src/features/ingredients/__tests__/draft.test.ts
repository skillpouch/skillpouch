// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
	changedCount,
	createDraft,
	draftFiles,
	draftReducer,
	DraftError,
	fileStatus,
	isDirty,
	MAX_FILE_BYTES,
	renameFromTemplate,
	TEMPLATE_PLACEHOLDER,
	type Draft,
} from '../draft';
import { kindDefinition } from '../kinds';

const encode = (text: string) => new TextEncoder().encode(text);

function existing(): Draft {
	return createDraft(
		'pdf-tools',
		[
			{ path: 'SKILL.md', bytes: encode('# pdf-tools\n') },
			{ path: 'scripts/run.sh', bytes: encode('echo hi\n'), mode: 'exec' },
			{ path: 'logo.png', bytes: new Uint8Array([0x89, 0x50, 0, 1]) },
		],
		{ open: 'SKILL.md' },
	);
}

describe('createDraft', () => {
	it('sorts entries, opens the requested file and detects binary files', () => {
		const draft = existing();
		expect(draft.entries.map((entry) => entry.path)).toEqual([
			'logo.png',
			'scripts/run.sh',
			'SKILL.md',
		]);
		expect(draft.active).toBe('SKILL.md');
		expect(draft.tabs).toEqual(['SKILL.md']);
		expect(draft.entries.find((entry) => entry.path === 'logo.png')?.text).toBeNull();
		expect(isDirty(draft)).toBe(false);
	});

	it('marks a new draft dirty even before edits', () => {
		const draft = createDraft('', [{ path: 'SKILL.md', bytes: encode('x') }], { isNew: true });
		expect(draft.originalName).toBeNull();
		expect(isDirty(draft)).toBe(true);
	});
});

describe('draftReducer', () => {
	it('tracks edits, adds, renames and deletes per file', () => {
		let draft = existing();
		draft = draftReducer(draft, { type: 'edit', path: 'SKILL.md', text: '# changed\n' });
		draft = draftReducer(draft, { type: 'add', path: 'docs/notes.md', text: 'n' });
		draft = draftReducer(draft, { type: 'rename-file', from: 'scripts/run.sh', to: 'run.sh' });
		draft = draftReducer(draft, { type: 'delete-file', path: 'logo.png' });
		const status = Object.fromEntries(
			draft.entries.map((entry) => [entry.path, fileStatus(entry)]),
		);
		expect(status['SKILL.md']).toBe('modified');
		expect(status['docs/notes.md']).toBe('new');
		expect(status['logo.png']).toBe('deleted');
		expect(changedCount(draft)).toBeGreaterThanOrEqual(4);
		expect(draft.active).toBe('docs/notes.md');
	});

	it('editing back to the original text is not a change', () => {
		let draft = existing();
		draft = draftReducer(draft, { type: 'edit', path: 'SKILL.md', text: 'other' });
		draft = draftReducer(draft, { type: 'edit', path: 'SKILL.md', text: '# pdf-tools\n' });
		expect(changedCount(draft)).toBe(0);
	});

	it('restores a deleted file', () => {
		let draft = draftReducer(existing(), { type: 'delete-file', path: 'SKILL.md' });
		draft = draftReducer(draft, { type: 'restore-file', path: 'SKILL.md' });
		expect(changedCount(draft)).toBe(0);
	});

	it('counts a rename of the ingredient as a change', () => {
		const draft = draftReducer(existing(), { type: 'rename-ingredient', name: 'pdf' });
		expect(changedCount(draft)).toBe(1);
	});

	it.each([
		['../escape.md', /“\.\.”/],
		['/abs.md', /relative/],
		['a\\b.md', /relative/],
		['a//b.md', /empty/],
		['bad:name.md', /characters/],
		['SKILL.md', /already exists/],
		['skill.md', /already exists/],
		['scripts', /folder/],
		['SKILL.md/inner', /folder/],
	])('rejects adding %s', (path, message) => {
		expect(() => draftReducer(existing(), { type: 'add', path })).toThrow(DraftError);
		expect(() => draftReducer(existing(), { type: 'add', path })).toThrow(message);
	});

	it('closing the active tab activates the previous one', () => {
		let draft = draftReducer(existing(), { type: 'open', path: 'scripts/run.sh' });
		draft = draftReducer(draft, { type: 'close-tab', path: 'scripts/run.sh' });
		expect(draft.active).toBe('SKILL.md');
		draft = draftReducer(draft, { type: 'close-tab', path: 'SKILL.md' });
		expect(draft.active).toBeNull();
	});

	it('ignores edits to binary files and opening deleted files', () => {
		let draft = draftReducer(existing(), { type: 'edit', path: 'logo.png', text: 'x' });
		expect(changedCount(draft)).toBe(0);
		draft = draftReducer(draft, { type: 'delete-file', path: 'logo.png' });
		expect(draftReducer(draft, { type: 'open', path: 'logo.png' })).toBe(draft);
	});
});

describe('draftFiles', () => {
	it('keeps binary bytes and modes, drops deleted files', () => {
		const draft = draftReducer(existing(), { type: 'delete-file', path: 'logo.png' });
		const result = draftFiles(draft);
		if ('problem' in result) throw new Error(result.problem);
		expect(result.files.map((file) => [file.path, file.mode])).toEqual([
			['scripts/run.sh', 'exec'],
			['SKILL.md', 'file'],
		]);
	});

	it('never lets the last file go and refuses oversized files', () => {
		let draft = existing();
		for (const path of ['logo.png', 'scripts/run.sh']) {
			draft = draftReducer(draft, { type: 'delete-file', path });
		}
		expect(() => draftReducer(draft, { type: 'delete-file', path: 'SKILL.md' })).toThrow(
			/at least one/,
		);
		const big = draftReducer(existing(), {
			type: 'edit',
			path: 'SKILL.md',
			text: 'a'.repeat(MAX_FILE_BYTES + 1),
		});
		expect(draftFiles(big)).toEqual({ problem: expect.stringMatching(/larger than 1 MB/) });
	});
});

describe('renameFromTemplate', () => {
	const skill = kindDefinition('skill')!;
	const fresh = () =>
		createDraft(
			'',
			[{ path: skill.mainFile, bytes: encode(skill.template(TEMPLATE_PLACEHOLDER)) }],
			{ isNew: true },
		);
	const mainText = (draft: Draft) =>
		draft.entries.find((entry) => entry.path === skill.mainFile)?.text;

	it('keeps the untouched template in step with the name', () => {
		let draft = renameFromTemplate(fresh(), 'p', skill.mainFile, skill.template);
		draft = renameFromTemplate(draft, 'pdf-tools', skill.mainFile, skill.template);
		expect(draft.name).toBe('pdf-tools');
		expect(mainText(draft)).toBe(skill.template('pdf-tools'));
		draft = renameFromTemplate(draft, '', skill.mainFile, skill.template);
		expect(mainText(draft)).toBe(skill.template(TEMPLATE_PLACEHOLDER));
	});

	it('never overwrites text the user edited', () => {
		let draft = draftReducer(fresh(), { type: 'edit', path: skill.mainFile, text: 'mine' });
		draft = renameFromTemplate(draft, 'pdf-tools', skill.mainFile, skill.template);
		expect(draft.name).toBe('pdf-tools');
		expect(mainText(draft)).toBe('mine');
	});
});
