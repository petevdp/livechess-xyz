let loc: URL | Location | null = null
if (typeof window === 'undefined') {
	loc = new URL('http://0.0.0.0:8080')
} else if (import.meta.env?.VITE_RUNNING_VITEST === 'true') {
	// just hardcode it as vitest doesn't support proxies and we can't grab the environment variable from the browser
	loc = new URL(`http://0.0.0.0:8080`)
} else {
	loc = window.location
}

export const PLAYER_TIMEOUT = 5000
export const API_URL = `${loc.protocol}//${loc.host}/api`
export const WS_API_URL = `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/api`

export const BOARD_COLORS = {
	light: '#eaaa69',
	dark: '#a05a2c',
	lightFog: '#b0814f',
	darkFog: '#623211',
}
