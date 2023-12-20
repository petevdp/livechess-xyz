import { beforeEach, describe, expect, test } from 'vitest'
import {
	connectToRoom,
	createId,
	createRoom,
	getPage,
} from '../../utils/testUtils.ts'
import * as G from './game.ts'
import { PromotionPiece } from './gameLogic.ts'
import { Page } from 'playwright'
import { AppConsole } from '../../console.ts'
import { sleep } from '../../utils/time.ts'

async function startGame(
	player1: string,
	player2: string,
	player1Page: Page,
	player2Page: Page
) {
	const roomId = await createId(6)
	await createRoom(roomId, player1Page, player1, true)
	await connectToRoom(roomId, player2Page, player2, true)

	await player1Page.evaluate(async () => {
		const app = (window as any).App as AppConsole
		app.Room.startGame()
	})
}

async function makeMove(
	page: Page,
	from: string,
	to: string,
	promotion?: PromotionPiece
) {
	await page.evaluate(
		async (move) => {
			const app = (window as any).App as AppConsole
			app.Game.tryMakeMove(move.from, move.to, move.promotion)
		},
		{ from, to, promotion }
	)
}

async function getGameState(page: Page) {
	return await page.evaluate(async () => {
		const app = (window as any).App as AppConsole

		// unwrap from proxy obj
		return app.Game.game
	})
}

describe('game', async () => {
	const white = 'player1'
	const black = 'player2'
	let whitePage: Page
	let blackPage: Page

	beforeEach(async () => {
		const res1 = await getPage()
		const res2 = await getPage()
		whitePage = res1.page
		blackPage = res2.page
		await startGame(white, black, whitePage, blackPage)
	})

	test('make a move', async () => {
		const move = { from: 'e2', to: 'e4' }

		const expectedGame = G.buildNewGame(white, black)
		const expectedBoard =
			expectedGame.boardHistory[expectedGame.boardHistory.length - 1][1]
		expectedBoard.pieces['e4'] = expectedBoard.pieces['e2']
		delete expectedBoard.pieces['e2']
		expectedBoard.toMove = 'black'

		await makeMove(whitePage, move.from, move.to)

		const game = await getGameState(blackPage)

		expect(game.boardHistory[game.boardHistory.length - 1][1]).toEqual(
			expectedBoard
		)
		const lastMove = game.moveHistory[game.moveHistory.length - 1]
		expect(lastMove).toHaveProperty('from', move.from)
		expect(lastMove).toHaveProperty('to', move.to)
	})

	test('resign', async () => {
		await whitePage.evaluate(async () => {
			const app = (window as any).App as AppConsole
			app.Room.dispatchAction({ type: 'resign' })
		})

		await sleep(100)
		const game = await getGameState(blackPage)

		expect(game.winner).toEqual('black')
	})
})
