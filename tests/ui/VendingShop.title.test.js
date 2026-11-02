/**
 * tests/ui/VendingShop.title.test.js
 *
 * The vendor's own shop window takes its title from the name typed when the shop opened. A window that did not
 * open the shop itself (a remote window attached to a bot already vending) has no name: the server does not send
 * the vendor its own shop name, so the window opens titled without one.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));

const VendingShop = (await import('UI/Components/VendingShop/VendingShop.js')).default;
const Vending = (await import('UI/Components/Vending/Vending.js')).default;

const title = () => VendingShop.getRoot().querySelector('.text.shopname').textContent;

describe('VendingShop title', () => {
	it('names the shop opened in this window', () => {
		Vending._shopname = 'RemoteShop';
		VendingShop.append();
		expect(title().endsWith(' : RemoteShop')).toBe(true);
		VendingShop.remove();
	});

	it('opens without a name when this window did not open the shop', () => {
		delete Vending._shopname;
		expect(() => VendingShop.append()).not.toThrow();
		expect(title()).not.toContain(' : ');
		VendingShop.remove();
	});
});
