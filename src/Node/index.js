/**
 * Node/index.js
 *
 * Main entry for the headless client: an interactive slash-command REPL, with
 * optional direct-launch of an auto-pilot routine that runs alongside the live
 * REPL. Self-configuring on first run (login → masked password → interactive
 * char select → config write-back); later launches only ask for the password.
 *
 *   node --import ./src/Node/shim.js dist-node/index.js [routine [args…]] [flags]
 *
 * Flags: -v/--debug (routine debug) · -vv (framework + packets) ·
 *        --account=<login> · --char=<name|slot> · --pass=<value> (or RO_PASS).
 *
 * Run via `npm run cli:node` — ./shim.js must be preloaded with `node --import`
 * (see shim.js header), it is NOT imported here.
 */
import path from 'node:path';
import process from 'node:process';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import Session from 'Engine/SessionStorage.js';
import { boot } from './boot.js';
import { resolvePassword, rawPrompt, saveConfig, charKey } from './config.js';
import { RoClient } from './api/RoClient.js';
import { ClientSession } from './Session.js';
import { Screen } from './cli/screen.js';
import { startRepl } from './cli/repl.js';
import { selectCharacter } from './cli/charselect.js';
import { routineNames } from './routines/registry.js';
import { wsUrl } from './transport/WsSocket.js';
import { startDebugLog, logLine } from './debuglog.js';
import { BUILD } from './version.js';
import { log, setVerbosity, setSink, setFileSink, installConsoleGate } from './log.js';

function parseArgs(argv) {
	const out = { verbosity: 0, account: null, char: null, positional: [] };
	for (let i = 2, n = argv.length; i < n; ++i) {
		const a = argv[i];
		if (a === '-v' || a === '--debug') {
			out.verbosity = Math.max(out.verbosity, 1);
		} else if (a === '-vv' || a === '-vvv') {
			out.verbosity = 2;
		} else if (a.startsWith('--account=')) {
			out.account = a.slice('--account='.length);
		} else if (a.startsWith('--char=')) {
			out.char = a.slice('--char='.length);
		} else if (a.startsWith('-')) {
			// --pass= is consumed by resolvePassword; ignore other flags here
		} else {
			out.positional.push(a);
		}
	}
	return out;
}

function buildChooseChar(cfg, opts) {
	// Explicit slot override → no prompt.
	if (opts.char != null && /^\d+$/.test(opts.char)) {
		cfg.server.charSlot = Number(opts.char);
		return undefined;
	}
	// Explicit name override → auto-pick by name, no prompt.
	if (opts.char != null) {
		const want = opts.char.toLowerCase();
		return list => {
			const m = list.find(c => String(c.name).toLowerCase() === want);
			if (!m) {
				throw new Error('no character named "' + opts.char + '"');
			}
			return m.CharNum;
		};
	}
	// A character saved for THIS login → reuse its slot, no prompt. Keys are
	// `login/slot` while cfg.server.charSlot is global (it may belong to a
	// previously-used account), so match on the login prefix — not the exact
	// charKey — and pin the slot to the match. Otherwise switching account
	// either re-prompts needlessly or logs into the wrong account's slot.
	const saved = savedCharForLogin(cfg);
	if (saved) {
		cfg.server.charSlot = saved.charSlot;
		return undefined;
	}
	// Unknown account → interactive select.
	return list => selectCharacter(list, { defaultSlot: cfg.server.charSlot });
}

// The character remembered for cfg.account.login, or null. Prefers the entry
// at the current global slot, else any character saved under this login.
function savedCharForLogin(cfg) {
	const chars = cfg.characters;
	if (!chars) {
		return null;
	}
	const exact = chars[charKey(cfg)];
	if (exact) {
		return exact;
	}
	const prefix = cfg.account.login + '/';
	for (const key in chars) {
		if (key.slice(0, prefix.length) === prefix) {
			return chars[key];
		}
	}
	return null;
}

