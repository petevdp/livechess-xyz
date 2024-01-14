import devtools from 'solid-devtools/vite'
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';


export default defineConfig({
	plugins: [devtools({ autoname: true }), solid(), solidSvg(), tsconfigPaths()],
})
