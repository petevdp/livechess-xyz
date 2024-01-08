import {describe, expect, it, test} from 'vitest'
import {buildTransaction, initSharedStore, newNetwork, SharedStore, SharedStoreProvider} from './sharedStore.ts'
import {until} from '@solid-primitives/promise'
import {createEffect, createRoot} from 'solid-js'
import {sleep} from './time.ts'
import {SERVER_HOST} from '../config.ts'
import {unwrap} from 'solid-js/store'
import {trackStore} from '@solid-primitives/deep'
import {firstValueFrom} from 'rxjs'

/**
 * All of the tests below assume that the sharedstore server  is running on localhost:8080
 */
describe('network provider/shared store', () => {
	it('can create a network', async () => {
		const network = await newNetwork(SERVER_HOST)
		expect(network.networkId).toMatch(/[a-zA-Z0-9]{6}/)
	})

	it('can connect to a network', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		await provider1.waitForConnected()
		//@ts-ignore
		expect(provider1.ws.readyState).toBe(WebSocket.OPEN)
	})

	test('can mutate', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		let toDispose: (() => void)[] = []

		type T = { ayy: string; lmao?: string }
		let leaderStore = null as unknown as ReturnType<typeof initSharedStore>
		let followerStore = null as unknown as ReturnType<typeof initSharedStore>

		createRoot((d) => {
			toDispose.push(d)
			leaderStore = initSharedStore<T>(provider1, {}, { ayy: 'ayy' })
		})
		await until(() => leaderStore.initialized())
		createRoot((d) => {
			toDispose.push(d)
			followerStore = initSharedStore<T>(provider2)
		})
		await until(() => followerStore.initialized())

		expect(leaderStore.lockstepStore.ayy).toBe('ayy')
		expect(leaderStore.rollbackStore.ayy).toBe('ayy')
		expect(followerStore.lockstepStore.ayy).toBe('ayy')
		expect(followerStore.rollbackStore.ayy).toBe('ayy')

		toDispose.forEach((d) => d())
	})

	test('first mutation is always accepted', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)

		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)

		const provider3 = new SharedStoreProvider(SERVER_HOST, network.networkId)

		let leaderStore = null as unknown as ReturnType<typeof initSharedStore>
		let follower1Store = null as unknown as ReturnType<typeof initSharedStore>
		let follower2Store = null as unknown as ReturnType<typeof initSharedStore>
		let dispose = () => {}

		createRoot((d) => {
			dispose = () => {
				d()
			}

			leaderStore = initSharedStore(provider1)
		})

		createRoot(() => {
			follower1Store = initSharedStore(provider2)
			follower2Store = initSharedStore(provider3)
		})

		await until(() => leaderStore.initialized() && follower1Store.initialized() && follower2Store.initialized())

		const follower1Set = follower1Store.setStore({ path: ['ayy'], value: 'follower1 was here' })
		const follower2Set = follower2Store.setStore({ path: ['ayy'], value: 'follower2 was here' })
		await Promise.all([follower1Set, follower2Set])
		// whether follower1 or follower2 wins is nondeterministic
		if (await follower1Set) {
			expect(follower1Store.lockstepStore.ayy).toBe('follower1 was here')
			expect(follower2Store.lockstepStore.ayy).toBe('follower1 was here')
			expect(leaderStore.lockstepStore.ayy).toBe('follower1 was here')
		} else if (await follower2Set) {
			expect(follower1Store.lockstepStore.ayy).toBe('follower2 was here')
			expect(follower2Store.lockstepStore.ayy).toBe('follower2 was here')
			expect(leaderStore.lockstepStore.ayy).toBe('follower2 was here')
		} else {
			throw new Error('neither transaciton succeeded')
		}
		dispose()
	})

	test('clients can join late and be updated', async () => {
		const network = await newNetwork(SERVER_HOST)
		let leaderStore = null as unknown as SharedStore<{ ayy: string }>
		let followerStore = null as unknown as SharedStore<{ ayy: string }>
		let toDispose: Function[] = []

		createRoot((d) => {
			const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
			toDispose.push(d)

			//@ts-ignore
			leaderStore = initSharedStore(provider1, {}, { ayy: 'lmao' })
		})

		await sleep(200)

		createRoot(() => {
			const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)

			toDispose.push(() => {})
			followerStore = initSharedStore(provider2)
		})

		await until(() => leaderStore.initialized() && followerStore.initialized())
		expect(followerStore.lockstepStore.ayy).toBe('lmao')
		toDispose.forEach((d) => d())
	})

	test('can elect new leader', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider3 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const toDispose: Function[] = []
		let originalLeaderStore = null as unknown as ReturnType<typeof initSharedStore>
		let followerStore = null as unknown as ReturnType<typeof initSharedStore>

		createRoot((dispose) => {
			toDispose.push(dispose)
			originalLeaderStore = initSharedStore(provider1)
			followerStore = initSharedStore(provider2)
		})

		await until(() => originalLeaderStore.initialized() && followerStore.initialized())

		provider1.ws.close()

		await until(() => followerStore.isLeader())
		let followerStore2 = null as unknown as ReturnType<typeof initSharedStore>
		createRoot((d) => {
			toDispose.push(d)
			followerStore2 = initSharedStore(provider3)
		})
		await until(() => followerStore2.initialized())
		expect(followerStore2.isLeader()).toBe(false)
	})

	test('can handle dynamic transactions', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		let dispose = () => {}
		let leaderStore = null as unknown as ReturnType<typeof initSharedStore>
		let followerStore = null as unknown as ReturnType<typeof initSharedStore>

		createRoot((d) => {
			dispose = () => {
				d()
			}
			leaderStore = initSharedStore(provider1)
			followerStore = initSharedStore(provider2)
		})
		await until(() => followerStore.initialized() && leaderStore.initialized())

		await buildTransaction(async (t) => {
			followerStore.setStore({ path: ['lmao'], value: 'ayy' }, t)
			followerStore.setStore({ path: ['whew'], value: 'lad' }, t)
			followerStore.setStore({ path: ['ayy'], value: undefined }, t)
		})

		dispose()
	})

	test('can replicate local client state controlled updates', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		let dispose = () => {}
		let leaderStore = null as unknown as ReturnType<typeof initSharedStore>
		let followerStore = null as unknown as ReturnType<typeof initSharedStore>

		createRoot((d) => {
			dispose = () => {
				d()
			}
			leaderStore = initSharedStore(provider1)
			followerStore = initSharedStore(provider2)
		})

		await until(() => followerStore.initialized() && leaderStore.initialized())

		await leaderStore.setClientControlledState({ value: 'lmao' })

		await until(() => {
			return followerStore.clientControlledStates[provider1.clientId!]?.value
		})
		expect(followerStore.clientControlledStates[provider1.clientId!]!.value).toBe('lmao')

		dispose()
	})

	test('can retry transactions', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider3 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		let dispose = () => {}
		let leaderStore = null as unknown as ReturnType<typeof initSharedStore>
		let follower1Store = null as unknown as ReturnType<typeof initSharedStore>
		let follower2Store = null as unknown as ReturnType<typeof initSharedStore>

		createRoot((d) => {
			dispose = d
			leaderStore = initSharedStore(provider1)
			follower1Store = initSharedStore(provider2)
			follower2Store = initSharedStore(provider3)
		})
		await until(() => follower1Store.initialized() && leaderStore.initialized() && follower2Store.initialized())

		await follower2Store.setStore({ path: ['arr'], value: [] })
		const follower1MutDone = follower1Store.setStore({ path: ['arr', 0], value: 'ayy' })
		const follower2MutDone = follower2Store.setStoreWithRetries((s: any) => [
			{
				path: ['arr', s.arr.length],
				value: 'lmao',
			},
		])

		await Promise.all([follower1MutDone, follower2MutDone])
		expect(leaderStore.lockstepStore.arr[0]).toBe('ayy')
		expect(leaderStore.lockstepStore.arr[1]).toBe('lmao')
		dispose()
	})

	test('can push non-rollback mutations', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)

		let dispose = () => {}
		let leaderStore = null as unknown as ReturnType<typeof initSharedStore>
		let follower1Store = null as unknown as ReturnType<typeof initSharedStore>

		createRoot((d) => {
			dispose = d
			leaderStore = initSharedStore(provider1, {}, { arr: [] })
		})

		await until(leaderStore.initialized)

		createRoot(() => {
			follower1Store = initSharedStore(provider2)
		})

		await until(() => follower1Store.initialized() && leaderStore.initialized())

		leaderStore.setStore({ path: ['arr', '__push__'], value: 1 })
		const success = await follower1Store.setStore({ path: ['arr', '__push__'], value: 2 }, undefined, [], false)

		expect(success).toBe(true)
		expect(leaderStore.lockstepStore.arr).toEqual([1, 2])
		expect(follower1Store.lockstepStore.arr).toEqual([1, 2])
		dispose()
	})

	test('disconnected clients removes their client controlled state', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		let dispose = () => {}
		let leaderStore = null as unknown as ReturnType<typeof initSharedStore>
		let followerStore = null as unknown as ReturnType<typeof initSharedStore>

		createRoot((d) => {
			dispose = d
			leaderStore = initSharedStore(provider1, { a: 1 })
			followerStore = initSharedStore(provider2, { b: 2 })
			createEffect(() => {
				trackStore(leaderStore.clientControlledStates)
			})
		})

		await until(() => followerStore.initialized() && leaderStore.initialized())
		await until(() => leaderStore.clientControlledStates[provider2.clientId!])
		expect(leaderStore.clientControlledStates).toEqual({ [provider1.clientId!]: { a: 1 }, [provider2.clientId!]: { b: 2 } })

		provider2.ws.close()
		await until(() => !leaderStore.clientControlledStates[provider2.clientId!])
		//
		const states = unwrap(leaderStore.clientControlledStates)
		expect(states).toEqual({ [provider1.clientId!]: { a: 1 } })
		dispose()
	})

	test('actions', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId)
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId)

		let leaderStore = null as unknown as SharedStore<any>
		let followerStore = null as unknown as SharedStore<any>

		let dispose = () => {}
		createRoot((d) => {
			dispose = d
			leaderStore = initSharedStore(provider1)
			followerStore = initSharedStore(provider2)
		})

		await until(() => followerStore.initialized() && leaderStore.initialized())

		console.log({
			leaderStore: provider1.clientId,
			followerStore: provider2.clientId,
		})

		leaderStore.setStoreWithRetries(() => {
			return { mutations: [{ path: ['ayy'], value: 'lmao' }], actions: ['action1'] }
		})

		expect((await firstValueFrom(followerStore.action$)).type).toEqual('action1')

		followerStore.setStoreWithRetries(() => {
			return { mutations: [{ path: ['lmao'], value: 'ayy' }], actions: ['action2'] }
		})

		expect((await firstValueFrom(leaderStore.action$)).type).toEqual('action2')

		dispose()
	})
})
