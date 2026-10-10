// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { PasskeysSection } from '../passkeys-section';

vi.mock('@/lib/api/client', () => ({
	api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const create = vi.fn();

function stubPrf(capability: boolean) {
	vi.stubGlobal(
		'PublicKeyCredential',
		Object.assign(function PublicKeyCredential() {}, {
			getClientCapabilities: async () => ({ 'extension:prf': capability }),
		}),
	);
	Object.defineProperty(navigator, 'credentials', {
		configurable: true,
		value: { create, get: vi.fn() },
	});
}

function renderSection(passkeys: unknown[]) {
	vi.mocked(api.get).mockResolvedValue({ members: [], passkeys } as never);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<PasskeysSection />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('PasskeysSection', () => {
	it('lists passkeys and lets a PRF-capable browser add one', async () => {
		stubPrf(true);
		renderSection([
			{
				id: 'p1',
				member_id: 'm1',
				credential_id: 'AQID',
				transports: [],
				label: 'YubiKey',
				created_at: '2026-10-01T00:00:00Z',
				last_used_at: null,
			},
		]);
		expect(await screen.findByRole('listitem', { name: 'YubiKey' })).toHaveTextContent(
			/not used yet/,
		);
		expect(screen.getByRole('button', { name: 'Add passkey' })).toBeEnabled();
	});

	it('disables adding and says why when this browser has no PRF', async () => {
		stubPrf(false);
		renderSection([]);
		expect(await screen.findByText(/can’t unlock with a passkey/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Add passkey' })).toBeDisabled();
	});

	it('explains an authenticator without PRF in the dialog and saves nothing', async () => {
		stubPrf(true);
		vi.mocked(api.post).mockResolvedValue({
			options: {
				challenge: 'AQID',
				rp: { id: 'localhost', name: 'SkillPouch' },
				user: { id: 'AQID', name: 'ada', displayName: 'ada' },
				pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
			},
		} as never);
		create.mockResolvedValue({
			id: 'AQID',
			rawId: new Uint8Array([1, 2, 3]).buffer,
			type: 'public-key',
			response: {},
			getClientExtensionResults: () => ({ prf: { enabled: false } }),
		});
		renderSection([]);
		await userEvent.click(await screen.findByRole('button', { name: 'Add passkey' }));
		await userEvent.type(screen.getByLabelText('Name'), 'Old key');
		await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(
			/doesn’t support the PRF extension. Nothing was saved/,
		);
		expect(api.post).toHaveBeenCalledTimes(1);
		expect(api.post).toHaveBeenCalledWith('/v1/account/passkeys/options');
	});
});
