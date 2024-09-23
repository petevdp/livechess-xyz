import { trackDeep } from '@solid-primitives/deep'
import deepEquals from 'fast-deep-equal'
import { interval } from 'rxjs'
import { createEffect, createMemo, untrack } from 'solid-js'
import { unwrap } from 'solid-js/store'

import { PLAYER_TIMEOUT } from '~/config.ts'
import * as SS from '~/sharedStore/sharedStore.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import * as R from '~/systems/room.ts'

export function initServerSideRoomLogic(store: R.RoomStore, transport: SS.Transport<R.RoomMessage>) {
	const room = new R.RoomStoreHelpers(store, transport)

	//#region set initial state
	{
		const state: R.RoomState = {
			members: [],
			status: 'pregame',
			gameParticipants: {} as R.RoomState['gameParticipants'],
			agreePieceSwap: null,
			isReadyForGame: {},
			gameConfig: GL.getDefaultGameConfig(),
			drawOffers: {} as R.RoomState['drawOffers'],
			moves: [],
		}
		void store.setStore({ path: [], value: state })
	}
	//#endregion

	//#region player event tracking
	{
		const prevConnected: R.RoomMember[] = []
		const connectedPlayers = createMemo(() => {
			const states = trackDeep(store.clientControlled.states)
			const playerIds: string[] = Object.values(states).map((s) => s.playerId)
			const currConnected = room.members.filter((p) => playerIds.includes(p.id) && p.name)
			// return same object so equality check passes
			if (deepEquals(playerIds, prevConnected)) return prevConnected
			return currConnected
		})

		//#region track reconnects and disconnects
		const previouslyConnected = new Set<string>()
		createEffect(() => {
			const _connectedPlayers = unwrap(connectedPlayers())
			untrack(() => {
				for (const player of room.members) {
					const isConnected = _connectedPlayers.some((p) => p.id === player.id)
					if (!previouslyConnected.has(player.id) && isConnected) {
						previouslyConnected.add(player.id)
						void store.setStoreWithRetries((state) => {
							const playerIndex = state.members.findIndex((p) => p.id === player.id)
							if (playerIndex === -1 || !player.disconnectedAt) return []
							return {
								events: [{ type: 'player-reconnected', playerId: player.id }],
								mutations: [
									{
										path: ['members', playerIndex, 'disconnectedAt'],
										value: undefined,
									},
								],
							}
						})
					} else if (previouslyConnected.has(player.id) && !isConnected) {
						const disconnectedAt = Date.now()
						previouslyConnected.delete(player.id)

						void store.setStoreWithRetries((state) => {
							const playerIndex = state.members.findIndex((p) => p.id === player.id)
							if (playerIndex === -1) return []
							console.debug('player disconnected', player.id, 'at', disconnectedAt, 'state', state)
							return {
								events: [],
								mutations: [
									{
										path: ['members', playerIndex, 'disconnectedAt'],
										value: disconnectedAt,
									},
								],
							}
						})
					}
				}
			})
		})
		interval(PLAYER_TIMEOUT / 4).subscribe(() => {
			for (const id of previouslyConnected) {
				const member = store.rollbackState.members.find((p) => p.id === id)!
				if (member.disconnectedAt !== undefined && Date.now() - member.disconnectedAt) {
					void store.setStoreWithRetries(() => {
						const participant = room.participants.find((p) => p.id === id)!
						if (!participant) return
						if (room.state.status !== 'pregame') {
							return { events: [{ type: 'player-disconnected', playerId: id }], mutations: [] }
						}
						return {
							events: [{ type: 'player-disconnected', playerId: id }],
							mutations: [
								{
									path: ['gameParticipants', participant.color],
									value: SS.DELETE,
								},
							],
						}
					})
				}
			}
		})
		//#endregion
	}
	//#endregion
}
