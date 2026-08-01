/**
 * Node/net/session.js
 *
 * Headless login → char-select → map-enter handshake. Reproduces the
 * protocol contract of Engine/{LoginEngine,CharEngine,MapEngine}.js
 * (same packets, same field usage, same Network.read prefix handling)
 * with zero UI imports.
 *
 * hookPacket (single-slot) is fine here: the handshake owns its
 * accept/refuse opcodes exclusively. Additive listening for everything
 * else goes through net/observe.js.
 *
 * Exit codes carried on Error.exitCode:
 *   2 connect failure / phase timeout   5 char refused / no character
 *   3 forced disconnect (NOTIFY_BAN)    6 pincode required
 *   4 login refused                     7 map refused
 */
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import PACKETVER from 'Network/PacketVerManager.js';
import Session from 'Engine/SessionStorage.js';
import { log } from '../log.js';

const PHASE_TIMEOUT = 20000;

// SC.NOTIFY_BAN ErrorCode → canonical client wording (msgstringtable via
// LoginEngine.js onServerClosed — the DB itself is not loadable headless).
const BAN_MESSAGES = {
	0: 'disconnected from server',
	1: 'server closed',
	2: 'someone has logged in with this ID',
	3: 'disconnected due to a time gap between you and the server',
	4: 'server is jammed due to over population — try again shortly',
	5: 'underaged account',
	8: 'the game server still recognizes your last log-in — retry in ~30 s',
	15: 'forced to disconnect by the Game Master Team',
	18: 'this account is already connected to the account server'
};

/**
 * @param {number} code process exit code
 * @param {string} msg
 * @returns {Error}
 */
function sessionError(code, msg) {
	const err = new Error(msg);
	err.exitCode = code;
	return err;
}

// hookPacket throws on an undefined struct; some refuse variants only
// exist for some client generations.
function hook(packetClass, callback) {
	if (packetClass) {
		Network.hookPacket(packetClass, callback);
	}
}

// SC.NOTIFY_BAN can arrive from any of the three servers — re-armed per
// phase so it rejects the phase in flight with a readable reason.
function hookNotifyBan(reject) {
	hook(PACKET.SC.NOTIFY_BAN, pkt => {
		const reason = BAN_MESSAGES[pkt.ErrorCode] || 'server closed the session';
		reject(sessionError(3, reason + ' (NOTIFY_BAN ' + pkt.ErrorCode + ')'));
	});
}

/**
 * Wraps a phase executor in a promise with single-settle + timeout.
 *
 * @param {string} name phase label for the timeout message
 * @param {function(function, function): void} executor (resolve, reject)
 * @returns {Promise<*>}
 */
function phase(name, executor) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			finishErr(sessionError(2, name + ': timed out after ' + PHASE_TIMEOUT + 'ms'));
		}, PHASE_TIMEOUT);

		function finishOk(value) {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve(value);
			}
		}
		function finishErr(err) {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(err);
			}
		}

		executor(finishOk, finishErr);
	});
}

/**
 * Login server: CA.LOGIN → AC.ACCEPT_LOGIN(3).
 *
 * @returns {Promise<Array>} char-server list
 */
function loginPhase(cfg, password) {
	const server = cfg.server;

	return phase('login', (resolve, reject) => {
		function onAccept(pkt) {
			Session.AuthCode = pkt.AuthCode;
			Session.AID = pkt.AID;
			Session.UserLevel = pkt.userLevel;
			Session.Sex = pkt.Sex;
			if (pkt.webAuthToken) {
				Session.WebToken = pkt.webAuthToken;
			}
			log('info', 'login accepted — AID', pkt.AID, '·', pkt.ServerList.length, 'char server(s)');
			resolve(pkt.ServerList);
		}

		function onRefuse(pkt) {
			reject(sessionError(4, 'login refused — ErrorCode ' + pkt.ErrorCode));
		}

		if (PACKETVER.value < 20170315) {
			hook(PACKET.AC.ACCEPT_LOGIN, onAccept);
		} else {
			hook(PACKET.AC.ACCEPT_LOGIN3, onAccept);
		}
		hook(PACKET.AC.REFUSE_LOGIN, onRefuse);
		hook(PACKET.AC.REFUSE_LOGIN_R2, onRefuse);
		hook(PACKET.AC.REFUSE_LOGIN3, onRefuse);
		hook(PACKET.AC.REFUSE_LOGIN_EX, onRefuse);
		hook(PACKET.AC.REFUSE_LOGIN_USA, onRefuse);
		hookNotifyBan(reject);

		log('info', 'connecting to login server', server.host + ':' + server.port);
		Network.connect(server.host, server.port, success => {
			if (!success) {
				reject(sessionError(2, 'login server connect failed'));
				return;
			}
			const pkt = new PACKET.CA.LOGIN();
			pkt.ID = cfg.account.login;
			pkt.Passwd = password;
			pkt.Version = parseInt(server.version, 10);
			pkt.clienttype = parseInt(server.langtype, 10);

			// NetworkManager.sendPacket logs every packet object
			// unconditionally — for this one it would print the password.
			const origLog = console.log;
			console.log = function suppressed() {};
			try {
				Network.sendPacket(pkt);
			} finally {
				console.log = origLog;
			}
			log('info', 'CA.LOGIN sent for account', cfg.account.login);
		});
	});
}

