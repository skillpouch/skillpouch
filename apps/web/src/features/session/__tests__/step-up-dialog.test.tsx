// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberProvider } from '@/lib/auth';
import { cancelStepUp, requestStepUp } from '../step-up';
import { StepUpDialog } from '../step-up-dialog';

afterEach(() => {
	act(() => cancelStepUp());
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe('StepUpDialog', () => {
	it('blocks the page until the user continues or cancels', async () => {
		rememberProvider('google');
		render(<StepUpDialog />);
		expect(screen.queryByRole('dialog')).toBeNull();

		let result!: Promise<boolean>;
		act(() => {
			result = requestStepUp();
		});
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await expect(result).resolves.toBe(false);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('shows that it is waiting while the sign-in window is open', () => {
		vi.spyOn(window, 'open').mockReturnValue({
			closed: false,
			close: vi.fn(),
			location: { href: '' },
		} as unknown as Window);
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => undefined)),
		);
		render(<StepUpDialog />);
		act(() => void requestStepUp());
		fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
		expect(screen.getByText(/in the window that opened/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Waiting/ })).toBeDisabled();
		vi.unstubAllGlobals();
	});
});
