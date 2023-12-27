import {describe, expect, expectTypeOf, it, test} from 'vitest'
import {createSharedStore, newNetwork, runOnTransaction, SharedStoreProvider} from './sharedStore.ts'
import {unwrap} from 'solid-js/store'
import {until} from '@solid-primitives/promise'
import {createRoot} from 'solid-js'
import {sleep} from './time.ts'
import {SERVER_HOST} from '../config.ts'

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
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'client1')
		await provider1.waitForConnected()
		//@ts-ignore
		expect(provider1.ws.readyState).toBe(WebSocket.OPEN)
	})

	test('can mutate', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'leader')
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'follower')
		let dispose = () => {}

		type T = { ayy: string; lmao?: string }
		let leaderStore = null as unknown as ReturnType<typeof createSharedStore>
		let followerStore = null as unknown as ReturnType<typeof createSharedStore>

		createRoot((d) => {
			dispose = () => {
				d()
			}
			leaderStore = createSharedStore(provider1, {
				networkId: network.networkId,
				leader: true,
				lastMutationIndex: 0,
				state: { ayy: 'lmao' },
			})
			followerStore = createSharedStore<T>(provider2)
		})

		// check if not empty object
		await until(() => followerStore.initialized() && leaderStore.initialized())
		expectTypeOf(unwrap(leaderStore.lockstepStore)).toEqualTypeOf({ ayy: 'lmao' })

		followerStore.setStore({ path: ['ayy'], value: 'ayy' })
		await until(() => {
			console.log({ ayyLockstep: leaderStore.lockstepStore.ayy, ayyRollback: leaderStore.rollbackStore.ayy })
			return (
				leaderStore.lockstepStore.ayy !== 'lmao' && leaderStore.rollbackStore.ayy !== 'lmao' && followerStore.lockstepStore.ayy !== 'lmao'
			)
		})
		console.log({
			ayyLockstep: JSON.stringify(leaderStore.lockstepStore),
			ayyRollback: JSON.stringify(leaderStore.rollbackStore),
		})
		expect(leaderStore.lockstepStore.ayy).toBe('ayy')
		expect(leaderStore.rollbackStore.ayy).toBe('ayy')
		expect(followerStore.lockstepStore.ayy).toBe('ayy')
		expect(followerStore.rollbackStore.ayy).toBe('ayy')

		dispose()
	})

	test('first mutation is always accepted', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'leader')

		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'follower1')

		const provider3 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'follower2')

		let leaderStore = null as unknown as ReturnType<typeof createSharedStore>
		let follower1Store = null as unknown as ReturnType<typeof createSharedStore>
		let follower2Store = null as unknown as ReturnType<typeof createSharedStore>
		let dispose = () => {}

		createRoot((d) => {
			dispose = () => {
				d()
			}

			leaderStore = createSharedStore(provider1, {
				networkId: network.networkId,
				leader: true,
				lastMutationIndex: 0,
				state: { ayy: 'lmao' },
			})
			follower1Store = createSharedStore(provider2)
			follower2Store = createSharedStore(provider3)
		})
		await until(() => leaderStore.initialized() && follower1Store.initialized() && follower2Store.initialized())

		follower1Store.setStore({ path: ['ayy'], value: 'follower1 was here' })
		follower2Store.setStore({ path: ['ayy'], value: 'follower2 was here' })
		await sleep(10)

		function isChanged(store: any) {
			return store.ayy !== 'lmao'
		}

		await until(
			() =>
				isChanged(leaderStore.lockstepStore) &&
				isChanged(leaderStore.rollbackStore) &&
				isChanged(follower1Store.lockstepStore) &&
				isChanged(follower1Store.rollbackStore) &&
				isChanged(follower2Store.lockstepStore)
		)
		expect(leaderStore.lockstepStore.ayy).toBe('follower1 was here')
		expect(leaderStore.rollbackStore.ayy).toBe('follower1 was here')
		expect(follower1Store.lockstepStore.ayy).toBe('follower1 was here')
		expect(follower1Store.rollbackStore.ayy).toBe('follower1 was here')
		expect(follower2Store.lockstepStore.ayy).toBe('follower1 was here')
		await until(() => isChanged(follower2Store.rollbackStore) && follower2Store.rollbackStore.ayy !== 'follower2 was here')
		expect(follower2Store.rollbackStore.ayy).toBe('follower1 was here')

		await until(() => follower1Store.lockstepStore.ayy !== 'lmao')
		dispose()
	})

	test('clients can join late and be updated', async () => {
		const network = await newNetwork(SERVER_HOST)
		let leaderStore = null as unknown as ReturnType<typeof createSharedStore>
		let followerStore = null as unknown as ReturnType<typeof createSharedStore>
		let toDispose: Function[] = []

		createRoot((d) => {
			const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'leader')
			toDispose.push(d)

			leaderStore = createSharedStore(provider1, {
				networkId: network.networkId,
				leader: true,
				lastMutationIndex: 0,
				state: { ayy: 'lmao' },
			})
		})

		sleep(200)

		createRoot(() => {
			const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'follower1')

			toDispose.push(() => {})
			followerStore = createSharedStore(provider2)
		})

		await until(() => leaderStore.initialized() && followerStore.initialized())
		expect(followerStore.lockstepStore.ayy).toBe('lmao')
	})

	test('can elect new leader', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'originalLeader')

		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'followerToPromote')
		const toDispose: Function[] = []
		let originalLeaderStore = null as unknown as ReturnType<typeof createSharedStore>
		let followerStore = null as unknown as ReturnType<typeof createSharedStore>

		createRoot((dispose) => {
			toDispose.push(dispose)
			originalLeaderStore = createSharedStore(provider1, {
				networkId: network.networkId,
				leader: true,
				lastMutationIndex: 0,
				state: { ayy: 'lmao' },
			})
			followerStore = createSharedStore(provider2)
		})

		await until(() => originalLeaderStore.initialized() && followerStore.initialized())

		provider1.ws.close()

		await until(() => followerStore.isLeader())
	})

	test('can handle transactions', async () => {
		const network = await newNetwork(SERVER_HOST)
		const provider1 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'leader')
		const provider2 = new SharedStoreProvider(SERVER_HOST, network.networkId, 'follower')
		let dispose = () => {}
		let leaderStore = null as unknown as ReturnType<typeof createSharedStore>
		let followerStore = null as unknown as ReturnType<typeof createSharedStore>

		createRoot((d) => {
			dispose = () => {
				d()
			}
			leaderStore = createSharedStore(provider1, {
				networkId: network.networkId,
				leader: true,
				lastMutationIndex: 0,
				state: { ayy: 'lmao' },
			})
			followerStore = createSharedStore(provider2)
		})

		await until(() => followerStore.initialized() && leaderStore.initialized())

		await runOnTransaction(async (t) => {
			followerStore.setStore({ path: ['lmao'], value: 'ayy' }, t)
			followerStore.setStore({ path: ['whew'], value: 'lad' }, t)
			followerStore.setStore({ path: ['ayy'], value: undefined }, t)
		})

		await until(
			() =>
				followerStore.lockstepStore.lmao === 'ayy' &&
				followerStore.lockstepStore.whew === 'lad' &&
				followerStore.lockstepStore.ayy === undefined
		)
		dispose()
	})
})
