// SPDX-License-Identifier: AGPL-3.0-only
/**
 * App-level providers and the pieces that run only while unlocked: the live
 * event stream and the `me` refresher.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAccountEvents } from '@/features/realtime/account-events';
import { StepUpDialog } from '@/features/session/step-up-dialog';
import { useMeSync } from '@/features/session/use-me-sync';
import { queryClient } from '@/lib/query-client';

export function RootLayout() {
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<Outlet />
				<StepUpDialog />
				<Toaster />
			</TooltipProvider>
		</QueryClientProvider>
	);
}

export function UnlockedRoot({ children }: { children: ReactNode }) {
	useMeSync();
	useAccountEvents(true);
	return <>{children}</>;
}
