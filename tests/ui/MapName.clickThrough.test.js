/**
 * tests/ui/MapName.clickThrough.test.js
 *
 * The map name banner is drawn over the scene for a few seconds after a warp.
 * The scene listens on its own canvas for the wheel (zoom) and for item drops,
 * so the banner must never be a hit-test target.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `?raw` CSS imports are empty under vitest; the rule lives in the stylesheet.
const cssText = readFileSync(join(process.cwd(), 'src/UI/Components/MapName/MapName.css'), 'utf8');

describe('MapName', () => {
	it('lets the pointer through to the scene', () => {
		// jsdom resolves no :host in computed styles, so read the rule itself.
		const style = document.createElement('style');
		style.textContent = cssText;
		document.head.appendChild(style);

		const host = [...style.sheet.cssRules].find(rule => rule.selectorText === ':host');
		expect(host.style.pointerEvents).toBe('none');
	});
});
