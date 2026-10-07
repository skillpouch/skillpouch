// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Realtime fan-out. Each API instance holds ONE
 * dedicated `LISTEN` connection and fans notifications out in memory, so
 * long-polls and SSE streams cost a socket, not a database connection.
 *
 * Notifications are hints only: on reconnect every waiter is woken and
 * re-queries, so correctness never depends on delivery.
 *
 * Channels (payloads are JSON, opaque IDs only):
 *   pouch_events    {"sa","p","s"}           new events in a pouch up to seq s
 *   account_events  {"sa","type","data"}     roster/device/entitlement changes
 *   device_revoked  {"sa","d"}               a device was revoked or suspended
 */
import { EventEmitter } from 'node:events';
import pg from 'pg';

export const CHANNELS = ['pouch_events', 'account_events', 'device_revoked'] as const;

export interface PouchNotification {
	sa: string;
	p: string;
	s: number;
}
export interface AccountNotification {
	sa: string;
	type: string;
	data: Record<string, unknown>;
}
export interface DeviceRevokedNotification {
	sa: string;
	d: string;
}

export interface Logger {
	warn(obj: unknown, msg?: string): void;
}

export class ListenHub {
	private client: pg.Client | null = null;
	private readonly emitter = new EventEmitter();
	private closed = false;
	private reconnectTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly connectionString: string,
		private readonly log: Logger,
	) {
		this.emitter.setMaxListeners(0);
	}

	async start(): Promise<void> {
		const client = new pg.Client({ connectionString: this.connectionString });
		client.on('notification', (message) => this.dispatch(message.channel, message.payload));
		client.on('error', (error) => {
			this.log.warn({ err: error }, 'listen hub connection error');
			this.scheduleReconnect();
		});
		client.on('end', () => this.scheduleReconnect());
		await client.connect();
		for (const channel of CHANNELS) await client.query(`LISTEN ${channel}`);
		this.client = client;
	}

	private scheduleReconnect(): void {
		if (this.closed || this.reconnectTimer) return;
		this.client = null;
		// Wake everybody: they re-query instead of trusting missed notifications.
		this.emitter.emit('reconnect');
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.start().catch((error) => {
				this.log.warn({ err: error }, 'listen hub reconnect failed');
				this.scheduleReconnect();
			});
		}, 1000);
	}

	private dispatch(channel: string, payload: string | undefined): void {
		if (!payload) return;
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(payload) as Record<string, unknown>;
		} catch {
			return;
		}
		if (channel === 'pouch_events') {
			this.emitter.emit(`pouch:${String(data.p)}`, data);
			this.emitter.emit(`account:${String(data.sa)}`, { kind: 'pouch', ...data });
		} else if (channel === 'account_events') {
			this.emitter.emit(`account:${String(data.sa)}`, { kind: 'account', ...data });
			this.emitter.emit('account_event', data);
		} else if (channel === 'device_revoked') {
			this.emitter.emit('device_revoked', data);
		}
	}

	/** Resolves when the pouch gets new events, the hub reconnects, or the timeout fires. */
	waitForPouch(
		pouchId: string,
		timeoutMs: number,
		signal?: AbortSignal,
	): Promise<'notified' | 'timeout'> {
		return new Promise((resolve) => {
			const event = `pouch:${pouchId}`;
			const finish = (result: 'notified' | 'timeout') => {
				clearTimeout(timer);
				this.emitter.off(event, onEvent);
				this.emitter.off('reconnect', onEvent);
				signal?.removeEventListener('abort', onAbort);
				resolve(result);
			};
			const onEvent = () => finish('notified');
			const onAbort = () => finish('timeout');
			const timer = setTimeout(() => finish('timeout'), timeoutMs);
			this.emitter.on(event, onEvent);
			this.emitter.on('reconnect', onEvent);
			signal?.addEventListener('abort', onAbort);
		});
	}

	/** Subscribes to everything for one storage account (SSE stream). */
	subscribeAccount(
		storageAccountId: string,
		listener: (
			event: { kind: 'pouch' | 'account' | 'reconnect' } & Record<string, unknown>,
		) => void,
	): () => void {
		const event = `account:${storageAccountId}`;
		const onReconnect = () => listener({ kind: 'reconnect' });
		this.emitter.on(event, listener);
		this.emitter.on('reconnect', onReconnect);
		return () => {
			this.emitter.off(event, listener);
			this.emitter.off('reconnect', onReconnect);
		};
	}

	onDeviceRevoked(listener: (event: DeviceRevokedNotification) => void): () => void {
		this.emitter.on('device_revoked', listener);
		return () => this.emitter.off('device_revoked', listener);
	}

	/** Every account event of every account (`{ sa, type, data }`), on this instance. */
	onAccountEvent(listener: (event: Record<string, unknown>) => void): () => void {
		this.emitter.on('account_event', listener);
		return () => this.emitter.off('account_event', listener);
	}

	/** Used by graceful shutdown: wake all long-polls so clients reconnect elsewhere. */
	wakeAll(): void {
		this.emitter.emit('reconnect');
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.emitter.emit('reconnect');
		const client = this.client;
		this.client = null;
		await client?.end().catch(() => {});
	}
}
