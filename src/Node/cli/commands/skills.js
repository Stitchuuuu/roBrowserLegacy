/**
 * /skills — learned skill list.
 */
import { log } from '../../log.js';

export default {
	name: 'skills',
	aliases: ['sk'],
	help: 'list your skills',
	run(ctx) {
		const skills = ctx.client.getSkills();
		if (!skills.length) {
			log.event('no skills yet (list arrives after map entry)');
			return;
		}
		log.event(skills.length + ' skill(s):');
		for (let i = 0, n = skills.length; i < n; ++i) {
			const s = skills[i];
			log.event('  ' + s.name + '  · SKID ' + s.skid + ' · Lv' + s.level + ' · SP' + s.spcost);
		}
	}
};
