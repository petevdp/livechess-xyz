/** @type {import("prettier").Config} */
const config = {
	trailingComma: 'es5',
	useTabs: true,
	semi: false,
	singleQuote: true,
	printWidth: 140,
	plugins: ['prettier-plugin-tailwindcss', '@trivago/prettier-plugin-sort-imports'],
	importOrder: ['<THIRD_PARTY_MODULES>', '^~/(.*)$', '^[./]'],
	importOrderSeparation: true,
	importOrderSortSpecifiers: true,
}

export default config
