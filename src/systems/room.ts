import { trackDeep, trackStore } from '@solid-primitives/deep'
import { until } from '@solid-primitives/promise'
import deepEquals from 'fast-deep-equal'
import { Observable, concatMap, first, interval, mergeAll, race, from as rxFrom, startWith } from 'rxjs'
import { map } from 'rxjs/operators'
import { Owner, createEffect, createMemo, createRoot, createSignal, getOwner, onCleanup, runWithOwner, untrack } from 'solid-js'
import { unwrap } from 'solid-js/store'

import * as Api from '~/api.ts'
import { PLAYER_TIMEOUT } from '~/config.ts'
import * as SS from '~/sharedStore/sharedStore.ts'
import { createId } from '~/utils/ids.ts'

import * as G from './game/game.ts'
import * as GL from './game/gameLogic.ts'
import * as P from './player.ts'

//#region types
export type RoomMember = P.Player & {
	disconnectedAt?: number
}

type GameParticipantDetails = {
	// just playerid
	id: string
	isReadyForGame: boolean
	agreePieceSwap: boolean
}

export type GameParticipant = RoomMember & GameParticipantDetails & { color: GL.Color }

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
				| 'new-game'
				| G.DrawEventType
			playerId: string
	  }
	| {
			type: 'make-move'
			playerId: string
			moveIndex: number
	  }
	| {
			type: 'game-over'
	  }

export type RoomState = {
	members: RoomMember[]
	status: 'pregame' | 'playing' | 'postgame'
	gameConfig: GL.GameConfig
	gameParticipants: Record<GL.Color, GameParticipantDetails>
	drawOffers: Record<GL.Color, number | undefined>
	moves: GL.Move[]
	outcome?: GL.GameOutcome
	activeGameId?: string
}

type ClientOwnedState = {
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

export function connectToRoom(
	roomId: string,
	playerId: string,
	initPlayer: (numPlayers: number) => Promise<{ player: P.Player; isSpectating: boolean }>,
	parentOwner: Owner
): Observable<ConnectionState> {
	const provider = new SS.TransportHelpers<RoomEvent>(new SS.WsTransport(roomId))

	// will only be used if the room is new
	let state: RoomState

	// we always keep/track snapshots because we never know when we're going to become the leader. It may happen after a reconnect or w/e.
	let lastSnaphotTs: number = -1
	const snapshot = localStorage.getItem(`roomSnapshot`)
	const snapshotRoomId = localStorage.getItem(`roomSnapshot:roomId`)
	if (snapshot && snapshotRoomId === roomId) {
		state = JSON.parse(snapshot)
		lastSnaphotTs = Date.now()
	} else {
		state = {
			members: [],
			status: 'pregame',
			gameParticipants: {} as RoomState['gameParticipants'],
			gameConfig: GL.getDefaultGameConfig(),
			drawOffers: {} as RoomState['drawOffers'],
			moves: [],
		}
	}

	const disconnected$: Observable<ConnectionState> = race(
		provider.disposed$.then(() => ({ status: 'lost' }) satisfies ConnectionState),
		provider.timedOut$.pipe(
			first(),
			map((idleTime) => ({ status: 'timeout', idleTime }) satisfies ConnectionState)
		)
	)

	let store = null as unknown as SS.SharedStore<RoomState, ClientOwnedState, RoomEvent>
	let instanceOwner = null as unknown as Owner
	disposePrevious()
	createRoot((_dispose) => {
		store = SS.initFollowerStore<RoomState, ClientOwnedState, RoomEvent>(provider, { playerId }, state)

		//#region try to take state snapshot on page unload
		createEffect(() => {
			trackStore(store.lockstepStore)
			const now = Date.now()
			if (lastSnaphotTs === -1 || now - lastSnaphotTs > 5000) {
				localStorage.setItem(`roomSnapshot:roomId`, roomId)
				localStorage.setItem(`roomSnapshot`, JSON.stringify(store.lockstepStore))
				lastSnaphotTs = now
			}
		})

		function unloadListener() {
			localStorage.setItem(`roomSnapshot`, JSON.stringify(store.lockstepStore))
			localStorage.setItem(`roomSnapshot:roomId`, roomId)
		}

		window.addEventListener('beforeunload', unloadListener)
		//#endregion
		instanceOwner = getOwner()!

		Api.keepServerAlive()

		disposePrevious = () => {
			window.removeEventListener('beforeunload', unloadListener)
			setRoom(null)
			_dispose()
		}
	})

	runWithOwner(parentOwner, () => {
		onCleanup(disposePrevious)
	})

	const connected$ = until(() => store.initialized()).then(async () => {
		if (!store.rollbackStore.members.some((p) => p.id === playerId)) {
			const { player, isSpectating } = await initPlayer(Object.values(store.rollbackStore.gameParticipants).length)
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
					} satisfies GameParticipantDetails
					if (state.gameParticipants.white) {
						mutations.push({
							path: ['gameParticipants', 'black'],
							value: gameParticipant,
						})
					} else if (state.gameParticipants.black) {
						mutations.push({
							path: ['gameParticipants', 'white'],
							value: gameParticipant,
						})
					} else {
						mutations.push({
							path: ['gameParticipants', Math.random() < 0.5 ? 'white' : 'black'],
							value: gameParticipant,
						})
					}
				}

				return {
					mutations,
					events: [{ type: 'player-connected', playerId: player.id }],
				}
			})
		}

		const room = runWithOwner(instanceOwner, () => new Room(store, provider, store.rollbackStore.members.find((p) => playerId === p.id)!))!
		setRoom(room)
	})
	//#endregion

	return mergeAll()(rxFrom([rxFrom(connected$).pipe(map(() => ({ status: 'connected' }))), disconnected$])).pipe(
		startWith({ status: 'connecting' } satisfies ConnectionState)
	)
}

