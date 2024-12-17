/// <reference types="vitest" />
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const httpTarget = 'http://' + process.env.HOSTNAME + ':' + process.env.PORT
const wsTarget = 'ws://' + process.env.HOSTNAME + ':' + process.env.PORT
process.env.VITE_RUNNING_VITEST = 'true'
export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		maxConcurrency: 5,
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
		browser: {
			enabled: true,
			headless: false,
			provider: 'playwright',
			name: 'chromium',
		},
	},
})
