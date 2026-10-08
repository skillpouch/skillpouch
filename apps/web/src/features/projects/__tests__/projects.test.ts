// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { countByKind, inScope, type Ingredient } from '../../ingredients/ingredients';
import { kindBlurb, kindBySlug, namePlaceholder } from '../../ingredients/kinds';
import { summarizeContents } from '../components/project-table';
import {
	parseManifest,
	projectItems,
	projectMeta,
	serializeManifest,
	validateProjectName,
} from '../projects';
import { GLOBAL_SCOPE, projectIdOf, projectScope } from '../scope';

const item = (overrides: Partial<Ingredient>): Ingredient =>
	({
		id: crypto.randomUUID(),
		kind: 'skill',
		scope: GLOBAL_SCOPE,
		name: 'x',
		deleted: false,
		...overrides,
	}) as Ingredient;

describe('project scopes', () => {
	it('round-trips the project id and rejects other scopes', () => {
		expect(projectScope('abc')).toBe('project:abc');
		expect(projectIdOf(projectScope('abc'))).toBe('abc');
		expect(projectIdOf(GLOBAL_SCOPE)).toBeNull();
		expect(projectIdOf('project:')).toBeNull();
	});

	it('keeps global and project items apart', () => {
		const items = [
			item({ name: 'global-skill' }),
			item({ name: 'AGENTS.md', kind: 'instructions', scope: projectScope('p1') }),
			item({ name: 'CLAUDE.md', kind: 'instructions', scope: projectScope('p1') }),
			item({ name: 'gone', scope: projectScope('p1'), deleted: true }),
			item({ name: 'other', scope: projectScope('p2') }),
		];
		expect(inScope(items).map((i) => i.name)).toEqual(['global-skill']);
		expect(projectItems(items, 'p1').map((i) => i.name)).toEqual(['AGENTS.md', 'CLAUDE.md']);
		expect(countByKind(items)).toMatchObject({ skill: 1, instructions: 0 });
		expect(countByKind(items, projectScope('p1'))).toMatchObject({ skill: 0, instructions: 2 });
		expect(summarizeContents(projectItems(items, 'p1'))).toBe('2 Instructions');
		expect(summarizeContents(projectItems(items, 'p2'))).toBe('1 Skill');
		expect(summarizeContents([])).toBe('—');
	});
});

describe('project manifests', () => {
	it('reads name and description, falling back to the id', () => {
		expect(projectMeta(parseManifest('{"name":" web ","description":" app "}'), 'id')).toEqual({
			name: 'web',
			description: 'app',
		});
		expect(projectMeta(parseManifest('not json'), 'id')).toEqual({
			name: 'id',
			description: '',
		});
		expect(projectMeta(parseManifest('[1]'), 'id').name).toBe('id');
		expect(projectMeta(null, 'id').name).toBe('id');
	});

	it('keeps keys written by the CLI when editing', () => {
		const manifest = { name: 'old', remotes: ['git@github.com:me/app.git'] };
		const written = JSON.parse(
			serializeManifest(manifest, { name: ' new ', description: 'd' }),
		) as Record<string, unknown>;
		expect(written).toEqual({
			name: 'new',
			remotes: ['git@github.com:me/app.git'],
			description: 'd',
		});
	});

	it('validates names', () => {
		expect(validateProjectName('  ')).toMatch(/name/);
		expect(validateProjectName('x'.repeat(65))).toMatch(/64/);
		expect(validateProjectName('My App')).toBeNull();
	});
});

describe('kinds inside a project', () => {
	it('suggests file names for project instructions only', () => {
		const instructions = kindBySlug('instructions')!;
		const skills = kindBySlug('skills')!;
		expect(namePlaceholder(instructions, projectScope('p'))).toBe('AGENTS.md');
		expect(namePlaceholder(instructions, GLOBAL_SCOPE)).toBe('instructions-name');
		expect(namePlaceholder(skills, projectScope('p'))).toBe('skill-name');
		expect(kindBlurb(instructions, projectScope('p'))).toMatch(/CLAUDE\.md/);
		expect(kindBlurb(skills, projectScope('p'))).toBe(skills.blurb);
	});
});
