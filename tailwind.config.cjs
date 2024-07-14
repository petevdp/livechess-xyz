/** @type {import('tailwindcss').Config} */
export default {
	darkMode: ['class', '[data-kb-theme="dark"]'],
	content: ['./src/**/*.{js,jsx,ts,tsx}', './index.html'],
	theme: {
		extend: {
			screens: {
				'wc': {raw: "(max-aspect-ratio: 7/6)"}
			}
		},
	},
	plugins: [],
	presets: [require('./ui.preset.js')]
}

