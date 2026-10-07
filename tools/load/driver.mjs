// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Load driver: simulates SkillPouch CLI daemons against the sandbox.
 *
 * Every simulated device behaves like the real daemon: refreshes its DPoP-bound
 * token, holds a long-poll on its pouch's event feed, and (in `sync`) uploads
 * a sealed blob and commits a signed revision. Each device appears to come
 * from its own IP (X-Forwarded-For through the one trusted proxy hop), so
 * per-IP limits behave as in production.
 *
 *   node driver.mjs --scenario idle --users 10000 --duration 120 [--ramp 30]
 *   node driver.mjs --scenario sync --users 10000 --rate 200 --duration 120
 *   node driver.mjs --scenario herd --users 10000 --duration 60
 *   node driver.mjs --scenario reads --users 2000 --rate 1000 --duration 60
 *
 * Scenarios
 *   idle   devices only hold long-polls (the steady state of most users)
 *   sync   long-polls + commits at --rate per second across all devices,
 *          measuring how fast a commit reaches the device's own poll
 *   herd   every device logs in and polls at the same instant (after a deploy)
 *   reads  --rate GET requests per second on pouch, artifacts and devices lists
 *
 * `--transport stream` makes devices hold the account SSE stream
 * (`/v1/events/stream`) instead of re-issuing long-polls.
 *
 * Results: a line every 5 s, and results/<scenario>-<users>[-<rate>].json.
 */
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { promisify } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import pg from 'pg';
import { Agent, request } from 'undici';
import { Key, b64, blake3Hash, buildOp, sealed, uuidv7 } from './lib.mjs';

/** The API's public URL: what DPoP proofs name as `htu`. */
const ORIGIN = process.env.LOAD_ORIGIN ?? 'http://localhost:18090';
/**
 * Where requests actually go (comma-separated). Inside the sandbox network
 * this is `http://api:8080`; several targets spread sockets across addresses
 * so one client host can hold more than ~64k connections.
 */
const TARGETS = (
	await Promise.all(
		(process.env.LOAD_TARGETS ?? ORIGIN).split(',').map(async (target) => {
			// Resolve once: thousands of parallel lookups swamp Docker's DNS and
			// show up as connect timeouts that have nothing to do with the API.
			// A scaled service resolves to every replica; devices spread over them.
			const url = new URL(target);
			const addresses = await lookup(url.hostname, { family: 4, all: true });
			return addresses.map(({ address }) => {
				const copy = new URL(url);
				copy.hostname = address;
				return copy.origin;
			});
		}),
	)
).flat();
/** The daemon's long-poll wait (the API allows up to 55 s). */
const LONG_POLL_SECONDS = Number(process.env.LOAD_LONG_POLL ?? 55);
const DB_URL =
	process.env.SEED_DATABASE_URL ?? 'postgres://postgres:loadtest@127.0.0.1:55433/skillpouch';

// ------------------------------------------------------------------ metrics

class Stats {
	constructor() {
		this.routes = new Map();
	}
	route(name) {
		let entry = this.routes.get(name);
		if (!entry) {
			entry = { count: 0, errors: {}, latencies: [] };
			this.routes.set(name, entry);
		}
		return entry;
	}
	record(name, ms, outcome) {
		const entry = this.route(name);
		entry.count += 1;
		if (entry.latencies.length < 200_000) entry.latencies.push(ms);
		if (outcome !== 'ok') entry.errors[outcome] = (entry.errors[outcome] ?? 0) + 1;
	}
	drain() {
		const out = Object.fromEntries(this.routes);
		this.routes = new Map();
		return out;
	}
}

function merge(into, part) {
	for (const [name, entry] of Object.entries(part)) {
		const target = (into[name] ??= { count: 0, errors: {}, latencies: [] });
		target.count += entry.count;
		for (const [code, n] of Object.entries(entry.errors))
			target.errors[code] = (target.errors[code] ?? 0) + n;
		for (const ms of entry.latencies)
			if (target.latencies.length < 500_000) target.latencies.push(ms);
	}
	return into;
}

function percentiles(latencies) {
	if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
	const sorted = Float64Array.from(latencies).sort();
	const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
	return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
}

