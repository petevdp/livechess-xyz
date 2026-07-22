import { until } from '@solid-primitives/promise'
import { Observable, concatMap, mergeAll, race, from as rxFrom, startWith } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import { Owner, createEffect, createSignal, on, onCleanup, runWithOwner } from 'solid-js'
import { unwrap } from 'solid-js/store'

import * as Api from '~/api.ts'
import { PLAYER_TIMEOUT } from '~/config.ts'
import * as SS from '~/sharedStore/sharedStore.ts'
import { WsTransport } from '~/sharedStore/wsTransport.ts'
import { makePersistedSignal } from '~/utils/makePersisted.ts'
import { createSignalProperty } from '~/utils/solid.ts'

import * as G from './game/game.ts'
import * as GL from './game/gameLogic.ts'
import { log } from './logger.browser.ts'
import * as P from './player.ts'
import * as RO from './roomOps.ts'

//#region types
export type { RoomMember, RoomState, ClientOwnedState, RoomEvent } from './roomOps.ts'
export { ROOM_ONLY_EVENTS } from './roomOps.ts'

export type RoomGameParticipant = RO.RoomMember & G.GameParticipant & { agreePieceSwap: boolean; isReadyForGame: boolean }
export type RoomDetails = { roomId: string; memberNames: string[] }
//#endregion

export async function createRoom() {
	return await Api.newNetwork()
}

export type ConnectionState =
	| {
			status: 'connecting'
	  }
	| {
			status: 'connected'
	  }
	| {
			status: 'timeout'
			idleTime: number
	  }
	| {
			status: 'lost'
	  }

export type RoomMessage = SS.SharedStoreMessage<RO.RoomOp, RO.RoomState, RO.ClientOwnedState>

export type RoomStore = SS.SharedStore<RO.RoomState, RO.RoomOp, RO.RoomEvent, RO.ClientOwnedState>

export function connectToRoom(
	roomId: string,
	playerId: string,
	initPlayer: (numPlayers: number) => Promise<{ player: P.Player; isSpectating: boolean }>,
	parentOwner: Owner
): Observable<ConnectionState> {
	const transport = new WsTransport<RoomMessage>(roomId)

	const disconnected$: Observable<ConnectionState> = race(
		transport.disposed$.then(() => ({ status: 'lost' }) satisfies ConnectionState),
		SS.observeTimedOut(transport).pipe(map((idleTime) => ({ status: 'timeout', idleTime }) satisfies ConnectionState))
	)

	let store = null as unknown as RoomStore
	runWithOwner(parentOwner, () => {
		store = SS.initFollowerStore<RO.RoomState, RO.RoomOp, RO.RoomEvent, RO.ClientOwnedState>(
			transport,
			RO.roomStoreDefinition,
			{ log },
			{ playerId }
		)
		onCleanup(() => {
			console.warn('-----cleaning up store----')
			setRoom(null)
		})
		if (import.meta.env.PROD) Api.keepServerAlive()
	})

	const connected$ = until(() => store.initialized()).then(async () => {
		const preferredColor = Math.random() < 0.5 ? 'white' : ('black' as const)
		const existing = store.snapshot().members.find((p) => p.id === playerId)
		if (!existing) {
			const { player, isSpectating } = await initPlayer(Object.values(store.snapshot().gameParticipants).length)
			// the reducer no-ops this if the player is already a member (e.g. we lost a race with
			// another client for the same player)
			await store.dispatch({ code: 'join', player, isSpectating, preferredColor })
		} else if (!existing.isSpectator && !Object.values(store.snapshot().gameParticipants).some((p) => p && p.id === playerId)) {
			// reclaim a seat lost to a pregame disconnect timeout; no-ops if the room filled up
			await store.dispatch({ code: 'join', player: existing, isSpectating: false, preferredColor })
		}

		const room = new Room(store, transport, store.snapshot().members.find((p) => playerId === p.id)!, parentOwner)
		setRoom(room)
		addRecentRoom(roomId)
	})

	return mergeAll()(rxFrom([rxFrom(connected$).pipe(map(() => ({ status: 'connected' }))), disconnected$])).pipe(
		startWith({ status: 'connecting' } satisfies ConnectionState)
	)
}

export class RoomStoreHelpers {
	constructor(
		public sharedStore: RoomStore,
		private transport: SS.Transport<RoomMessage>
	) {}

	get roomId() {
		return this.transport.networkId
	}

	get state() {
		return this.sharedStore.state
	}

	playerColor(playerId: string) {
		if (!playerId) throw new Error('playerId is missing')
		if (this.state.gameParticipants.white?.id === playerId) return 'white'
		if (this.state.gameParticipants.black?.id === playerId) return 'black'
		return null
	}

	get members() {
		return this.state.members
	}

	// players that are connected, or have been disconnected for less than the timeout window
	get activePlayers() {
		return this.members.filter((p) => !p.disconnectedAt || Date.now() - p.disconnectedAt < PLAYER_TIMEOUT)
	}

	get participants(): RoomGameParticipant[] {
		return this.members
			.map((player): RoomGameParticipant[] => {
				const gameParticipant = Object.values(this.state.gameParticipants).find((gp) => gp.id === player.id)
				if (!gameParticipant) return []
				return [
					{
						...player,
						...gameParticipant,
						color: this.playerColor(gameParticipant.id)!,
						isReadyForGame: this.state.isReadyForGame[gameParticipant.id],
						agreePieceSwap: this.state.agreePieceSwap === gameParticipant.id,
					} satisfies RoomGameParticipant,
				]
			})
			.flat()
	}

