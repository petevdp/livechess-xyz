import { describe, expect, test } from 'vitest'
import { AppConsole, UtilsConsole } from '../console.ts'
import * as T from '../utils/testUtils.ts'

describe('Room', async () => {
	test('Create a room, have a second player connect', async () => {
		const { page: page1 } = await T.getPage()
		const { page: page2 } = await T.getPage()
		const roomId = await page1.evaluate(async () => {
			const app = (window as any).App as AppConsole
			const U = (window as any).Utils as UtilsConsole
			await app.Player.setupPlayer()

			await U.createRoot(async () => {
				await app.Room.createRoom(U.getOwner()!)
			})

			return app.Room.room()?.roomId
		})
		expect(roomId).toBeDefined()

		const roomId2 = await page2.evaluate(async (roomId: string) => {
			const app = (window as any).App as AppConsole
			const U = (window as any).Utils as UtilsConsole
			await app.Player.setupPlayer()

			await U.createRoot(async () => {
				await app.Room.connectToRoom(roomId, U.getOwner()!)
			})

			return app.Room.room()?.roomId
		}, roomId!)

		expect(roomId).toEqual(roomId2)
	})

	test('send messages', async () => {
		const originalMessage = 'Hello World!'
		const { page: sender } = await T.getPage()
		const { page: receiver } = await T.getPage()
		const roomId = await T.createId(6)

		const receiverPromise = receiver.evaluate(async (roomId) => {
			const app = (window as any).App as AppConsole
			const U = (window as any).Utils as UtilsConsole
			await app.Player.setupPlayer()
			app.Player.setPlayer({ ...app.Player.player(), name: 'receiver' })

			await U.createRoot(async () => {
				await app.Room.createRoom(U.getOwner()!, roomId)
			})

			return await new Promise<string>((resolve) => {
				app.Room.room()!.chat.observe((e) => {
					if (e.changes.delta.length == 0) return
					const messages = e.changes.delta
						.filter((c) => c.insert)
						.map((c) => c.insert)
						.flat()
						.filter((m) => m.sender)
					if (messages.length === 0) return
					resolve(messages[0])
				})
			})
		}, roomId)

		await sender.evaluate(
			async ({ roomId, originalMessage }: any) => {
				const app = (window as any).App as AppConsole
				const U = (window as any).Utils as UtilsConsole
				await app.Player.setupPlayer()
				app.Player.setPlayer({ ...app.Player.player(), name: 'sender' })

				await U.createRoot(async () => {
					await app.Room.connectToRoom(roomId, U.getOwner()!)
				})

				app.Room.sendMessage(originalMessage, false)
			},
			{ roomId, originalMessage }
		)

		expect(await receiverPromise).toEqual({
			sender: 'sender',
			text: originalMessage,
		})
	})

	test('start game', async () => {
		const { page: host } = await T.getPage()
		const { page: guest } = await T.getPage()
		const roomId = await T.createId(6)

		const actionPromise = host.evaluate(async (roomId) => {
			const app = (window as any).App as AppConsole
			const U = (window as any).Utils as UtilsConsole
			await app.Player.setupPlayer()
			app.Player.setPlayer({ ...app.Player.player(), name: 'host' })

			await U.createRoot(async () => {
				await app.Room.createRoom(U.getOwner()!, roomId)
			})

			return new Promise((resolve) => {
				app.Room.observeActions((actions) => {
					for (let a of actions) {
						if (a.type === 'new-game') {
							resolve(a)
						}
					}
				})
			})
		}, roomId)

		await guest.evaluate(async (roomId) => {
			const app = (window as any).App as AppConsole
			const U = (window as any).Utils as UtilsConsole
			await app.Player.setupPlayer()
			app.Player.setPlayer({ ...app.Player.player(), name: 'guest' })

			await U.createRoot(async () => {
				await app.Room.connectToRoom(roomId, U.getOwner()!)
			})

			app.Room.startGame()
		}, roomId)

		const action = await actionPromise
		// @ts-ignore
		expect(action.type).toEqual('new-game')
	})
})
