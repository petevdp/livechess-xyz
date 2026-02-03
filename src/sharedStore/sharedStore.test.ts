import { trackStore } from '@solid-primitives/deep'
import { until } from '@solid-primitives/promise'
import { firstValueFrom } from 'rxjs'
import { createEffect, createRoot } from 'solid-js'
import { unwrap } from 'solid-js/store'
import { describe, expect, it, test } from 'vitest'

import { log } from '~/systems/logger.browser.ts'

import * as Api from '../api.ts'
import { sleep } from '../utils/time.ts'
import { DELETE, SharedStore, buildTransaction, initFollowerStore } from './sharedStore.ts'
import { WsTransport } from './wsTransport.ts'

const storeCtx = { log }

const transport = WsTransport

/**
 * All the tests below assume that the shareStore server  is running on localhost:8080
 */
describe('network provider/shared store', () => {
	it('can create a network', async () => {
		const network = await Api.newNetwork()
		expect(network.networkId).toMatch(/[a-zA-Z0-9_-]{6}/)
	})

	it('can connect to a network', async () => {
		const network = await Api.newNetwork()
		const transport1 = new transport(network.networkId)
		await transport1.waitForConnected()
		expect(transport1.ws.readyState).toBe(WebSocket.OPEN)
	})

	test('can mutate', async () => {
		const network = await Api.newNetwork()
		const trans1 = new transport(network.networkId)
		const trans2 = new transport(network.networkId)
		const toDispose: (() => void)[] = []

		type T = { ayy: string }
		let store1 = null as unknown as SharedStore<T>
		let store2 = null as unknown as SharedStore<T>
		createRoot((d) => {
			toDispose.push(d)
			store1 = initFollowerStore(trans1, storeCtx)
			store2 = initFollowerStore(trans2, storeCtx)
		})
		await until(() => store1.initialized())
		await until(() => store2.initialized())
		await store1.setStore({ path: ['ayy'], value: 'ayy' })
		expect(store1.lockstepState.ayy).toBe('ayy')
		expect(store1.rollbackState.ayy).toBe('ayy')

		await until(() => store2.lockstepState.ayy === 'ayy')
		expect(store2.lockstepState.ayy).toBe('ayy')
		expect(store2.rollbackState.ayy).toBe('ayy')

		toDispose.forEach((d) => d())
	})
	//
	test('first mutation is always accepted', async () => {
		const network = await Api.newNetwork()
		const trans1 = new transport(network.networkId)
		const trans2 = new transport(network.networkId)
		type T = { ayy: string }

		let follower1 = null as unknown as SharedStore<T>
		let follower2 = null as unknown as SharedStore<T>
		let dispose = () => {}
		createRoot((d) => {
			dispose = d
			follower1 = initFollowerStore(trans1, storeCtx)
			follower2 = initFollowerStore(trans2, storeCtx)
		})

		await until(() => follower1.initialized() && follower2.initialized())

		// test will fail if one of these requests is fully processed before the other hits the server
		const follower1SetPromise = follower1.setStore({
			path: ['ayy'],
			value: 'follower1 was here',
		})
		const follower2SetPromise = follower2.setStore({
			path: ['ayy'],
			value: 'follower2 was here',
		})
		const [f1set, f2set] = await Promise.all([follower1SetPromise, follower2SetPromise])
		// whether follower1 or follower2 wins is nondeterministic
		if (f1set) {
			expect(follower2.lockstepState.ayy).toEqual('follower1 was here')
			expect(follower1.lockstepState.ayy).toEqual('follower1 was here')
		} else if (f2set) {
			expect(follower2.lockstepState.ayy).toEqual('follower2 was here')
			expect(follower1.lockstepState.ayy).toEqual('follower2 was here')
		} else {
			throw new Error('neither transaction succeeded')
		}
		dispose()
	})

	test('clients can join late and be updated', async () => {
		const network = await Api.newNetwork()
		let store1 = null as unknown as SharedStore<{ ayy: string }>
		let lateStore = null as unknown as SharedStore<{ ayy: string }>
		const toDispose: Function[] = []

		createRoot((d) => {
			const trans1 = new transport(network.networkId)
			toDispose.push(d)
			store1 = initFollowerStore(trans1, storeCtx)
		})

		await until(() => store1.initialized())
		await store1.setStore({ path: ['ayy'], value: 'lmao' })
		await sleep(100)

		createRoot(() => {
			const trans2 = new transport(network.networkId)
			toDispose.push(() => {})
			lateStore = initFollowerStore(trans2, storeCtx)
		})

		await until(() => lateStore.initialized())
		expect(lateStore.lockstepState.ayy).toBe('lmao')
		toDispose.forEach((d) => d())
	})
	//
	test('can handle dynamic transactions', async () => {
		const network = await Api.newNetwork()
		const trans1 = new transport(network.networkId)
		const trans2 = new transport(network.networkId)
		let dispose = () => {}
		type T = { ayy: string; whew: string; lmao: string }
		let store1 = null as unknown as SharedStore<T>
		let store2 = null as unknown as SharedStore<T>

		createRoot((d) => {
			dispose = d
			store1 = initFollowerStore(trans1, storeCtx)
			store2 = initFollowerStore(trans2, storeCtx)
		})
		await until(() => store2.initialized() && store1.initialized())

		await buildTransaction(async (t) => {
			void store2.setStore({ path: ['lmao'], value: 'ayy' }, t)
			void store2.setStore({ path: ['whew'], value: 'lad' }, t)
			void store2.setStore({ path: ['ayy'], value: 'dawg' }, t)
		})

		await until(() => store1.lockstepState.lmao === 'ayy')

		expect(store1.lockstepState.lmao).toBe('ayy')
		expect(store1.lockstepState.whew).toBe('lad')
		expect(store1.lockstepState.ayy).toBe('dawg')

		dispose()
	})

	test('can replicate local client state controlled updates', async () => {
		const network = await Api.newNetwork()
		const t1 = new transport(network.networkId)
		const t2 = new transport(network.networkId)
		let dispose = () => {}
		let store1 = null as unknown as SharedStore<object>
		let store2 = null as unknown as SharedStore<object>

		createRoot((d) => {
			dispose = () => {
				d()
			}
			store1 = initFollowerStore(t1, storeCtx)
			store2 = initFollowerStore(t2, storeCtx)
		})

		await until(() => store2.initialized() && store1.initialized())

		await store1.clientControlled.updateState({ value: 'lmao' })
		const store1config = await until(store1.config)

		await until(() => {
			return store2.clientControlled.states[store1config.clientId!]?.value
		})
		expect(store2.clientControlled.states[store1config.clientId]!.value).toBe('lmao')

		dispose()
	})
	//
	test('can retry transactions', async () => {
		const network = await Api.newNetwork()
		const t2 = new transport(network.networkId)
		const t3 = new transport(network.networkId)

		let dispose = () => {}
		let f1 = null as unknown as SharedStore<any>
		let f2 = null as unknown as SharedStore<any>

		createRoot((d) => {
			dispose = d
			f1 = initFollowerStore(t2, storeCtx)
			f2 = initFollowerStore(t3, storeCtx)
		})
		await until(() => f1.initialized() && f2.initialized())
		await f2.setStore({ path: ['arr'], value: [] })
		await until(() => f1.lockstepState.arr?.length === 0 && f2.lockstepState.arr?.length === 0)
		let tryCount = 0
		let lastRetry = null as string | null
		const f1Res = f1.setStoreWithRetries((s) => {
			tryCount++
			lastRetry = 'f1'
			return [
				{
					path: ['arr', s.arr.length],
					value: 'ayy',
				},
			]
		})
		const f2Res = f2.setStoreWithRetries((s: any) => {
			tryCount++
			lastRetry = 'f2'
			return [
				{
					path: ['arr', s.arr.length],
					value: 'lmao',
				},
			]
		})
		await Promise.all([f1Res, f2Res])
		expect(tryCount).toBe(3)
		expect(f1.lockstepState.arr).toEqual(lastRetry === 'f1' ? ['lmao', 'ayy'] : ['ayy', 'lmao'])
		dispose()
	})
	//
	//
	test('disconnected clients have their client controlled states removed', async () => {
		const network = await Api.newNetwork()
		const t1 = new transport(network.networkId)
		const t2 = new transport(network.networkId)
		let dispose = () => {}
		let s1 = null as unknown as SharedStore<object>
		let s2 = null as unknown as SharedStore<object>

		createRoot((d) => {
			dispose = d
			s1 = initFollowerStore(t1, storeCtx, { a: 1 })
			s2 = initFollowerStore(t2, storeCtx, { b: 2 })
			createEffect(() => {
				trackStore(s1.clientControlled.states)
			})
		})

		const s1ClientId = await until(() => s1.config()?.clientId)
		const s2ClientId = await until(() => s2.config()?.clientId)
		await until(() => s2.initialized() && s1.initialized())
		await until(() => s1.clientControlled.states[s2ClientId])
		expect(s1.clientControlled.states).toEqual({
			[s1ClientId]: { a: 1 },
			[s2ClientId]: { b: 2 },
		})

		t2.dispose()
		await until(() => !s1.clientControlled.states[s2ClientId])
		//
		const states = unwrap(s1.clientControlled.states)
		expect(states).toEqual({ [s1ClientId]: { a: 1 } })
		dispose()
	})
	//
	test('events', async () => {
		const network = await Api.newNetwork()
		const t1 = new transport(network.networkId)
		const t2 = new transport(network.networkId)

		let s1 = null as unknown as SharedStore<any>
		let s2 = null as unknown as SharedStore<any>

		let dispose = () => {}
		createRoot((d) => {
			dispose = d
			s1 = initFollowerStore(t1, storeCtx)
			s2 = initFollowerStore(t2, storeCtx)
		})

		await until(() => s2.initialized() && s1.initialized())

		void s1.setStoreWithRetries(() => {
			return {
				mutations: [{ path: ['ayy'], value: 'lmao' }],
				events: [{ type: 'action1' }],
			}
		})

		expect(await firstValueFrom(s2.event$)).toEqual('action1')

		void s2.setStoreWithRetries(() => {
			return {
				mutations: [{ path: ['lmao'], value: 'ayy' }],
				events: [{ type: 'action2' }],
			}
		})
		expect(await firstValueFrom(s1.event$)).toEqual('action2')

		dispose()
	})
	//
	test('can delete entries', async () => {
		const network = await Api.newNetwork()
		const t1 = new transport(network.networkId)
		const t2 = new transport(network.networkId)
		let s1 = null as unknown as SharedStore<any>
		let s2 = null as unknown as SharedStore<any>

		let dispose = () => {}
		createRoot((d) => {
			dispose = d
			s1 = initFollowerStore(t1, storeCtx)
			s2 = initFollowerStore(t2, storeCtx)
		})

		await until(() => s2.initialized() && s1.initialized())

		await s1.setStore({ path: ['a'], value: [1, 2, 3] })
		await until(() => s2.lockstepState.a?.length === 3)

		void s2.setStoreWithRetries(() => {
			return [{ path: ['a', 1], value: DELETE }]
		})

		await until(() => s2.lockstepState.a.length === 2)
		expect(s2.lockstepState.a).toEqual([1, 3])
		expect(s1.lockstepState.a).toEqual([1, 3])
		dispose()
	})
	//
	test('client controlled states set before initialized is set', async () => {
		const network = await Api.newNetwork()
		const t1 = new transport(network.networkId)
		const t2 = new transport(network.networkId)

		let s1!: SharedStore<any>
		let s2!: SharedStore<any>

		let dispose = () => {}
		createRoot((d) => {
			dispose = d
			s1 = initFollowerStore(t1, storeCtx, { a: 1 })
			s2 = initFollowerStore(t2, storeCtx)
		})

		await until(() => s1.initialized() && s2.initialized())
		const s1ClientId = await until(() => s1.config()?.clientId)
		expect(s2.clientControlled.states[s1ClientId]).toEqual({ a: 1 })
		dispose()
	})
})
