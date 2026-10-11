// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ingredient, PouchContents } from '@/features/ingredients/ingredients';
import { usePouchContents } from '@/features/ingredients/ingredients';
import type * as Ingredients from '@/features/ingredients/ingredients';
import { commitIngredient } from '@/features/ingredients/write';
import { api } from '@/lib/api/client';
import { TrashPage } from '../trash-page';

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ pouchId: 'p1' }) }));
vi.mock('@/lib/api/client', () => ({ api: { post: vi.fn() } }));
vi.mock('@/features/pouches/pouches', () => ({
	usePouch: () => ({ data: { id: 'p1', epoch: 'e1', name: 'Personal', state: 'active' } }),
}));
vi.mock('@/features/session/session-store', () => ({ currentKeyring: () => ({}) }));
vi.mock('@/features/ingredients/write', () => ({ commitIngredient: vi.fn() }));
vi.mock('@/features/ingredients/ingredients', async (importActual) => ({
	...(await importActual<typeof Ingredients>()),
	usePouchContents: vi.fn(),
}));

function item(name: string, deleted: boolean): Ingredient {
	return {
		id: `${name}-${deleted ? 'old' : 'live'}`,
		kind: 'skill',
		scope: 'global',
		name,
		files: [{ path: 'SKILL.md', blob: 'b1', size: 10, mode: 'file' }],
		size: 10,
		revisionId: `r-${name}`,
		keyGen: 1,
		updatedAt: '2026-10-10T00:00:00Z',
		createdBy: 'm1',
		deleted,
		deletedAt: deleted ? new Date().toISOString() : null,
		filesRemoved: false,
		body: {} as Ingredient['body'],
	};
}

function renderPage(contents: PouchContents) {
	vi.mocked(usePouchContents).mockReturnValue({
		data: contents,
		error: null,
		isPending: false,
	} as never);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<TrashPage />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(commitIngredient).mockResolvedValue({ revisionId: 'r-new' });
});
afterEach(cleanup);

describe('TrashPage', () => {
	it('restores from the ⋯ menu under the same name when it is free', async () => {
		const user = userEvent.setup();
		const pdf = item('pdf', true);
		renderPage({ ingredients: [item('other', false)], trash: [pdf], unreadable: [] });

		await user.click(screen.getAllByRole('button', { name: 'Actions for pdf' })[0]!);
		await user.click(await screen.findByRole('menuitem', { name: 'Restore' }));

		expect(commitIngredient).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'restore',
				artifactId: pdf.id,
				base: pdf,
				name: 'pdf',
				previousEntries: pdf.files,
			}),
		);
	});

	it('asks for a new name when a live item took it', async () => {
		const user = userEvent.setup();
		const pdf = item('pdf', true);
		renderPage({ ingredients: [item('pdf', false)], trash: [pdf], unreadable: [] });

		await user.click(screen.getAllByRole('button', { name: 'Actions for pdf' })[0]!);
		await user.click(await screen.findByRole('menuitem', { name: 'Restore' }));

		const dialog = await screen.findByRole('dialog');
		expect(dialog).toHaveTextContent('A skill called “pdf” already exists');
		expect(commitIngredient).not.toHaveBeenCalled();
		const field = screen.getByRole('textbox', { name: 'Name' });
		expect(field).toHaveValue('pdf-2');

		await user.clear(field);
		await user.type(field, 'PDF');
		await user.click(screen.getByRole('button', { name: 'Restore' }));
		expect(dialog).toHaveTextContent('There is already a skill called “pdf”');
		expect(commitIngredient).not.toHaveBeenCalled();

		await user.clear(field);
		await user.type(field, 'pdf-old');
		await user.click(screen.getByRole('button', { name: 'Restore' }));
		expect(commitIngredient).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'restore', artifactId: pdf.id, name: 'pdf-old' }),
		);
	});

	it('deletes permanently from the ⋯ menu after confirming', async () => {
		const user = userEvent.setup();
		const pdf = item('pdf', true);
		vi.mocked(api.post).mockResolvedValue({} as never);
		renderPage({ ingredients: [], trash: [pdf], unreadable: [] });

		await user.click(screen.getAllByRole('button', { name: 'Actions for pdf' })[0]!);
		await user.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }));
		await user.click(await screen.findByRole('button', { name: 'Delete permanently' }));

		expect(api.post).toHaveBeenCalledWith('/v1/pouches/p1/free-space', {
			artifact_ids: [pdf.id],
		});
		expect(commitIngredient).not.toHaveBeenCalled();
	});

	it('says when the trash is empty', () => {
		renderPage({ ingredients: [item('pdf', false)], trash: [], unreadable: [] });
		expect(screen.getByText('Trash is empty')).toBeInTheDocument();
	});
});
