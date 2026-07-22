import { NEVER, Observable } from 'rxjs'
import { Owner, createEffect, createSignal, getOwner, on, onCleanup, runWithOwner } from 'solid-js'

// import { RandomBot } from '~/bots/randomBot.ts'
import { StockfishBot } from '~/bots/stockfish.ts'
import * as SS from '~/sharedStore/sharedStore.ts'
import * as DS from '~/systems/debugSystem'
import { createSignalProperty, trackAndUnwrap } from '~/utils/solid.ts'
import { unit } from '~/utils/unit.ts'

import { initClockAuthority } from './game/clockAuthority.ts'
import * as G from './game/game.ts'
import * as GL from './game/gameLogic'
import * as GO from './game/gameOps.ts'
import { log } from './logger.browser.ts'
import * as P from './player.ts'

export const BOT_COMPATIBLE_VARIANTS = ['regular', 'fischer-random']

export interface Bot {
	name: string

	makeMove(state: GL.GameState): Promise<GL.InProgressMove>

	dispose(): void
}

type GameMessage = SS.SharedStoreMessage<GO.GameOp, GO.RootGameState>
export const BOT_ID = 'BOT'
const LOCAL_STORAGE_KEY = 'vsBotState'
const LOCAL_STORAGE_VERSION = 'v2'

const [_vsBotContext, setVsBotContext] = createSignal<VsBotContext | null>(null)
export const vsBotContext = _vsBotContext
export let hasSavedGame = !!localStorage.getItem(LOCAL_STORAGE_KEY)

export function setupVsBot(loadSavedGame: boolean, owner: Owner) {
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
		let startingState: GO.RootGameState
		const saved = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? 'null')
		// version is incremented when there's a breaking change in the storage format
		if (loadSavedGame && saved && saved.version === LOCAL_STORAGE_VERSION) {
			startingState = saved.state
		} else {
			localStorage.removeItem(LOCAL_STORAGE_KEY)
			startingState = {
				drawOffers: { white: null, black: null },
				gameConfig: {
					variant: 'regular',
					timeControl: 'unlimited',
					increment: '0',
					fischerRandomSeed: GL.getFischerRandomSeed(),
					bot: {
						difficulty: 3,
					},
				},
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

		const store = SS.initLeaderStore<GO.RootGameState, GO.GameOp, GO.GameEvent>(
			transport,
			{ reducer: GO.gameReducer, rawPaths: [['moves']] },
			{ log },
			startingState
		)
		// no server behind the local store, so this session flags its own clocks
		initClockAuthority(store)
		hasSavedGame = true
		const persistSub = store.stateUpdate$.subscribe((state) => {
			localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ state, version: LOCAL_STORAGE_VERSION }))
		})
		onCleanup(() => persistSub.unsubscribe())

		DS.addHook('vsBotStore', () => ({ ...trackAndUnwrap(store.state), moves: store.raw.moves }), getOwner()!)
		const bot = new StockfishBot(store.snapshot().gameConfig.bot!.difficulty, GL.parseGameConfig(store.snapshot().gameConfig))

		const ctx = new VsBotContext(store, bot)
		createEffect(
			on(
				() => {
					return store.state.activeGameId
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
			if (store.state.gameConfig.bot!.difficulty === undefined) {
				log.error('Bot difficulty is undefined')
				return
			}
			void bot.setDifficulty(store.state.gameConfig.bot!.difficulty)
		})
	})
}

export class VsBotContext implements G.RootGameContext {
	gameConfigContext: G.GameConfigContext

	constructor(
		public sharedStore: G.GameStore,
		private bot: Bot
	) {
		this.gameConfigContext = {
			vsBot: true,
			editingConfigDisabled: () => false,
			gameConfig: sharedStore.state.gameConfig,
			setGameConfig: (config: Partial<GL.GameConfig>) => {
				void this.sharedStore.dispatch({ code: 'set-game-config', config })
			},
			reseedFischerRandom: () => {
				void this.sharedStore.dispatch({ code: 'reseed-fischer-random', seed: GL.getFischerRandomSeed() })
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
		return Object.values(this.sharedStore.state.gameParticipants).find((p) => p.id === BOT_ID)!
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
		void this.sharedStore.dispatch({ code: 'start-game', playerId: this.player.id, gameId: G.newGameId() })
	}

	async backToPregame() {
		await this.sharedStore.dispatch({ code: 'back-to-pregame', playerId: this.player.id })
		this.setGame(null)
	}

	get state() {
		return this.sharedStore.state
	}
}
