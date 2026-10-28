/**
 * tests/ui/Escape.remote.test.js
 *
 * On a remote bot the Escape menu has no Character select: the character select would be the bot's.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ active: false }));

vi.mock('Network/RemoteBot.js', () => ({ default: { isActive: () => mocks.active } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));

const Escape = (await import('UI/Components/Escape/Escape.js')).default;

describe('Escape menu', () => {
	it('hides Character select on a remote bot, keeps Exit', () => {
		mocks.active = true;
		Escape.append();
		const root = Escape.getRoot();

		expect(root.querySelector('.charselect').style.display).toBe('none');
		expect(root.querySelector('.exit').style.display).toBe('');
		Escape.remove();
	});

	it('shows it otherwise', () => {
		mocks.active = false;
		Escape.append();

		expect(Escape.getRoot().querySelector('.charselect').style.display).toBe('');
		Escape.remove();
	});
});
