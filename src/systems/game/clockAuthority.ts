import { Observable } from 'rxjs'
import { onCleanup } from 'solid-js'

import * as GL from './gameLogic.ts'
import * as GO from './gameOps.ts'

// the subset of a leader SharedStore the clock authority needs; kept structural so it works for
// both the server's room store and the local vs-bot store
type ClockAuthorityStore<S extends Pick<GO.RootGameState, 'gameConfig' | 'moves' | 'activeGameId' | 'outcome'>> = {
	snapshot(): S
	stateUpdate$: Observable<S>
	dispatch(op: { code: 'flag-timeout'; gameId: string; winner: GL.Color }): Promise<unknown>
}

/**
 * makes a leader store the clock authority for its games: whenever committed state changes, one
 * precise timer is (re)scheduled for the running clock's expiry, and firing dispatches
 * flag-timeout. followers never flag -- they render their local clock derivation and wait for the
 * outcome op. must be called within a reactive root; cleans up with it.
 */
export function initClockAuthority<S extends Pick<GO.RootGameState, 'gameConfig' | 'moves' | 'activeGameId' | 'outcome'>>(
	store: ClockAuthorityStore<S>
) {
	let timer: ReturnType<typeof setTimeout> | null = null

	function clear() {
		if (timer !== null) {
			clearTimeout(timer)
			timer = null
		}
	}

	function schedule() {
		clear()
		const state = store.snapshot()
		if (!state.activeGameId || state.outcome) return
		// the clock only starts running once the first move is made
		if (state.moves.length === 0) return
		const clocks = GO.computeClocks(state, Date.now())
		if (!clocks) return
		const gameId = state.activeGameId
		// only the to-move player's clock is ticking, so the earliest possible expiry is the smaller
		// of the two. the small epsilon guarantees the recomputation at fire time sees <= 0.
		const expiresIn = Math.max(Math.min(clocks.white, clocks.black), 0) + 5
		timer = setTimeout(() => {
			timer = null
			const current = store.snapshot()
			if (current.activeGameId !== gameId || current.outcome) return
			const currentClocks = GO.computeClocks(current, Date.now())
			if (!currentClocks) return
			const flagged = currentClocks.white <= 0 ? 'white' : currentClocks.black <= 0 ? 'black' : null
			if (!flagged) {
				// timing jitter left the clock a hair above zero -- reschedule rather than give up
				schedule()
				return
			}
			void store.dispatch({ code: 'flag-timeout', gameId, winner: GL.oppositeColor(flagged) })
		}, expiresIn)
	}

	const sub = store.stateUpdate$.subscribe(schedule)
	schedule()

	onCleanup(() => {
		sub.unsubscribe()
		clear()
	})
}
