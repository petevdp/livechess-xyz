import { NEVER, Observable, Subscription } from 'rxjs'
import { Owner, createEffect, createSignal, getOwner, on, onCleanup, runWithOwner } from 'solid-js'

// import { RandomBot } from '~/bots/randomBot.ts'
import { StockfishBot } from '~/bots/stockfish.ts'
import * as SS from '~/sharedStore/sharedStore.ts'
import * as DS from '~/systems/debugSystem'
import { createSignalProperty, trackAndUnwrap } from '~/utils/solid.ts'
import { unit } from '~/utils/unit.ts'

import * as G from './game/game.ts'
import * as GL from './game/gameLogic'
import { log } from './logger.browser.ts'
import * as P from './player.ts'

export const BOT_COMPATIBLE_VARIANTS = ['regular', 'fischer-random']

export interface Bot {
	name: string

	makeMove(state: GL.GameState): Promise<GL.InProgressMove>

	dispose(): void
}

type GameMessage = SS.SharedStoreMessage<G.GameEvent, G.RootGameState, object>
export const BOT_ID = 'BOT'
const LOCAL_STORAGE_KEY = 'vsBotState'
const LOCAL_STORAGE_VERSION = 'v1'

const [_vsBotContext, setVsBotContext] = createSignal<VsBotContext | null>(null)
export const vsBotContext = _vsBotContext
export let hasSavedGame = !!localStorage.getItem(LOCAL_STORAGE_KEY)

export function setupVsBot(newGame: boolean, owner: Owner) {
	runWithOwner(owner, () => {
		const transport: SS.Transport<GameMessage> = {
			networkId: 'LOCAL',
			send() {},
			dispose() {},
			waitForConnected(): Promise<void> {
				return Promise.resolve()
			},
			disposed$: new Promise<void>(unit),
			message$: NEVER as Observable<GameMessage>,
		}
		//@ts-expect-error
		const drawOffers: G.RootGameState['drawOffers'] = {}
		let startingState: G.RootGameState
		const saved = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? 'null')
		// increment when there's a breaking change in the storage format
		if (!newGame && saved && saved.version !== LOCAL_STORAGE_VERSION) {
			startingState = saved.state
		} else {
			localStorage.removeItem(LOCAL_STORAGE_KEY)
			startingState = {
				drawOffers,
				gameConfig: {
					variant: 'regular',
					timeControl: 'unlimited',
					increment: '0',
					fischerRandomSeed: GL.getFischerRandomSeed(),
					bot: {
						difficulty: 3,
					},
				},
				outcome: undefined,
				moves: [],
				gameParticipants: {
					white: {
						id: P.playerId()!,
						color: 'white',
					},
					black: {
						id: BOT_ID,
						color: 'black',
					},
				},
			}
		}

		const store = SS.initLeaderStore<G.RootGameState, object, G.GameEvent>(transport, { log }, startingState)
		hasSavedGame = true
		createEffect(() => {
			const state = trackAndUnwrap(store.rollbackState)
			localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ state, version: LOCAL_STORAGE_VERSION }))
		})

		DS.addHook('vsBotStore', () => store.rollbackState, getOwner()!)
		const bot = new StockfishBot(store.lockstepState.gameConfig.bot!.difficulty, GL.parseGameConfig(store.lockstepState.gameConfig))

		const ctx = new VsBotContext(store, bot)
		createEffect(
			on(
				() => {
					return store.lockstepState.activeGameId
				},
				(gameId) => {
					if (gameId === undefined) {
						ctx.setGame(null)
						return
					}
					bot.initialize()
					ctx.setGame(new G.Game(gameId, ctx, ctx.state.gameConfig))
				}
			)
		)

		setVsBotContext(ctx)
		let cleanedUp = false
		onCleanup(() => {
			bot?.dispose()
			vsBotContext()?.dispose()
			setVsBotContext(null)
			cleanedUp = true
		})

		function makeMove(move: GL.InProgressMove) {
			if (cleanedUp) return
			ctx.game!.makeMoveProgrammatic(move)
		}

		createEffect(
			on(
				() => [ctx.game?.stateSignal(), ctx.game] as const,
				([state, game]) => {
					if (!state || !game) return
					if (GL.getBoard(state).toMove !== ctx.botParticipant.color || game.outcome) return
					bot.makeMove(state).then(makeMove)
				}
			)
		)

		createEffect(() => {
			if (store.lockstepState.gameConfig.bot!.difficulty === undefined) {
				log.error('Bot difficulty is undefined')
				return
			}
			void bot.setDifficulty(store.lockstepState.gameConfig.bot!.difficulty)
		})
	})
}

export class VsBotContext implements G.RootGameContext {
	gameConfigContext: G.GameConfigContext

	constructor(
		public sharedStore: SS.SharedStore<G.RootGameState, object, G.GameEvent>,
		private bot: Bot
	) {
		this.gameConfigContext = {
			vsBot: true,
			editingConfigDisabled: () => false,
			gameConfig: sharedStore.rollbackState.gameConfig,
			setGameConfig: (config: Partial<GL.GameConfig>) => {
				void this.sharedStore.setStore({ path: ['gameConfig'], value: config })
			},
			reseedFischerRandom: () => {
				void this.sharedStore.setStore({ path: ['gameConfig', 'fischerRandomSeed'], value: GL.getFischerRandomSeed() })
			},
		}
	}

	private _game = createSignalProperty<G.Game | null>(null)
	get game() {
		return this._game.get()
	}

	setGame(game: G.Game | null) {
		this.game?.dispose()
		this._game.set(game)
	}

	dispose() {
		this.setGame(null)
		this.bot.dispose()
	}

	get botParticipant() {
		return Object.values(this.sharedStore.rollbackState.gameParticipants).find((p) => p.id === BOT_ID)!
	}

	get members() {
		return [
			{
				id: P.playerId()!,
				name: P.settings.name || 'Player',
			},
			{
				id: BOT_ID,
				name: this.bot.name,
			},
		]
	}

	get player() {
		return this.members.find((p) => p.id === P.playerId())!
	}

	get event$() {
		return this.sharedStore.event$
	}

	startGame() {
		void this.sharedStore.setStoreWithRetries(() => {
			return G.getNewGameTransaction(this.player.id)
		})
	}

	async backToPregame() {
		const res = await this.sharedStore.setStoreWithRetries(() => {
			return [{ path: ['activeGameId'], value: undefined }]
		})
		if (!res) return
		this.setGame(null)
	}

	get state() {
		return this.sharedStore.lockstepState
	}

	get rollbackState() {
		return this.sharedStore.rollbackState
	}
}
