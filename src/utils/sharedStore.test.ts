import { describe, expect, expectTypeOf, it } from 'vitest'
import { createSharedStore, NewNetworkResponse, WebsocketNetProvider } from './sharedStore.ts'
import { unwrap } from 'solid-js/store'
import { until } from '@solid-primitives/promise'
import { createEffect, createRoot } from 'solid-js'

async function newNetwork() {
	return (await fetch('http://localhost:8080/networks/new').then((res) => res.json())) as NewNetworkResponse
}

describe('network provider/shared store', () => {
	it('can create a network', async () => {
		const network = await newNetwork()

		expect(network.networkId).toMatch(/[a-zA-Z0-9]{6}/)
	})

	it('can connect to a network', async () => {
		const network = await newNetwork()
		const ws1 = new WebSocket(`ws://localhost:8080/networks/${network.networkId}`)
		const provider1 = new WebsocketNetProvider(ws1, 'client1')

		type T = { ayy: string; lmao?: string }
		const sharedStore1 = createSharedStore(
			provider1,
			{
				networkId: network.networkId,
				leader: true,
				lastMutationIndex: 0,
			},
			{ ayy: 'lmao' } as T
		)

		await new Promise<void>((resolve) => {
			function listener() {
				expect(provider1.ws.readyState).toBe(WebSocket.OPEN)
				provider1.ws.removeEventListener('open', listener)
				resolve()
			}

			provider1.ws.addEventListener('open', listener)
		})

		// check if not empty object
		expectTypeOf(unwrap(sharedStore1.lockstepStore)).toEqualTypeOf({ ayy: 'lmao' })

		sharedStore1.setStore(['lmao'], 'ayy')
		await until(() => sharedStore1.rollbackStore.lmao === 'ayy')
		await until(() => sharedStore1.lockstepStore.lmao === 'ayy')
		expect(sharedStore1.rollbackStore.lmao).toBe('ayy')

		const ws2 = new WebSocket(`ws://localhost:8080/networks/${network.networkId}`)
		const provider2 = new WebsocketNetProvider(ws2, 'client2')
		const sharedStore2 = createSharedStore<T>(provider2)
		createRoot(() => {
			console.log(' in root')
			createEffect(() => {
				console.log('initialized: test', sharedStore2.initialized())
			})
		})
		console.log('waiting for second client to connect')
		await until(sharedStore2.initialized)
		console.log('initialized!!')
		sharedStore2.setStore(['lmao'], 'lmao')
		await until(() => sharedStore2.rollbackStore.lmao === 'lmao')
		console.log('rollback store updated')
		await until(() => sharedStore2.lockstepStore.lmao === 'lmao')
		console.log('lockstep store updated')
		expect(sharedStore2.rollbackStore.lmao).toBe('lmao')
	})
})
