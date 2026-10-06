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
 *   /cli/authorize           approve a `skillpouch login`
 *   /s/:shareId              public share link
 *
 * `/` belongs to the future landing page; for now it forwards to `/app`.
 */
import {
	createRootRoute,
	createRoute,
	createRouter,
	Navigate,
	Outlet,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SessionGate, type GateRequirement } from '@/features/session/session-gate';
import { AccountLayout } from '@/pages/account/account-layout';
import { BillingPage } from '@/pages/account/billing-page';
import { DevicesPage } from '@/pages/account/devices-page';
import { ProfilePage } from '@/pages/account/profile-page';
import { SecurityPage } from '@/pages/account/security-page';
import { CliAuthorizePage } from '@/pages/cli-authorize/cli-authorize-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { IngredientsPage, type IngredientsSearch } from '@/pages/pouch/ingredients-page';
import { OverviewPage } from '@/pages/pouch/overview-page';
import { PouchLayout } from '@/pages/pouch/pouch-layout';
import { PouchSettingsPage } from '@/pages/pouch/pouch-settings-page';
import { SharedLinksPage } from '@/pages/pouch/shared-links-page';
import { PouchesPage } from '@/pages/pouches/pouches-page';
import { PublicSharePage } from '@/pages/share/public-share-page';
import { SignInPage } from '@/pages/sign-in/sign-in-page';
import { SetupPage } from '@/pages/setup/setup-page';
import { UnlockPage } from '@/pages/unlock/unlock-page';
import { RootLayout, UnlockedRoot } from './root';

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

const pouchSettingsRoute = createRoute({
	getParentRoute: () => pouchRoute,
	path: '/settings',
	component: PouchSettingsPage,
});

const kindRoute = createRoute({
	getParentRoute: () => pouchRoute,
	path: '/$kind',
	validateSearch: (search: Record<string, unknown>): IngredientsSearch => {
		const item = optionalString(search.item);
		return {
			...(item ? { item } : {}),
			...(search.mode === 'edit' || search.mode === 'show' ? { mode: search.mode } : {}),
			...(search.new === true || search.new === 'true' || search.new === 1
				? { new: true }
				: {}),
		};
	},
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
	shareRoute,
	appRoute.addChildren([
		pouchesRoute,
		pouchRoute.addChildren([overviewRoute, sharedRoute, pouchSettingsRoute, kindRoute]),
		accountRoute.addChildren([profileRoute, devicesRoute, securityRoute, billingRoute]),
	]),
]);

export const router = createRouter({
	routeTree,
	defaultPreload: 'intent',
	scrollRestoration: true,
});