	get event$() {
		return this.sharedStore.event$.pipe(
			concatMap((event) => {
				let player: RO.RoomMember | undefined = undefined
				if (event.type !== 'game-over') {
					player = this.members.find((p) => {
						return p.id === event.playerId
					})!
				}
				return [
					{
						...event,
						player: unwrap(player),
					},
				]
			})
		)
	}
}

export class Room extends RoomStoreHelpers {
	get canStartGame() {
		return this.state.status === 'pregame' && this.leftPlayer?.id === this.player.id && !!this.rightPlayer?.isReadyForGame
	}

	gameConfigContext: G.GameConfigContext
	gameContext: G.RootGameContext

	constructor(
		public sharedStore: RoomStore,
		transport: SS.Transport<RoomMessage>,
		public player: RO.RoomMember,
		owner: Owner
	) {
		super(sharedStore, transport)
		this.gameConfigContext = {
			gameConfig: this.state.gameConfig,
			vsBot: false,
			editingConfigDisabled: () => {
				return !this.isPlayerParticipating || !!this.leftPlayer?.isReadyForGame
			},
			setGameConfig: (config: Partial<GL.GameConfig>) => {
				void this.sharedStore.dispatch({ code: 'set-game-config', config })
			},
			reseedFischerRandom: () => {
				void this.sharedStore.dispatch({ code: 'reseed-fischer-random', seed: GL.getFischerRandomSeed() })
			},
		}

		// boilerplate mostly to make typescript happy
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const room = this
		this.gameContext = {
			backToPregame: room.backToPregame,
			event$: room.event$.pipe(
				filter((event) => !RO.ROOM_ONLY_EVENTS.includes(event.type as (typeof RO.ROOM_ONLY_EVENTS)[number]))
			) as Observable<G.GameEvent>,
			get members() {
				return room.members
			},
			get player() {
				return room.player
			},
			get state() {
				return room.state
			},
			get sharedStore() {
				return room.sharedStore as unknown as G.GameStore
			},
		}

		runWithOwner(owner, () => {
			onCleanup(() => {
				this.setGame(null)
			})

			createEffect(
				on(
					() => this.state.activeGameId,
					() => {
						if (this.state.activeGameId) {
							this.setGame(new G.Game(this.state.activeGameId, this.gameContext, this.gameConfigContext.gameConfig))
						} else {
							this.setGame(null)
						}
					}
				)
			)
		})
	}

	private _game = createSignalProperty<G.Game | null>(null)
	get game() {
		return this._game.get()
	}
	setGame(game: G.Game | null) {
		this.game?.dispose()
		this._game.set(game)
	}

	get isPlayerParticipating() {
		return this.player.id === this.leftPlayer?.id
	}

	get spectators() {
		return this.members.filter((p) => Object.values(this.state.gameParticipants).some((gp) => gp.id === p.id))
	}

	get rightPlayer(): RoomGameParticipant | null {
		return this.participants.find((p) => p.id !== this.player.id) || null
	}

	get leftPlayer(): RoomGameParticipant | null {
		const participant = this.participants.find((p) => p.id === this.player.id)
		if (participant) return participant
		return this.participants.find((p) => p.id !== this.player.id && p.id !== this.rightPlayer?.id) || null
	}

	async setCurrentPlayerName(name: string) {
		// the reducer dedupes names and no-ops if the name is unchanged
		void this.sharedStore.dispatch({ code: 'set-name', playerId: this.player.id, name })
	}

	get playerHasMultipleClients() {
		return Object.values(this.sharedStore.clientControlled.states).filter((v) => v.playerId === this.player.id).length > 1
	}

	//#region piece swapping
	initiateOrAgreePieceSwap() {
		void this.sharedStore.dispatch({ code: 'initiate-or-agree-piece-swap', playerId: this.player.id })
	}

	declineOrCancelPieceSwap() {
		void this.sharedStore.dispatch({ code: 'decline-or-cancel-piece-swap', playerId: this.player.id })
	}

	//#endregion

	async toggleReadyOrStartGame() {
		if (!this.isPlayerParticipating) return
		if (!this.leftPlayer!.isReadyForGame) {
			if (this.rightPlayer?.isReadyForGame) {
				await this.sharedStore.dispatch({ code: 'start-game', playerId: this.player.id, gameId: G.newGameId() })
			} else {
				await this.sharedStore.dispatch({ code: 'set-ready', playerId: this.player.id, ready: true })
			}
		} else {
			await this.sharedStore.dispatch({ code: 'set-ready', playerId: this.player.id, ready: false })
		}
	}

	backToPregame = async () => {
		// the game effect above tears the game down once activeGameId clears
		await this.sharedStore.dispatch({ code: 'back-to-pregame', playerId: this.player.id })
	}
}

export const [room, setRoom] = createSignal<Room | null>(null)

export const [recentRooms, setRecentRooms] = makePersistedSignal<string[]>('recentRooms', [])

export function addRecentRoom(roomId: string) {
	setRecentRooms((prev) => {
		if (prev.includes(roomId)) return prev
		return [...prev, roomId]
	})
}
