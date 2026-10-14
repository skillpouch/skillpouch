// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
			<p className="font-mono text-xs text-meta">404</p>
			<h1 className="text-xl font-semibold">Nothing here</h1>
			<p className="max-w-sm text-[13px] text-muted">
				This page doesn’t exist, or it belongs to a pouch you can’t open.
			</p>
			<Button asChild className="mt-2">
				<Link to="/pouches">Back to pouches</Link>
			</Button>
		</div>
	);
}
