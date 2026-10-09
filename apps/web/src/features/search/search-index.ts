// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What ⌘K can find: pages, pouches, devices, browsers, invoices and — inside
 * a pouch — its items. Everything is matched in memory; the
 * query never leaves the browser.
 */
import {
	Activity,
	CreditCard,
	FileText,
	Globe,
	LayoutGrid,
	Laptop,
	MonitorSmartphone,
	Package,
	Settings,
	Share2,
	Store,
	Shield,
	User,
	type LucideIcon,
} from 'lucide-react';
import type { DeviceList } from '@/features/devices/devices';
import { inScope, type Ingredient } from '@/features/ingredients/ingredients';
import { KINDS, kindDefinition } from '@/features/ingredients/kinds';
import type { Invoice } from '@/lib/api/types';
import { formatDate, formatMoney, formatRelative } from '@/lib/format';
import { browserLabel } from '@/lib/platform';

export type SearchGroup = 'Items' | 'Pouches' | 'Pages' | 'Computers' | 'Browsers' | 'Invoices';

export interface SearchResult {
	id: string;
	group: SearchGroup;
	label: string;
	hint: string;
	icon: LucideIcon;
	/** Where the result goes, as a URL path with its query. */
	href: string;
	/** Extra words it should be found by. */
	keywords?: string;
}

export interface SearchSources {
	pouch?: { id: string; ingredients: Ingredient[] };
	pouches: { id: string; name: string; description: string; state: string }[];
	devices: DeviceList | undefined;
	invoices: Invoice[] | undefined;
}

const GROUP_ORDER: SearchGroup[] = [
	'Items',
	'Pouches',
	'Pages',
	'Computers',
	'Browsers',
	'Invoices',
];

/** With an empty query only a few of each group are shown. */
const IDLE_LIMIT = 5;
const MATCH_LIMIT = 8;

const ACCOUNT_PAGES: SearchResult[] = [
	{
		id: 'page-pouches',
		group: 'Pages',
		label: 'All pouches',
		hint: 'Go to',
		icon: Package,
		href: '/app',
		keywords: 'home dashboard',
	},
	{
		id: 'page-profile',
		group: 'Pages',
		label: 'Profile',
		hint: 'Account',
		icon: User,
		href: '/app/account',
		keywords: 'account name email avatar delete',
	},
	{
		id: 'page-devices',
		group: 'Pages',
		label: 'Devices',
		hint: 'Account',
		icon: MonitorSmartphone,
		href: '/app/account/devices',
		keywords: 'computers browsers cli sessions revoke',
	},
	{
		id: 'page-usage',
		group: 'Pages',
		label: 'Usage',
		hint: 'Account',
		icon: Activity,
		href: '/app/account/usage',
		keywords: 'tokens usage claude codex opencode models stats',
	},
	{
		id: 'page-security',
		group: 'Pages',
		label: 'Security',
		hint: 'Account',
		icon: Shield,
		href: '/app/account/security',
		keywords: 'master password recovery key passkeys events trust',
	},
	{
		id: 'page-billing',
		group: 'Pages',
		label: 'Billing',
		hint: 'Account',
		icon: CreditCard,
		href: '/app/account/billing',
		keywords: 'plan subscription upgrade invoices receipts payment',
	},
];

function pouchPages(pouchId: string): SearchResult[] {
	const base = `/app/p/${pouchId}`;
	return [
		{
			id: 'page-overview',
			group: 'Pages',
			label: 'Overview',
			hint: 'This pouch',
			icon: LayoutGrid,
			href: base,
		},
		...KINDS.map<SearchResult>((kind) => ({
			id: `page-${kind.slug}`,
			group: 'Pages',
			label: kind.label,
			hint: 'This pouch',
			icon: kind.icon,
			href: `${base}/${kind.slug}`,
		})),
		{
			id: 'page-marketplaces',
			group: 'Pages',
			label: 'Marketplaces',
			hint: 'Skills, agents and MCP servers to add',
			icon: Store,
			href: `${base}/marketplaces`,
		},
		{
			id: 'page-shared',
			group: 'Pages',
			label: 'Shared links',
			hint: 'This pouch',
			icon: Share2,
			href: `${base}/shared`,
		},
		{
			id: 'page-settings',
			group: 'Pages',
			label: 'Pouch settings',
			hint: 'This pouch',
			icon: Settings,
			href: `${base}/settings`,
			keywords: 'rename delete members',
		},
	];
}

