// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantBadge } from '../components/assistant-badge';

describe('AssistantBadge', () => {
	it.each([
		['claude-code', 'Claude Code'],
		['codex', 'Codex'],
		['opencode', 'OpenCode'],
		['copilot', 'Copilot'],
	])('shows the %s mark with its name', (id, name) => {
		const { container } = render(<AssistantBadge id={id} />);
		expect(screen.getByText(name)).toBeTruthy();
		expect(container.querySelector(`svg[data-assistant-icon="${id}"]`)).not.toBeNull();
	});

	it('falls back to the name alone for an assistant it has no mark for', () => {
		const { container } = render(<AssistantBadge id="new-tool" />);
		expect(screen.getByText('New Tool')).toBeTruthy();
		expect(container.querySelector('svg')).toBeNull();
	});
});
