import { NEVER, Observable, Subscription } from 'rxjs'
import { createEffect, createSignal, getOwner, on, onCleanup, runWithOwner } from 'solid-js'

// import { RandomBot } from '~/bots/randomBot.ts'
import { StockfishBot } from '~/bots/stockfish.ts'
import * as SS from '~/sharedStore/sharedStore.ts'
import { unit } from '~/utils/unit.ts'

import * as G from './game/game.ts'
import { setGame } from './game/game.ts'
import * as GL from './game/gameLogic'
import * as P from './player.ts'

export const BOT_COMPATIBLE_VARIANTS = ['regular', 'fischer-random']

export interface Bot {
	name: string

	makeMove(state: GL.GameState): Promise<GL.SelectedMove>

	dispose(): void
}

type GameMessage = SS.SharedStoreMessage<G.GameEvent, G.RootGameState, object>
export const BOT_ID = 'BOT'

const [_vsBotContext, setVsBotContext] = createSignal<VsAIContext | null>(null)
export const vsBotContext = _vsBotContext

export function setupVsBot() {
	const owner = getOwner()
	if (!owner) throw new Error('Owner not found')

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
	const startingState: G.RootGameState = {
		drawOffers,
		gameConfig: {
			variant: 'regular',
			timeControl: 'unlimited',
			increment: '0',
			fischerRandomSeed: GL.getFischerRandomSeed(),
			bot: {
				difficulty: 10,
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
	const store = SS.initLeaderStore<G.RootGameState, object, G.GameEvent>(transport, startingState)
	const bot = new StockfishBot(store.lockstepState.gameConfig.bot!.difficulty, store.lockstepState.gameConfig)

	const sub = new Subscription()
	const vsAiContext = new VsAIContext(store, bot)
	setVsBotContext(vsAiContext)
	let cleanedUp = false
	onCleanup(() => {
		sub.unsubscribe()
		bot?.dispose()
		setVsBotContext(null)
		setGame(null)
		cleanedUp = true
	})

	function makeMove(move: GL.SelectedMove) {
		if (cleanedUp) return
		G.game()?.makeMoveProgrammatic(move, BOT_ID)
	}

	const ownerContext = getOwner()

	sub.add(
		vsAiContext.event$.subscribe((e) => {
			if (e.type !== 'new-game') return
			runWithOwner(ownerContext, () => {
				const game = new G.Game(store.lockstepState.activeGameId!, vsAiContext, vsAiContext.state.gameConfig)
				G.setGame(game)
				bot.initialize()
				if (vsAiContext.botParticipant.color === 'white') {
					bot.makeMove(game.state).then(makeMove)
				}
			})
		})
	)

	createEffect(
		on(
			() => [G.game()?.stateSignal(), G.game()] as const,
			([state, game]) => {
				if (!state || !game) return
				if (GL.getBoard(state).toMove !== vsAiContext.botParticipant.color || game.outcome) return
				bot.makeMove(state).then(makeMove)
			}
		)
	)

	createEffect(() => {
		on(
			() => store.lockstepState.gameConfig.bot!.difficulty,
			() => {
				void bot.setDifficulty(store.lockstepState.gameConfig.bot!.difficulty)
			}
		)
	})
}

export class VsAIContext implements G.RootGameContext {
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

	async configureNewGame() {
		const res = await this.sharedStore.setStoreWithRetries(() => {
			return [
				{ path: ['status'], value: 'pregame' },
				{ path: ['activeGameId'], value: undefined },
			]
		})
		res && G.setGame(null)
	}

	get state() {
		return this.sharedStore.lockstepState
	}

	get rollbackState() {
		return this.sharedStore.rollbackState
	}
}
