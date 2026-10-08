// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The route tree. Every page states the session it needs through
 * `SessionGate`; layouts (`/app/p/:pouchId`, `/app/account`) own their
 * navigation and render children through `<Outlet />`.
 *
 *   /sign-in                 GitHub / Google
 *   /setup                   first-time onboarding (master password, Recovery Key)
 *   /unlock                  new or lapsed browser
 *   /app                     pouches
 *   /app/p/:pouchId          overview, /:kind lists, /shared, /settings
 *   /app/account             profile, /devices, /security, /billing
 *   /app/p/:pouchId/marketplaces  skills.sh, MCP Registry, GitHub repositories
 *   /cli/authorize           approve a `skillpouch login`
 *   /github/connected        return from installing the GitHub App
 *   /s/:shareId              public share link
 *   /terms, /privacy         legal pages
 *
 * `/` belongs to the future landing page; for now it forwards to `/app`.
 * Pages are code-split; layouts, the session gate and crypto load up front.
 */
import {
	createRootRoute,
	createRoute,
	createRouter,
	Navigate,
	Outlet,
} from '@tanstack/react-router';
import { lazy, Suspense, type ReactNode } from 'react';
import { CONTENT_SCROLL_ID } from '@/components/layout/app-shell';
import { SessionGate, type GateRequirement } from '@/features/session/session-gate';
import { NotFoundPage } from '@/pages/not-found-page';
import type { IngredientsSearch } from '@/pages/pouch/ingredients-page';
import { AuthSkeleton, PageSkeleton } from '@/components/ui/page-skeleton';
import { AccountLayout } from '@/pages/account/account-layout';
import { PouchLayout } from '@/pages/pouch/pouch-layout';
import { PouchesPage } from '@/pages/pouches/pouches-page';
import { RootLayout, UnlockedRoot } from './root';

// Layouts are part of the main bundle, so the sidebar and top bar never
// disappear. Each page is its own chunk; while it loads, a skeleton shaped
// like that page fills the content area inside the layout. All chunks are
// fetched in the background shortly after start, so later visits are instant.
const pageLoaders: (() => Promise<unknown>)[] = [];

function lazyPage<K extends string>(
	load: () => Promise<Record<K, () => ReactNode>>,
	name: K,
	fallback: ReactNode,
): () => ReactNode {
	pageLoaders.push(load);
	const Page = lazy(async () => ({ default: (await load())[name] as () => ReactNode }));
	return () => (
		<Suspense fallback={fallback}>
			<Page />
		</Suspense>
	);
}

const list = <PageSkeleton variant="list" />;
const settings = <PageSkeleton variant="settings" />;
const auth = <AuthSkeleton />;

const BillingPage = lazyPage(
	() => import('@/pages/account/billing-page'),
	'BillingPage',
	<PageSkeleton variant="billing" />,
);
const DevicesPage = lazyPage(
	() => import('@/pages/account/devices-page'),
	'DevicesPage',
	<PageSkeleton variant="devices" />,
);
const ProfilePage = lazyPage(
	() => import('@/pages/account/profile-page'),
	'ProfilePage',
	<PageSkeleton variant="profile" />,
);
const SecurityPage = lazyPage(
	() => import('@/pages/account/security-page'),
	'SecurityPage',
	settings,
);
const CliAuthorizePage = lazyPage(
	() => import('@/pages/cli-authorize/cli-authorize-page'),
	'CliAuthorizePage',
	auth,
);
const IngredientsPage = lazyPage(
	() => import('@/pages/pouch/ingredients-page'),
	'IngredientsPage',
	list,
);
const OverviewPage = lazyPage(
	() => import('@/pages/pouch/overview-page'),
	'OverviewPage',
	<PageSkeleton variant="overview" />,
);
const PouchSettingsPage = lazyPage(
	() => import('@/pages/pouch/pouch-settings-page'),
	'PouchSettingsPage',
	<PageSkeleton variant="form" />,
);
const SharedLinksPage = lazyPage(
	() => import('@/pages/pouch/shared-links-page'),
	'SharedLinksPage',
	list,
);
const MarketplacesPage = lazyPage(
	() => import('@/pages/pouch/marketplaces-page'),
	'MarketplacesPage',
	list,
);
const GithubConnectedPage = lazyPage(
	() => import('@/pages/github/github-connected-page'),
	'GithubConnectedPage',
	auth,
);
const PublicSharePage = lazyPage(
	() => import('@/pages/share/public-share-page'),
	'PublicSharePage',
	auth,
);
const TermsPage = lazyPage(() => import('@/pages/legal/terms-page'), 'TermsPage', null);
const PrivacyPage = lazyPage(() => import('@/pages/legal/privacy-page'), 'PrivacyPage', null);
const SignInPage = lazyPage(() => import('@/pages/sign-in/sign-in-page'), 'SignInPage', auth);
const SetupPage = lazyPage(() => import('@/pages/setup/setup-page'), 'SetupPage', auth);
const UnlockPage = lazyPage(() => import('@/pages/unlock/unlock-page'), 'UnlockPage', auth);

