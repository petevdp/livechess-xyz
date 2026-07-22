import { onCleanup } from 'solid-js'

import { PLAYER_TIMEOUT } from '~/config.ts'
import { SharedStore } from '~/sharedStore/sharedStore.ts'
import { initClockAuthority } from '~/systems/game/clockAuthority.ts'
import * as RO from '~/systems/roomOps.ts'

type RoomStore = SharedStore<RO.RoomState, RO.RoomOp, RO.RoomEvent, RO.ClientOwnedState>

export function initServerSideRoomLogic(store: RoomStore) {
	initConnectionTracking(store)
	initClockAuthority(store)
}

// mirrors socket-level presence into the shared room state via server-authored ops. all the actual
// state transitions live in the room reducer -- this system just decides when to dispatch. it is
// driven by the store's update streams (solid reactivity is inert in the server build) and uses
// precise one-shot timers for disconnect timeouts instead of polling.
function initConnectionTracking(store: RoomStore) {
	const previouslyConnected = new Set<string>()
	const timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>()
	// players we've already reported a timeout for during their current disconnect episode
	const timedOutEpisode = new Set<string>()

	function cancelTimeout(playerId: string) {
		const timer = timeoutTimers.get(playerId)
		if (timer !== undefined) {
			clearTimeout(timer)
			timeoutTimers.delete(playerId)
		}
	}

	function reconcile() {
		// players with at least one connected client that has identified itself
		const connected = new Set(
			Object.values(store.clientControlled.states)
				.map((s) => s.playerId)
				.filter((id) => !!id)
		)

		for (const member of store.snapshot().members) {
			const isConnected = connected.has(member.id)
			if (!previouslyConnected.has(member.id) && isConnected) {
				previouslyConnected.add(member.id)
				cancelTimeout(member.id)
				timedOutEpisode.delete(member.id)
				// the reducer no-ops this unless the player was actually marked disconnected
				void store.dispatch({ code: 'player-reconnected', playerId: member.id })
			} else if (previouslyConnected.has(member.id) && !isConnected) {
				previouslyConnected.delete(member.id)
				void store.dispatch({ code: 'player-disconnected', playerId: member.id, time: Date.now() })
			}

			// once the reducer has stamped disconnectedAt (the dispatch above triggers another
			// reconcile pass), arm a one-shot timer for the exact end of the timeout window
			if (member.disconnectedAt !== undefined && !isConnected && !timeoutTimers.has(member.id) && !timedOutEpisode.has(member.id)) {
				const remaining = Math.max(PLAYER_TIMEOUT - (Date.now() - member.disconnectedAt), 0)
				timeoutTimers.set(
					member.id,
					setTimeout(() => {
						timeoutTimers.delete(member.id)
						timedOutEpisode.add(member.id)
						const current = store.snapshot().members.find((m) => m.id === member.id)
						if (!current || current.disconnectedAt === undefined) return
						void store.dispatch({ code: 'player-timed-out', playerId: member.id })
					}, remaining)
				)
			}
		}
	}

	// dispatches inside reconcile fire stateUpdate$ synchronously -- coalesce to one pass per tick
	// instead of re-entering
	let queued = false
	function requestReconcile() {
		if (queued) return
		queued = true
		queueMicrotask(() => {
			queued = false
			reconcile()
		})
	}

	const stateSub = store.stateUpdate$.subscribe(requestReconcile)
	const ccsSub = store.clientControlled.update$.subscribe(requestReconcile)
	requestReconcile()

	onCleanup(() => {
		stateSub.unsubscribe()
		ccsSub.unsubscribe()
		for (const timer of timeoutTimers.values()) clearTimeout(timer)
		timeoutTimers.clear()
	})
}
