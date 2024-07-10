export const ENVIRONMENTS = ['development', 'production', 'testing'] as const
import dotenv from 'dotenv'
export let ENVIRONMENT: typeof ENVIRONMENTS[number] = 'development'
let loc: URL | Location
console.log(import.meta.env)
if (import.meta.env?.VITE_RUNNING_VITEST === 'true') {
	ENVIRONMENT = 'testing'
	// just hardcode it as vitest doesn't support proxyies and we can't grav the environment variable
	loc = new URL(`http://0.0.0.0:8080`)
} else if (typeof window === 'undefined') {
	dotenv.config()
	// probably won't be used, but we'll set it up correctly anyway :shrug:
	loc = new URL(`http://${process.env.HOST}:${process.env.PORT}`)
	ENVIRONMENT = process.env.NODE_ENV as typeof ENVIRONMENTS[number] ?? ENVIRONMENT
} else {
	ENVIRONMENT = import.meta.env.ENVIRONMENT ?? ENVIRONMENT
	loc = window.location
}

export const PLAYER_TIMEOUT = 5000
export const API_URL = `${loc.protocol}//${loc.host}/api`;
export const WS_API_URL = `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/api`

export const BOARD_COLORS = {
	light: '#eaaa69',
	dark: '#a05a2c',
	lightFog: '#b0814f',
	darkFog: '#623211',
}
