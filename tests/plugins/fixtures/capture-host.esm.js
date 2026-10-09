export default {
	name: 'CaptureHost',
	init(pars, deps) {
		window.__capturedHost = deps.PluginHost;
		return true;
	}
};