/**
 * Char server: CH.ENTER → char list → CH.SELECT_CHAR → HC.NOTIFY_ZONESVR.
 *
 * @param {?function(Array): (number|Promise<number>)} [chooseChar] when given,
 *        receives the deduped real char list and returns the chosen CharNum
 *        (interactive select); when absent, selects by cfg.server.charSlot.
 * @returns {Promise<{mapName: string, ip: string, port: number}>}
 */
function charPhase(cfg, charServers, chooseChar) {
	const server = cfg.server;

	return phase('char', (resolve, reject) => {
		if (!charServers.length) {
			reject(sessionError(5, 'empty char-server list'));
			return;
		}
		const srv = charServers[0];
		if (charServers.length > 1) {
			log('warn', charServers.length + ' char servers, using first: ' + srv.name);
		}
		Session.ServerName = srv.name;
		Session.CharServer = srv; // retained so returnToCharSelect can reconnect without re-login

		// The char list may span several packets (NEO_UNION and/or _LIST/_LIST2
		// chunks after a CHARLIST_NOTIFY/CHARLIST_REQ exchange). Aggregate, and
		// select on exact slot match right away — otherwise wait for a short
		// settle window after the last chunk before falling back. With an
		// interactive chooseChar, always wait the settle window so the whole
		// list is collected before prompting.
		const charList = [];
		const SETTLE_MS = 500;
		let selected = false;
		let settleTimer = null;

		// LIST2 chunks repeat the same character — dedupe by slot for display.
		function dedupeBySlot(list) {
			const seen = {};
			const out = [];
			for (let i = 0, n = list.length; i < n; ++i) {
				const c = list[i];
				if (seen[c.CharNum]) {
					continue;
				}
				seen[c.CharNum] = 1;
				out.push(c);
			}
			return out;
		}

		function sendSelect(character) {
			Session.Character = character;
			log('info', 'selecting character', character.name, '(slot ' + character.CharNum + ')');
			const pktSel = new PACKET.CH.SELECT_CHAR();
			pktSel.CharNum = character.CharNum;
			Network.sendPacket(pktSel);
		}

		async function selectCharacter() {
			if (selected) {
				return;
			}
			selected = true;
			clearTimeout(settleTimer);

			if (!charList.length) {
				reject(sessionError(5, 'no character on this account'));
				return;
			}

			if (chooseChar) {
				const uniq = dedupeBySlot(charList);
				let slot;
				try {
					slot = await chooseChar(uniq);
				} catch {
					reject(sessionError(5, 'character selection aborted'));
					return;
				}
				let character = null;
				for (let i = 0, n = uniq.length; i < n; ++i) {
					if (uniq[i].CharNum === slot) {
						character = uniq[i];
						break;
					}
				}
				if (!character) {
					reject(sessionError(5, 'no character for slot ' + slot));
					return;
				}
				sendSelect(character);
				return;
			}

			const slot = server.charSlot;
			let character = null;
			for (let i = 0, count = charList.length; i < count; ++i) {
				if (charList[i].CharNum === slot) {
					character = charList[i];
					break;
				}
			}
			if (!character) {
				character = charList[0];
				log(
					'warn',
					'no character in slot ' + slot + ' — falling back to',
					character.name,
					'(slot ' + character.CharNum + ')'
				);
			}
			sendSelect(character);
		}

		function onCharList(pkt) {
			const charInfo = pkt.charInfo || [];
			if (selected) {
				return;
			}
			for (let i = 0, count = charInfo.length; i < count; ++i) {
				charList.push(charInfo[i]);
				if (!chooseChar && charInfo[i].CharNum === server.charSlot) {
					selectCharacter();
					return;
				}
			}
			clearTimeout(settleTimer);
			settleTimer = setTimeout(selectCharacter, SETTLE_MS);
		}

		function onZoneInfo(pkt) {
			Session.GID = pkt.GID;
			resolve({
				mapName: pkt.mapName,
				ip: typeof pkt.addr.ip === 'string' ? pkt.addr.ip : Network.utils.longToIP(pkt.addr.ip),
				port: pkt.addr.port
			});
		}

		hook(PACKET.HC.ACCEPT_ENTER_NEO_UNION, onCharList);
		hook(PACKET.HC.ACCEPT_ENTER_NEO_UNION_LIST, onCharList);
		hook(PACKET.HC.ACCEPT_ENTER_NEO_UNION_LIST2, onCharList);
		hook(PACKET.HC.CHARLIST_NOTIFY, pkt => {
			// Paged list flow: request every page (CharEngine.js:797-803).
			const total = Math.max(pkt.TotalCnt, 1);
			for (let i = 0; i < total; ++i) {
				Network.sendPacket(new PACKET.CH.CHARLIST_REQ());
			}
		});
		hook(PACKET.HC.REFUSE_ENTER, pkt => {
			reject(sessionError(5, 'char server refused — ErrorCode ' + pkt.ErrorCode));
		});
		hook(PACKET.HC.REFUSE_SELECTCHAR, pkt => {
			reject(sessionError(5, 'char select refused — ErrorCode ' + pkt.ErrorCode));
		});
		hook(PACKET.HC.SECOND_PASSWD_LOGIN, pkt => {
			// State 0 = pincode disabled or already satisfied.
			if (pkt.State !== 0) {
				reject(sessionError(6, 'pincode required (state ' + pkt.State + ') — not supported headless'));
			}
		});
		hook(PACKET.HC.NOTIFY_ZONESVR, onZoneInfo);
		hook(PACKET.HC.NOTIFY_ZONESVR2, onZoneInfo);
		hookNotifyBan(reject);

		const ip = Network.utils.longToIP(srv.ip);
		log('info', 'connecting to char server', ip + ':' + srv.port, '(' + srv.name + ')');
		Network.connect(ip, srv.port, success => {
			if (!success) {
				reject(sessionError(2, 'char server connect failed'));
				return;
			}
			const pkt = new PACKET.CH.ENTER();
			pkt.AID = Session.AID;
			pkt.AuthCode = Session.AuthCode;
			pkt.userLevel = Session.UserLevel;
			pkt.Sex = Session.Sex;
			pkt.clientType = Session.LangType;
			Network.sendPacket(pkt);

			// The char server prefixes its stream with a headerless AID —
			// must be consumed or the parser desyncs (CharEngine.js:96).
			Network.read(fp => {
				Session.AID = fp.readLong();
			});
		});
	});
}

