// SPDX-License-Identifier: AGPL-3.0-only
/** App-wide toasts (sonner), styled to match the dark surfaces. */
import { Toaster as Sonner, toast } from 'sonner';

export function Toaster() {
	return (
		<Sonner
			theme="dark"
			position="bottom-right"
			toastOptions={{
				classNames: {
					toast: '!bg-surface !border-border !text-fg !text-[13px] !rounded-lg',
					description: '!text-muted',
				},
			}}
		/>
	);
}

export { toast };
