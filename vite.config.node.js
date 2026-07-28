/**
 * vite.config.node.js
 *
 * Headless Node build for src/Node/ (SSR/lib mode — no HTML pipeline).
 * Alias map: keep in sync with vite.config.js:47-61.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			App: path.resolve(__dirname, './src/App'),
			Audio: path.resolve(__dirname, './src/Audio'),
			Controls: path.resolve(__dirname, './src/Controls'),
			Core: path.resolve(__dirname, './src/Core'),
			DB: path.resolve(__dirname, './src/DB'),
			Engine: path.resolve(__dirname, './src/Engine'),
			Loaders: path.resolve(__dirname, './src/Loaders'),
			Network: path.resolve(__dirname, './src/Network'),
			Plugins: path.resolve(__dirname, './src/Plugins'),
			Preferences: path.resolve(__dirname, './src/Preferences'),
			Renderer: path.resolve(__dirname, './src/Renderer'),
			UI: path.resolve(__dirname, './src/UI'),
			Utils: path.resolve(__dirname, './src/Utils'),
			Vendors: path.resolve(__dirname, './src/Vendors')
		}
	},
	build: {
		ssr: true,
		outDir: 'dist-node',
		emptyOutDir: true,
		sourcemap: false,
		minify: false,
		target: 'node22',
		rollupOptions: {
			input: {
				run: path.resolve(__dirname, 'src/Node/run.js'),
				smoke: path.resolve(__dirname, 'src/Node/smoke.js'),
				client: path.resolve(__dirname, 'src/Node/client.js')
			},
			external: ['ws'],
			output: {
				format: 'es',
				entryFileNames: '[name].js'
			}
		}
	}
});