/**
 * Map server: CZ.ENTER(2) → ZC.ACCEPT_ENTER(2,3) → CZ.NOTIFY_ACTORINIT + ping.
 *
 * @returns {Promise<{mapName: string}>}
 */
function mapPhase(cfg, mapInfo) {
	return phase('map', (resolve, reject) => {
		function onAccept(pkt) {
			// "Map loaded" ack — without it the server never spawns the
			// character (MapEngine.js:742).
			Network.sendPacket(new PACKET.CZ.NOTIFY_ACTORINIT());

			const startTick = Date.now();
			Network.setPing(() => {
				const ping = PACKETVER.value >= 20180307 ? new PACKET.CZ.REQUEST_TIME2() : new PACKET.CZ.REQUEST_TIME();
				ping.clientTime = Date.now() - startTick;
				Network.sendPacket(ping);
			});

			log('info', 'map entered at pos', pkt.PosDir, '— GID', Session.GID);
			resolve({ mapName: mapInfo.mapName });
		}

		hook(PACKET.ZC.ACCEPT_ENTER, onAccept);
		hook(PACKET.ZC.ACCEPT_ENTER2, onAccept);
		hook(PACKET.ZC.ACCEPT_ENTER3, onAccept);
		hook(PACKET.ZC.REFUSE_ENTER, pkt => {
			reject(sessionError(7, 'map server refused — ErrorCode ' + pkt.ErrorCode));
		});
		hook(PACKET.ZC.NPCACK_MAPMOVE, pkt => {
			log('info', 'map move ack:', pkt.mapName, pkt.xPos + ',' + pkt.yPos);
		});
		hookNotifyBan(reject);

		log('info', 'connecting to map server', mapInfo.ip + ':' + mapInfo.port, '(' + mapInfo.mapName + ')');
		Network.connect(
			mapInfo.ip,
			mapInfo.port,
			success => {
				if (!success) {
					reject(sessionError(2, 'map server connect failed'));
					return;
				}
				const pkt = PACKETVER.value >= 20180307 ? new PACKET.CZ.ENTER2() : new PACKET.CZ.ENTER();
				pkt.AID = Session.AID;
				pkt.GID = Session.GID;
				pkt.AuthCode = Session.AuthCode;
				pkt.clientTime = Date.now();
				pkt.Sex = Session.Sex;
				Network.sendPacket(pkt);

				// Pre-20070521 servers prefix the stream with a raw GID;
				// armed unconditionally to mirror MapEngine.js:187-197.
				Network.read(fp => {
					if (PACKETVER.value < 20070521) {
						Session.Character.GID = fp.readLong();
					}
				});
			},
			true // isZone → PacketCrypt.init() (no-op when packetKeys is false)
		);
	});
}

