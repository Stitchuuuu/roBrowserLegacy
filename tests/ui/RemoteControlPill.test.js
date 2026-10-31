/**
 * tests/ui/RemoteControlPill.test.js
 *
 * On a remote bot the info window's title bar says whether this window plays the character, « ● Control » or
 * « ○ Watching » as the bot last said, and a click asks the bot for the other state through the chat's
 * `@control on|off`. Outside the mode it is not shown.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ active: true, control: false, talk: [] }));

vi.mock('Network/RemoteBot.js', () => ({
	default: { isActive: () => mocks.active, hasControl: () => mocks.control }
}));
vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({
	default: {
		TYPE: { PUBLIC: 2 },
		onRequestTalk: (user, text, target) => mocks.talk.push([user, text, target])
	}
}));

const RemoteControlPill = (await import('UI/Components/BasicInfo/RemoteControlPill.js')).default;

function topbar() {
	const host = document.createElement('div');
	const bar = document.createElement('div');
	bar.className = 'topbar';
	host.attachShadow({ mode: 'open' }).appendChild(bar);
	return bar;
}

describe('remote control pill', () => {
	beforeEach(() => {
		mocks.active = true;
		mocks.control = false;
		mocks.talk.length = 0;
	});

	it('reads Watching while the bot plays, and a click asks for the control', () => {
		const bar = topbar();
		RemoteControlPill.attach(bar);
		const pill = bar.querySelector('.remote-control');

		expect(pill.style.display).toBe('');
		expect(pill.textContent).toBe('○ Watching');
		expect(pill.classList.contains('on')).toBe(false);
		pill.click();
		expect(mocks.talk).toEqual([['', '@control on', 2]]);
	});

	it('reads Control once the bot says so, and a click gives it back', () => {
		const bar = topbar();
		RemoteControlPill.attach(bar);
		mocks.control = true;
		RemoteControlPill.refresh();
		const pill = bar.querySelector('.remote-control');

		expect(pill.textContent).toBe('● Control');
		expect(pill.classList.contains('on')).toBe(true);
		pill.click();
		expect(mocks.talk).toEqual([['', '@control off', 2]]);
	});

	it('is hidden outside the mode', () => {
		mocks.active = false;
		const bar = topbar();
		RemoteControlPill.attach(bar);

		expect(bar.querySelector('.remote-control').style.display).toBe('none');
	});

	it('brings its style into the window once', () => {
		const bar = topbar();
		RemoteControlPill.attach(bar);
		RemoteControlPill.attach(bar);

		expect(bar.getRootNode().querySelectorAll('style').length).toBe(1);
		expect(bar.querySelectorAll('.remote-control').length).toBe(1);
	});
});
