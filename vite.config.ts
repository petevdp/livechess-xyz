import devtools from 'solid-devtools/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';
import { ViteFaviconsPlugin } from 'vite-plugin-favicon';


export default defineConfig({
	plugins: [devtools({ autoname: true }), solid(), solidSvg(), tsconfigPaths(), ViteFaviconsPlugin({logo: 'favicon.svg', favicons: {
			appName: 'livechess.xyz',
			appDescription: 'Play chess with friends online',
			developerName: 'Pieter Vanderpol',
			developerURL: 'https://github.com/petevdp',
			background: '#ddd',
			theme_color: 'hsl(221.2 83.2% 53.3%)',
			icons: {
				coast: false,
				yandex: false
			}
		}})],
	server: {
		proxy: {
			'/networks': { target: 'http://0.0.0.0:8080', changeOrigin: true },
			// not working for some reason
			'/networks/.*': { target: 'ws://0.0.0.0:8080', changeOrigin: true, ws: true },
		},
	},
})
