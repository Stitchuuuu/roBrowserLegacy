/**
 * Node/cli/screen.js
 *
 * Split-screen terminal for the REPL: the top region scrolls the event log,
 * a fixed 3-line footer at the bottom holds the command input (grey, `>`).
 * No dependencies — uses an ANSI scroll region (DECSTBM) so event lines never
 * clobber the input line.
 *
 *   ┌ events (scroll region, rows 1 .. H-3) ┐
 *   ├────────────────────────────────────────┤  row H-2  separator
 *   │ > user input                            │  row H-1  input
 *   │ /help · Ctrl-C to quit                  │  row H    hint
 *
 * write() is wired as the log sink. On a non-TTY stdout it degrades to a plain
 * readline line reader with unadorned writes.
 */
import fs from 'node:fs';
import process from 'node:process';
import readline from 'node:readline';

const FOOTER_H = 3;
const HISTORY_MAX = 1000; // lines kept in memory / loaded from the history file
const ESC = '\x1b';
const grey = s => '\x1b[90m' + s + '\x1b[0m';

export class Screen {
	constructor() {
		this.tty = !!(process.stdout.isTTY && process.stdin.isTTY);
		this.buffer = '';
		this.hint = '/help for commands · Ctrl-C to quit';
		this.cursor = 0; // caret position within `buffer` (0 .. buffer.length)
		this.history = []; // submitted lines (Up/Down navigate)
		this.histIdx = 0; // cursor into history; === length means the fresh line
		this._historyFile = null; // persists history across sessions when set
		this._onLine = null;
		this._onInterrupt = null;
		this._paused = false;
		this._rl = null;
		this._onData = null;
		this._onResize = null;
	}

	get rows() {
		return process.stdout.rows || 24;
	}
	get cols() {
		return process.stdout.columns || 80;
	}
	get _scrollBottom() {
		return Math.max(1, this.rows - FOOTER_H);
	}

	/** @param {function(string): void} cb line handler (raw text, no trailing NL) */
	onLine(cb) {
		this._onLine = cb;
	}
	/** @param {function(): void} cb Ctrl-C / Ctrl-D handler */
	onInterrupt(cb) {
		this._onInterrupt = cb;
	}
	setHint(text) {
		this.hint = text;
		if (this.tty && !this._paused) {
			this._drawFooter();
		}
	}

	/**
	 * Persist command history to a file across sessions. Loads the existing file
	 * (last HISTORY_MAX lines) now, and appends each submitted line thereafter.
	 * @param {string} filePath
	 */
	setHistoryFile(filePath) {
		this._historyFile = filePath;
		try {
			const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
			this.history = lines.slice(-HISTORY_MAX);
			this.histIdx = this.history.length;
		} catch {
			// no history file yet — starts empty
		}
	}

	mount() {
		if (!this.tty) {
			this._mountPlain();
			return;
		}
		this._out(ESC + '[2J' + ESC + '[H'); // clear + home
		this._setRegion();
		this._out(ESC + '[' + this._scrollBottom + ';1H'); // cursor into scroll area
		this._drawFooter();

		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.setEncoding('utf8');
		this._onData = ch => this._handleKeys(ch);
		process.stdin.on('data', this._onData);

		this._onResize = () => {
			this._setRegion();
			this._drawFooter();
		};
		process.stdout.on('resize', this._onResize);
	}

	_mountPlain() {
		this._rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
		this._rl.on('line', line => {
			if (this._onLine) {
				this._onLine(line.trim());
			}
			this._rl.prompt();
		});
		this._rl.on('SIGINT', () => {
			if (this._onInterrupt) {
				this._onInterrupt();
			}
		});
		this._rl.prompt();
	}

	// The log sink: print a line into the scroll region without disturbing input.
	write(text, stream) {
		if (!this.tty) {
			(stream === 'err' ? process.stderr : process.stdout).write(text + '\n');
			if (this._rl && !this._paused) {
				this._rl.prompt(true);
			}
			return;
		}
		if (this._paused) {
			this._out(text + '\r\n');
			return;
		}
		const lines = String(text).split('\n');
		let seq = ESC + '7'; // save cursor
		for (let i = 0; i < lines.length; ++i) {
			seq += ESC + '[' + this._scrollBottom + ';1H' + '\n' + ESC + '[2K' + lines[i];
		}
		seq += ESC + '8'; // restore cursor (back to input caret)
		this._out(seq);
	}

	_setRegion() {
		// scroll region = rows 1 .. H-FOOTER_H ; rest is the static footer
		this._out(ESC + '[1;' + this._scrollBottom + 'r');
	}

	_drawFooter() {
		const H = this.rows;
		const sep = '\x1b[90m' + '─'.repeat(this.cols) + '\x1b[0m';
		let seq = ESC + '7';
		seq += ESC + '[' + (H - 2) + ';1H' + ESC + '[2K' + sep; // separator
		seq += ESC + '[' + (H - 1) + ';1H' + ESC + '[2K' + this._promptLine();
		seq += ESC + '[' + H + ';1H' + ESC + '[2K' + grey(this.hint);
		// place the caret at the cursor position ('> ' is 2 cols → 1-based col 3)
		seq += ESC + '[' + (H - 1) + ';' + (3 + this.cursor) + 'H';
		this._out(seq);
	}

