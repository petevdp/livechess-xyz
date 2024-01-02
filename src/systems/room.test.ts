import { describe, expect, it } from 'vitest'
import * as R from './room.ts'
import { connectToRoom } from './room.ts'
import { until } from '@solid-primitives/promise'

describe('room', () => {
	it('can be created and connected to', async () => {
		const res = await R.createRoom()
		const room = await connectToRoom(res.networkId, { id: 'player1', name: 'player1' })

		expect(room.rollbackState.status).toBe('pregame')
		expect(room.state.status).toBe('pregame')
		expect(room.sharedStore.initialized()).toBe(true)
		await until(() => room.state.messages.length >= 1)
		expect(room.state.messages[0].text).toContain('player1 has joined')
		room.destroy()
	})
})
