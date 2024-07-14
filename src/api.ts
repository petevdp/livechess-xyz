import { interval } from 'rxjs'
import { onCleanup } from 'solid-js'

import { API_URL } from '~/config.ts'
import { NewNetworkResponse } from '~/utils/sharedStore.ts'

export async function newNetwork() {
	return (await fetch(`${API_URL}/networks`, { method: 'POST' }).then((res) => res.json())) as NewNetworkResponse
}

export async function checkNetworkExists(networkId: string) {
	return await fetch(`${API_URL}/networks/${networkId}`, { method: 'HEAD' }).then((res) => res.status === 200)
}

export function keepServerAlive() {
	const sub = interval(10000).subscribe(() => {
		// make sure render's server doesn't spin down while we're in the middle of a game
		void fetch(API_URL + '/ping')
	})
	onCleanup(() => {
		sub.unsubscribe()
	})
}