function query(params: Record<string, string>): string {
	return `?${new URLSearchParams(params).toString()}`;
}

function pouchResults(pouch: NonNullable<SearchSources['pouch']>): SearchResult[] {
	const base = `/app/p/${pouch.id}`;
	const items = inScope(pouch.ingredients).map<SearchResult>((item) => {
		const kind = kindDefinition(item.kind)!;
		return {
			id: `item-${item.id}`,
			group: 'Items',
			label: item.name,
			hint: kind.singular,
			icon: kind.icon,
			href: `${base}/${kind.slug}${query({ item: item.id })}`,
		};
	});
	return [...items, ...pouchPages(pouch.id)];
}

function accountResults(sources: SearchSources): SearchResult[] {
	const devicesPage = '/app/account/devices';
	const pouches = sources.pouches
		.filter((pouch) => pouch.state !== 'deleted' && pouch.id !== sources.pouch?.id)
		.map<SearchResult>((pouch) => ({
			id: `pouch-${pouch.id}`,
			group: 'Pouches',
			label: pouch.name,
			hint: pouch.state === 'locked' ? 'Pouch · locked' : 'Pouch',
			icon: Package,
			href: `/app/p/${pouch.id}`,
			keywords: pouch.description,
		}));
	const computers = (sources.devices?.devices ?? [])
		.filter((device) => device.state !== 'revoked')
		.map<SearchResult>((device) => ({
			id: `device-${device.id}`,
			group: 'Computers',
			label: device.name,
			hint: `Computer · last seen ${formatRelative(device.last_seen_at)}`,
			icon: Laptop,
			href: devicesPage,
			keywords: `device cli ${device.os} ${device.assistants.join(' ')}`,
		}));
	const browsers = (sources.devices?.browsers ?? [])
		.filter((browser) => !browser.revoked_at && browser.removed_seq === null)
		.map<SearchResult>((browser) => ({
			id: `browser-${browser.member_id}`,
			group: 'Browsers',
			label: browser.is_current ? `${browserLabel()} (this browser)` : 'Browser',
			hint: `Last used ${formatRelative(browser.last_seen_at)}`,
			icon: Globe,
			href: devicesPage,
			keywords: 'device session',
		}));
	const invoices = (sources.invoices ?? []).map<SearchResult>((invoice) => ({
		id: `invoice-${invoice.id}`,
		group: 'Invoices',
		label: `${invoice.description} · ${formatMoney(invoice.amount_cents, invoice.currency)}`,
		hint: formatDate(invoice.created_at),
		icon: FileText,
		href: '/app/account/billing',
		keywords: `invoice receipt payment billing ${invoice.status}`,
	}));
	return [...pouches, ...ACCOUNT_PAGES, ...computers, ...browsers, ...invoices];
}

/** 0 = the label starts with the query, 1 = the label contains it, 2 = only the rest does. */
function rank(result: SearchResult, words: string[]): number | null {
	const label = result.label.toLowerCase();
	const haystack =
		`${label} ${result.hint} ${result.group} ${result.keywords ?? ''}`.toLowerCase();
	if (!words.every((word) => haystack.includes(word))) return null;
	if (label.startsWith(words[0]!)) return 0;
	return words.every((word) => label.includes(word)) ? 1 : 2;
}

/** Results grouped in a fixed order, best matches first within each group. */
export function searchEverything(sources: SearchSources, text: string): SearchResult[] {
	const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const all = [...(sources.pouch ? pouchResults(sources.pouch) : []), ...accountResults(sources)];
	return GROUP_ORDER.flatMap((group) => {
		const inGroup = all.filter((result) => result.group === group);
		if (words.length === 0) {
			// Idle: the pouch's own pages and account pages are the useful jumps.
			if (group === 'Pages') return inGroup;
			return inGroup.slice(0, group === 'Items' || group === 'Pouches' ? IDLE_LIMIT : 0);
		}
		return inGroup
			.map((result) => ({ result, score: rank(result, words) }))
			.filter(
				(entry): entry is { result: SearchResult; score: number } => entry.score !== null,
			)
			.sort((a, b) => a.score - b.score)
			.slice(0, MATCH_LIMIT)
			.map((entry) => entry.result);
	});
}
