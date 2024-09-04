import { until } from '@solid-primitives/promise'
import { Observable, concatMap, mergeAll, race, from as rxFrom, startWith } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import { Owner, createRoot, createSignal, getOwner, onCleanup, runWithOwner } from 'solid-js'
import { unwrap } from 'solid-js/store'

import * as Api from '~/api.ts'
import { PLAYER_TIMEOUT } from '~/config.ts'
import * as SS from '~/sharedStore/sharedStore.ts'
import { WsTransport } from '~/sharedStore/wsTransport.ts'
import { createId } from '~/utils/ids.ts'
import { deepClone } from '~/utils/obj.ts'

import * as G from './game/game.ts'
import * as GL from './game/gameLogic.ts'
import * as P from './player.ts'

//#region types
export type RoomMember = P.Player & {
	disconnectedAt?: number
}

export type RoomGameParticipant = RoomMember & G.GameParticipant & { agreePieceSwap: boolean; isReadyForGame: boolean }

// not exhaustive of all state mutations, just the ones we want to name for convenience
export type RoomEvent =
	| {
			type:
				| 'initiate-piece-swap'
				| 'agree-piece-swap'
				| 'decline-or-cancel-piece-swap'
				| 'player-connected'
				| 'player-disconnected'
				| 'player-reconnected'
			playerId: string
	  }
	| G.GameEvent

export const ROOM_ONLY_EVENTS = [
	'initiate-piece-swap',
	'agree-piece-swap',
	'decline-or-cancel-piece-swap',
	'player-connected',
	'player-disconnected',
	'player-reconnected',
] as const

export type RoomState = {
	members: RoomMember[]
	status: 'pregame' | 'playing' | 'postgame'
	gameConfig: GL.GameConfig
	gameParticipants: Record<GL.Color, RoomGameParticipant>
	drawOffers: { [key in GL.Color]: number }
	moves: GL.Move[]
	outcome?: GL.GameOutcome
	activeGameId?: string
}

export type ClientOwnedState = {
	playerId: string
}
//#endregion

let disposePrevious = () => {}

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

export type RoomMessage = SS.SharedStoreMessage<RoomEvent, RoomState, ClientOwnedState>

