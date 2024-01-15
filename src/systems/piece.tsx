import { until } from '@solid-primitives/promise';
import { createEffect, createSignal } from 'solid-js';



import bbishop from '~/assets/pieces/bbishop.svg';
import bking from '~/assets/pieces/bking.svg';
import bknight from '~/assets/pieces/bknight.svg';
import bpawn from '~/assets/pieces/bpawn.svg';
import bqueen from '~/assets/pieces/bqueen.svg';
import brook from '~/assets/pieces/brook.svg';
import duck from '~/assets/pieces/duck.svg';
import wbishop from '~/assets/pieces/wbishop.svg';
import wking from '~/assets/pieces/wking.svg';
import wknight from '~/assets/pieces/wknight.svg';
import wpawn from '~/assets/pieces/wpawn.svg';
import wqueen from '~/assets/pieces/wqueen.svg';
import wrook from '~/assets/pieces/wrook.svg';



import * as GL from './game/gameLogic.ts';


const pieces = {
	wqueen,
	wbishop,
	wking,
	wknight,
	wpawn,
	wrook,
	bqueen,
	bbishop,
	bking,
	bknight,
	bpawn,
	brook,
	duck,
}

export const pieceCache = new Map<string, HTMLImageElement>()

export const [squareSize, setSquareSize] = createSignal(32)

// so we can subscribe to when the pieces are updated
export const [pieceChangedEpoch, setPiecedChangedEpoch] = createSignal(0)
export const initialized = () => pieceCache.size > 0

function loadPiece(key: keyof typeof pieces, squareSize: number) {
	const Svg = pieces[key]
	//@ts-ignore
	const svg = (<Svg class="chess-piece" width={squareSize} height={squareSize} />) as HTMLElement
	const xml = new XMLSerializer().serializeToString(svg)
	const image64 = 'data:image/svg+xml;base64,' + btoa(xml)
	return loadImage(image64, 180)
}

export function initPieceSystem() {
	createEffect(() => {
		console.log('updating piece size: ', squareSize())
		let promises: Promise<void>[] = []
		for (const key in pieces) {
			promises.push(
				loadPiece(key as keyof typeof pieces, squareSize()).then((img) => {
					pieceCache.set(key, img)
				})
			)
		}

		if (initialized()) return
		Promise.all(promises).then(() => {
			setPiecedChangedEpoch((epoch) => epoch + 1)
		})
	})
}

function getPieceKey(piece: GL.ColoredPiece) {
	if (piece.type === 'duck') return 'duck'
	const colorPrefix = piece.color === 'white' ? 'w' : 'b'
	return `${colorPrefix}${piece.type}`
}

export function getPieceSrc(piece: GL.ColoredPiece) {
	return `/pieces/${getPieceKey(piece)}.svg`
}

export async function getPiece(piece: GL.ColoredPiece, size?: number) {
	let key = getPieceKey(piece)
	if (!size) {
		await until(() => initialized())
		return pieceCache.get(key)!
	}

	return await loadPiece(key as keyof typeof pieces, size)
}

export function getCachedPiece(piece: GL.ColoredPiece) {
	return pieceCache.get(getPieceKey(piece))!
}

export function loadImage(src: string, size: number) {
	return new Promise<HTMLImageElement>((resolve) => {
		const img = new Image()
		img.width = size
		img.height = size
		img.src = src
		img.onload = () => {
			resolve(img)
		}
	})
}
