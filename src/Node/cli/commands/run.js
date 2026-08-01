/**
 * /run          — list the macros on disk and which one is running
 * /run <macro>  — run macros/<macro>.macro.js until it finishes or /stop
 *
 * The macro file lives outside the bundle and is re-read on every /run, so
 * editing it needs neither a rebuild nor a restart. Unrelated to /macro, which
 * chains slash-commands under a name; this runs an async JS file against the
 * bot façade (api/Bot.js).
 */
import { start, listMacros, runningMacro, macroDir } from '../../macro/loader.js';
import { log } from '../../log.js';

function list() {
	const names = listMacros();
	if (!names.length) {
		log.event('no macro — create ' + macroDir() + '/<name>.macro.js');
		log.event('  it must `export default async bot => {…}` and import nothing');
		return;
	}
	const running = runningMacro();
	log.event(names.length + ' macro(s) in ' + macroDir() + ':');
	for (let i = 0, n = names.length; i < n; ++i) {
		log.event('  ' + names[i] + (names[i] === running ? '  [running]' : ''));
	}
}

export default {
	name: 'run',
	usage: '[macro]',
	help: 'run a macro file from macros/ (no arg: list)',
	async run(ctx, args) {
		if (!args.length || !args[0]) {
			list();
			return;
		}
		await start(ctx, args[0]);
	}
};
