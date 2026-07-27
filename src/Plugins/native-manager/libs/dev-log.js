// dev-log — dev-only log shim.
//
// Plugins call `devLog(level, channel, msg, data)` and the events are batched
// (200 ms window) then POSTed to a local sink at http://localhost:9876/log.
//
// Boot-time auto-disable: at first devLog() we fire-and-forget a /health GET.
// If it times out, errors, or returns non-200, the lib disables itself for
// HEALTHCHECK_BACKOFF_MS (10s) — production users see no console noise and no
// network calls. Re-arms on the next devLog() call past the backoff window.
//
// **Native transport.** The v3 lib used a Tampermonkey GM-XHR bridge to bypass
// CORS/mixed-content. Natively we use `fetch`. CAVEAT: the dev client runs on
// HTTPS (:6987) while the sink is plain http://localhost:9876 → a browser
// mixed-content block. On the HTTPS client the health check fails and dev-log
// silently disables itself (by design). To actually use it, run the sink over
// https or same-origin — tracked as a follow-up. dev-log is off the critical
// path for this session.

const ENDPOINT = 'http://localhost:9876'
const FLUSH_INTERVAL_MS = 200
const HEALTHCHECK_TIMEOUT_MS = 500
const HEALTHCHECK_BACKOFF_MS = 10000
const POST_TIMEOUT_MS = 2000
const MAX_QUEUE = 1000

let _disabled = false
let _disabledPermanent = false
let _healthChecked = false
let _healthCheckedAt = 0
let _queue = []
let _timer = null
const _stats = {
	sent: 0,
	dropped: 0,
	lastError: null,
	lastFlushMs: null,
}

function _fetchWithTimeout(url, opts, timeoutMs) {
	if (typeof fetch !== 'function') {return Promise.reject(new Error('fetch unavailable'))}
	const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
	const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
	const merged = ctrl ? Object.assign({ signal: ctrl.signal }, opts) : opts
	return fetch(url, merged).finally(() => { if (timer) {clearTimeout(timer)} })
}

function _healthCheck() {
	if (_healthChecked) return
	_healthChecked = true
	_healthCheckedAt = Date.now()
	if (typeof fetch !== 'function') {
		// No fetch — can't recover without a page reload.
		_disabled = true
		_disabledPermanent = true
		_stats.lastError = 'fetch unavailable'
		return
	}
	_fetchWithTimeout(ENDPOINT + '/health', { method: 'GET' }, HEALTHCHECK_TIMEOUT_MS)
		.then((res) => {
			if (!res || res.status !== 200) {
				_disabled = true
				_stats.lastError = 'health HTTP ' + (res && res.status)
			}
		})
		.catch((e) => { _disabled = true; _stats.lastError = 'health error: ' + (e && e.message) })
}

// Backoff re-arm: if `_disabled` was set by a server-reachability failure and
// HEALTHCHECK_BACKOFF_MS has elapsed, flip back to enabled so the next devLog()
// retriggers `_healthCheck`. `_disabledPermanent` bypasses re-arm.
function _maybeReArm() {
	if (!_disabled || _disabledPermanent) return
	if (Date.now() - _healthCheckedAt < HEALTHCHECK_BACKOFF_MS) return
	_disabled = false
	_healthChecked = false
}

function _scheduleFlush() {
	if (_timer) return
	_timer = setTimeout(_flush, FLUSH_INTERVAL_MS)
}

function _flush() {
	_timer = null
	if (_disabled || _queue.length === 0) return
	if (typeof fetch !== 'function') {
		_disabled = true
		_disabledPermanent = true
		return
	}
	const batch = _queue.splice(0)
	const body = JSON.stringify(batch)
	_stats.lastFlushMs = Date.now()
	_fetchWithTimeout(ENDPOINT + '/log', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
		keepalive: true,
	}, POST_TIMEOUT_MS)
		.then((res) => {
			if (res && res.status === 204) {
				_stats.sent += batch.length
			} else {
				_stats.lastError = 'POST HTTP ' + (res && res.status)
				_stats.dropped += batch.length
			}
		})
		.catch((e) => {
			_stats.lastError = 'POST error: ' + (e && e.message)
			_stats.dropped += batch.length
		})
}

// `opts.file` (string, optional) routes this event to a dedicated server-side
// file (logs/<file>-<date>.jsonl) instead of the default daily file. 4-arg
// calls are unchanged: `file` stays undefined and is dropped.
export function devLog(level, channel, msg, data, opts) {
	_maybeReArm()
	if (_disabled) return
	if (!_healthChecked) _healthCheck()
	if (_disabled) return
	if (_queue.length >= MAX_QUEUE) {
		_stats.dropped++
		return
	}
	_queue.push({
		ts: Date.now(),
		level: level,
		channel: channel,
		msg: msg,
		data: data,
		file: opts && opts.file ? opts.file : undefined,
	})
	_scheduleFlush()
}

export function devLogStatus() {
	return {
		enabled: !_disabled,
		permanent: _disabledPermanent,
		healthChecked: _healthChecked,
		healthCheckedAt: _healthCheckedAt,
		queued: _queue.length,
		sent: _stats.sent,
		dropped: _stats.dropped,
		lastError: _stats.lastError,
		lastFlushMs: _stats.lastFlushMs,
	}
}
