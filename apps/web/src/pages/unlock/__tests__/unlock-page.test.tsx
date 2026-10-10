// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSession } from '@/features/session/session-store';
import { PasskeyError, unlockBrowserWithPasskey } from '@/features/vault/passkeys';
import type * as Passkeys from '@/features/vault/passkeys';
import { api } from '@/lib/api/client';
import { UnlockPage } from '../unlock-page';

vi.mock('@/lib/api/client', () => ({
	api: { get: vi.fn(), post: vi.fn() },
	setDpopKey: vi.fn(),
}));
vi.mock('@/features/vault/passkeys', async (importActual) => ({
	...(await importActual<typeof Passkeys>()),
	unlockBrowserWithPasskey: vi.fn(),
}));

function stubPrf(capability: boolean | null) {
	vi.stubGlobal(
		'PublicKeyCredential',
		Object.assign(function PublicKeyCredential() {}, {
			getClientCapabilities: async () =>
				capability === null ? {} : { 'extension:prf': capability },
		}),
	);
	Object.defineProperty(navigator, 'credentials', { configurable: true, value: {} });
}

function renderPage(passkeys: unknown[]) {
	vi.mocked(api.get).mockResolvedValue({ members: [], passkeys } as never);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<UnlockPage />
		</QueryClientProvider>,
	);
}

const passkey = {
	id: 'p1',
	member_id: 'm1',
	credential_id: 'AQID',
	transports: [],
	label: 'MacBook',
	created_at: '2026-10-01T00:00:00Z',
	last_used_at: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	// jsdom has no ResizeObserver; the Radix checkbox measures itself with one.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	setSession({
		status: 'locked',
		me: { user: { email: 'ada@example.com', name: 'Ada', image: null }, account: { id: 'a1' } },
		browser: { userId: 'u1' },
		reason: 'new_browser',
	} as never);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	setSession({ status: 'loading' });
});

describe('UnlockPage', () => {
	it('leads with the passkey when the account has one and the browser supports PRF', async () => {
		stubPrf(true);
		renderPage([passkey]);
		const button = await screen.findByRole('button', { name: 'Unlock with passkey' });
		expect(screen.queryByLabelText('Master password')).toBeNull();

		vi.mocked(unlockBrowserWithPasskey).mockRejectedValue(new PasskeyError('cancelled'));
		await userEvent.click(button);
		expect(unlockBrowserWithPasskey).toHaveBeenCalledWith(
			expect.objectContaining({ accountId: 'a1', membership: 'none' }),
			{ trust: true },
		);
		expect(await screen.findByRole('alert')).toHaveTextContent(/prompt was closed/);

		await userEvent.click(screen.getByRole('button', { name: 'Use master password instead' }));
		expect(screen.getByLabelText('Master password')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Use a passkey instead' })).toBeInTheDocument();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('also offers it when the browser can’t say whether it supports PRF', async () => {
		stubPrf(null);
		renderPage([passkey]);
		expect(
			await screen.findByRole('button', { name: 'Unlock with passkey' }),
		).toBeInTheDocument();
	});

	it('skips passkeys silently when PRF is unsupported or none is set up', async () => {
		stubPrf(false);
		const { unmount } = renderPage([passkey]);
		expect(await screen.findByLabelText('Master password')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /passkey/ })).toBeNull();
		unmount();

		stubPrf(true);
		renderPage([]);
		expect(await screen.findByLabelText('Master password')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /passkey/ })).toBeNull();
		expect(
			screen.getByRole('button', { name: 'Use Recovery Key instead' }),
		).toBeInTheDocument();
	});
});