export class Room {
	get canStartGame() {
		// check both states because reasons
		return this.rollbackState.status === 'pregame' && this.leftPlayer?.id === this.player.id && !!this.rightPlayer?.isReadyForGame
	}

	constructor(
		public sharedStore: SS.SharedStore<RoomState, ClientOwnedState, RoomEvent>,
		public provider: SS.TransportHelpers<RoomEvent>,
		public player: RoomMember
	) {
		this.setupPlayerEventTracking()
	}

	//#region members(players + spectators)

	setupPlayerEventTracking() {
		const prevConnected: RoomMember[] = []
		const connectedPlayers = createMemo(() => {
			trackDeep(this.sharedStore.clientControlledStates)
			const playerIds: string[] = Object.values(this.sharedStore.clientControlledStates).map((s) => s.playerId)
			const currConnected = this.members.filter((p) => playerIds.includes(p.id) && p.name)
			// return same object so equality check passes
			if (deepEquals(playerIds, prevConnected)) return prevConnected
			return currConnected
		})

		//#region track reconnects and disconnects
		const previouslyConnected = new Set<string>()
		createEffect(() => {
			const _connectedPlayers = unwrap(connectedPlayers())
			untrack(() => {
				for (const player of this.members) {
					const isConnected = _connectedPlayers.some((p) => p.id === player.id)
					if (!previouslyConnected.has(player.id) && isConnected) {
						previouslyConnected.add(player.id)
						if (!this.sharedStore.isLeader()) return
						this.sharedStore.setStoreWithRetries((state) => {
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
						if (!this.sharedStore.isLeader()) return
						this.sharedStore.setStoreWithRetries((state) => {
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
			if (!this.sharedStore.isLeader()) return
			for (const id of previouslyConnected) {
				const member = this.members.find((p) => p.id === id)!
				if (member.disconnectedAt !== undefined && Date.now() - member.disconnectedAt) {
					this.sharedStore.setStoreWithRetries(() => {
						const participant = this.participants.find((p) => p.id === id)!
						if (!participant) return
						if (this.state.status !== 'pregame') {
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

	// the implementation here could potentially lead to bugs in multiple client per user scenarios where player details change on one client but not another. need to do something more clever for that
	get members() {
		return this.sharedStore.rollbackStore.members
	}

	get participants(): GameParticipant[] {
		return this.members
			.map((player): GameParticipant[] => {
				const gameParticipant = Object.values(this.rollbackState.gameParticipants).find((gp) => gp.id === player.id)
				if (!gameParticipant) return []
				return [
					{
						...player,
						...gameParticipant,
						color: this.playerColor(gameParticipant.id)!,
					},
				]
			})
			.flat()
	}

	get isPlayerParticipating() {
		return this.player.id === this.leftPlayer?.id
	}

	get spectators() {
		return this.members.filter((p) => Object.values(this.rollbackState.gameParticipants).some((gp) => gp.id === p.id))
	}

	get rightPlayer() {
		return this.participants.find((p) => p.id !== this.player.id) || null
	}

	get leftPlayer() {
		const participant = this.participants.find((p) => p.id === this.player.id)
		if (participant) return participant
		return this.participants.find((p) => p.id !== this.player.id && p.id !== this.rightPlayer?.id) || null
	}

	// players that are connected, or have been disconnected for less than the timeout window
	get activePlayers() {
		return this.members.filter((p) => !p.disconnectedAt || Date.now() - p.disconnectedAt < PLAYER_TIMEOUT)
	}

	playerColor(playerId: string) {
		if (!playerId) throw new Error('playerId is missing')
		if (this.rollbackState.gameParticipants.white?.id === playerId) return 'white'
		if (this.rollbackState.gameParticipants.black?.id === playerId) return 'black'
		return null
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

	//#region helpers

	get roomId() {
		return this.provider.transport.networkId
	}

	get rollbackState() {
		return this.sharedStore.rollbackStore
	}

	get state() {
		return this.sharedStore.lockstepStore
	}

	get playerHasMultipleClients() {
		return Object.values(this.sharedStore.clientControlledStates).filter((v) => v.playerId === this.player.id).length > 1
	}

	//#endregion

	get event$() {
		return this.sharedStore.event$.pipe(
			concatMap((event) => {
				let player: RoomMember | undefined = undefined
				if (event.type !== 'game-over') {
					player = this.members.find((p) => p.id === event.playerId)!
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

	//#region piece swapping
	initiateOrAgreePieceSwap() {
		void this.sharedStore.setStoreWithRetries(() => {
			if (this.state.status !== 'pregame' || !this.isPlayerParticipating) return
			if (!this.rightPlayer) {
				const participant = { ...this.rollbackState.gameParticipants[this.leftPlayer!.color] }
				participant.agreePieceSwap = false
				return {
					events: [{ type: 'agree-piece-swap', playerId: this.player.id }],
					mutations: [
						{
							path: ['gameParticipants', GL.oppositeColor(this.leftPlayer!.color)],
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
		return [
			{
				path: ['gameParticipants', this.leftPlayer!.color],
				value: {
					...this.rollbackState.gameParticipants[this.rightPlayer!.color],
					agreePieceSwap: false,
				},
			},
			{
				path: ['gameParticipants', this.rightPlayer!.color],
				// always clone because this object will have been mutated by the previous mutation
				value: {
					...this.rollbackState.gameParticipants[this.leftPlayer!.color],
					agreePieceSwap: false,
				},
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

	//#region game start / config
	setGameConfig(config: Partial<GL.GameConfig>) {
		void this.sharedStore.setStore({ path: ['gameConfig'], value: config })
	}

	reseedFischerRandom() {
		void this.sharedStore.setStore({ path: ['gameConfig', 'fischerRandomSeed'], value: GL.getFischerRandomSeed() })
	}

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

	configureNewGame() {
		void this.sharedStore.setStoreWithRetries(() => {
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
	}

	//#endregion
}

export const [room, setRoom] = createSignal<Room | null>(null)
