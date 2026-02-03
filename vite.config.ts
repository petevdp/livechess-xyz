import devtools from 'solid-devtools/vite'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import solidSvg from 'vite-plugin-solid-svg'
import tsconfigPaths from 'vite-tsconfig-paths'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore dumb typescript stuff, clashing includes in tsconfig.json and tsconfig.node.json
import { ENV, ensureSetupEnv } from './src/env'

// noinspection JSUnusedGlobalSymbols
export default defineConfig(() => {
	ensureSetupEnv()

	const httpTarget = `http://${ENV.HOSTNAME}:${ENV.PORT}`
	const wsTarget = `ws://${ENV.HOSTNAME}:${ENV.PORT}`
	const config = {
		plugins: [devtools({ autoname: true }), solid(), solidSvg({ defaultAsComponent: false }), tsconfigPaths()],
		build: {
			sourcemap: true,
		},
		server: {
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp',
			},
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
