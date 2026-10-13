// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { breadcrumbs, guideJsonLd, isApiOperation, sidebarLabels } from './seo';

describe('isApiOperation', () => {
	it('matches generated endpoint pages, by path or full URL', () => {
		expect(isApiOperation('/api/operations/v1adminusersidsuspend/')).toBe(true);
		expect(
			isApiOperation('https://docs.skillpouch.net/api/operations/v1billingwebhookspolar/'),
		).toBe(true);
	});

	it('keeps the API overview and the guides', () => {
		expect(isApiOperation('/api/')).toBe(false);
		expect(isApiOperation('https://docs.skillpouch.net/api/')).toBe(false);
		expect(isApiOperation('https://docs.skillpouch.net/getting-started/second-computer/')).toBe(
			false,
		);
	});
});

describe('breadcrumbs', () => {
	const labels = sidebarLabels([
		{ type: 'link', label: 'Install', href: '/getting-started/install/' },
		{
			type: 'group',
			label: 'CLI',
			entries: [
				{ type: 'link', label: 'Overview', href: '/cli/' },
				{ type: 'link', label: 'login', href: '/cli/login/' },
				{ type: 'link', label: 'GitHub', href: 'https://github.com/skillpouch' },
			],
		},
	]);

	it('reads every internal sidebar link', () => {
		expect([...labels.keys()]).toEqual(['/getting-started/install/', '/cli/', '/cli/login/']);
	});

	it('runs from the docs home through parent pages to the page', () => {
		expect(breadcrumbs('/cli/login/', 'skillpouch login', labels)).toEqual([
			{ name: 'SkillPouch Docs', path: '/' },
			{ name: 'Overview', path: '/cli/' },
			{ name: 'skillpouch login', path: '/cli/login/' },
		]);
		// `/getting-started/` is no page of its own, so it is skipped.
		expect(breadcrumbs('/getting-started/install/', 'Install', labels)).toHaveLength(2);
	});
});

describe('guideJsonLd', () => {
	it('describes the guide as a TechArticle about SkillPouch, with its breadcrumbs', () => {
		const body = guideJsonLd({
			path: '/security/',
			title: 'Security </script>',
			description: 'How it works',
			crumbs: [
				{ name: 'SkillPouch Docs', path: '/' },
				{ name: 'Security', path: '/security/' },
			],
		});
		expect(body).not.toContain('</script>');
		const { '@context': context, '@graph': graph } = JSON.parse(body);
		expect(context).toBe('https://schema.org');
		expect(graph[0]).toMatchObject({
			'@type': 'TechArticle',
			url: 'https://docs.skillpouch.net/security/',
			description: 'How it works',
			about: { '@id': 'https://skillpouch.net/#software' },
		});
		expect(graph[1].itemListElement[1]).toEqual({
			'@type': 'ListItem',
			position: 2,
			name: 'Security',
			item: 'https://docs.skillpouch.net/security/',
		});
	});
});
