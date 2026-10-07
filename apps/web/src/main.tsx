// SPDX-License-Identifier: AGPL-3.0-only
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { preloadPages, router } from './app/router';
import { bootstrapSession } from './features/session/bootstrap';
import './styles/globals.css';

if (import.meta.env.DEV) void import('./lib/dev-tools').then((tools) => tools.installDevTools());
void bootstrapSession();
preloadPages();

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
