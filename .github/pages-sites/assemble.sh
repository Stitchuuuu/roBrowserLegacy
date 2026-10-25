#!/usr/bin/env bash
# Builds one server's site: a roBrowser build (dist/Web, or the gh-pages folder pages.yml published
# from it), the native plugins, shared/ (relay service worker, gate, index), then the site's own files.
# Writes version.json: the hash of the client (Online.js, before encrypt.mjs locks it), which
# shared/update-check.js compares to tell the player a new client is out, and the build's commit when
# it ships a build.json ({ sha }) or build-sites.sh gives one (BUILD_SHA), with its date (BUILD_DATE)
# and the upstream commit it is based on (BASE_SHA, BASE_DATE), which shared/build-switch.js shows.
#   assemble.sh <built-dir> <plugins-dir> <site-dir> <out-dir>
set -euo pipefail

BUILT="${1:?built dir}"
PLUGINS="${2:?plugins dir}"
SITE="${3:?site dir}"
OUT="${4:?out dir}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$BUILT/api.html" ] && [ -f "$BUILT/Online.js" ] || { echo "no roBrowser build in $BUILT" >&2; exit 1; }
[ -f "$SITE/Config.local.js" ] || { echo "no Config.local.js in $SITE" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"
rsync -a "$BUILT"/ "$OUT"/
rsync -a "$PLUGINS"/ "$OUT"/plugins/
rsync -a "$HERE"/shared/ "$OUT"/
rsync -a "$SITE"/ "$OUT"/

HASH="$(sha256sum "$OUT/Online.js" | cut -d' ' -f1)" node -e '
	const { readFileSync, writeFileSync } = require("node:fs");
	let sha = null;
	try {
		sha = JSON.parse(readFileSync(process.argv[1] + "/build.json", "utf8")).sha || null;
	} catch {}
	sha = sha || process.env.BUILD_SHA || null;
	const date = process.env.BUILD_DATE || null;
	const base = process.env.BASE_SHA ? { sha: process.env.BASE_SHA, date: process.env.BASE_DATE || null } : null;
	writeFileSync(process.argv[1] + "/version.json", JSON.stringify({ hash: process.env.HASH, sha, date, base }) + "\n");
' "$OUT"
