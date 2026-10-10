// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PRIVACY_URL, TERMS_URL } from '@/lib/site';
import { AuthLayout } from '../auth-layout';

describe('AuthLayout', () => {
	it('links the Terms and Privacy on the public site', () => {
		render(<AuthLayout>content</AuthLayout>);
		expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe(TERMS_URL);
		expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe(
			PRIVACY_URL,
		);
		expect(TERMS_URL).toMatch(/^https?:\/\/[^/]+\/terms$/);
	});
});
