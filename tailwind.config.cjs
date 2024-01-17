/** @type {import('tailwindcss').Config} */
export default {
	darkMode: ['class', '[data-kb-theme="dark"]'],
	content: ['./src/**/*.{js,jsx,ts,tsx}'],
	theme: {
		extend: {
			screens: {
				'wc': {raw: "(max-aspect-ratio: 1/1)"}
			}
		},
	},
	plugins: [],
	presets: [require('./ui.preset.js')]
}

