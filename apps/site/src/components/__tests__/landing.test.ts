// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { blend, fakeCiphertext } from '../cipher-text';
import { LOGIN_SCRIPT, scriptSteps, visibleLines } from '../install-terminal';
import { ASSISTANTS, FLOW_ASSISTANTS, formatPrice, planLines, type Plan } from '../landing-content';
import { shotProgress } from '../product-shot';

describe('formatPrice', () => {
	it('drops cents from whole amounts only', () => {
		expect(formatPrice(0)).toBe('$0');
		expect(formatPrice(300)).toBe('$3');
		expect(formatPrice(450)).toBe('$4.50');
	});
});

describe('planLines', () => {
	it('lists pouches and storage', () => {
		const plan = {
			slug: 'supporter',
			price_cents: 300,
			pouch_limit: 3,
			storage_bytes: 1_073_741_824,
		} as Plan;
		expect(planLines(plan)).toEqual([
			'3 pouches',
			'1 GB of encrypted storage',
			'Every feature, every assistant',
		]);
		expect(planLines({ ...plan, pouch_limit: 1 })[0]).toBe('1 pouch');
	});
});

describe('assistants', () => {
	it('draws only known assistants in the sync diagram', () => {
		expect(FLOW_ASSISTANTS.every((assistant) => ASSISTANTS.includes(assistant))).toBe(true);
		expect(new Set(ASSISTANTS.map((assistant) => assistant.id)).size).toBe(ASSISTANTS.length);
	});
});

describe('install terminal', () => {
	it('types commands a character at a time and prints output a line at a time', () => {
		const script = [
			{ kind: 'command', text: 'ab' },
			{ kind: 'output', text: 'done' },
		] as const;
		expect(scriptSteps(script)).toBe(3);
		expect(visibleLines(script, 0)).toEqual([]);
		expect(visibleLines(script, 1)).toEqual([{ kind: 'command', text: 'a' }]);
		expect(visibleLines(script, 3)).toEqual(script);
	});

	it('shows the whole login script at the last step', () => {
		expect(visibleLines(LOGIN_SCRIPT, scriptSteps(LOGIN_SCRIPT))).toEqual(LOGIN_SCRIPT);
	});
});

describe('cipher text', () => {
	it('keeps the shape of the text and is stable', () => {
		const text = 'name: a\ntools: b';
		const cipher = fakeCiphertext(text, 1);
		expect(cipher).toHaveLength(text.length);
		expect(cipher.indexOf('\n')).toBe(text.indexOf('\n'));
		expect(cipher).not.toBe(text);
		expect(fakeCiphertext(text, 1)).toBe(cipher);
	});

	it('blends from one text to the other', () => {
		expect(blend('abcdef', 'uvwxyz', 0)).toBe('abcdef');
		expect(blend('abcdef', 'uvwxyz', 1)).toBe('uvwxyz');
	});
});

describe('product shot', () => {
	it('straightens from entering the viewport to 45% down it', () => {
		expect(shotProgress(1000, 1000)).toBe(0);
		expect(shotProgress(1200, 1000)).toBe(0);
		expect(shotProgress(450, 1000)).toBeCloseTo(1);
		expect(shotProgress(0, 1000)).toBe(1);
		expect(shotProgress(725, 1000)).toBeCloseTo(0.5);
	});
});
