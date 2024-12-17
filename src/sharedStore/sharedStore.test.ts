import { trackStore } from '@solid-primitives/deep'
import { until } from '@solid-primitives/promise'
import import2 from 'import2'
import { filter, firstValueFrom } from 'rxjs'
import { createEffect, createRoot } from 'solid-js'
import { unwrap } from 'solid-js/store'
import { beforeAll, describe, expect, it, test } from 'vitest'

import { log } from '~/systems/logger.browser.ts'

import * as Api from '../api.ts'
import { sleep } from '../utils/time.ts'
import { DELETE, SharedStore, buildTransaction, initFollowerStore } from './sharedStore.ts'
import { WsTransport } from './wsTransport.ts'

// JUST TO AVOID TRANSPILING

const storeCtx = { log }

const transport = WsTransport

/**
 * All the tests below assume that the shareStore server  is running on localhost:8080
 */
describe('network provider/shared store', () => {
	it.each(times(10))('can create a network', async () => {
		const network = await Api.newNetwork()
		expect(network.networkId).toMatch(/[a-zA-Z0-9_-]{6}/)
	})

	it.each(times(10))('can connect to a network', async () => {
		const network = await Api.newNetwork()
		const transport1 = new transport(network.networkId)
		await transport1.waitForConnected()
		expect(transport1.ws.readyState).toBe(WebSocket.OPEN)
	})

	test.each(times(10))('can mutate', async () => {
		type T = { ayy: string }
		const [store1, store2, dispose] = await getFollowerPair<T>()

		await store1.setStore({ path: ['ayy'], value: 'ayy' })
		expect(store1.lockstepState.ayy).toBe('ayy')
		expect(store1.rollbackState.ayy).toBe('ayy')

		await until(() => store2.lockstepState.ayy === 'ayy')
		expect(store2.lockstepState.ayy).toBe('ayy')
		expect(store2.rollbackState.ayy).toBe('ayy')

		dispose()
	})

	test.each(times(10))('first mutation is always accepted', async () => {
		type T = { ayy: string }
		const [follower1, follower2, dispose] = await getFollowerPair<T>()

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

	test.each(times(10))('clients can join late and be updated', async () => {
		const [store1, lateStore, dispose] = await getFollowerPair<{ ayy: string }>()

		await store1.setStore({ path: ['ayy'], value: 'lmao' })
		await sleep(100)

		await until(() => lateStore.initialized())
		expect(lateStore.lockstepState.ayy).toBe('lmao')
		dispose()
	})

	test.each(times(10))('can handle dynamic transactions', async () => {
		type T = { ayy: string; whew: string; lmao: string }
		const [store1, store2, dispose] = await getFollowerPair<T>()

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

	test.each(times(10))('can replicate local client state controlled updates', async () => {
		const [store1, store2, dispose] = await getFollowerPair()

		await store1.clientControlled.updateState({ value: 'lmao' })
		const store1config = await until(store1.config)

		await until(() => {
			return store2.clientControlled.states[store1config.clientId!]?.value
		})
		expect(store2.clientControlled.states[store1config.clientId]!.value).toBe('lmao')

		dispose()
	})

	test.each(times(10))('can retry transactions', async () => {
		const [f1, f2, dispose] = await getFollowerPair<{ arr: number[] }>()

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

	test.each(times(10))('disconnected clients have their client controlled states removed', async () => {
		const [s1, s2, dispose, t1, t2] = await getFollowerPair<object>([{ a: 1 }, { b: 2 }])

		const s1ClientId = await until(() => s1.config()?.clientId)
		const s2ClientId = await until(() => s2.config()?.clientId)
		await until(() => s1.clientControlled.states[s2ClientId])
		expect(s1.clientControlled.states).toEqual({
			[s1ClientId]: { a: 1 },
			[s2ClientId]: { b: 2 },
		})

		t2.dispose()
		await until(() => !s1.clientControlled.states[s2ClientId])

		const states = unwrap(s1.clientControlled.states)
		expect(states).toEqual({ [s1ClientId]: { a: 1 } })
		dispose()
	})

	test.each(times(10))('events', async () => {
		const [s1, s2, dispose] = await getFollowerPair()
		void s1.setStoreWithRetries(() => {
			return {
				mutations: [{ path: ['ayy'], value: 'lmao' }],
				events: [{ type: 'action1' }],
			}
		})

		const event = await firstValueFrom(s2.event$)
		expect(event.type).toEqual('action1')

		void s2.setStoreWithRetries(() => {
			return {
				mutations: [{ path: ['lmao'], value: 'ayy' }],
				events: [{ type: 'action2' }],
			}
		})
		const action2$ = s1.event$.pipe(filter((e) => e.type === 'action2'))
		expect((await firstValueFrom(action2$)).type).toEqual('action2')
		dispose()
	})

	test.each(times(10))('can delete entries', async () => {
		const [s1, s2, dispose] = await getFollowerPair<{ a: number[] }>()

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

	test.each(times(10))('client controlled states set before initialized is set', async () => {
		const [s1, s2, dispose] = await getFollowerPair([{ a: 1 }, undefined])

		const s1ClientId = await until(() => s1.config()?.clientId)
		expect(s2.clientControlled.states[s1ClientId]).toEqual({ a: 1 })
		dispose()
	})

	test.each(times(10))('events always have clientId included', async () => {
		const [s1, s2, dispose] = await getFollowerPair()

		const evtPromise = firstValueFrom(s2.event$)
		s1.setStoreWithRetries(() => {
			return {
				events: [{ type: 'test-event' }],
				mutations: [{ path: ['a'], value: 1 }],
			}
		})
		const evt = await evtPromise
		expect(evt.clientId).toBeDefined()
		dispose()
	})
})

async function getFollowerPair<T extends object = object>(clientState?: [object | undefined, object | undefined]) {
	const network = await Api.newNetwork()
	const t1 = new transport(network.networkId)
	const t2 = new transport(network.networkId)

	let dispose = () => {}
	let f1 = null as unknown as SharedStore<T>
	let f2 = null as unknown as SharedStore<T>

	createRoot((d) => {
		dispose = d
		f1 = initFollowerStore(t1, storeCtx, clientState?.[0])
		f2 = initFollowerStore(t2, storeCtx, clientState?.[1])
	})
	await until(() => f1.initialized() && f2.initialized())
	return [f1, f2, dispose, t1, t2] as const
}
function times(n: number) {
	const arr = Array(n)
	for (let i = 0; i < n; i++) {
		arr[i] = [i]
	}
	return arr
}