function persistLogin(cfg) {
	const chosen = Session.Character;
	if (chosen) {
		cfg.server.charSlot = chosen.CharNum;
	}
	const key = charKey(cfg);
	saveConfig({
		server: cfg.server,
		account: { login: cfg.account.login },
		characters: {
			[key]: { name: chosen ? chosen.name : '', charSlot: chosen ? chosen.CharNum : cfg.server.charSlot }
		}
	});
}

// --- boot ------------------------------------------------------------------

const opts = parseArgs(process.argv);
setVerbosity(opts.verbosity);
installConsoleGate();

const screen = new Screen();
let session = null;
let quitting = false;
let finished = false;

function finishQuit() {
	if (finished) {
		return;
	}
	finished = true;
	try {
		Network.close();
	} catch {
		// already closed
	}
	screen.close();
	process.exit(0);
}

function quit() {
	if (quitting) {
		process.exit(130);
	}
	quitting = true;
	if (session) {
		session.quit();
	}
	log.event('quitting — clean disconnect…');
	try {
		Network.hookPacket(PACKET.ZC.ACK_REQ_DISCONNECT, () => finishQuit());
		const pkt = new PACKET.CZ.REQ_DISCONNECT();
		pkt.type = 0;
		Network.sendPacket(pkt);
	} catch {
		finishQuit();
		return;
	}
	setTimeout(finishQuit, 1000);
}

screen.onInterrupt(quit);
process.on('SIGINT', quit);

let cfg;
try {
	cfg = boot();
} catch (err) {
	log.error(err.message);
	process.exit(1);
}

if (opts.account) {
	cfg.account.login = opts.account;
}

// First run: no account configured → prompt the login (default = last used).
if (!cfg.account.login) {
	const r = await rawPrompt('Login: ');
	if (r.value) {
		cfg.account.login = r.value.trim();
	}
	if (!cfg.account.login) {
		log.error('no account login — aborting');
		process.exit(1);
	}
}

log.info('build   :', BUILD);
log.info('target :', wsUrl(cfg.server.host, cfg.server.port, cfg.server.wsProxy), '· packetver', cfg.server.packetver);
log.info('account:', cfg.account.login);

const chooseChar = buildChooseChar(cfg, opts);

let password;
try {
	password = await resolvePassword(cfg);
} catch (err) {
	log.error(err.message);
	process.exit(1);
}

const client = new RoClient(cfg);
session = new ClientSession(cfg, client);
session.setPassword(password);

// Full-session debug trace (inbound + outbound packets except CA.LOGIN, REPL
// commands, and every log line — each timestamped). Enabled by default for now;
// started before connect so the handshake is captured. Screen stays
// verbosity-gated; the file always gets everything.
const debugLogFile = startDebugLog();
setFileSink((channel, text) => logLine(channel, text));
log.info('debug log →', debugLogFile);

// Verbose channels — packet-ish state noise stays off by default.
client.on('hp', e => log.framework('hp', e.hp + '/' + e.maxhp));
client.on('sp', e => log.framework('sp', e.sp + '/' + e.maxsp));
client.on('change', e => log.framework('player', e.field));
client.on('status', e => log.framework('status aid', e.aid, 'efst', e.efst, e.active ? 'ON' : 'off'));
client.on('party', e => log.framework('party', e.reason));
client.on('skills', () => log.framework('skills updated'));

// Always-on event channel.
client.on('connected', r => log.event('connected — map ' + r.mapName));
client.on('reconnected', r => log.event('reconnected — map ' + r.mapName));
client.on('disconnected', () => log.event('disconnected'));
client.on('cast', e => log.event('cast ' + e.name + ' → ' + e.target + (e.caveat ? ' (' + e.caveat + ')' : '')));
client.on('blocked', e => log.routine('cast', 'blocked —', e.reason));
client.on('chat', e => log.event('chat: ' + e.msg));
client.on('privateMessage', e => log.event('whisper ' + e.sender + ': ' + e.msg));

