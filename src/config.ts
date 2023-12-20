export const WS_CONNECTION = 'ws://localhost:1234'
// check if we're in browser

export let HEADLESS_TEST = false
if (typeof window !== 'undefined') {
	HEADLESS_TEST = location.search.includes('headless_test=true')
}
