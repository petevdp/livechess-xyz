/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
	test: {
		browser: {
			enabled: true,
			headless: false,
			provider: 'playwright',
			name: 'chromium',
		},
	},
})
