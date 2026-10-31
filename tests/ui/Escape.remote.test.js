/**
 * tests/ui/Escape.remote.test.js
 *
 * On a remote bot the Escape menu has Character select only while this window holds the bot's control: the
 * character select is the bot's.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ active: false, control: false }));

vi.mock('Network/RemoteBot.js', () => ({ default: { isActive: () => mocks.active, hasControl: () => mocks.control } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));

const Escape = (await import('UI/Components/Escape/Escape.js')).default;

describe('Escape menu', () => {
	it('hides Character select on a remote bot, keeps Exit', () => {
		mocks.active = true;
		mocks.control = false;
		Escape.append();
		const root = Escape.getRoot();

		expect(root.querySelector('.charselect').style.display).toBe('none');
		expect(root.querySelector('.exit').style.display).toBe('');
		Escape.remove();
	});

	it('shows it while this window holds the control, and hides it again when it gives it back', () => {
		mocks.active = true;
		mocks.control = true;
		Escape.append();
		const button = Escape.getRoot().querySelector('.charselect');
		expect(button.style.display).toBe('');

		mocks.control = false;
		Escape.refreshCharSelect();
		expect(button.style.display).toBe('none');
		Escape.remove();
	});

	it('shows it otherwise', () => {
		mocks.active = false;
		Escape.append();

		expect(Escape.getRoot().querySelector('.charselect').style.display).toBe('');
		Escape.remove();
	});
});
