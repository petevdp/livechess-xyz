// TODO bring websocket and site serving into vitest
import { AppConsole, UtilsConsole } from '../console.ts'
import { chromium, Page } from 'playwright'

export const visitUrl = 'http://localhost:5173?headless_test=true'

export const browser = await chromium.launch()

export async function getPage(label: string) {
	const context = await browser.newContext()
	const page = await context.newPage()
	page.on('console', (msg) => {
		console.log(`${label}: ${msg.text()}`)
	})
	await page.goto(visitUrl)
	return { context, page }
}

export function createId(size: number) {
	let result = ''
	const characters =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	const charactersLength = characters.length
	let counter = 0
	while (counter < size) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength))
		counter += 1
	}
	return result
}

export async function createRoom(
	roomId: string,
	page: Page,
	playerName: string,
	setupGame = false
) {
	await page.evaluate(
		async (args) => {
			const app = (window as any).App as AppConsole
			const U = (window as any).Utils as UtilsConsole
			await app.P.setupPlayer()
			app.P.setPlayer({ ...app.P.player(), name: args.playerName })

			await U.createRoot(async () => {
				await app.R.connectToRoom(args.roomId, true)
				if (args.setupGame) {
					app.G.setupGame()
				}
			})
		},
		{ roomId, playerName, setupGame }
	)
}

//
// export async function connectToRoom(
// 	roomId: string,
// 	page: Page,
// 	playerName: string,
// 	setupGame = false
// ) {
// 	await page.evaluate(
// 		async (args) => {
// 			const app = (window as any).App as AppConsole
// 			const U = (window as any).Utils as UtilsConsole
// 			await app.Player.setupPlayer()
// 			app.Player.setPlayer({ ...app.Player.player(), name: args.playerName })
//
// 			await U.createRoot(async () => {
// 				await app.Room.connectToRoom(args.roomId)
// 				if (args.setupGame) {
// 					app.Game.setupGame()
// 				}
// 			})
// 		},
// 		{ roomId, playerName, setupGame }
// 	)
// }
