import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import solidSvg from 'vite-plugin-solid-svg'
import devtools from 'solid-devtools/vite'

export default defineConfig({
	plugins: [devtools({ autoname: true }), solid(), solidSvg()],
})
