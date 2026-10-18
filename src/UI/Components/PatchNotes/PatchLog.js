/**
 * UI/Components/PatchNotes/PatchLog.js
 *
 * Resolve the client version and the unread releases from a patch log
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

/**
 * Compare two "major.minor.patch" versions
 *
 * @param {string} a
 * @param {string} b
 * @return {number} < 0, 0 or > 0
 */
function compare(a, b) {
	const pa = String(a).split('.');
	const pb = String(b).split('.');

	for (let i = 0; i < 3; i++) {
		const diff = (parseInt(pa[i], 10) || 0) - (parseInt(pb[i], 10) || 0);
		if (diff) {
			return diff;
		}
	}

	return 0;
}

/**
 * Releases, newest first
 *
 * @param {Array} releases
 * @return {Array}
 */
function sorted(releases) {
	return releases.slice().sort((a, b) => compare(b.version, a.version));
}

/**
 * Release of the running build: the one published from its sha,
 * else the latest one, as the log ships with the build
 *
 * @param {Array} releases
 * @param {string} sha of the build
 * @return {object|null} release
 */
function current(releases, sha) {
	const list = sorted(releases);

	if (sha) {
		for (let i = 0; i < list.length; i++) {
			const released = list[i].sha || '';
			if (released && (released.startsWith(sha) || sha.startsWith(released))) {
				return list[i];
			}
		}
	}

	return list[0] || null;
}

/**
 * Releases published after the last seen version, newest first
 *
 * @param {Array} releases
 * @param {string} version running
 * @param {string|null} seen version, null on a first visit
 * @return {Array}
 */
function unseen(releases, version, seen) {
	if (!seen) {
		return [];
	}

	return sorted(releases).filter(r => compare(r.version, seen) > 0 && compare(r.version, version) <= 0);
}

export default { compare, sorted, current, unseen };
