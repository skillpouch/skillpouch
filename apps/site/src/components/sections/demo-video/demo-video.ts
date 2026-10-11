// SPDX-License-Identifier: AGPL-3.0-only
/** The promo video, served from `public/`. */
export const DEMO_VIDEO = {
	src: '/video/skillpouch-promo.mp4',
	poster: '/video/skillpouch-promo-poster.webp',
	width: 1920,
	height: 1080,
} as const;

/** Cloudflare Pages refuses to deploy any single file larger than this. */
export const PAGES_FILE_LIMIT_BYTES = 25 * 1024 * 1024;
