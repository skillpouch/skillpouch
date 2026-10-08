// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SkillPouch GitHub App: read-only access to the repositories a user
 * picks on GitHub.
 *
 * Connecting never trusts an `installation_id` from the browser. The user
 * authorizes the app, we exchange that code for a user token and keep only
 * installations GitHub lists for that user: their own account, or an
 * organization they administer. Repository reads then use short-lived
 * installation tokens (cached until shortly before they expire).
 */
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';
import { AppError } from '../../http/app-error';

const API = 'https://api.github.com';
const TOKEN_MARGIN_MS = 5 * 60_000;
const MAX_REPO_PAGES = 10;

export interface GithubAppConfig {
	appId: string;
	slug: string;
	clientId: string;
	clientSecret: string;
	/** PEM from the app's settings page (PKCS#1 or PKCS#8). */
	privateKey: string;
}

export interface GithubInstallation {
	installationId: number;
	accountLogin: string;
	accountType: 'User' | 'Organization';
	githubUserId: number;
}

export interface GithubRepository {
	full_name: string;
	private: boolean;
	description: string | null;
}

interface RawInstallation {
	id: number;
	account: { login: string; id: number; type: string } | null;
}

export class GithubApp {
	private readonly key: KeyObject;
	private readonly tokens = new Map<number, { token: string; expires: number }>();

	constructor(
		private readonly config: GithubAppConfig,
		private readonly http: typeof fetch = fetch,
		private readonly now: () => Date = () => new Date(),
	) {
		this.key = createPrivateKey(config.privateKey.replace(/\\n/g, '\n'));
	}

	/** Where the browser goes to install the app and pick repositories. */
	get installUrl(): string {
		return `https://github.com/apps/${encodeURIComponent(this.config.slug)}/installations/new`;
	}

	/** Where the browser goes to re-authorize when the app is already installed. */
	get authorizeUrl(): string {
		return `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(this.config.clientId)}`;
	}

	private async request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
		const response = await this.http(`${API}${path}`, {
			...init,
			headers: {
				Accept: 'application/vnd.github+json',
				'User-Agent': 'skillpouch',
				Authorization: `Bearer ${token}`,
				...init.headers,
			},
			signal: AbortSignal.timeout(10_000),
		});
		if (response.status === 401 || response.status === 403 || response.status === 404) {
			throw new AppError('forbidden', {
				reason: 'GitHub refused access',
				status: response.status,
			});
		}
		if (!response.ok) throw new AppError('upstream_unavailable', { status: response.status });
		return (await response.json()) as T;
	}

	private async appJwt(): Promise<string> {
		const issuedAt = Math.floor(this.now().getTime() / 1000) - 60;
		return new SignJWT({})
			.setProtectedHeader({ alg: 'RS256' })
			.setIssuer(this.config.appId)
			.setIssuedAt(issuedAt)
			.setExpirationTime(issuedAt + 9 * 60)
			.sign(this.key);
	}

	/** Exchanges the code from GitHub's redirect for a user token. */
	private async userToken(code: string): Promise<string> {
		const response = await this.http('https://github.com/login/oauth/access_token', {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_id: this.config.clientId,
				client_secret: this.config.clientSecret,
				code,
			}),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new AppError('upstream_unavailable', { status: response.status });
		const body = (await response.json()) as { access_token?: string; error?: string };
		if (!body.access_token) {
			throw new AppError('validation_failed', {
				reason: 'GitHub did not accept the authorization code; connect again',
				error: body.error,
			});
		}
		return body.access_token;
	}

	/** The installations this GitHub user may connect: their own, or of orgs they administer. */
	async verifiedInstallations(code: string): Promise<GithubInstallation[]> {
		const token = await this.userToken(code);
		const user = await this.request<{ id: number; login: string }>('/user', token);
		const { installations } = await this.request<{ installations: RawInstallation[] }>(
			'/user/installations?per_page=100',
			token,
		);
		const verified: GithubInstallation[] = [];
		for (const installation of installations) {
			const account = installation.account;
			if (!account) continue;
			const own = account.type === 'User' && account.id === user.id;
			const admin =
				account.type === 'Organization' && (await this.isOrgAdmin(token, account.login));
			if (!own && !admin) continue;
			verified.push({
				installationId: installation.id,
				accountLogin: account.login,
				accountType: account.type === 'User' ? 'User' : 'Organization',
				githubUserId: user.id,
			});
		}
		return verified;
	}

	private async isOrgAdmin(userToken: string, org: string): Promise<boolean> {
		try {
			const membership = await this.request<{ role: string; state: string }>(
				`/user/memberships/orgs/${encodeURIComponent(org)}`,
				userToken,
			);
			return membership.role === 'admin' && membership.state === 'active';
		} catch (error) {
			if (error instanceof AppError && error.code === 'forbidden') return false;
			throw error;
		}
	}

	/** A short-lived token that reads the installation's repositories. */
	async installationToken(installationId: number): Promise<string> {
		const cached = this.tokens.get(installationId);
		if (cached && cached.expires - TOKEN_MARGIN_MS > this.now().getTime()) return cached.token;
		const body = await this.request<{ token: string; expires_at: string }>(
			`/app/installations/${installationId}/access_tokens`,
			await this.appJwt(),
			{ method: 'POST' },
		);
		this.tokens.set(installationId, {
			token: body.token,
			expires: Date.parse(body.expires_at),
		});
		return body.token;
	}

	/** Repositories the user picked for this installation. */
	async repositories(installationId: number): Promise<GithubRepository[]> {
		const token = await this.installationToken(installationId);
		const repos: GithubRepository[] = [];
		for (let page = 1; page <= MAX_REPO_PAGES; page++) {
			const body = await this.request<{
				total_count: number;
				repositories: GithubRepository[];
			}>(`/installation/repositories?per_page=100&page=${page}`, token);
			repos.push(
				...body.repositories.map(({ full_name, private: isPrivate, description }) => ({
					full_name,
					private: isPrivate,
					description,
				})),
			);
			if (repos.length >= body.total_count || body.repositories.length === 0) break;
		}
		return repos;
	}

	/** Forgets cached tokens, e.g. after the user disconnects. */
	forget(installationId: number): void {
		this.tokens.delete(installationId);
	}
}
