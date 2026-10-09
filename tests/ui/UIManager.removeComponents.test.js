import { describe, expect, it, vi } from 'vitest';

vi.mock('UI/GUIComponent.js', () => ({ default: class GUIComponent {} }));
vi.mock('UI/Common.css?raw', () => ({ default: '' }));
vi.mock('UI/UIVersionManager.js', () => ({ default: {} }));
vi.mock('Controls/KeyEventHandler.js', () => ({ default: {} }));
vi.mock('UI/ClampToViewport.js', () => ({ default: vi.fn() }));

const UIManager = (await import('UI/UIManager.js')).default;

describe('UIManager.removeComponents', () => {
	it('removes every component but the kept ones', () => {
		const kept = { remove: vi.fn() };
		const other = { remove: vi.fn() };
		UIManager.components = { kept, other };

		UIManager.removeComponents([kept]);

		expect(kept.remove).not.toHaveBeenCalled();
		expect(other.remove).toHaveBeenCalledOnce();
	});

	it('removes every component when nothing is kept', () => {
		const first = { remove: vi.fn() };
		const second = { remove: vi.fn() };
		UIManager.components = { first, second };

		UIManager.removeComponents();

		expect(first.remove).toHaveBeenCalledOnce();
		expect(second.remove).toHaveBeenCalledOnce();
	});
});