	_promptLine() {
		return grey('> ') + this.buffer;
	}

	_handleKeys(ch) {
		// A data chunk can carry several bytes (paste, or a multi-byte escape seq).
		const n = ch.length;
		let i = 0;
		while (i < n) {
			const c = ch[i];
			if (c === '\r' || c === '\n') {
				const line = this.buffer.trim();
				this.buffer = '';
				this.cursor = 0;
				if (line && this.history[this.history.length - 1] !== line) {
					this.history.push(line);
					if (this._historyFile) {
						try {
							fs.appendFileSync(this._historyFile, line + '\n');
						} catch {
							// history persistence is best-effort
						}
					}
				}
				this.histIdx = this.history.length;
				this._drawFooter();
				if (line && this._onLine) {
					this._onLine(line);
				}
				i += 1;
			} else if (c === '\x03' || c === '\x04') {
				if (this._onInterrupt) {
					this._onInterrupt();
				}
				i += 1;
			} else if (c === '\x7f' || c === '\b') {
				// backspace — delete the char before the cursor
				if (this.cursor > 0) {
					this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
					this.cursor -= 1;
					this._drawFooter();
				}
				i += 1;
			} else if (c === '\x1b') {
				i += this._handleEscape(ch.slice(i));
			} else if (c >= ' ') {
				// printable — insert at the cursor
				this.buffer = this.buffer.slice(0, this.cursor) + c + this.buffer.slice(this.cursor);
				this.cursor += 1;
				this._drawFooter();
				i += 1;
			} else {
				i += 1; // ignore other control bytes
			}
		}
	}

	// Handle a CSI escape sequence (arrows / Home / End / Delete). Returns the
	// number of bytes consumed from `seq` (>= 1 so the caller always advances).
	_handleEscape(seq) {
		if (seq.startsWith('\x1b[D')) {
			// Left
			if (this.cursor > 0) {
				this.cursor -= 1;
				this._drawFooter();
			}
			return 3;
		}
		if (seq.startsWith('\x1b[C')) {
			// Right
			if (this.cursor < this.buffer.length) {
				this.cursor += 1;
				this._drawFooter();
			}
			return 3;
		}
		if (seq.startsWith('\x1b[H') || seq.startsWith('\x1b[1~')) {
			this.cursor = 0; // Home
			this._drawFooter();
			return seq[2] === 'H' ? 3 : 4;
		}
		if (seq.startsWith('\x1b[F') || seq.startsWith('\x1b[4~')) {
			this.cursor = this.buffer.length; // End
			this._drawFooter();
			return seq[2] === 'F' ? 3 : 4;
		}
		if (seq.startsWith('\x1b[3~')) {
			// Delete — remove the char under the cursor
			if (this.cursor < this.buffer.length) {
				this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
				this._drawFooter();
			}
			return 4;
		}
		if (seq.startsWith('\x1b[A')) {
			this._historyStep(-1); // Up — older
			return 3;
		}
		if (seq.startsWith('\x1b[B')) {
			this._historyStep(1); // Down — newer
			return 3;
		}
		return 1; // lone ESC or unknown — swallow a single byte
	}

	_historyStep(dir) {
		const next = this.histIdx + dir;
		if (next < 0 || next > this.history.length) {
			return;
		}
		this.histIdx = next;
		this.buffer = next === this.history.length ? '' : this.history[next];
		this.cursor = this.buffer.length;
		this._drawFooter();
	}

	// Drop the TUI for a modal inline prompt (masked password, char select),
	// then restore. Used by /login mid-session.
	pauseInput() {
		if (!this.tty || this._paused) {
			return;
		}
		this._paused = true;
		if (this._onData) {
			process.stdin.removeListener('data', this._onData);
		}
		process.stdin.setRawMode(false);
		this._out(ESC + '[r'); // reset scroll region to full screen
		this._out(ESC + '[' + this.rows + ';1H\n'); // move below, fresh line
	}

	resumeInput() {
		if (!this.tty || !this._paused) {
			return;
		}
		this._paused = false;
		this._out(ESC + '[2J' + ESC + '[H');
		this._setRegion();
		this._out(ESC + '[' + this._scrollBottom + ';1H');
		this._drawFooter();
		process.stdin.setRawMode(true);
		process.stdin.resume();
		if (this._onData) {
			process.stdin.on('data', this._onData);
		}
	}

	close() {
		if (!this.tty) {
			if (this._rl) {
				this._rl.close();
			}
			return;
		}
		if (this._onData) {
			process.stdin.removeListener('data', this._onData);
		}
		if (this._onResize) {
			process.stdout.removeListener('resize', this._onResize);
		}
		try {
			process.stdin.setRawMode(false);
		} catch {
			// stdin may already be closed
		}
		this._out(ESC + '[r' + ESC + '[' + this.rows + ';1H\n'); // reset region, cursor to bottom
	}

	_out(s) {
		process.stdout.write(s);
	}
}
