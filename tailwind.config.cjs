/** @type {import('tailwindcss').Config} */
export default {
	darkMode: ['class', '[data-kb-theme="dark"]'],
	important: true,
	content: ['./src/**/*.{js,jsx,ts,tsx}'],
	theme: {
		extend: {},
	},
	plugins: [],
	presets: [require('./ui.preset.js')]
}

