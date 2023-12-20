import * as R from './systems/room.ts'
import * as G from './systems/game/game.ts'
import * as P from './systems/player.ts'
import {createEffect, createRoot, getOwner} from "solid-js";

const appConsole = {
	Room: R,
	Game: G,
	Player: P,
}

const utils = {
	createRoot,
	getOwner,
	createEffect
}

export type AppConsole = typeof appConsole;
export type UtilsConsole = typeof utils;

if (window) {
	// @ts-ignore
	window.App = appConsole;
	// @ts-ignore
	window.Utils = utils;
}
