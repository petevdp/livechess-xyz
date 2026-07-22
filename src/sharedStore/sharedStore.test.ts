import { trackStore } from '@solid-primitives/deep'
import { until } from '@solid-primitives/promise'
import deepEquals from 'fast-deep-equal'
import { Subject, firstValueFrom } from 'rxjs'
import { createEffect, createRoot } from 'solid-js'
import { unwrap } from 'solid-js/store'
import { describe, expect, it, test } from 'vitest'

import { initClockAuthority } from '~/systems/game/clockAuthority.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import * as GO from '~/systems/game/gameOps.ts'
import { log } from '~/systems/logger.browser.ts'
import * as P from '~/systems/player.ts'
import * as RO from '~/systems/roomOps.ts'

import * as Api from '../api.ts'
import { sleep } from '../utils/time.ts'
import { SharedStore, initFollowerStore } from './sharedStore.ts'
import { WsTransport } from './wsTransport.ts'

const storeCtx = { log }

type RoomStore = SharedStore<RO.RoomState, RO.RoomOp, RO.RoomEvent, RO.ClientOwnedState>

function player(id: string, name: string): P.Player {
	return { id, name }
}

function joinOp(p: P.Player, preferredColor: 'white' | 'black' = 'white') {
	return { code: 'join', player: p, isSpectating: false, preferredColor } as const
}

/**
 * All the tests below assume that the shared store server is running on localhost:8080. every
 * network runs the room reducer, so the tests speak the room domain.
 */
