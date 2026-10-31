/**
 * tests/plugins/item-db.test.js
 *
 * ItemDb fetches its bundles from jsDelivr, then raw.githubusercontent, then
 * the copies shipped next to the plugin, and those copies carry the pinned
 * commit in their name.
 */
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_COMMIT, bundleUrls, fetchBundle } from '../../plugins/item-db/item-db.esm.js';

describe('ItemDb bundle sources', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('ships a local copy of both bundles for the pinned commit', () => {
		for (const name of ['cyro.json.gz', 'cyro.mobs.json.gz']) {
			const local = bundleUrls(name)[2];
			expect(local).toContain(DB_COMMIT.slice(0, 7));
			expect(existsSync(join('plugins/item-db', basename(local)))).toBe(true);
		}
	});

	it('pins both remote hosts to the commit', () => {
		const [cdn, raw] = bundleUrls('cyro.json.gz');
		expect(cdn).toBe(`https://cdn.jsdelivr.net/gh/Stitchuuuu/ro-item-db@${DB_COMMIT}/bundles/cyro.json.gz`);
		expect(raw).toBe(`https://raw.githubusercontent.com/Stitchuuuu/ro-item-db/${DB_COMMIT}/bundles/cyro.json.gz`);
	});

	it('falls back to the local copy when the page blocks both hosts', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const [cdn, raw, local] = bundleUrls('cyro.json.gz');
		const fetch = vi.fn(async url => {
			if (url === local) {
				return new Response(new Uint8Array([1, 2, 3]));
			}
			throw new TypeError('Failed to fetch');
		});
		vi.stubGlobal('fetch', fetch);

		const buf = await fetchBundle('cyro.json.gz');

		expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
		expect(fetch.mock.calls.map(c => c[0])).toEqual([cdn, raw, local]);
	});

	it('stops at jsDelivr when it answers', async () => {
		const fetch = vi.fn(async () => new Response(new Uint8Array([9])));
		vi.stubGlobal('fetch', fetch);

		await fetchBundle('cyro.mobs.json.gz');

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0][0]).toBe(bundleUrls('cyro.mobs.json.gz')[0]);
	});

	it('names the last source when every one fails', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

		await expect(fetchBundle('cyro.json.gz')).rejects.toThrow(/item-db-.*\.bin → HTTP 404/);
	});
});
