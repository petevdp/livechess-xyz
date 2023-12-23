import { describe, expect, test } from 'vitest'
import { AppConsole, UtilsConsole } from '../console.ts'
import * as T from '../utils/testUtils.ts'
import * as R from './room.ts'
import { firstValueFrom } from 'rxjs'
import { filter } from 'rxjs/operators'

describe('Room', async () => {
	test('Create a room, have a second player connect', async (test) => {
		const { page: page1 } = await T.getPage(`[${test.task.name}]:p1`)
		const { page: page2 } = await T.getPage(`[${test.task.name}]:p2`)
		console.log('p1')
		const roomId = await page1.evaluate(async () => {
			const app = (window as any).App as AppConsole
			await app.P.setupPlayer()
			app.P.setPlayer({ ...app.P.player(), name: 'player1' })
			await app.R.connectToRoom(null, true)
			return app.R.room()?.roomId
		})
		console.log('p2')
		expect(roomId).toBeDefined()

		const roomId2 = await page2.evaluate(async (roomId: string) => {
			const app = (window as any).App as AppConsole
			const U = (window as any).Utils as UtilsConsole
			await app.P.setupPlayer()
			app.P.setPlayer({ ...app.P.player(), name: 'player1' })

			await U.createRoot(async () => {
				await app.R.connectToRoom(roomId)
			})

			return app.R.room()?.roomId
		}, roomId!)

		expect(roomId).toEqual(roomId2)
	})

	test('send messages', async (test) => {
		const originalMessage = 'Hello World!'
		const { page: sender } = await T.getPage(`[${test.task.name}]:sender`)
		const { page: receiver } = await T.getPage(`[${test.task.name}]:receiver`)
		const roomId = T.createId(6)

		const receiverPromise = receiver.evaluate(async (roomId) => {
			const app = (window as any).App as AppConsole
			await app.P.setupPlayer()
			app.P.setPlayer({ ...app.P.player(), name: 'receiver' })
			await app.R.connectToRoom(roomId, true)

			return await new Promise<R.ChatMessage>((resolve) => {
				app.R.room()!.chat.observe((e) => {
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
				await app.P.setupPlayer()
				app.P.setPlayer({ ...app.P.player(), name: 'sender' })

				await app.R.connectToRoom(roomId)

				app.R.sendMessage(originalMessage, false)
			},
			{ roomId, originalMessage }
		)

		const receiverMessage = await receiverPromise
		expect(receiverMessage.text).toEqual(originalMessage)
		expect(receiverMessage.sender).toEqual('sender')
	})

	test('player disconnects', async (test) => {
		const { page: host } = await T.getPage(`[${test.task.name}]:host`)
		const { page: guest } = await T.getPage(`[${test.task.name}]:guest`)
		const roomId = await T.createId(6)

		const hostPromise = host.evaluate(async (roomId) => {
			const app = (window as any).App as AppConsole
			const U = (window as any).Utils as UtilsConsole
			await app.P.setupPlayer()
			app.P.setPlayer({ ...app.P.player(), name: 'host' })

			await app.R.connectToRoom(roomId, true)
			await U.until(
				() => app.R.room()?.players && app.R.room()!.players.size > 1
			)
			await U.until(
				() => app.R.room()?.players && app.R.room()!.players.size === 1
			)

			return app.R.room()!.chat.toArray()
		}, roomId)

		await guest.evaluate(async (roomId) => {
			const app = (window as any).App as AppConsole
			await app.P.setupPlayer()
			app.P.setPlayerName('guest')
			await app.R.connectToRoom(roomId)
		}, roomId)

		await guest.close()
		const messages = await hostPromise
		expect(messages).toEqual('guest')
	})

	test('start game', async (test) => {
		const { page: host } = await T.getPage(`[${test.task.name}]:host`)
		const { page: guest } = await T.getPage(`[${test.task.name}]:guest`)
		const roomId = await T.createId(6)

		const actionPromise = host.evaluate(async (roomId) => {
			const app = (window as any).App as AppConsole
			await app.P.setupPlayer()
			app.P.setPlayer({ ...app.P.player(), name: 'host' })

			await app.R.connectToRoom(roomId, true)

			return await firstValueFrom(
				app.R.observeActions().pipe(filter((a) => a.type === 'new-game'))
			)
		}, roomId)

		await guest.evaluate(async (roomId) => {
			const app = (window as any).App as AppConsole
			const U = (window as any).Utils as UtilsConsole
			await app.P.setupPlayer()
			app.P.setPlayer({ ...app.P.player(), name: 'guest' })

			await U.createRoot(async () => {
				await app.R.connectToRoom(roomId)
			})

			app.R.startGame()
		}, roomId)

		const action = await actionPromise
		// @ts-ignore
		expect(action.type).toEqual('new-game')
	})
})
