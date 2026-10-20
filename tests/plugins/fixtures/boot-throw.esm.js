export default {
	name: 'BootThrow',
	init() {
		throw new Error('boot boom');
	}
};
