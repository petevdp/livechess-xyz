import * as R from './systems/room.ts'
import * as G from './systems/game/game.ts'
import * as GL from './systems/game/gameLogic.ts'
import * as P from './systems/player.ts'
import * as M from './components/Modal.tsx'
import { createEffect, createRoot, getOwner } from 'solid-js'
import { until } from '@solid-primitives/promise'

const appConsole = {
	R,
	G,
	P,
	M,
	GL,
}

const utils = {
	createRoot,
	getOwner,
	createEffect,
	until,
	unwrap: (i: any) => JSON.parse(JSON.stringify(i)),
}

export type AppConsole = typeof appConsole
export type UtilsConsole = typeof utils

if (window) {
	// @ts-ignore
	window.App = appConsole
	// @ts-ignore
	window.Utils = utils
}

createRoot(() => {
	createEffect(() => {
		// @ts-ignore
		appConsole.room = R.room()
		// @ts-ignore
		appConsole.game = G.game()
	})
})
