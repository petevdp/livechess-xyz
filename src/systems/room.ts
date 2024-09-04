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
	// will contain id of player that initiated the piece swap
	agreePieceSwap: string | null
	isReadyForGame: { [playerId: string]: boolean }
	status: 'pregame' | 'playing' | 'postgame'
} & G.RootGameState

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
					let color: GL.Color
					if (state.gameParticipants.white) {
						color = 'black'
					} else if (state.gameParticipants.black) {
						color = 'white'
					} else {
						color = Math.random() < 0.5 ? 'white' : 'black'
					}
					const gameParticipant = {
						id: playerId,
						color,
					} satisfies G.GameParticipant as G.GameParticipant

					mutations.push({
						path: ['gameParticipants', gameParticipant.color],
						value: gameParticipant,
					})

					mutations.push({
						path: ['isReadyForGame', playerId],
						value: false,
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
						isReadyForGame: this.rollbackState.isReadyForGame[gameParticipant.id],
						agreePieceSwap: this.rollbackState.agreePieceSwap === gameParticipant.id,
					} satisfies RoomGameParticipant,
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
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const room = this
		this.gameContext = {
			configureNewGame: room.configureNewGame,
			event$: room.event$.pipe(
				filter((event) => !ROOM_ONLY_EVENTS.includes(event.type as (typeof ROOM_ONLY_EVENTS)[number]))
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
			get rollbackState() {
				return room.rollbackState
			},
			get sharedStore() {
				return room.sharedStore as G.RootGameContext['sharedStore']
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
					{
						path: ['agreePieceSwap'],
						value: this.player.id,
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
		rightParticipant.color = prevLeft
		return [
			{
				path: ['gameParticipants', leftParticipant.color],
				value: leftParticipant,
			},
			{
				path: ['agreePieceSwap'],
				value: null,
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
						path: ['agreePieceSwap'],
						value: null,
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
								path: ['isReadyForGame', this.leftPlayer!.id],
								value: false,
							},
							{
								path: ['isReadyForGame', this.rightPlayer!.id],
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
							path: ['isReadyForGame', this.leftPlayer!.id],
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
						path: ['isReadyForGame', this.leftPlayer!.id],
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
