// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { nameTaken, type ConflictRecord, type Ingredient } from '../../ingredients/ingredients';
import { latestPerItem } from '../conflicts';

const conflict = (id: string, artifact: string | null, at: string): ConflictRecord => ({
	id,
	artifact_id: artifact,
	type: 'name_collision',
	base_revision_id: null,
	server_revision_id: null,
	incoming_revision_id: null,
	head_revision_id: null,
	device_id: null,
	state: 'open',
	created_at: at,
});

const item = (id: string, kind: Ingredient['kind'], name: string, deleted = false) =>
	({ id, kind, name, scope: 'global', deleted }) as Ingredient;

describe('conflicts', () => {
	it('shows one card per item, its newest conflict', () => {
		const shown = latestPerItem([
			conflict('c1', 'a', '2026-10-09T10:00:00Z'),
			conflict('c2', 'a', '2026-10-09T11:00:00Z'),
			conflict('c3', 'b', '2026-10-09T09:00:00Z'),
			conflict('c4', null, '2026-10-09T12:00:00Z'),
		]);
		expect(shown.map((c) => c.id)).toEqual(['c2', 'c3']);
	});

	it('finds a live item of the same kind with the same name, any case', () => {
		const items = [
			item('1', 'skill', 'PDF-tools'),
			item('2', 'agent', 'reviewer'),
			item('3', 'skill', 'old', true),
		];
		expect(nameTaken(items, 'skill', 'pdf-tools')?.id).toBe('1');
		// Renaming an item to its own name is fine.
		expect(nameTaken(items, 'skill', 'pdf-tools', '1')).toBeUndefined();
		expect(nameTaken(items, 'skill', 'reviewer')).toBeUndefined();
		expect(nameTaken(items, 'skill', 'old')).toBeUndefined();
	});
});
