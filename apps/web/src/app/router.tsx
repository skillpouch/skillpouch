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
 *   /app/p/:pouchId          overview, /:kind lists, /shared, /conflicts, /settings
 *   /app/account             profile, /devices, /usage, /security, /billing
 *   /app/p/:pouchId/marketplaces  skills.sh, MCP Registry, GitHub repositories
 *   /app/p/:pouchId/trash    deleted items, restorable for 7 days
 *   /cli/authorize           approve a `skillpouch login`
 *   /github/connected        return from installing the GitHub App
 *   /s/:shareId              public share link
 *   /admin                   admin dashboard (admins only; others see not found)
 *   /                        opens the app (the landing page, Terms and Privacy are the
 *                            static site on its own host)
 *
 * Pages are code-split; layouts, the session gate and crypto load up front.
 */
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
} from '@tanstack/react-router';
import { lazy, Suspense, type ReactNode } from 'react';
import { CONTENT_SCROLL_ID } from '@/components/layout/app-shell';
import { SessionGate, type GateRequirement } from '@/features/session/session-gate';
import { NotFoundPage } from '@/pages/not-found-page';
import type { IngredientsSearch } from '@/pages/pouch/ingredients-page';
import { AuthSkeleton, PageSkeleton } from '@/components/ui/page-skeleton';
import { AccountLayout } from '@/pages/account/account-layout';
import { AdminLayout } from '@/pages/admin/admin-layout';
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
const UsagePage = lazyPage(
	() => import('@/pages/account/usage-page'),
	'UsagePage',
	<PageSkeleton variant="usage" />,
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
const ConflictsPage = lazyPage(() => import('@/pages/pouch/conflicts-page'), 'ConflictsPage', list);
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
const TrashPage = lazyPage(() => import('@/pages/pouch/trash-page'), 'TrashPage', list);
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
const AdminOverviewPage = lazyPage(
	() => import('@/pages/admin/overview-page'),
	'AdminOverviewPage',
	<PageSkeleton variant="overview" />,
);
const AdminAnalyticsPage = lazyPage(
	() => import('@/pages/admin/analytics-page'),
	'AdminAnalyticsPage',
	<PageSkeleton variant="overview" />,
);
const AdminUsersPage = lazyPage(
	() => import('@/pages/admin/users-page'),
	'AdminUsersPage',
	<PageSkeleton variant="list" />,
);
const AdminUserPage = lazyPage(
	() => import('@/pages/admin/user-page'),
	'AdminUserPage',
	<PageSkeleton variant="settings" />,
);
const AdminSubscriptionsPage = lazyPage(
	() => import('@/pages/admin/billing-pages'),
	'AdminSubscriptionsPage',
	<PageSkeleton variant="list" />,
);
const AdminPaymentsPage = lazyPage(
	() => import('@/pages/admin/billing-pages'),
	'AdminPaymentsPage',
	<PageSkeleton variant="list" />,
);
const AdminPlansPage = lazyPage(
	() => import('@/pages/admin/plans-page'),
	'AdminPlansPage',
	<PageSkeleton variant="list" />,
);
const AdminAuditPage = lazyPage(
	() => import('@/pages/admin/audit-page'),
	'AdminAuditPage',
	<PageSkeleton variant="list" />,
);
const AdminSystemPage = lazyPage(
	() => import('@/pages/admin/system-page'),
	'AdminSystemPage',
	<PageSkeleton variant="overview" />,
);
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
	beforeLoad: () => {
		throw redirect({ to: '/app', replace: true });
	},
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

const conflictsRoute = createRoute({
	getParentRoute: () => pouchRoute,
	path: '/conflicts',
	component: ConflictsPage,
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

const trashRoute = createRoute({
	getParentRoute: () => pouchRoute,
	path: '/trash',
	component: TrashPage,
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
const usageRoute = createRoute({
	getParentRoute: () => accountRoute,
	path: '/usage',
	component: UsagePage,
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

const adminRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/admin',
	component: gated('unlocked', () => (
		<UnlockedRoot>
			<AdminLayout />
		</UnlockedRoot>
	)),
});

const adminOverviewRoute = createRoute({
	getParentRoute: () => adminRoute,
	path: '/',
	component: AdminOverviewPage,
});

const adminAnalyticsRoute = createRoute({
	getParentRoute: () => adminRoute,
	path: '/analytics',
	component: AdminAnalyticsPage,
});

const adminUsersRoute = createRoute({
	getParentRoute: () => adminRoute,
	path: '/users',
	component: AdminUsersPage,
});

const adminUserRoute = createRoute({
	getParentRoute: () => adminRoute,
	path: '/users/$userId',
	component: AdminUserPage,
});

const adminSubscriptionsRoute = createRoute({
	getParentRoute: () => adminRoute,
	path: '/subscriptions',
	component: AdminSubscriptionsPage,
});

const adminPaymentsRoute = createRoute({
	getParentRoute: () => adminRoute,
	path: '/payments',
	component: AdminPaymentsPage,
});

const adminPlansRoute = createRoute({
	getParentRoute: () => adminRoute,
	path: '/plans',
	component: AdminPlansPage,
});

const adminAuditRoute = createRoute({
	getParentRoute: () => adminRoute,
	path: '/audit',
	component: AdminAuditPage,
});

const adminSystemRoute = createRoute({
	getParentRoute: () => adminRoute,
	path: '/system',
	component: AdminSystemPage,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	signInRoute,
	setupRoute,
	unlockRoute,
	cliAuthorizeRoute,
	githubConnectedRoute,
	shareRoute,
	appRoute.addChildren([
		pouchesRoute,
		pouchRoute.addChildren([
			overviewRoute,
			sharedRoute,
			conflictsRoute,
			pouchSettingsRoute,
			marketplacesRoute,
			trashRoute,
			kindRoute,
		]),
		accountRoute.addChildren([
			profileRoute,
			devicesRoute,
			usageRoute,
			securityRoute,
			billingRoute,
		]),
	]),
	adminRoute.addChildren([
		adminOverviewRoute,
		adminAnalyticsRoute,
		adminUsersRoute,
		adminUserRoute,
		adminSubscriptionsRoute,
		adminPaymentsRoute,
		adminPlansRoute,
		adminAuditRoute,
		adminSystemRoute,
	]),
]);

export const router = createRouter({
	routeTree,
	defaultPreload: 'intent',
	scrollRestoration: true,
	scrollToTopSelectors: [`#${CONTENT_SCROLL_ID}`],
});
