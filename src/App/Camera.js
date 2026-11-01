/**
 * App/Camera.js
 *
 * The camera page: the hall's bots in a grid of game windows, without a game of its own
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import Thread from 'Core/Thread.js';
import Client from 'Core/Client.js';
import Camera from 'UI/Components/Camera/Camera.js';

export default function init() {
	Camera.init();

	// The skin bitmaps come from the client's files
	Thread.hook('THREAD_READY', function () {
		Client.onFilesLoaded = Camera.skin;
		Client.init([]);
	});
	Thread.init();
}

init();
