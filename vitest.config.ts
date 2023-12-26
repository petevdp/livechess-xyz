/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
	test: {
		browser: {
			enabled: true,
			headless: true,
			provider: 'playwright',
			name: 'chromium'
		}
	}
})
