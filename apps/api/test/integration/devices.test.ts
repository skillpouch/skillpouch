// SPDX-License-Identifier: AGPL-3.0-only
/** Devices page data: rename, detected assistants, sync cursors. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliClient } from '../helpers/clients';
import { authorizeCli, setupAccount, type Account } from '../helpers/flows';
import { createHarness, type Harness } from '../helpers/harness';

describe('devices', () => {
	let h: Harness;
	let alice: Account;
	let mallory: Account;
	let laptop: CliClient;
	let desktop: CliClient;

	beforeAll(async () => {
		h = await createHarness();
		alice = await setupAccount(h, 'alice@skillpouch.test');
		mallory = await setupAccount(h, 'mallory@skillpouch.test');
		laptop = await authorizeCli(h, alice, 'laptop');
		desktop = await authorizeCli(h, alice, 'desktop');
	});
	afterAll(async () => {
		await h.close();
	});

	async function deviceById(id: string) {
		const list = await alice.browser.get('/v1/devices');
		return list.body.data.devices.find((device: { id: string }) => device.id === id);
	}

	it('lets the web rename any device of the account', async () => {
		const renamed = await alice.browser.patch(`/v1/devices/${laptop.deviceId}`, {
			name: '  work laptop  ',
		});
		expect(renamed.status).toBe(200);
		expect((await deviceById(laptop.deviceId!)).name).toBe('work laptop');
		const { rows } = await h.owner.query(
			"SELECT count(*)::int AS n FROM audit_log WHERE action = 'device.renamed'",
		);
		expect(rows[0].n).toBe(1);
	});

	it('lets a CLI rename only itself', async () => {
		expect(
			(await laptop.patch(`/v1/devices/${laptop.deviceId}`, { name: 'mine' })).status,
		).toBe(200);
		const other = await laptop.patch(`/v1/devices/${desktop.deviceId}`, { name: 'pwned' });
		expect(other.status).toBe(404);
		expect((await deviceById(desktop.deviceId!)).name).toBe('desktop');
	});

	it('hides devices of other accounts', async () => {
		const response = await mallory.browser.patch(`/v1/devices/${laptop.deviceId}`, {
			name: 'pwned',
		});
		expect(response.status).toBe(404);
		expect((await deviceById(laptop.deviceId!)).name).not.toBe('pwned');
	});

	it('validates names', async () => {
		for (const name of ['', '   ', 'x'.repeat(65)]) {
			const response = await alice.browser.patch(`/v1/devices/${laptop.deviceId}`, { name });
			expect(response.status, name).toBe(400);
		}
	});

	it('stores the assistants and version a CLI reports, de-duplicated and sorted', async () => {
		const report = await laptop.patch('/v1/devices/me', {
			cli_version: '0.2.0',
			assistants: ['opencode', 'claude-code', 'opencode'],
		});
		expect(report.status).toBe(200);
		expect(await deviceById(laptop.deviceId!)).toMatchObject({
			cli_version: '0.2.0',
			assistants: ['claude-code', 'opencode'],
		});

		const bad = await laptop.patch('/v1/devices/me', { assistants: ['Not Valid'] });
		expect(bad.status).toBe(400);
		const web = await alice.browser.patch('/v1/devices/me', { assistants: [] });
		expect(web.status).toBe(401);
	});

	it('lists the sync cursor of every pouch per device', async () => {
		const pouch = alice.pouchId;
		const { rows } = await h.owner.query('SELECT epoch FROM pouches WHERE id = $1', [pouch]);
		await desktop.put('/v1/devices/me/cursor', {
			pouch_id: pouch,
			epoch: rows[0].epoch,
			acked_seq: 0,
		});
		const device = await deviceById(desktop.deviceId!);
		expect(device.cursors).toEqual([{ pouch_id: pouch, acked_seq: 0 }]);
		expect((await deviceById(laptop.deviceId!)).cursors).toEqual([]);
	});
});
