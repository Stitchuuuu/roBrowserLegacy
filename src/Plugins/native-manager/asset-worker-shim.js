/**
 * Plugins/native-manager/asset-worker-shim.js
 *
 * First import of the asset worker: middleware chain, and the FileSystem mask when the worker name has nofs
 */

import { installShim, isNoFs, maskFileSystem } from './asset-worker-core.js';

installShim(self);

if (isNoFs(self.name)) {
	maskFileSystem(self);
}