export type RoomStore = SS.SharedStore<RoomState, ClientOwnedState, RoomEvent>

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
	let instanceOwner = null as unknown as Owner
	disposePrevious()
	createRoot((_dispose) => {
		store = SS.initFollowerStore<RoomState, ClientOwnedState, RoomEvent>(transport, { playerId })
		instanceOwner = getOwner()!

		if (import.meta.env.PROD) Api.keepServerAlive()

		disposePrevious = () => {
			setRoom(null)
			_dispose()
		}
	})

	runWithOwner(parentOwner, () => {
		onCleanup(disposePrevious)
	})

	const connected$ = until(() => store.initialized()).then(async () => {
		if (!store.rollbackState.members.some((p) => p.id === playerId)) {
			const { player, isSpectating } = await initPlayer(Object.values(store.rollbackState.gameParticipants).length)
			//#region connect player
			await store.setStoreWithRetries((state) => {
				// leader will report player reconnection
				if (state.members.some((p) => p.id === playerId)) return []
				const mutations: SS.StoreMutation[] = [
					{
						path: ['members', SS.PUSH],
						value: player satisfies RoomMember,
					},
				]

				if (!isSpectating) {
					const gameParticipant = {
						id: playerId,
						isReadyForGame: false,
						agreePieceSwap: false,
						disconnectedAt: undefined,
						name: player.name,
					} as RoomGameParticipant
					if (state.gameParticipants.white) {
						gameParticipant.color = 'black'
					} else if (state.gameParticipants.black) {
						gameParticipant.color = 'white'
					} else {
						gameParticipant.color = Math.random() < 0.5 ? 'white' : 'black'
					}
					mutations.push({
						path: ['gameParticipants', gameParticipant.color],
						value: gameParticipant,
					})
				}

				return {
					mutations,
					events: [{ type: 'player-connected', playerId: player.id }],
				}
			})
		}

		const room = runWithOwner(instanceOwner, () => new Room(store, transport, store.rollbackState.members.find((p) => playerId === p.id)!))!
		setRoom(room)
	})
	//#endregion

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

	get rollbackState() {
		return this.sharedStore.rollbackState
	}

	get state() {
		return this.sharedStore.lockstepState
	}

	playerColor(playerId: string) {
		if (!playerId) throw new Error('playerId is missing')
		if (this.rollbackState.gameParticipants.white?.id === playerId) return 'white'
		if (this.rollbackState.gameParticipants.black?.id === playerId) return 'black'
		return null
	}

	get members() {
		return this.sharedStore.rollbackState.members
	}

	// players that are connected, or have been disconnected for less than the timeout window
	get activePlayers() {
		return this.members.filter((p) => !p.disconnectedAt || Date.now() - p.disconnectedAt < PLAYER_TIMEOUT)
	}

	get participants(): RoomGameParticipant[] {
		return this.members
			.map((player): RoomGameParticipant[] => {
				const gameParticipant = Object.values(this.rollbackState.gameParticipants).find((gp) => gp.id === player.id)
				if (!gameParticipant) return []
				return [
					{
						...player,
						...gameParticipant,
						color: this.playerColor(gameParticipant.id)!,
					} as RoomGameParticipant,
				]
			})
			.flat()
	}

	get event$() {
		return this.sharedStore.event$.pipe(
			concatMap((event) => {
				let player: RoomMember | undefined = undefined
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
		// check both states because reasons
		return this.rollbackState.status === 'pregame' && this.leftPlayer?.id === this.player.id && !!this.rightPlayer?.isReadyForGame
	}

	gameConfigContext: G.GameConfigContext
	gameContext: G.RootGameContext

	constructor(
		public sharedStore: RoomStore,
		transport: SS.Transport<RoomMessage>,
		public player: RoomMember
	) {
		super(sharedStore, transport)
		this.gameConfigContext = {
			gameConfig: this.rollbackState.gameConfig,
			vsBot: false,
			editingConfigDisabled: () => {
				return !this.isPlayerParticipating || !!this.leftPlayer?.isReadyForGame
			},
			setGameConfig: (config: Partial<GL.GameConfig>) => {
				void this.sharedStore.setStore({ path: ['gameConfig'], value: config })
			},
			reseedFischerRandom: () => {
				void this.sharedStore.setStore({ path: ['gameConfig', 'fischerRandomSeed'], value: GL.getFischerRandomSeed() })
			},
		}

		// boilerplate mostly to make typescript happy
		this.gameContext = {
			configureNewGame: this.configureNewGame,
			event$: this.event$.pipe(
				filter((event) => !ROOM_ONLY_EVENTS.includes(event.type as (typeof ROOM_ONLY_EVENTS)[number]))
			) as Observable<G.GameEvent>,
			get members() {
				return this.members
			},
			get player() {
				return this.player
			},
			get state() {
				return this.state
			},
			get rollbackState() {
				return this.rollbackState
			},
			get sharedStore() {
				return this.sharedStore
			},
		}
	}

	get isPlayerParticipating() {
		return this.player.id === this.leftPlayer?.id
	}

	get spectators() {
		return this.members.filter((p) => Object.values(this.rollbackState.gameParticipants).some((gp) => gp.id === p.id))
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
		void this.sharedStore.setStoreWithRetries((state) => {
			let _name = name
			// name already set
			if (state.members.some((p) => p.id === this.player.id && p.name === name)) return []

			// check if name taken
			const duplicates = state.members.filter((p) => p.name === name)
			if (duplicates.length > 0) {
				_name = `${name} (${duplicates.length})`
			}

			return [
				{
					path: ['members', state.members.findIndex((p) => p.id === this.player.id), 'name'],
					value: _name,
				},
			]
		})
	}

	//#endregion

	get playerHasMultipleClients() {
		return Object.values(this.sharedStore.clientControlled.states).filter((v) => v.playerId === this.player.id).length > 1
	}

	//#region piece swapping
	initiateOrAgreePieceSwap() {
		void this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame' || !this.isPlayerParticipating) return
			if (!this.rightPlayer) {
				const participant = { ...this.rollbackState.gameParticipants[this.leftPlayer!.color] }
				participant.agreePieceSwap = false
				participant.color = GL.oppositeColor(this.leftPlayer!.color)
				return {
					events: [{ type: 'agree-piece-swap', playerId: this.player.id }],
					mutations: [
						{
							path: ['gameParticipants', participant.color],
							value: participant,
						},
						{
							path: ['gameParticipants', this.leftPlayer!.color],
							value: undefined,
						},
					] satisfies SS.StoreMutation[],
				}
			}

			if (this.rightPlayer.agreePieceSwap) {
				return {
					events: [{ type: 'agree-piece-swap', playerId: this.player.id }],
					mutations: this.getPieceSwapMutation(),
				}
			}

			return {
				events: [{ type: 'initiate-piece-swap', playerId: this.player.id }],
				mutations: [
					{
						path: ['gameParticipants', this.leftPlayer!.color, 'agreePieceSwap'],
						value: true,
					},
				],
			}
		})
	}

	getPieceSwapMutation(): SS.StoreMutation[] {
		const leftParticipant = deepClone(this.leftPlayer!)
		const rightParticipant = deepClone(this.rightPlayer!)
		const prevLeft = leftParticipant.color
		leftParticipant.color = rightParticipant.color
		leftParticipant.agreePieceSwap = false
		rightParticipant.color = prevLeft
		rightParticipant.agreePieceSwap = false
		return [
			{
				path: ['gameParticipants', leftParticipant.color],
				value: leftParticipant,
			},
			{
				path: ['gameParticipants', rightParticipant.color],
				value: rightParticipant,
			},
		]
	}

	declineOrCancelPieceSwap() {
		void this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame') return []
			if (!this.rightPlayer) return []
			return {
				events: [{ type: 'decline-or-cancel-piece-swap', playerId: this.player.id }],
				mutations: [
					{
						path: ['gameParticipants', 'white', 'agreePieceSwap'],
						value: false,
					},
					{
						path: ['gameParticipants', 'black', 'agreePieceSwap'],
						value: false,
					},
				],
			}
		})
	}

	//#endregion

	toggleReady() {
		if (!this.isPlayerParticipating) return
		if (!this.leftPlayer!.isReadyForGame) {
			void this.sharedStore.setStoreWithRetries(() => {
				if (!this.isPlayerParticipating || this.leftPlayer!.isReadyForGame) return []
				if (this.rightPlayer?.isReadyForGame) {
					return {
						events: [{ type: 'new-game', playerId: this.player.id }],
						mutations: [
							{
								path: ['gameParticipants', this.leftPlayer!.color, 'isReadyForGame'],
								value: false,
							},
							{
								path: ['gameParticipants', this.rightPlayer!.color, 'isReadyForGame'],
								value: false,
							},
							{ path: ['status'], value: 'playing' },
							{ path: ['moves'], value: [] },
							{ path: ['drawOffers'], value: { white: null, black: null } },
							{ path: ['activeGameId'], value: createId(6) },
							{ path: ['outcome'], value: undefined },
						] satisfies SS.StoreMutation[],
					}
				} else {
					return [
						{
							path: ['gameParticipants', this.leftPlayer!.color, 'isReadyForGame'],
							value: true,
						},
					]
				}
			})
		} else {
			void this.sharedStore.setStoreWithRetries(() => {
				if (!this.isPlayerParticipating || !this.leftPlayer!.isReadyForGame) return []
				return [
					{
						path: ['gameParticipants', this.leftPlayer!.color, 'isReadyForGame'],
						value: false,
					},
				]
			})
		}
	}

	configureNewGame = async () => {
		const res = await this.sharedStore.setStoreWithRetries(() => {
			if (!this.rightPlayer || !this.rollbackState.activeGameId) return
			return [
				...this.getPieceSwapMutation(),
				{ path: ['status'], value: 'pregame' },
				{
					path: ['activeGameId'],
					value: undefined,
				},
			]
		})
		if (res) G.setGame(null)
	}

	//#endregion
}

export const [room, setRoom] = createSignal<Room | null>(null)
