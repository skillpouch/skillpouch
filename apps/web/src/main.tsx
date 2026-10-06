// SPDX-License-Identifier: AGPL-3.0-only
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './app/router';
import { bootstrapSession } from './features/session/bootstrap';
import './styles/globals.css';

void bootstrapSession();

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
