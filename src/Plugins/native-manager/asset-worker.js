/**
 * Plugins/native-manager/asset-worker.js
 *
 * Asset worker used when ROConfig.fetchIntercept is on: the core thread handler wrapped by the shim
 */

// Evaluated in this order
import './asset-worker-shim.js';
import 'Core/ThreadEventHandler.js';
import './asset-worker-restore.js';
