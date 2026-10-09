export default {
	name: 'Consumer',
	deps: ['BootFalse'],
	init(pars, deps) {
		window.__consumedFalse = deps.BootFalse;
		return true;
	}
};
