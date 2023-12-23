import { WebsocketProvider } from 'y-websocket'
import { createId } from '../utils/ids.ts'
import * as GL from './game/gameLogic.ts'
import * as Y from 'yjs'
import * as P from './player.ts'
import { WS_CONNECTION } from '../config.ts'
import { createSignal } from 'solid-js'
import { until } from '@solid-primitives/promise'
import {
	combineLatest,
	concatAll,
	firstValueFrom,
	mergeAll,
	Subscription,
} from 'rxjs'
import * as YU from '../utils/yjs.ts'
import { filter, map } from 'rxjs/operators'

export const ROOM_STATES = ['pregame', 'in-progress', 'postgame'] as const
export type RoomStatus = (typeof ROOM_STATES)[number]
export const GAME_ENDED_ACTION_TYPES = [
	'resign',
	'offer-draw',
	'accept-draw',
	'reject-draw',
] as const
export type GameEndedActionType = (typeof GAME_ENDED_ACTION_TYPES)[number]

export type RoomActionArgs =
	| {
			type: 'move'
			move: GL.Move
	  }
	| {
			type: GameEndedActionType | 'play-again'
	  }
	| {
			type: 'new-game'
			gameConfig: GL.GameConfig
			playerColors: GL.GameState['players']
	  }

// actions are events that need to be replicated, though chat messages are handled separately
export type RoomAction = {
	playerId: string
} & RoomActionArgs

// can be sent by either players or the room(on host)
export type ChatMessage = {
	type: 'player' | 'system'
	sender: string | null
	text: string
}

export type RoomParticipant = P.Player & { spectator: boolean; joinTs: number }

const roomYWrapperDef = {
	entities: {
		player: {
			key: (p: RoomParticipant) => p.id,
			startingValues: [] as RoomParticipant[],
		} satisfies YU.EntityStoreDef<RoomParticipant>,
		processedRoomActions: {
			key: (index: number) => index.toString(),
			startingValues: [] as number[],
		},
	},
	events: {
		roomAction: {
			example: { type: 'move', move: { from: 'a1', to: 'a2' } } as RoomAction,
		},
		chatMessage: {
			example: {} as unknown as ChatMessage,
		},
	},
	values: {
		status: {
			default: 'pregame' as RoomStatus,
		},
		cachedBoard: {
			default: [-1, GL.startPos()] as [number, ReturnType<typeof GL.startPos>],
		},
		gameConfig: {
			default: GL.defaultGameConfig,
		},
		creator: {
			default: null as string | null,
		},
	},
	awareness: {
		playerId: 'empty',
	},
} satisfies YU.DataConfig
type RoomStateDef = typeof roomYWrapperDef

export const [room, setRoom] = createSignal<Room | null>(null)

export class Room {
	public yClient: YU.YState<RoomStateDef>
	private subscription: Subscription
	private wsProvider: any

	constructor(
		public readonly roomId: string,
		private playerId: string,
		isNewRoom: boolean
	) {
		const doc = new Y.Doc()
		this.wsProvider = new WebsocketProvider(WS_CONNECTION, roomId, doc, {
			connect: false,
		})

		this.yClient = new YU.YState(
			doc,
			this.wsProvider,
			roomYWrapperDef,
			this.wsProvider.awareness,
			isNewRoom
		)

		this.subscription = new Subscription()

		this.setupListeners().then(async () => {
			this.wsProvider.connect()
			const playerName = await until(() => P.player()?.name)
			await this.yClient.dispatchEvent('chatMessage', {
				type: 'system',
				sender: null,
				text: `${playerName} has connected`,
			})
		})
	}

	get players() {
		return this.yClient.getAllEntities('player')
	}

	async connectedPlayers() {
		return await Promise.all(
			(await this.yClient.getAllEntities('player')).filter(async (p) => {
				const playerIds = Object.values(
					await this.yClient.getAwarenessState()
				).map((s) => s.playerId)
				return playerIds.includes(p.id)
			})
		)
	}

	async host() {
		let players = await this.players
		return players.sort((a, b) => a.joinTs - b.joinTs)[0]
	}

	async roomStatus() {
		return await this.yClient.getValue('status')
	}

	observeRoomStatus() {
		return this.yClient.observeValue('status', true)
	}

	canStart() {}

	observeHost() {
		return this.yClient.observeEntity('player', true).pipe(
			map(() => this.host()),
			concatAll()
		)
	}

