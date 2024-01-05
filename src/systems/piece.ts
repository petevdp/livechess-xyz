import * as GL from './game/gameLogic.ts'

export function resolvePieceImagePath(piece: GL.ColoredPiece) {
	const abbrs = {
		pawn: 'p',
		knight: 'n',
		bishop: 'b',
		rook: 'r',
		queen: 'q',
		king: 'k',
	}
	const color = piece.color == 'white' ? 'l' : 'd'

	return `/pieces/${abbrs[piece.type]}${color}t45.svg`
}

export function loadImage(src: string) {
	return new Promise<HTMLImageElement>((resolve) => {
		const img = new Image()
		img.src = src
		img.onload = () => {
			resolve(img)
		}
	})
}
