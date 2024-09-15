import { For, createEffect, onMount } from 'solid-js'

import * as BVC from '~/systems/boardViewContext.ts'
import * as GL from '~/systems/game/gameLogic.ts'
import * as Pieces from '~/systems/piece.tsx'

const board = GL.getStartPos({ variant: 'regular', timeControl: '5m', increment: '0', fischerRandomSeed: 222 })

export function Board() {
	onMount(() => {
		document.getElementById('loader')?.remove()
		document.getElementById('root')?.classList.remove('hidden')
		document.querySelector('body')?.classList.remove('loading')
	})
	const squareSize = 100
	const boardSize = () => squareSize * 8
	const boardFlipped = false
	const pieces = () => Object.entries(board.pieces) as [string, GL.ColoredPiece][]
	return (
		<div class="bg-board-brown" style={{ width: `${boardSize()}px`, height: `${boardSize()}px` }}>
			<For each={pieces()}>
				{([square, piece]) => {
					return <Piece boardFlipped={boardFlipped} square={square} squareSize={squareSize} piece={piece} />
				}}
			</For>
		</div>
	)
}