function summarize(routes, seconds) {
	return Object.fromEntries(
		Object.entries(routes)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, entry]) => {
				const errors = Object.values(entry.errors).reduce((sum, n) => sum + n, 0);
				const p = percentiles(entry.latencies);
				return [
					name,
					{
						count: entry.count,
						rps: +(entry.count / seconds).toFixed(1),
						error_rate: entry.count ? +(errors / entry.count).toFixed(4) : 0,
						errors: entry.errors,
						p50_ms: +p.p50.toFixed(1),
						p95_ms: +p.p95.toFixed(1),
						p99_ms: +p.p99.toFixed(1),
						max_ms: +p.max.toFixed(1),
					},
				];
			}),
	);
}

// ------------------------------------------------------------------ main thread

async function resetDevices(accounts) {
	// Refresh tokens rotate on every use; put the seeded ones back so a run can be repeated.
	const client = new pg.Client({ connectionString: DB_URL });
	await client.connect();
	const { createHash } = await import('node:crypto');
	for (let offset = 0; offset < accounts.length; offset += 5000) {
		const slice = accounts.slice(offset, offset + 5000);
		await client.query(
			`UPDATE devices d SET refresh_hash = t.h, prev_refresh_hash = NULL, state = 'active', revoked_at = NULL
			 FROM unnest($1::uuid[], $2::bytea[]) AS t(id, h) WHERE d.id = t.id`,
			[
				slice.map((a) => a.device),
				slice.map((a) => createHash('sha256').update(a.refresh.split('.')[3]).digest()),
			],
		);
	}
	await client.query('DELETE FROM rate_limits');
	await client.end();
}

const exec = promisify(execFile);
async function sampleServer() {
	const sample = { at: Date.now() };
	try {
		const { stdout } = await exec('docker', [
			'stats',
			'--no-stream',
			'--format',
			'{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}',
			'skillpouch-load-api-1',
			'skillpouch-load-postgres-1',
		]);
		for (const line of stdout.trim().split('\n')) {
			const [name, cpu, mem] = line.split('|');
			sample[name.includes('api') ? 'api' : 'postgres'] = {
				cpu: parseFloat(cpu),
				mem: mem.split(' / ')[0],
			};
		}
	} catch {
		// docker stats unavailable: results just lack the server columns.
	}
	return sample;
}

async function main() {
	const args = Object.fromEntries(
		process.argv.slice(2).reduce((pairs, value, index, all) => {
			if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
			return pairs;
		}, []),
	);
	const scenario = args.scenario ?? 'idle';
	const transport = args.transport ?? 'poll';
	const users = Number(args.users ?? 1000);
	const duration = Number(args.duration ?? 60);
	const rate = Number(args.rate ?? 0);
	const ramp = Number(
		args.ramp ?? (scenario === 'herd' ? 0 : Math.min(60, Math.ceil(users / 500))),
	);
	const workers = Number(
		args.workers ?? Math.min(cpus().length - 2, Math.max(1, Math.ceil(users / 2500))),
	);

	const accounts = readFileSync(new URL('./accounts.ndjson', import.meta.url), 'utf8')
		.trim()
		.split('\n')
		.slice(0, users)
		.map((line) => JSON.parse(line));
	if (accounts.length < users) throw new Error(`only ${accounts.length} seeded accounts`);
	await resetDevices(accounts);

	console.log(
		`${scenario} (${transport}): ${users} devices, ${workers} workers, ramp ${ramp}s, duration ${duration}s${rate ? `, rate ${rate}/s` : ''}`,
	);
	const totals = {};
	const timeline = [];
	const started = Date.now();
	const pool = Array.from({ length: workers }, (_, index) => {
		const worker = new Worker(new URL(import.meta.url), {
			workerData: {
				scenario,
				transport,
				accounts: accounts.filter((_, i) => i % workers === index),
				duration,
				ramp,
				rate: rate / workers,
				startAt: started + 1000,
			},
		});
		return new Promise((resolve, reject) => {
			worker.on('message', (message) => {
				if (message.type === 'stats') merge(interval, message.routes);
				if (message.type === 'done') resolve(message.state);
			});
			worker.on('error', reject);
		});
	});

	let interval = {};
	const ticker = setInterval(async () => {
		const routes = interval;
		interval = {};
		merge(totals, structuredClone(routes));
		const server = await sampleServer();
		const summary = summarize(routes, 5);
		timeline.push({ t: Math.round((Date.now() - started) / 1000), server, routes: summary });
		const line = Object.entries(summary)
			.map(
				([name, s]) =>
					`${name} ${s.rps}/s p95 ${s.p95_ms}ms${s.error_rate ? ` err ${(s.error_rate * 100).toFixed(1)}%` : ''}`,
			)
			.join(' | ');
		const srv = server.api
			? ` [api ${server.api.cpu}% ${server.api.mem} · pg ${server.postgres?.cpu}%]`
			: '';
		console.log(`t+${timeline.at(-1).t}s${srv} ${line}`);
	}, 5000);

	const states = await Promise.all(pool);
	clearInterval(ticker);
	merge(totals, interval);
	const seconds = (Date.now() - started) / 1000;
	const result = {
		scenario,
		transport,
		users,
		rate,
		duration,
		workers,
		finished_at: new Date().toISOString(),
		active_polls_at_end: states.reduce((sum, s) => sum + s.polling, 0),
		logged_in: states.reduce((sum, s) => sum + s.loggedIn, 0),
		routes: summarize(totals, seconds),
		timeline,
	};
	mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
	const file = new URL(
		`./results/${scenario}${transport === 'stream' ? '-stream' : ''}-${users}${rate ? `-${rate}` : ''}.json`,
		import.meta.url,
	);
	writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
	console.log(
		`\nlogged in ${result.logged_in}/${users}, polling at end ${result.active_polls_at_end}`,
	);
	console.table(
		Object.fromEntries(
			Object.entries(result.routes).map(([name, s]) => [
				name,
				{
					count: s.count,
					rps: s.rps,
					'err %': +(s.error_rate * 100).toFixed(2),
					p50: s.p50_ms,
					p95: s.p95_ms,
					p99: s.p99_ms,
					max: s.max_ms,
				},
			]),
		),
	);
	console.log(`saved ${file.pathname}`);
	process.exit(0);
}

