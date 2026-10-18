#!/usr/bin/env bash
# Assembles every build of BUILDS into a gh-pages tree: for each <folder> <branch> <access> line and each
# site folder here but shared/, <folder>/<site>/ from gh-pages/<safe-branch>/ (assemble.sh), locked by
# encrypt.mjs when access = key. Prints the deployed paths. Run from the gh-pages tree:
#   build-sites.sh <plugins-root>    # <plugins-root>/<safe-branch>/ = that branch's plugins/
set -euo pipefail

PLUGINS_ROOT="${1:?plugins root}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while read -r folder branch access; do
	safe="$(printf '%s' "$branch" | tr '/' '-' | sed -E 's/[^A-Za-z0-9._-]+/-/g')"
	if [ ! -f "$safe/api.html" ]; then
		echo "::warning::$branch has no build in gh-pages/$safe/ yet: $folder skipped" >&2
		continue
	fi
	for site in "$HERE"/*/; do
		name="$(basename "$site")"
		[ "$name" = shared ] && continue
		out="$folder/$name"
		bash "$HERE/assemble.sh" "$safe" "$PLUGINS_ROOT/$safe" "$site" "$out" >&2
		if [ "$access" = key ]; then
			node "$HERE/encrypt.mjs" "$out" >&2
		fi
		printf ' %s' "${out#./}"
	done
# BUILDS is checked out CRLF (.gitattributes): without tr, the access field reads "key\r"
done < <(grep -v '^#' "$HERE/BUILDS" | tr -d '\r' | awk 'NF')
