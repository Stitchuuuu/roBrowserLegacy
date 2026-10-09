/**
 * Plugins/native-manager/asset-worker-restore.js
 *
 * Last import of the asset worker: lifts the FileSystem mask once Core/FileSystem.js has read it
 */

import { isNoFs, unmaskFileSystem } from './asset-worker-core.js';

if (isNoFs(self.name)) {
	unmaskFileSystem(self);
}
