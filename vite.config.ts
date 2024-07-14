// @ts-ignore
import { execSync } from 'child_process'
import dotenv from 'dotenv'
import devtools from 'solid-devtools/vite'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import solidSvg from 'vite-plugin-solid-svg'
import tsconfigPaths from 'vite-tsconfig-paths'

//@ts-expect-error dumb typescript stuff, clashing includes in tsconfig.json and tsconfig.node.json
import { ENV, setupEnv } from './src/env'

dotenv.config()

// noinspection JSUnusedGlobalSymbols
export default defineConfig(() => {
	setupEnv()

	const httpTarget = `http://${ENV.HOSTNAME}:${ENV.PORT}`
	const wsTarget = `ws://${ENV.HOSTNAME}:${ENV.PORT}`
	const config = {
		plugins: [devtools({ autoname: true }), solid(), solidSvg(), tsconfigPaths()],
		build: {
			sourcemap: true,
		},
		server: {
			proxy: {
				'/api': {
					target: httpTarget,
					changeOrigin: true,
				},
				'^/api/networks/.*': {
					target: wsTarget,
					changeOrigin: true,
					ws: true,
				},
			},
		},
	}

	for (const [key, value] of Object.entries(config.server.proxy)) {
		console.log(`proxying ${key} to ${value.target}`)
	}
	console.log()

	return config
})
