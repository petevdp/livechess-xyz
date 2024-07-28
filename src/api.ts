import { interval } from 'rxjs'
import { onCleanup } from 'solid-js'

import { API_URL } from './config.ts'
import { type NewNetworkResponse } from './sharedStore/sharedStore.ts'
import * as Errors from './systems/errors.ts'

export async function newNetwork() {
	return (await fetch(`${API_URL}/networks`, { method: 'POST' }).then((res) => {
		if (!res.ok) {
			const title = 'Failed to create new network'
			Errors.pushFatalError(title, 'Server may be down', true)
		}
		return res.json()
	})) as NewNetworkResponse
}

export async function checkNetworkExists(networkId: string) {
	return await fetch(`${API_URL}/networks/${networkId}`, { method: 'HEAD' }).then((res) => {
		if (res.status === 200) return true
		if (res.status === 404) return false
		Errors.pushFatalError('Failed to check network exists', 'Server may be down', true)
	})
}

export function keepServerAlive() {
	const sub = interval(10000).subscribe(async () => {
		// make sure render's server doesn't spin down while we're in the middle of a game
		const res = await fetch(API_URL + '/ping')
		if (!res.ok) {
			sub.unsubscribe()
			Errors.pushFatalError('Failed to keep server alive', 'Server may be down', true)
		}
	})
	onCleanup(() => {
		sub.unsubscribe()
	})
}
