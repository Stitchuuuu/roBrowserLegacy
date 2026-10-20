/**
 * tests/plugins/asset-worker.nofs.test.js
 *
 * The nofs mask hides the sync FileSystem API while Core/FileSystem.js loads, then restores it.
 */
import { describe, expect, it } from 'vitest';
import { isNoFs, maskFileSystem, unmaskFileSystem } from 'Plugins/native-manager/asset-worker-core.js';

function api() {
	return 'fs';
}

function fakeWorkerScope() {
	return Object.create({ requestFileSystemSync: api, webkitRequestFileSystemSync: api });
}

describe('asset worker nofs mask', () => {
	it('reads nofs from the worker name', () => {
		expect(isNoFs('asset-worker-nofs')).toBe(true);
		expect(isNoFs('asset-worker')).toBe(false);
		expect(isNoFs(undefined)).toBe(false);
	});

	it('shadows the inherited API with own undefined properties', () => {
		const scope = fakeWorkerScope();
		maskFileSystem(scope);
		expect(!!(scope.requestFileSystemSync || scope.webkitRequestFileSystemSync)).toBe(false);
		expect(Object.getOwnPropertyDescriptor(scope, 'requestFileSystemSync').configurable).toBe(true);
	});

	it('restores the inherited API', () => {
		const scope = fakeWorkerScope();
		maskFileSystem(scope);
		unmaskFileSystem(scope);
		expect(scope.requestFileSystemSync).toBe(api);
		expect(scope.webkitRequestFileSystemSync).toBe(api);
		expect(Object.hasOwn(scope, 'requestFileSystemSync')).toBe(false);
	});

	it('restores an API the scope holds as its own property', () => {
		const scope = { requestFileSystemSync: api, webkitRequestFileSystemSync: api };
		maskFileSystem(scope);
		expect(scope.webkitRequestFileSystemSync).toBeUndefined();
		unmaskFileSystem(scope);
		expect(scope.requestFileSystemSync).toBe(api);
		expect(scope.webkitRequestFileSystemSync).toBe(api);
	});

	it('leaves an unmasked scope untouched', () => {
		const scope = fakeWorkerScope();
		unmaskFileSystem(scope);
		expect(scope.requestFileSystemSync).toBe(api);
	});
});