	observeCanStart() {
		const player$ = this.yClient.observeEntity('player', true).pipe(
			map(() => this.players),
			concatAll()
		)
		const status$ = this.yClient.observeValue('status', true).pipe(
			map(() => this.yClient.getValue('status')),
			concatAll()
		)
		return combineLatest([player$, status$]).pipe(
			map(([players, status]) => {
				return status === 'pregame' && players.length > 1
			})
		)
	}

	async guest() {
		return (await this.players).sort((a, b) => a.joinTs - b.joinTs)[1]
	}

	async sendMessage(message: string, isSystem: boolean) {
		await this.yClient.dispatchEvent('chatMessage', {
			type: isSystem ? 'system' : 'player',
			sender: await until(() => P.player()?.name),
			text: message,
		})
	}

	async gameConfig() {
		return await this.yClient.getValue('gameConfig')
	}

	async setRoomState(state: RoomStatus) {
		await this.yClient.setValue('status', state)
	}

	async startGame() {
		await this.yClient.dispatchEvent('roomAction', {
			type: 'new-game',
			gameConfig: GL.defaultGameConfig,
			playerColors: [(await this.host()).id, (await this.guest()).id],
			playerId: (await this.host()).id,
		})
	}

	async dispatchRoomAction(action: RoomActionArgs) {
		await this.yClient.dispatchEvent('roomAction', {
			playerId: this.playerId,
			...action,
		})
	}

	async destroy() {
		this.subscription.unsubscribe()
		await this.yClient.destroy()
	}

	private async setupListeners() {
		//#region handle actions as host
		this.subscription.add(
			this.yClient
				.observeEvent('roomAction', true)
				.pipe(
					// do this separately so we ensure that we process actions in order
					map(async (a) => {
						if ((await this.host()).id !== (await until(() => P.player()?.id)))
							return []
						return [a]
					}),
					mergeAll(), // merge promise
					mergeAll() // merge arrays
				)
				.subscribe(async (action) => {
					await this.yClient.setEntity(
						'processedRoomActions',
						action.index.toString(),
						action.index
					)
					let roomStatus = await this.roomStatus()

					if (
						GAME_ENDED_ACTION_TYPES.includes(
							action.type as GameEndedActionType
						) &&
						roomStatus === 'in-progress'
					) {
						await this.yClient.setValue('status', 'postgame')
						await this.sendMessage(`Game Ended`, true)
						return
					}

					if (action.type === 'new-game' && roomStatus === 'pregame') {
						const player = await this.yClient.getEntity(
							'player',
							action.playerId
						)
						if (!player) {
							console.warn(
								`player not found when attempting to log message (${action.type}):`,
								action.playerId
							)
							return
						}
						await this.yClient.setValue('status', 'in-progress')
						await this.sendMessage(
							`${player.name!} has started a new game`,
							true
						)
						return
					}
					if (action.type === 'play-again' && roomStatus === 'postgame') {
						await this.yClient.setValue('status', 'pregame')
						return
					}
				})
		)
		//#endregion

		//#region check if any players have DCed
		this.subscription.add(
			this.yClient
				.observeAwareness(true)
				.pipe(
					map(async (a) => {
						const host = await this.host()
						let playerId = until(() => P.player()?.id)
						if (!host || host.id !== (await playerId)) return []
						return [a]
					}),
					mergeAll(), // merge promise
					mergeAll() // merge arrays
				)
				.subscribe(async () => {
					for (let player of await this.players) {
						if (
							(await this.connectedPlayers())
								.map((p) => p.id)
								.includes(player.id)
						)
							continue
						await this.sendMessage(`${player.name} has disconnected`, true)
					}
				})
		)
		//#endregion

		this.wsProvider.once('connection-error', (e: any) => {
			console.error('connection error: ', e)
		})
	}
}

export async function connectToRoom(roomId: string | null, isNewRoom = false) {
	let _room = room()
	if (_room && roomId && _room.roomId === roomId) {
		throw new Error(`already in room ${roomId}`)
	}
	if (!roomId) {
		roomId = await createId(6)
	}

	_room && (await _room.destroy())

	_room = new Room(roomId, await until(() => P.player()?.id), isNewRoom)
	setRoom(_room)

	const status = await firstValueFrom(
		_room.yClient.connectionStatus$.pipe(filter((s) => s === 'connected'))
	)
	console.log({ status })

	return status
}
