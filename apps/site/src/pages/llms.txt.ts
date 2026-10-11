// SPDX-License-Identifier: AGPL-3.0-only
import type { APIRoute } from 'astro';
import { llmsTxt } from '@/lib/llms';

export const GET: APIRoute = () =>
	new Response(llmsTxt(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