/** Fetches every page chunk once the browser is idle. */
export function preloadPages(): void {
	const run = () => {
		for (const load of pageLoaders) void load().catch(() => undefined);
	};
	if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 });
	else setTimeout(run, 1500);
}

const gated = (require: GateRequirement, page: () => ReactNode) => () => (
	<SessionGate require={require}>{page()}</SessionGate>
);

const optionalString = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundPage });

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: () => <Navigate to="/app" replace />,
});

const signInRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/sign-in',
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: optionalString(search.redirect),
		from: optionalString(search.from),
		error: optionalString(search.error),
	}),
	component: gated('signed_out', () => <SignInPage />),
});

const setupRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/setup',
	component: gated('setup_required', () => <SetupPage />),
});

const unlockRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/unlock',
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: optionalString(search.redirect),
	}),
	component: gated('locked', () => <UnlockPage />),
});

const cliAuthorizeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/cli/authorize',
	validateSearch: (search: Record<string, unknown>) => ({
		request: optionalString(search.request),
	}),
	component: gated('unlocked', () => (
		<UnlockedRoot>
			<CliAuthorizePage />
		</UnlockedRoot>
	)),
});

const githubConnectedRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/github/connected',
	validateSearch: (search: Record<string, unknown>) => ({
		code: optionalString(search.code),
		state: optionalString(search.state),
	}),
	component: gated('unlocked', () => <GithubConnectedPage />),
});

const shareRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/s/$shareId',
	component: PublicSharePage,
});

const termsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/terms',
	component: TermsPage,
});

const privacyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/privacy',
	component: PrivacyPage,
});

const appRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/app',
	component: gated('unlocked', () => (
		<UnlockedRoot>
			<Outlet />
		</UnlockedRoot>
	)),
});

const pouchesRoute = createRoute({
	getParentRoute: () => appRoute,
	path: '/',
	component: PouchesPage,
});

const pouchRoute = createRoute({
	getParentRoute: () => appRoute,
	path: '/p/$pouchId',
	component: PouchLayout,
});

const overviewRoute = createRoute({
	getParentRoute: () => pouchRoute,
	path: '/',
	component: OverviewPage,
});

const sharedRoute = createRoute({
	getParentRoute: () => pouchRoute,
	path: '/shared',
	component: SharedLinksPage,
});

const pouchSettingsRoute = createRoute({
	getParentRoute: () => pouchRoute,
	path: '/settings',
	component: PouchSettingsPage,
});

const marketplacesRoute = createRoute({
	getParentRoute: () => pouchRoute,
	path: '/marketplaces',
	validateSearch: (search: Record<string, unknown>) => {
		const m = optionalString(search.m);
		return m ? { m } : {};
	},
	component: MarketplacesPage,
});

const panelSearch = (search: Record<string, unknown>): IngredientsSearch => {
	const item = optionalString(search.item);
	return {
		...(item ? { item } : {}),
		...(search.mode === 'edit' || search.mode === 'show' ? { mode: search.mode } : {}),
		...(search.new === true || search.new === 'true' || search.new === 1 ? { new: true } : {}),
	};
};

const kindRoute = createRoute({
	getParentRoute: () => pouchRoute,
	path: '/$kind',
	validateSearch: panelSearch,
	component: IngredientsPage,
});

const accountRoute = createRoute({
	getParentRoute: () => appRoute,
	path: '/account',
	component: AccountLayout,
});

const profileRoute = createRoute({
	getParentRoute: () => accountRoute,
	path: '/',
	component: ProfilePage,
});
const devicesRoute = createRoute({
	getParentRoute: () => accountRoute,
	path: '/devices',
	component: DevicesPage,
});
const securityRoute = createRoute({
	getParentRoute: () => accountRoute,
	path: '/security',
	component: SecurityPage,
});
const billingRoute = createRoute({
	getParentRoute: () => accountRoute,
	path: '/billing',
	component: BillingPage,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	signInRoute,
	setupRoute,
	unlockRoute,
	cliAuthorizeRoute,
	githubConnectedRoute,
	shareRoute,
	termsRoute,
	privacyRoute,
	appRoute.addChildren([
		pouchesRoute,
		pouchRoute.addChildren([
			overviewRoute,
			sharedRoute,
			pouchSettingsRoute,
			marketplacesRoute,
			kindRoute,
		]),
		accountRoute.addChildren([profileRoute, devicesRoute, securityRoute, billingRoute]),
	]),
]);

export const router = createRouter({
	routeTree,
	defaultPreload: 'intent',
	scrollRestoration: true,
	scrollToTopSelectors: [`#${CONTENT_SCROLL_ID}`],
});
