import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const sourceRoot = process.env.EFFECT_SOURCE_ROOT || join(process.cwd(), 'src');
const source = name => readFileSync(join(sourceRoot, name), 'utf8').replace(/^import .*;\r?$/gm, '');

// A gl stub that counts the textures still alive.
function fakeGl() {
	const gl = {
		textures: 0,
		createBuffer: () => ({}),
		createTexture: () => (gl.textures++, {}),
		deleteTexture: () => gl.textures--,
		deleteProgram() {},
		deleteBuffer() {},
		bindBuffer() {},
		bufferData() {},
		bindTexture() {},
		texImage2D() {},
		texParameteri() {},
		generateMipmap() {}
	};
	return gl;
}

// Loads an effect whose texture file only arrives when `flush()` is called.
function effect(name) {
	const pending = [];
	const image = { width: 2, height: 2, getContext: () => new Proxy({}, { get: () => () => {} }) };
	const context = vm.createContext({
		console,
		Float32Array,
		Math,
		SkillId: {},
		_vertexShader: '',
		_fragmentShader: '',
		WebGL: {
			createShaderProgram: () => ({ uniform: {}, attribute: {} }),
			texture: (gl, buffer, callback) => callback(gl.createTexture())
		},
		Texture: { load: (buffer, onload) => onload.call(image) },
		Client: { loadFile: (filename, onload) => pending.push(onload) },
		Configs: { get: () => false },
		glMatrix: { mat4: { create: () => new Float32Array(16) } }
	});
	vm.runInContext(
		source(`Renderer/Effects/${name}.js`).replace(`export default ${name};`, `this.Effect = ${name};`),
		context
	);
	return { Effect: context.Effect, flush: () => pending.splice(0).forEach(onload => onload(new ArrayBuffer(1))) };
}

// A teleport frees every effect (EffectManager.free) while a texture may still be loading.
// The late load used to mark the class ready with its program already deleted: the next
// instance skipped init and beforeRender threw on a null program, every frame.
describe('effect texture loaded after the effect was freed', () => {
	for (const name of ['LockOnTarget', 'MagicTarget', 'GroundEffect', 'SpiritSphere', 'WarlockSphere']) {
		it(`${name} stays not ready, and its stale texture is released`, () => {
			const { Effect, flush } = effect(name);
			const gl = fakeGl();

			Effect.init(gl);
			Effect.free(gl);
			flush();

			assert.equal(Effect.ready, false);
			assert.equal(gl.textures, 0);
		});

		it(`${name} is ready once a re-init loads, even after a stale load`, () => {
			const { Effect, flush } = effect(name);
			const gl = fakeGl();

			Effect.init(gl);
			Effect.free(gl);
			Effect.init(gl);
			flush();

			assert.equal(Effect.ready, true);
			assert.equal(gl.textures, 1);
		});
	}
});
