// SPDX-License-Identifier: AGPL-3.0-only
import { getContainerRenderer } from '@astrojs/react/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { describe, expect, it } from 'vitest';
import { SIGN_IN_URL } from '@/lib/links';
import { CONTACT_EMAIL } from '../landing-content';
import PrivacyPage from '../../pages/privacy.astro';
import TermsPage from '../../pages/terms.astro';

describe('legal pages', () => {
	it('render the Terms and the Privacy Policy with the site nav and contact', async () => {
		const container = await AstroContainer.create({
			astroConfig: { site: 'https://skillpouch.net' },
			renderers: await loadRenderers([getContainerRenderer()]),
		});
		for (const [page, title, path] of [
			[TermsPage, 'Terms of Service', '/terms/'],
			[PrivacyPage, 'Privacy Policy', '/privacy/'],
		] as const) {
			const html = await container.renderToString(page);
			expect(html).toContain(`<h1`);
			expect(html).toContain(title);
			expect(html).toContain(`href="https://skillpouch.net${path}"`);
			expect(html).toContain(`mailto:${CONTACT_EMAIL}`);
			expect(html).toContain('href="/terms/"');
			expect(html).toContain('href="/privacy/"');
			expect(html).toContain(`href="${SIGN_IN_URL}"`);
		}
	});
});
