export const ENVIRONMENT = import.meta.env.ENVIRONMENT || 'development'
export const PLAYER_TIMEOUT = 5000
export const API_URL = `${window.location.protocol}//${window.location.host}/api`;
export const WS_API_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api`

export const BOARD_COLORS = {
	light: '#eaaa69',
	dark: '#a05a2c',
	lightFog: '#b0814f',
	darkFog: '#623211',
}
