import { until } from '@solid-primitives/promise'
import { createEffect, createRoot, getOwner } from 'solid-js'

import * as M from './components/utils/Modal.tsx'
import * as SS from './sharedStore/sharedStore.ts'
import * as Errors from './systems/errors.ts'
import * as G from './systems/game/game.ts'
import * as GL from './systems/game/gameLogic.ts'
import * as Pieces from './systems/piece.tsx'
import * as P from './systems/player.ts'
import * as R from './systems/room.ts'

const appConsole = {
	R,
	G,
	P,
	M,
	GL,
	Pieces: Pieces,
	Errors,
	SS,
	game: null as G.Game | null,
	room: R.room(),
	boardView: null as null | BV.BoardView,
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
	// @ts-expect-error
	window.App = appConsole
	// @ts-expect-error
	window.Utils = utils
}

createRoot(() => {
	createEffect(() => {
		appConsole.room = R.room()
	})
})
