// SPDX-License-Identifier: AGPL-3.0-only
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { preloadPages, router } from './app/router';
import { bootstrapSession } from './features/session/bootstrap';
import {
	completeStepUpWindow,
	requestStepUp,
	STEP_UP_CALLBACK_PATH,
} from './features/session/step-up';
import { setStepUpHandler } from './lib/api/client';
import './styles/globals.css';

if (location.pathname === STEP_UP_CALLBACK_PATH) {
	// The step-up sign-in window: report back to the waiting tab, don't boot.
	completeStepUpWindow();
	document.getElementById('root')!.textContent = 'Signed in. You can close this window.';
} else {
	if (import.meta.env.DEV)
		void import('./lib/dev-tools').then((tools) => tools.installDevTools());
	setStepUpHandler(requestStepUp);
	void bootstrapSession();
	preloadPages();

	createRoot(document.getElementById('root')!).render(
		<StrictMode>
			<RouterProvider router={router} />
		</StrictMode>,
	);
}