// While retrying login, a refused-login socket close must not trip boot's
// process.exit(3) — the retry loop owns the flow. ClientSession.login installs
// the real auto-reconnect handler once connected.
Network.onDisconnect = () => {};

const connectOpts = chooseChar ? { chooseChar } : {};
for (;;) {
	try {
		const result = await session.login(password, connectOpts);
		persistLogin(cfg);
		log.info('CONNECTED — ' + (Session.Character ? Session.Character.name + ' ' : '') + 'in map ' + result.mapName);
		break;
	} catch (err) {
		// Login refused (exit 4 — wrong password / unknown account): re-prompt the
		// password and retry instead of aborting. Any other failure exits.
		if (err.exitCode === 4 && process.stdin.isTTY) {
			log.warn(err.message + ' — re-enter the password (Ctrl-C to abort)');
			const r = await rawPrompt('Password: ', { mask: true });
			if (!r.value) {
				log.error('login aborted');
				process.exit(4);
			}
			password = r.value; // retried in the next loop iteration
			continue;
		}
		log.error(err.message);
		process.exit(err.exitCode || 1);
	}
}

// In map — switch to the split-screen REPL and route all logging into it.
screen.setHistoryFile(path.resolve(process.cwd(), '.ro-node-history'));
screen.mount();
setSink((text, stream) => screen.write(text, stream));
const ctx = startRepl({ screen, session, client, config: cfg });

// Storage has no client "open" packet — `open` flips on the kafra's first
// item-list push. Surface that transition (and the close echo) so the
// operator isn't blind-polling isOpen().
client.on('storage', e => {
	if (e.reason === 'open') {
		log.event('Storage opened');
	} else if (e.reason === 'close') {
		log.event('Storage closed');
	}
});

// Log every warp so map changes are easy to spot in the REPL and the trace.
client.on('map', e => {
	log.event('→ map ' + e.map + '  (' + e.x + ',' + e.y + ')');
});

// Echo NPC dialog: the reply to /npc talk arrives async on the 'dialog' event,
// so without this the REPL only shows "npc talk sent" and never the NPC's line.
const NPC_REPLY_HINT = {
	next: '/npc next',
	close: '/npc close',
	'input-num': '/npc num <value>',
	'input-str': '/npc str <text>'
};
const stripColor = s => s.replace(/\^[0-9a-fA-F]{6}/g, ''); // ^RRGGBB client color codes
let lastNpcText = null;
let lastNpcSig = null;
client.on('dialog', e => {
	// Only the NPC the operator is actively talking to (set by /npc talk). Map
	// scripts push background dialogs (autoloot/announcer closes) on entry that
	// aren't ours — ignore them so the REPL isn't spammed.
	if (e.naid !== client.npc.getTarget()) {
		return;
	}
	// Skip an event identical to the last (some scripts re-send the same state).
	const sig = e.awaiting + '|' + e.text + '|' + e.options.join('');
	if (sig === lastNpcSig) {
		return;
	}
	lastNpcSig = sig;

	if (e.text && e.text !== lastNpcText) {
		lastNpcText = e.text;
		log.event('[npc] ' + stripColor(e.text));
	}
	if (e.awaiting === 'menu' && e.options.length) {
		log.event('[npc] menu (/npc choose <i>, 255 = cancel):');
		for (let i = 0, n = e.options.length; i < n; ++i) {
			log.event('  ' + (i + 1) + ') ' + stripColor(e.options[i]));
		}
	} else if (NPC_REPLY_HINT[e.awaiting]) {
		log.event('[npc] awaiting → ' + NPC_REPLY_HINT[e.awaiting]);
	}
});

log.event('REPL ready (build ' + BUILD + ') — /help for commands');

// Direct-launch: start the routine alongside the live REPL.
if (opts.positional.length) {
	const name = opts.positional[0];
	const res = session.startRoutine(name, opts.positional.slice(1), ctx);
	if (!res.ok) {
		log.event(res.reason + ' — known routines: ' + routineNames().join(', '));
	}
}