// ------------------------------------------------------------------ worker

async function runWorker() {
	const { scenario, transport, accounts, duration, ramp, rate, startAt } = workerData;
	const stats = new Stats();
	const agent = new Agent({
		connections: Math.ceil(accounts.length / TARGETS.length) + 64,
		keepAliveTimeout: 60_000,
		connect: { timeout: 30_000 },
		headersTimeout: 60_000,
		bodyTimeout: 60_000,
	});
	let nonce = null;
	const endAt = startAt + ramp * 1000 + duration * 1000;
	const state = { loggedIn: 0, polling: 0 };

	const devices = accounts.map((account) => ({
		...account,
		key: new Key(account.key),
		token: null,
		tokenExpires: 0,
		after: 0,
		ip: `10.${(account.i >> 16) & 255}.${(account.i >> 8) & 255}.${account.i & 255}`,
		target: TARGETS[account.i % TARGETS.length],
		artifact: null,
		pendingCommitAt: null,
	}));

	async function call(device, name, method, path, { json, raw, headers = {}, auth = true } = {}) {
		for (let attempt = 0; attempt < 2; attempt++) {
			const token = auth ? device.token : null;
			const all = {
				'x-forwarded-for': device.ip,
				'skillpouch-client': 'cli/load',
				dpop: device.key.dpop(method, `${ORIGIN}${path.split('?')[0]}`, nonce, token),
				...headers,
			};
			if (token) all.authorization = `DPoP ${token}`;
			let body;
			if (json !== undefined) {
				all['content-type'] = 'application/json';
				body = JSON.stringify(json);
			} else if (raw) {
				all['content-type'] = 'application/octet-stream';
				body = raw;
			}
			const begin = performance.now();
			let response;
			try {
				response = await request(`${device.target}${path}`, {
					method,
					headers: all,
					body,
					dispatcher: agent,
				});
			} catch (error) {
				stats.record(name, performance.now() - begin, `net:${error.code ?? error.name}`);
				return null;
			}
			const text = await response.body.text();
			const ms = performance.now() - begin;
			const fresh = response.headers['dpop-nonce'];
			if (fresh) nonce = fresh;
			let parsed = null;
			try {
				parsed = JSON.parse(text);
			} catch {
				// Non-JSON bodies only on proxy-level errors.
			}
			const code = parsed?.error?.code;
			if (code === 'dpop_nonce_required' && attempt === 0) continue;
			stats.record(
				name,
				ms,
				response.statusCode < 400 ? 'ok' : `${response.statusCode}:${code ?? 'unknown'}`,
			);
			return response.statusCode < 400 ? (parsed?.data ?? parsed) : null;
		}
		return null;
	}

	async function login(device) {
		const data = await call(device, 'POST /v1/devices/token', 'POST', '/v1/devices/token', {
			json: { refresh_token: device.refresh },
			auth: false,
		});
		if (!data) return false;
		device.token = data.access_token;
		device.refresh = data.refresh_token;
		device.tokenExpires = Date.now() + (data.expires_in - 30) * 1000;
		return true;
	}

	async function ensureToken(device) {
		if (Date.now() < device.tokenExpires) return true;
		return login(device);
	}

	/** The daemon's main loop: long-poll the pouch, apply what arrives, repeat. */
	async function pollLoop(device) {
		state.polling += 1;
		while (Date.now() < endAt) {
			if (!(await ensureToken(device))) {
				await sleep(2000);
				continue;
			}
			const wait = Math.min(LONG_POLL_SECONDS, Math.floor((endAt - Date.now()) / 1000) - 1);
			if (wait < 1) break;
			const data = await call(
				device,
				'GET events (long-poll)',
				'GET',
				`/v1/pouches/${device.pouch}/events?after=${device.after}&epoch=${device.epoch}&wait=${wait}`,
			);
			if (!data) {
				await sleep(1000 + Math.random() * 2000);
				continue;
			}
			if (data.events.length > 0 && device.pendingCommitAt) {
				stats.record(
					'commit → event delivered',
					Math.max(0, performance.now() - device.pendingCommitAt),
					'ok',
				);
				device.pendingCommitAt = null;
			}
			device.after = data.next_cursor;
		}
		state.polling -= 1;
	}

	/** The same, over the account SSE stream: one connection, events pushed. */
	async function streamLoop(device) {
		state.polling += 1;
		while (Date.now() < endAt) {
			if (!(await ensureToken(device))) {
				await sleep(2000);
				continue;
			}
			const path = `/v1/events/stream?cursors=${device.pouch}:${device.after}`;
			const controller = new AbortController();
			const stop = setTimeout(() => controller.abort(), Math.max(0, endAt - Date.now()));
			const begin = performance.now();
			let retryMs = 1000 + Math.random() * 2000;
			try {
				const response = await request(`${device.target}${path}`, {
					method: 'GET',
					headers: {
						'x-forwarded-for': device.ip,
						accept: 'text/event-stream',
						authorization: `DPoP ${device.token}`,
						dpop: device.key.dpop(
							'GET',
							`${ORIGIN}${path.split('?')[0]}`,
							nonce,
							device.token,
						),
					},
					dispatcher: agent,
					signal: controller.signal,
					bodyTimeout: 0,
				});
				const fresh = response.headers['dpop-nonce'];
				if (fresh) nonce = fresh;
				if (response.statusCode !== 200) {
					const body = await response.body.text();
					const code = body.includes('"code"') ? JSON.parse(body).error?.code : 'unknown';
					stats.record(
						'SSE connect',
						performance.now() - begin,
						`${response.statusCode}:${code}`,
					);
					if (code === 'token_invalid' || code === 'token_expired')
						device.tokenExpires = 0;
				} else {
					stats.record('SSE connect', performance.now() - begin, 'ok');
					let buffer = '';
					for await (const chunk of response.body) {
						buffer += chunk.toString();
						let end;
						while ((end = buffer.indexOf('\n\n')) >= 0) {
							const frame = buffer.slice(0, end);
							buffer = buffer.slice(end + 2);
							const event = /^event: (.*)$/m.exec(frame)?.[1];
							const data = /^data: (.*)$/m.exec(frame)?.[1];
							if (event === 'pouch_event' && data) {
								device.after = Math.max(device.after, JSON.parse(data).seq);
								if (device.pendingCommitAt) {
									stats.record(
										'commit → event delivered',
										Math.max(0, performance.now() - device.pendingCommitAt),
										'ok',
									);
									device.pendingCommitAt = null;
								}
							} else if (event === 'reconnect' && data) {
								retryMs = JSON.parse(data).retry_ms;
								stats.record('SSE server-asked reconnect', 0, 'ok');
							}
						}
					}
				}
			} catch (error) {
				if (!controller.signal.aborted)
					stats.record(
						'SSE connect',
						performance.now() - begin,
						`net:${error.code ?? error.name}`,
					);
			} finally {
				clearTimeout(stop);
			}
			if (Date.now() < endAt) await sleep(retryMs);
		}
		state.polling -= 1;
	}

	/** blobs/check → PUT blob → signed commit, like saving one edited skill. */
	async function commit(device) {
		if (!(await ensureToken(device))) return;
		const blob = sealed(1, 2048);
		const blobId = b64(randomBytes(32));
		const check = await call(
			device,
			'POST blobs/check',
			'POST',
			`/v1/pouches/${device.pouch}/blobs/check`,
			{
				json: { blobs: [{ id: blobId, stored_size: blob.length }] },
			},
		);
		if (!check) return;
		const put = await call(
			device,
			'PUT blob',
			'PUT',
			`/v1/pouches/${device.pouch}/blobs/${blobId}`,
			{
				raw: blob,
				headers: { 'skillpouch-ciphertext-hash': b64(blake3Hash(blob)) },
			},
		);
		if (!put) return;
		const op = buildOp(device.key, device.member, device.pouch, {
			type: device.artifact ? 'update' : 'create',
			artifactId: device.artifact?.id ?? uuidv7(),
			baseRevisionId: device.artifact?.head ?? null,
			blobIds: [blobId],
		});
		const body = { operation_id: uuidv7(), epoch: device.epoch, ops: [op] };
		const sentAt = performance.now();
		const data = await call(
			device,
			'POST operations (commit)',
			'POST',
			`/v1/pouches/${device.pouch}/operations`,
			{
				json: body,
				headers: { 'skillpouch-signature': device.key.requestSignature(body) },
			},
		);
		const result = data?.results?.[0];
		if (result?.status === 'applied') {
			device.artifact = { id: result.artifact_id, head: result.revision_id };
			device.pendingCommitAt = sentAt;
		}
	}

	async function readOnce(device) {
		if (!(await ensureToken(device))) return;
		const which = Math.random();
		if (which < 0.4) await call(device, 'GET pouch', 'GET', `/v1/pouches/${device.pouch}`);
		else if (which < 0.8)
			await call(device, 'GET artifacts', 'GET', `/v1/pouches/${device.pouch}/artifacts`);
		else await call(device, 'GET devices', 'GET', '/v1/devices');
	}

	/** Open-model arrivals: `perSecond` actions spread over random devices. */
	async function arrivals(perSecond, action) {
		if (perSecond <= 0) return;
		const inflight = new Set();
		let next = Math.max(Date.now(), startAt + ramp * 1000);
		while (Date.now() < endAt) {
			const device = devices[Math.floor(Math.random() * devices.length)];
			if (device.token) {
				const task = action(device).finally(() => inflight.delete(task));
				inflight.add(task);
			}
			next += 1000 / perSecond;
			const delay = next - Date.now();
			if (delay > 0) await sleep(delay);
		}
		await Promise.allSettled(inflight);
	}

	const reporter = setInterval(
		() => parentPort.postMessage({ type: 'stats', routes: stats.drain() }),
		1000,
	);
	await sleep(Math.max(0, startAt - Date.now()));

	const loops = devices.map(async (device, index) => {
		if (ramp > 0) await sleep((index / devices.length) * ramp * 1000);
		if (!(await login(device))) return;
		state.loggedIn += 1;
		if (scenario === 'reads') return;
		await (transport === 'stream' ? streamLoop(device) : pollLoop(device));
	});
	const load =
		scenario === 'sync'
			? arrivals(rate, commit)
			: scenario === 'reads'
				? arrivals(rate, readOnce)
				: Promise.resolve();
	await Promise.allSettled([...loops, load]);
	clearInterval(reporter);
	parentPort.postMessage({ type: 'stats', routes: stats.drain() });
	parentPort.postMessage({ type: 'done', state });
	await agent.close();
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

if (isMainThread) await main();
else await runWorker();