/**
 * Full handshake. Resolves once in-map (ACCEPT_ENTER handled, actor-init
 * sent, ping loop running).
 *
 * @param {object} cfg from loadConfig()
 * @param {string} password RAM only — never logged, never persisted
 * @param {{chooseChar?: function(Array): (number|Promise<number>)}} [opts]
 *        chooseChar → interactive char select (see charPhase); absent → config slot.
 * @returns {Promise<{mapName: string}>}
 */
export async function runSession(cfg, password, opts = {}) {
	const charServers = await loginPhase(cfg, password);
	const mapInfo = await charPhase(cfg, charServers, opts.chooseChar);
	return mapPhase(cfg, mapInfo);
}

/**
 * Return to character-select on the live, already-authenticated session — no
 * re-login, no password. Mirrors the browser's CZ.RESTART(type=1) →
 * CharEngine.reload() path (MapEngine.js:819 / CharEngine.js:130): ask the map
 * server to send us back, tear down the map socket, then re-run the char + map
 * phases reusing the retained char-server descriptor and the Session auth
 * tokens (AID/AuthCode/UserLevel/Sex/LangType — all still valid).
 *
 * @param {object} cfg
 * @param {?function(Array): (number|Promise<number>)} [chooseChar] interactive picker
 * @returns {Promise<{mapName: string}>}
 */
export async function returnToCharSelect(cfg, chooseChar) {
	if (!Session.CharServer) {
		throw sessionError(5, 'no retained char server — return to char-select needs a prior login');
	}

	// Ask the map server, and wait for its ack before tearing down.
	await phase('restart', (resolve, reject) => {
		hook(PACKET.ZC.RESTART_ACK, pkt => {
			// type 1 = return to char-select; type 0 = respawn ("wait 10s").
			if (pkt.type === 1) {
				resolve();
			} else {
				reject(sessionError(7, 'restart refused — got type ' + pkt.type + ' (respawn), not char-select'));
			}
		});
		hookNotifyBan(reject);
		const pkt = new PACKET.CZ.RESTART();
		pkt.type = 1;
		Network.sendPacket(pkt);
	});

	// Close the map socket first (mirrors CharEngine.reload's Network.close) so
	// the stale map ping loop doesn't run against a dead server while the char
	// phase reconnects. The server may already have closed it after the ack.
	try {
		Network.close();
	} catch {
		// already closed
	}

	const mapInfo = await charPhase(cfg, [Session.CharServer], chooseChar);
	return mapPhase(cfg, mapInfo);
}
