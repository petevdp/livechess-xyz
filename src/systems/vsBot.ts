import { NEVER, Observable, Subscription, concatMap } from 'rxjs'
import { createEffect, getOwner, on } from 'solid-js'
import { unwrap } from 'solid-js/store'

// import { RandomBot } from '~/bots/randomBot.ts'
import { StockfishBot } from '~/bots/stockfish.ts'
import * as SS from '~/sharedStore/sharedStore.ts'
import { createId } from '~/utils/ids.ts'
import { unit } from '~/utils/unit.ts'

import * as G from './game/game.ts'
import * as GL from './game/gameLogic'
import * as P from './player.ts'

export interface Bot {
	name: string
	setDifficulty: (difficulty: number) => void

	makeMove(state: GL.GameState): Promise<GL.SelectedMove>
	dispose(): void
}

type GameMessage = SS.SharedStoreMessage<G.GameEvent, G.RootGameState, object>
export const BOT_ID = 'BOT'

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
	const gameId = createId(6)
	//@ts-expect-error
	const drawOffers: G.RootGameState['drawOffers'] = {}
	const startingState: G.RootGameState = {
		drawOffers,
		gameConfig: {
			variant: 'regular',
			timeControl: 'unlimited',
			increment: '0',
			fischerRandomSeed: -1,
		},
		outcome: undefined,
		activeGameId: gameId,
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
	const bot = new StockfishBot()
	void bot.initialize()

	const context = new VsAIContext(store, bot)
	const game = new G.Game(gameId, context, startingState.gameConfig)
	G.setGame(game)

	if (context.botParticipant.color === 'white') {
		bot.makeMove(game.state).then((candidateMove) => {
			game.makeMoveProgrammatic(candidateMove, BOT_ID)
		})
	}

	createEffect(
		on(
			() => game.stateSignal(),
			(state) => {
				const board = GL.getBoard(state)
				if (board.toMove !== context.botParticipant.color || game.outcome) return
				bot.makeMove(state).then((candidateMove) => {
					game.makeMoveProgrammatic(candidateMove, BOT_ID)
				})
			}
		)
	)
}

export class VsAIContext implements G.RootGameContext {
	sub = new Subscription()

	constructor(
		public sharedStore: SS.SharedStore<G.RootGameState, object, G.GameEvent>,
		private bot: Bot
	) {}

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
		return this.sharedStore.event$.pipe(
			concatMap((event) => {
				if (event.type === 'game-over' || event.type === 'new-game') return [event as G.GameEventWithDetails]
				const participant = Object.values(unwrap(this.rollbackState.gameParticipants)).find((p) => {
					//@ts-expect-error
					return p.id === event.playerId
				})!
				if (!participant) throw new Error('Participant not found')
				const participantWithDetails = {
					...participant,
					name: this.members.find((m) => m.id === participant.id)!.name,
				}
				return [
					{
						...event,
						participant: participantWithDetails,
					} as G.GameEventWithDetails,
				]
			})
		)
	}

	configureNewGame() {
		throw new Error('Method not implemented.')
	}

	get state() {
		return this.sharedStore.lockstepState
	}

	get rollbackState() {
		return this.sharedStore.rollbackState
	}
}
