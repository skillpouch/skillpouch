// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApple } from '@/lib/platform';
import { Shortcut } from '../kbd';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36';

afterEach(() => vi.restoreAllMocks());

describe('Shortcut', () => {
	it('detects Apple keyboards', () => {
		expect(isApple(MAC)).toBe(true);
		expect(isApple(WINDOWS)).toBe(false);
	});

	it('writes Ctrl outside Apple, one keycap per key', () => {
		vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(WINDOWS);
		const { container } = render(<Shortcut keys={['mod', 'K']} />);
		expect(screen.getByLabelText('Control+K')).toBeTruthy();
		expect(container.querySelectorAll('kbd')).toHaveLength(2);
		expect(container.textContent).toBe('CtrlK');
		expect(container.querySelector('svg')).toBeNull();
	});

	it('draws the ⌘ symbol on a Mac', () => {
		vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC);
		const { container } = render(<Shortcut keys={['mod', 'B']} />);
		expect(screen.getByLabelText('Command+B')).toBeTruthy();
		expect(container.querySelector('svg')).not.toBeNull();
	});
});
