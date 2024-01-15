import devtools from 'solid-devtools/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';


export default defineConfig({
	plugins: [devtools({ autoname: true }), solid(), solidSvg(), tsconfigPaths()],
	server: {
		proxy: {
			'/networks': { target: 'http://0.0.0.0:8080', changeOrigin: true },
			// not working for some reason
			'/networks/.*': { target: 'ws://0.0.0.0:8080', changeOrigin: true, ws: true },
		},
	},
})