describe('network provider/shared store', () => {
	it('can create a network', async () => {
		const network = await Api.newNetwork()
		expect(network.networkId).toMatch(/[a-zA-Z0-9_-]{6}/)
	})

	it('can connect to a network', async () => {
		const network = await Api.newNetwork()
		const transport1 = new WsTransport(network.networkId)
		await transport1.waitForConnected()
		expect(transport1.ws.readyState).toBe(WebSocket.OPEN)
	})

	test('can dispatch ops and replicate them', async () => {
		const network = await Api.newNetwork()
		const trans1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const trans2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const toDispose: (() => void)[] = []

		let store1 = null as unknown as RoomStore
		let store2 = null as unknown as RoomStore
		createRoot((d) => {
			toDispose.push(d)
			store1 = initFollowerStore(trans1, RO.roomStoreDefinition, storeCtx, { playerId: 'p1' })
			store2 = initFollowerStore(trans2, RO.roomStoreDefinition, storeCtx)
		})
		await until(() => store1.initialized())
		await until(() => store2.initialized())

		const res = await store1.dispatch(joinOp(player('p1', 'alice')))
		expect(res.rejected).toBe(false)
		// applied optimistically
		expect(store1.state.members.map((m) => m.id)).toEqual(['p1'])
		// confirmed by the server
		expect(await (res as { confirmed: Promise<boolean> }).confirmed).toBe(true)

		await until(() => store2.state.members.length === 1)
		expect(store2.state.members[0].name).toBe('alice')
		expect(store2.snapshot().gameParticipants.white?.id).toBe('p1')

		toDispose.forEach((d) => d())
	})

	test('a batch the reducer rejects locally is dropped and not sent', async () => {
		const network = await Api.newNetwork()
		const trans1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		let dispose = () => {}
		let store1 = null as unknown as RoomStore
		createRoot((d) => {
			dispose = d
			store1 = initFollowerStore(trans1, RO.roomStoreDefinition, storeCtx)
		})
		await until(() => store1.initialized())

		// p1 is not a member, so readying them is a no-op
		const res = await store1.dispatch({ code: 'set-ready', playerId: 'p1', ready: true })
		expect(res.rejected).toBe(true)
		expect(store1.history().length).toBe(0)
		dispose()
	})

	test('conflicting dispatches converge on the server order', async () => {
		const network = await Api.newNetwork()
		const trans1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const trans2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		let dispose = () => {}
		let f1 = null as unknown as RoomStore
		let f2 = null as unknown as RoomStore

		createRoot((d) => {
			dispose = d
			f1 = initFollowerStore(trans1, RO.roomStoreDefinition, storeCtx, { playerId: 'p1' })
			f2 = initFollowerStore(trans2, RO.roomStoreDefinition, storeCtx, { playerId: 'p2' })
		})
		await until(() => f1.initialized() && f2.initialized())

		// both clients race to claim white for different players
		const [res1, res2] = await Promise.all([f1.dispatch(joinOp(player('p1', 'alice'))), f2.dispatch(joinOp(player('p2', 'bob'), 'white'))])
		expect(res1.rejected).toBe(false)
		expect(res2.rejected).toBe(false)

		await until(() => f1.state.members.length === 2 && f2.state.members.length === 2)
		await until(() => deepEquals(f1.snapshot(), f2.snapshot()))

		const participants = f1.snapshot().gameParticipants
		// exactly one of them got white, the other was bumped to black -- on every replica
		expect(participants.white).toBeDefined()
		expect(participants.black).toBeDefined()
		expect(participants.white.id).not.toEqual(participants.black.id)

		dispose()
	})

	test('clients can join late and be updated', async () => {
		const network = await Api.newNetwork()
		let store1 = null as unknown as RoomStore
		let lateStore = null as unknown as RoomStore
		const toDispose: Function[] = []

		createRoot((d) => {
			const trans1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
			toDispose.push(d)
			store1 = initFollowerStore(trans1, RO.roomStoreDefinition, storeCtx, { playerId: 'p1' })
		})

		await until(() => store1.initialized())
		await store1.dispatch(joinOp(player('p1', 'alice')))
		await sleep(100)

		createRoot((d) => {
			const trans2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
			toDispose.push(d)
			lateStore = initFollowerStore(trans2, RO.roomStoreDefinition, storeCtx)
		})

		await until(() => lateStore.initialized())
		expect(lateStore.snapshot().members.map((m) => m.name)).toEqual(['alice'])
		toDispose.forEach((d) => d())
	})

	test('a full game flow: ready, start, move; raw paths stay plain', async () => {
		const network = await Api.newNetwork()
		const trans1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const trans2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		let dispose = () => {}
		let f1 = null as unknown as RoomStore
		let f2 = null as unknown as RoomStore

		createRoot((d) => {
			dispose = d
			f1 = initFollowerStore(trans1, RO.roomStoreDefinition, storeCtx, { playerId: 'p1' })
			f2 = initFollowerStore(trans2, RO.roomStoreDefinition, storeCtx, { playerId: 'p2' })
		})
		await until(() => f1.initialized() && f2.initialized())

		await f1.dispatch(joinOp(player('p1', 'alice'), 'white'))
		await f2.dispatch(joinOp(player('p2', 'bob')))
		await until(() => f1.state.members.length === 2 && f2.state.members.length === 2)

		// p2 readies up, p1 starts the game
		await f2.dispatch({ code: 'set-ready', playerId: 'p2', ready: true })
		await until(() => f1.state.isReadyForGame['p2'])
		const startRes = await f1.dispatch({ code: 'start-game', playerId: 'p1', gameId: 'game01' })
		expect(startRes.rejected).toBe(false)
		await until(() => f2.state.activeGameId === 'game01')
		expect(f2.state.status).toBe('playing')

		// whoever holds white moves 1. e4
		const whiteStore = f1.snapshot().gameParticipants.white.id === 'p1' ? f1 : f2
		const whiteId = whiteStore.snapshot().gameParticipants.white.id
		const moveRes = await whiteStore.dispatch({
			code: 'make-move',
			playerId: whiteId,
			gameId: 'game01',
			expectedMoveIndex: 0,
			move: { from: 'e2', to: 'e4' },
			time: Date.now(),
		})
		expect(moveRes.rejected).toBe(false)

		await until(() => f1.raw.moves?.length === 1 && f2.raw.moves?.length === 1)
		// moves live at a raw path: plain arrays, absent from the proxied tree
		expect(Array.isArray(unwrap(f1.raw.moves))).toBe(true)
		expect(f1.raw.moves).toBe(unwrap(f1.raw.moves)) // not proxied
		expect((f1.state as Partial<RO.RoomState>).moves).toBeUndefined()
		expect(f1.raw.moves[0].algebraic).toBe('e4')
		expect(f2.raw.moves[0].algebraic).toBe('e4')

		// an illegal move is rejected locally and never leaves the client
		const badMove = await whiteStore.dispatch({
			code: 'make-move',
			playerId: whiteId,
			gameId: 'game01',
			expectedMoveIndex: 1,
			move: { from: 'e4', to: 'e6' },
			time: Date.now(),
		})
		expect(badMove.rejected).toBe(true)

		// duck placement is rejected outside the duck variant
		const blackStore = whiteStore === f1 ? f2 : f1
		const blackId = f1.snapshot().gameParticipants.black.id
		const duckInRegular = await blackStore.dispatch({
			code: 'make-move',
			playerId: blackId,
			gameId: 'game01',
			expectedMoveIndex: 1,
			move: { from: 'e7', to: 'e5', duck: 'd4' },
			time: Date.now(),
		})
		expect(duckInRegular.rejected).toBe(true)

		dispose()
	})

	test('duck variant: the reducer enforces duck placement', async () => {
		const network = await Api.newNetwork()
		const trans1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const trans2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		let dispose = () => {}
		let f1 = null as unknown as RoomStore
		let f2 = null as unknown as RoomStore

		createRoot((d) => {
			dispose = d
			f1 = initFollowerStore(trans1, RO.roomStoreDefinition, storeCtx, { playerId: 'p1' })
			f2 = initFollowerStore(trans2, RO.roomStoreDefinition, storeCtx, { playerId: 'p2' })
		})
		await until(() => f1.initialized() && f2.initialized())

		await f1.dispatch(joinOp(player('p1', 'alice'), 'white'))
		await f2.dispatch(joinOp(player('p2', 'bob')))
		await until(() => f1.state.members.length === 2 && f2.state.members.length === 2)
		await f1.dispatch({ code: 'set-game-config', config: { variant: 'duck' } })
		await f2.dispatch({ code: 'set-ready', playerId: 'p2', ready: true })
		await until(() => f1.state.isReadyForGame['p2'])
		await f1.dispatch({ code: 'start-game', playerId: 'p1', gameId: 'duck01' })
		await until(() => f2.state.activeGameId === 'duck01')

		const whiteStore = f1.snapshot().gameParticipants.white.id === 'p1' ? f1 : f2
		const whiteId = whiteStore.snapshot().gameParticipants.white.id
		const base = { code: 'make-move', playerId: whiteId, gameId: 'duck01', expectedMoveIndex: 0 } as const

		// missing duck -> rejected
		expect((await whiteStore.dispatch({ ...base, move: { from: 'e2', to: 'e4' }, time: Date.now() })).rejected).toBe(true)
		// duck on an occupied square -> rejected
		expect((await whiteStore.dispatch({ ...base, move: { from: 'e2', to: 'e4', duck: 'e1' }, time: Date.now() })).rejected).toBe(true)
		// duck on the square the pawn just left -> fine
		expect((await whiteStore.dispatch({ ...base, move: { from: 'e2', to: 'e4', duck: 'e2' }, time: Date.now() })).rejected).toBe(false)
		await until(() => f2.raw.moves?.length === 1)
		expect(f2.raw.moves[0].duck).toBe('e2')

		dispose()
	})

	test('events fire on the synced timeline for every client', async () => {
		const network = await Api.newNetwork()
		const t1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const t2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)

		let s1 = null as unknown as RoomStore
		let s2 = null as unknown as RoomStore

		let dispose = () => {}
		createRoot((d) => {
			dispose = d
			s1 = initFollowerStore(t1, RO.roomStoreDefinition, storeCtx, { playerId: 'p1' })
			s2 = initFollowerStore(t2, RO.roomStoreDefinition, storeCtx)
		})

		await until(() => s2.initialized() && s1.initialized())

		const s1Event = firstValueFrom(s1.event$)
		const s2Event = firstValueFrom(s2.event$)
		void s1.dispatch(joinOp(player('p1', 'alice')))

		expect(await s1Event).toEqual({ type: 'player-connected', playerId: 'p1' })
		expect(await s2Event).toEqual({ type: 'player-connected', playerId: 'p1' })

		dispose()
	})

	test('can replicate local client state controlled updates', async () => {
		const network = await Api.newNetwork()
		const t1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const t2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		let dispose = () => {}
		let store1 = null as unknown as RoomStore
		let store2 = null as unknown as RoomStore

		createRoot((d) => {
			dispose = () => {
				d()
			}
			store1 = initFollowerStore(t1, RO.roomStoreDefinition, storeCtx)
			store2 = initFollowerStore(t2, RO.roomStoreDefinition, storeCtx)
		})

		await until(() => store2.initialized() && store1.initialized())

		await store1.clientControlled.updateState({ playerId: 'lmao' })
		const store1config = await until(store1.config)

		await until(() => {
			return store2.clientControlled.states[store1config.clientId]?.playerId
		})
		expect(store2.clientControlled.states[store1config.clientId]!.playerId).toBe('lmao')

		dispose()
	})

	test('disconnected clients have their client controlled states removed', async () => {
		const network = await Api.newNetwork()
		const t1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const t2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		let dispose = () => {}
		let s1 = null as unknown as RoomStore
		let s2 = null as unknown as RoomStore

		createRoot((d) => {
			dispose = d
			s1 = initFollowerStore(t1, RO.roomStoreDefinition, storeCtx, { playerId: 'a' })
			s2 = initFollowerStore(t2, RO.roomStoreDefinition, storeCtx, { playerId: 'b' })
			createEffect(() => {
				trackStore(s1.clientControlled.states)
			})
		})

		const s1ClientId = await until(() => s1.config()?.clientId)
		const s2ClientId = await until(() => s2.config()?.clientId)
		await until(() => s2.initialized() && s1.initialized())
		await until(() => s1.clientControlled.states[s2ClientId])
		expect(s1.clientControlled.states).toEqual({
			[s1ClientId]: { playerId: 'a' },
			[s2ClientId]: { playerId: 'b' },
		})

		t2.dispose()
		await until(() => !s1.clientControlled.states[s2ClientId])
		//
		const states = unwrap(s1.clientControlled.states)
		expect(states).toEqual({ [s1ClientId]: { playerId: 'a' } })
		dispose()
	})

	test('client controlled states set before initialized is set', async () => {
		const network = await Api.newNetwork()
		const t1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const t2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)

		let s1!: RoomStore
		let s2!: RoomStore

		let dispose = () => {}
		createRoot((d) => {
			dispose = d
			s1 = initFollowerStore(t1, RO.roomStoreDefinition, storeCtx, { playerId: 'a' })
			s2 = initFollowerStore(t2, RO.roomStoreDefinition, storeCtx)
		})

		await until(() => s1.initialized() && s2.initialized())
		const s1ClientId = await until(() => s1.config()?.clientId)
		expect(s2.clientControlled.states[s1ClientId]).toEqual({ playerId: 'a' })
		dispose()
	})

	test('computeClocks derives clocks from move timestamps', () => {
		const gameConfig = { ...GL.getDefaultGameConfig(), timeControl: '1m' as const, increment: '0' as const }
		const t0 = 1_000_000
		const move = (ts: number) => ({ ts }) as GL.Move
		// white's first move is free; black spends 5s, white spends 10s, black has been thinking for 3s
		const state = { gameConfig, moves: [move(t0), move(t0 + 5000), move(t0 + 15000)] }
		expect(GO.computeClocks(state, t0 + 18000)).toEqual({ white: 50000, black: 52000 })
		// untimed games have no clocks
		expect(GO.computeClocks({ gameConfig: { ...gameConfig, timeControl: 'unlimited' }, moves: [] }, t0)).toBe(null)
		// increments are refunded
		const withIncrement = { gameConfig: { ...gameConfig, increment: '2' as const }, moves: [move(t0), move(t0 + 5000)] }
		expect(GO.computeClocks(withIncrement, t0 + 5000)).toEqual({ white: 60000, black: 57000 })
	})

	test('clock authority flags an exhausted clock', async () => {
		const gameConfig = { ...GL.getDefaultGameConfig(), timeControl: '1m' as const, increment: '0' as const }
		// white moved 70s ago on a 1m clock, so black's flag is already overdue
		const state = {
			gameConfig,
			moves: [{ ts: Date.now() - 70_000 } as GL.Move],
			activeGameId: 'g1',
			outcome: undefined,
		}
		const dispatched: unknown[] = []
		let dispose = () => {}
		createRoot((d) => {
			dispose = d
			initClockAuthority({
				snapshot: () => state,
				stateUpdate$: new Subject<typeof state>(),
				dispatch: async (op) => {
					dispatched.push(op)
				},
			})
		})
		await sleep(100)
		expect(dispatched).toEqual([{ code: 'flag-timeout', gameId: 'g1', winner: 'white' }])
		dispose()
	})

	test('unauthorized ops are dropped by the server', async () => {
		const network = await Api.newNetwork()
		const trans1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const trans2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		let dispose = () => {}
		let f1 = null as unknown as RoomStore
		let f2 = null as unknown as RoomStore

		createRoot((d) => {
			dispose = d
			f1 = initFollowerStore(trans1, RO.roomStoreDefinition, storeCtx, { playerId: 'p1' })
			f2 = initFollowerStore(trans2, RO.roomStoreDefinition, storeCtx, { playerId: 'p2' })
		})
		await until(() => f1.initialized() && f2.initialized())

		await f1.dispatch(joinOp(player('p1', 'alice'), 'white'))
		await f2.dispatch(joinOp(player('p2', 'bob')))
		await until(() => f1.state.members.length === 2 && f2.state.members.length === 2)
		await f2.dispatch({ code: 'set-ready', playerId: 'p2', ready: true })
		await until(() => f1.state.isReadyForGame['p2'])
		await f1.dispatch({ code: 'start-game', playerId: 'p1', gameId: 'game02' })
		await until(() => f2.state.activeGameId === 'game02')

		// flag-timeout is server-only: the local reducer accepts it optimistically, but the server
		// rejects the batch and the originator rolls its optimistic copy back
		const f2Rejection = firstValueFrom(f2.opsRejected$)
		const flag = await f2.dispatch({ code: 'flag-timeout', gameId: 'game02', winner: 'black' })
		expect(flag.rejected).toBe(false)
		expect(f2.snapshot().outcome).toBeDefined() // applied optimistically
		expect(await (flag as { confirmed: Promise<boolean> }).confirmed).toBe(false)
		expect((await f2Rejection).code).toBe('unauthorized')
		expect(f2.snapshot().outcome).toBeUndefined() // rolled back
		await sleep(200)
		expect(f1.snapshot().outcome).toBeUndefined()

		// impersonation: acting as a player the sender isn't registered as
		const f1Rejection = firstValueFrom(f1.opsRejected$)
		void f1.dispatch({ code: 'set-name', playerId: 'p2', name: 'evil' })
		expect((await f1Rejection).code).toBe('unauthorized')
		expect(f1.snapshot().members.find((m) => m.id === 'p2')!.name).toBe('bob')
		expect(f2.state.members.find((m) => m.id === 'p2')!.name).toBe('bob')

		dispose()
	})

	test('implausibly timestamped ops are rejected and rolled back', async () => {
		const network = await Api.newNetwork()
		const trans1 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		const trans2 = new WsTransport<import('~/systems/room.ts').RoomMessage>(network.networkId)
		let dispose = () => {}
		let f1 = null as unknown as RoomStore
		let f2 = null as unknown as RoomStore

		createRoot((d) => {
			dispose = d
			f1 = initFollowerStore(trans1, RO.roomStoreDefinition, storeCtx, { playerId: 'p1' })
			f2 = initFollowerStore(trans2, RO.roomStoreDefinition, storeCtx, { playerId: 'p2' })
		})
		await until(() => f1.initialized() && f2.initialized())

		await f1.dispatch(joinOp(player('p1', 'alice'), 'white'))
		await f2.dispatch(joinOp(player('p2', 'bob')))
		await until(() => f1.state.members.length === 2 && f2.state.members.length === 2)
		await f2.dispatch({ code: 'set-ready', playerId: 'p2', ready: true })
		await until(() => f1.state.isReadyForGame['p2'])
		await f1.dispatch({ code: 'start-game', playerId: 'p1', gameId: 'game03' })
		await until(() => f2.state.activeGameId === 'game03')

		const whiteStore = f1.snapshot().gameParticipants.white.id === 'p1' ? f1 : f2
		const whiteId = whiteStore.snapshot().gameParticipants.white.id
		const base = { code: 'make-move', playerId: whiteId, gameId: 'game03', expectedMoveIndex: 0, move: { from: 'e2', to: 'e4' } } as const

		// backdated a minute: unreasonable -- either extreme lag or an attempt to save clock time
		const rejection1 = firstValueFrom(whiteStore.opsRejected$)
		const backdated = await whiteStore.dispatch({ ...base, time: whiteStore.serverNow() - 60_000 })
		expect(backdated.rejected).toBe(false) // the local reducer can't know; applied optimistically
		expect((await rejection1).code).toBe('op-time-unreasonable')
		expect(whiteStore.snapshot().moves.length).toBe(0) // rolled back

		// future-dated a minute: impossible -- the client's clock must be out of sync
		const rejection2 = firstValueFrom(whiteStore.opsRejected$)
		void whiteStore.dispatch({ ...base, time: whiteStore.serverNow() + 60_000 })
		expect((await rejection2).code).toBe('clock-out-of-sync')
		expect(whiteStore.snapshot().moves.length).toBe(0)

		// a move stamped with estimated server time goes through
		const ok = await whiteStore.dispatch({ ...base, time: whiteStore.serverNow() })
		expect(ok.rejected).toBe(false)
		expect(await (ok as { confirmed: Promise<boolean> }).confirmed).toBe(true)
		const otherStore = whiteStore === f1 ? f2 : f1
		await until(() => otherStore.raw.moves?.length === 1)

		dispose()
	})
})
