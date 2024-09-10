import deepEquals from 'fast-deep-equal'
import { Accessor } from 'solid-js'

//#region primitives

export const PIECES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king', 'duck'] as const
export const PIECES_NO_DUCK = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const
export type Piece = (typeof PIECES)[number]
export type PieceNoDuck = (typeof PIECES_NO_DUCK)[number]
export const PROMOTION_PIECES = ['knight', 'bishop', 'rook', 'queen'] as const
export type PromotionPiece = (typeof PROMOTION_PIECES)[number]
export const COLORS = ['white', 'black'] as const
export type PieceColors = (typeof COLORS)[number] | 'duck'
export type Color = (typeof COLORS)[number]
export type ColoredPiece = {
	readonly color: PieceColors
	readonly type: (typeof PIECES)[number]
}

type Timestamp = number

export type SelectedMove = {
	from: string
	to: string
	disambiguation?: MoveDisambiguation
	duck?: string
}

// TODO type declarations here should be deduped
export type Move = {
	from: string
	to: string
	piece: Piece
	castle?: 'king' | 'queen'
	promotion?: PromotionPiece
	enPassant?: string
	check?: boolean
	capture: boolean
	checkmate?: boolean
	algebraic: string
	duck?: string
	algebraicNotationAmbiguity: ('rank' | 'file')[]
	ts: Timestamp
}

export type CandidateMove = {
	from: Coords
	to: Coords
	piece: Piece
	castle?: 'king' | 'queen'
	enPassant?: string
	algebraicNotationAmbiguity: ('rank' | 'file')[]
	promotion?: PromotionPiece
}

export type CandidateMoveOptions = {
	from: Coords
	to: Coords
	piece: Piece
	castle?: 'king' | 'queen'
	enPassant?: string
	promotion?: PromotionPiece
}

export type MoveDisambiguation =
	| {
			type: 'promotion'
			piece: PromotionPiece
	  }
	| {
			type: 'castle'
			castling: boolean
	  }

export function getStartPos(config: GameConfig) {
	if (config.variant === 'fischer-random') {
		// https://en.wikipedia.org/wiki/Fischer_random_chess_numbering_scheme
		let lineup: Piece[]
		//#region generate random lineup
		{
			function remainingIndexes(lineup: (Piece | null)[]) {
				return lineup.map((piece, index) => (piece === null ? [index] : [])).flat()
			}

			let fischerNumber = config.fischerRandomSeed
			const _lineup: (Piece | null)[] = Array(8).fill(null)

			// bishop
			const lightBishopFile = fischerNumber % 4
			_lineup[lightBishopFile * 2 + 1] = 'bishop'
			fischerNumber = Math.floor(fischerNumber / 4)
			const darkBishopFile = fischerNumber % 4
			_lineup[darkBishopFile * 2] = 'bishop'
			fischerNumber = Math.floor(fischerNumber / 4)

			const queenNum = fischerNumber % 6
			let freeIndexes = remainingIndexes(_lineup)
			_lineup[freeIndexes[queenNum]] = 'queen'
			fischerNumber = Math.floor(fischerNumber / 6)
			// can do programatically but bleh
			const knightTable = [
				[0, 1],
				[0, 2],
				[0, 3],
				[0, 4],
				[1, 2],
				[1, 3],
				[1, 4],
				[2, 3],
				[2, 4],
				[3, 4],
			]

			freeIndexes = remainingIndexes(_lineup)
			_lineup[freeIndexes[knightTable[fischerNumber][0]]] = 'knight'
			_lineup[freeIndexes[knightTable[fischerNumber][1]]] = 'knight'
			freeIndexes = remainingIndexes(_lineup)
			_lineup[freeIndexes[0]] = 'rook'
			_lineup[freeIndexes[1]] = 'king'
			_lineup[freeIndexes[2]] = 'rook'
			lineup = _lineup as Piece[]
		}
		//#endregion

		const pieces: Board['pieces'] = {}
		lineup.forEach((piece, index) => {
			pieces[notationFromCoords({ x: index, y: 1 })] = { color: 'white', type: 'pawn' }
			pieces[notationFromCoords({ x: index, y: 0 })] = { color: 'white', type: piece }
			pieces[notationFromCoords({ x: index, y: 6 })] = { color: 'black', type: 'pawn' }
			pieces[notationFromCoords({ x: index, y: 7 })] = { color: 'black', type: piece }
		})
		return { pieces, toMove: 'white' } as Board
	}
	return {
		pieces: {
			a1: { color: 'white', type: 'rook' },
			b1: { color: 'white', type: 'knight' },
			c1: { color: 'white', type: 'bishop' },
			d1: { color: 'white', type: 'queen' },
			e1: { color: 'white', type: 'king' },
			f1: { color: 'white', type: 'bishop' },
			g1: { color: 'white', type: 'knight' },
			h1: { color: 'white', type: 'rook' },
			a2: { color: 'white', type: 'pawn' },
			b2: { color: 'white', type: 'pawn' },
			c2: { color: 'white', type: 'pawn' },
			d2: { color: 'white', type: 'pawn' },
			e2: { color: 'white', type: 'pawn' },
			f2: { color: 'white', type: 'pawn' },
			g2: { color: 'white', type: 'pawn' },
			h2: { color: 'white', type: 'pawn' },

			a8: { color: 'black', type: 'rook' },
			b8: { color: 'black', type: 'knight' },
			c8: { color: 'black', type: 'bishop' },
			d8: { color: 'black', type: 'queen' },
			e8: { color: 'black', type: 'king' },
			f8: { color: 'black', type: 'bishop' },
			g8: { color: 'black', type: 'knight' },
			h8: { color: 'black', type: 'rook' },
			a7: { color: 'black', type: 'pawn' },
			b7: { color: 'black', type: 'pawn' },
			c7: { color: 'black', type: 'pawn' },
			d7: { color: 'black', type: 'pawn' },
			e7: { color: 'black', type: 'pawn' },
			f7: { color: 'black', type: 'pawn' },
			g7: { color: 'black', type: 'pawn' },
			h7: { color: 'black', type: 'pawn' },
		},
		toMove: 'white',
	} as Board
}

export function getFischerRandomSeed() {
	return Math.floor(Math.random() * 960)
}

//#endregion

//#region QUACK

export const DUCK = { type: 'duck', color: 'duck' } satisfies ColoredPiece
//#endregion

//#region organization
export type GameOutcome = {
	winner: 'white' | 'black' | null
	reason:
		| 'checkmate'
		| 'stalemate'
		| 'insufficient-material'
		| 'threefold-repetition'
		| 'resigned'
		| 'draw-accepted'
		| 'flagged'
		| 'king-captured'
}

export const VARIANTS = ['regular', 'fog-of-war', 'duck', 'fischer-random'] as const
export type Variant = (typeof VARIANTS)[number]

export const VARIANTS_ALLOWING_SELF_CHECKS = ['fog-of-war', 'duck'] as Variant[]
export const TIME_CONTROLS = ['15m', '10m', '5m', '3m', '1m', 'unlimited'] as const
export type TimeControl = (typeof TIME_CONTROLS)[number]
export const INCREMENTS = ['0', '1', '2', '5'] as const
export type Increment = (typeof INCREMENTS)[number]
export type GameConfig = {
	variant: Variant
	timeControl: TimeControl
	increment: Increment
	fischerRandomSeed: number
	bot?: {
		difficulty: number
	}
}

export type ParsedGameConfig = {
	variant: Variant
	// all times are in ms
	timeControl: number | null
	increment: number
}
export const getDefaultGameConfig = (): GameConfig => ({
	variant: 'regular',
	timeControl: '5m',
	increment: '0',
	fischerRandomSeed: getFischerRandomSeed(),
})

export type GameState = {
	players: { [id: string]: Color }
	boardHistory: BoardHistoryEntry[]
	moveHistory: MoveHistory
}

export type Board = {
	pieces: { [square: string]: ColoredPiece }
	toMove: Color
}
export type MoveHistory = Move[]
export type BoardHistoryEntry = { board: Board }
export type Coords = {
	x: number
	y: number
}

function hashMove(move: Move): string {
	return JSON.stringify(move)
}

export function useBoardHistory(moves: Accessor<Move[]>, startingBoard: Board) {
	let moveHashes: string[] = []
	let boardHistory: BoardHistoryEntry[] = [{ board: startingBoard }]
	return () => getBoardHistory(moves())

	function getBoardHistory(_moves: Move[]) {
		const movesList = _moves
		let i = 0
		let firstNewMoveHash: string | null = null
		for (; i < movesList.length; i++) {
			const move = movesList[i]
			if (i + 1 === boardHistory.length) break
			const moveHash = hashMove(move)
			const lastHash = moveHashes[i]
			if (lastHash !== moveHash) {
				boardHistory = boardHistory.slice(0, i + 1)
				moveHashes = moveHashes.slice(0, i)
				firstNewMoveHash = moveHash
				break
			}
		}
		const newMoves = movesList.slice(i)
		for (const move of newMoves) {
			let moveHash: string
			if (firstNewMoveHash) {
				moveHash = firstNewMoveHash
				firstNewMoveHash = null
			} else {
				moveHash = hashMove(move)
			}
			const lastBoard = boardHistory[boardHistory.length - 1].board
			const [newBoard] = applyMoveToBoard(move, lastBoard, move.duck)
			moveHashes.push(moveHash)
			boardHistory.push({ board: newBoard })
		}
		return boardHistory
	}
}

//#endregion

//#region move conversions
export function coordsFromNotation(notation: string) {
	return {
		x: notation[0].charCodeAt(0) - 'a'.charCodeAt(0),
		y: parseInt(notation[1]) - 1,
	} as Coords
}

export function notationFromCoords(coords: Coords) {
	return String.fromCharCode('a'.charCodeAt(0) + coords.x) + (coords.y + 1)
}

export function candidateMoveToSelectedMove(move: CandidateMove): SelectedMove {
	let disambiguation: MoveDisambiguation | undefined
	if (move.promotion) {
		disambiguation = { type: 'promotion', piece: move.promotion }
	} else if (move.castle) {
		disambiguation = { type: 'castle', castling: true }
	}
	return {
		from: notationFromCoords(move.from),
		to: notationFromCoords(move.to),
		disambiguation,
	} satisfies SelectedMove
}

export function getMoveHistoryAsNotation(history: MoveHistory) {
	const moves: [string, string | null][] = []
	for (let i = 0; i < Math.ceil(history.length / 2); i++) {
		const whiteMove = history[i * 2].algebraic
		if (i * 2 + 1 >= history.length) {
			moves.push([whiteMove, null])
			break
		}
		const blackMove = history[i * 2 + 1].algebraic
		moves.push([whiteMove, blackMove])
	}
	return moves
}

function candidateMoveToMove(candidateMove: CandidateMove, capture?: boolean, check?: boolean, checkmate?: boolean, duck?: string): Move {
	const algebraic = (() =>
		// get algebraic notation for move
		{
			const pieceStr = candidateMove.piece === 'pawn' ? '' : toShortPieceName(candidateMove.piece)
			const captureStr = capture ? 'x' : ''
			const toStr = notationFromCoords(candidateMove.to)
			const promotionStr = candidateMove.promotion ? '=' + candidateMove.promotion.toUpperCase() : ''
			const checkStr = check ? '+' : ''
			const checkmateStr = checkmate ? '#' : ''

			if (candidateMove.castle) {
				return candidateMove.castle === 'queen' ? 'O-O-O' : 'O-O'
			}

			let disambiguation = ''
			for (const type of candidateMove.algebraicNotationAmbiguity) {
				if (type === 'rank') {
					disambiguation += notationFromCoords(candidateMove.from).charAt(1)
				} else if (type === 'file') {
					disambiguation += notationFromCoords(candidateMove.from).charAt(0)
				}
			}

			return pieceStr + disambiguation + captureStr + toStr + promotionStr + checkStr + checkmateStr
		})()

	return {
		from: notationFromCoords(candidateMove.from),
		to: notationFromCoords(candidateMove.to),
		piece: candidateMove.piece,
		castle: candidateMove.castle,
		promotion: candidateMove.promotion,
		enPassant: candidateMove.enPassant,
		ts: Date.now(),
		capture: capture ?? false,
		check: check ?? false,
		checkmate: checkmate,
		duck,
		algebraic,
		algebraicNotationAmbiguity: candidateMove.algebraicNotationAmbiguity,
	} satisfies Move
}

function moveToCandidateMove(move: Move): CandidateMove {
	return {
		from: coordsFromNotation(move.from),
		to: coordsFromNotation(move.to),
		piece: move.piece,
		castle: move.castle,
		enPassant: move.enPassant,
		promotion: move.promotion,
		algebraicNotationAmbiguity: move.algebraicNotationAmbiguity,
	} satisfies CandidateMove
}

//#endregion

//#region game status

export function checkmated(game: GameState, variant: Variant) {
	return inCheck(getBoard(game)) && noMoves(game, variant)
}

export function kingCaptured(board: Board) {
	const piece = { color: board.toMove, type: 'king' } satisfies ColoredPiece
	return !findPiece(piece, board)
}

function stalemated(game: GameState, variant: Variant) {
	return !inCheck(getBoard(game)) && noMoves(game, variant)
}

function threefoldRepetition(game: GameState) {
	if (game.boardHistory.length === 0) return false
	const currentBoard = game.boardHistory[game.boardHistory.length - 1].board
	const dupeCount = game.boardHistory.filter(({ board }) => deepEquals(board, currentBoard)).length
	return dupeCount == 3
}

// https://support.chess.com/article/128-what-does-insufficient-mating-material-mean
function insufficientMaterial(game: GameState) {
	function getPieceCount(color: Color) {
		return Object.values(getBoard(game).pieces).filter((piece) => piece.color === color).length
	}

	const totalPieces = { white: getPieceCount('white'), black: getPieceCount('black') } satisfies Record<Color, number>
	const insufficient = { white: false, black: false }
	for (const color of Object.values(game.players)) {
		if (totalPieces[color] === 1) {
			insufficient[color] = true
		}
		const pieceCounts = new Map<Piece, number>()
		for (const piece of Object.values(getBoard(game).pieces)) {
			if (piece.color !== color) continue
			const key = piece.type
			pieceCounts.set(key, (pieceCounts.get(key) || 0) + 1)
		}
		if (totalPieces[color] === 2) {
			if (pieceCounts.get('bishop') === 1 || pieceCounts.get('knight') === 1) {
				insufficient[color] = true
			}
		}
		if (totalPieces[color] === 3) {
			if (pieceCounts.get('knight') === 2) {
				insufficient[color] = totalPieces[oppositeColor(color)] === 1
			}
		}
	}

	return insufficient.white && insufficient.black
}

export function getBoard(game: GameState) {
	return game.boardHistory[game.boardHistory.length - 1].board
}

export function getGameOutcome(state: GameState, config: ParsedGameConfig) {
	let winner: GameOutcome['winner']
	let reason: GameOutcome['reason']
	if (!VARIANTS_ALLOWING_SELF_CHECKS.includes(config.variant) && checkmated(state, config.variant)) {
		winner = oppositeColor(getBoard(state).toMove)
		reason = 'checkmate'
	} else if (VARIANTS_ALLOWING_SELF_CHECKS.includes(config.variant) && kingCaptured(getBoard(state))) {
		winner = oppositeColor(getBoard(state).toMove)
		reason = 'king-captured'
	} else if (stalemated(state, config.variant)) {
		winner = null
		reason = 'stalemate'
	} else if (insufficientMaterial(state)) {
		winner = null
		reason = 'insufficient-material'
	} else if (threefoldRepetition(state)) {
		winner = null
		reason = 'threefold-repetition'
	} else {
		// we handle flags externally
		return null
	}
	return { winner, reason } as GameOutcome
}

//#endregion

//#region move application

// returns new board and  returns null if move is invalid
export function validateAndPlayMove(move: SelectedMove, game: GameState, variant: Variant) {
	if (!getBoard(game).pieces[move.from] || getBoard(game).pieces[move.from].color !== getBoard(game).toMove) {
		return
	}

	if (move.from === move.to) {
		return
	}

	const candidateMoves = getLegalMoves([coordsFromNotation(move.from)], game, variant)
	// handle cases where multiple moves match a from/to square pairing
	const candidates = candidateMoves.filter((m) => {
		if (notationFromCoords(m.to) !== move.to) return false
		if (move.disambiguation?.type === 'promotion') {
			return m.promotion === move.disambiguation.piece
		}
		if (move.disambiguation?.type === 'castle') {
			return !!m.castle === move.disambiguation.castling
		}
		return true
	})
	const candidate = candidates[0]
	const isCapture = !!getBoard(game).pieces[move.to] || candidate.enPassant
	const [newBoard] = applyMoveToBoard(candidate, getBoard(game))
	const checkmate = !VARIANTS_ALLOWING_SELF_CHECKS.includes(variant) && checkmated(game, variant)
	return {
		board: newBoard,
		move: candidateMoveToMove(candidate, isCapture, inCheck(newBoard), checkmate, move.duck),
	}
}

// board should already have been modified by whatever move we're making this turn
export function validateDuckPlacement(duck: string, board: Board) {
	return !board.pieces[duck]
}

// Uncritically apply a move to the board. Does not mutate input.
function applyMoveToBoard(move: CandidateMove | Move, board: Board, duckSquare?: string) {
	const _move = (typeof move.from === 'string' ? moveToCandidateMove(move as Move) : move) as CandidateMove
	const piece = board.pieces[notationFromCoords(_move.from)]
	const newBoard = JSON.parse(JSON.stringify(board)) as Board
	const moveToCoords = notationFromCoords(_move.to)
	newBoard.pieces[moveToCoords] = piece
	const moveFromCoords = notationFromCoords(_move.from)
	delete newBoard.pieces[moveFromCoords]
	newBoard.pieces[moveToCoords] = piece

	if (duckSquare) {
		for (const [square, piece] of Object.entries(newBoard.pieces)) {
			if (piece.type === 'duck') {
				delete newBoard.pieces[square]
				break
			}
		}
	}

	if (_move.castle) {
		// move rook
		const { rookLeft, rookRight } = findBackRankRooks(board, board.toMove)
		const rank = board.toMove === 'white' ? 0 : 7
		const direction = _move.to.x === 6 ? 1 : -1
		const currentRookSquare = notationFromCoords(direction === 1 ? rookRight! : rookLeft!)
		if (notationFromCoords(_move.to) !== currentRookSquare) {
			if (direction === 1) {
				delete newBoard.pieces[currentRookSquare]
			} else {
				delete newBoard.pieces[currentRookSquare]
			}
		}
		const endingRookFile = direction === 1 ? 5 : 3
		newBoard.pieces[notationFromCoords({ x: endingRookFile, y: rank })] = {
			color: board.toMove,
			type: 'rook',
		}
	}
	if (_move.enPassant) {
		const enPassantCapture = {
			x: _move.to.x,
			y: _move.from.y,
		} satisfies Coords
		delete newBoard.pieces[notationFromCoords(enPassantCapture)]
	}
	let promoted = false
	if (piece.type === 'pawn' && (_move.to.y === 0 || _move.to.y === 7)) {
		newBoard.pieces[moveToCoords] = {
			color: board.toMove,
			type: _move.promotion || 'queen',
		}
		promoted = true
	}

	if (duckSquare) {
		for (const [square, piece] of Object.entries(newBoard.pieces)) {
			if (piece.type === 'duck') {
				delete newBoard.pieces[square]
				break
			}
		}
	}
	if (duckSquare && !newBoard.pieces[duckSquare]) {
		newBoard.pieces[duckSquare] = DUCK
	}
	newBoard.toMove = board.toMove === 'white' ? 'black' : 'white'
	return [newBoard, promoted] as const
}

//#endregion

//#region move generation

export function getLegalMoves(piecePositions: Coords[], game: GameState, variant: Variant): CandidateMove[] {
	let candidateMoves: CandidateMove[] = []
	const allowSelfChecks = VARIANTS_ALLOWING_SELF_CHECKS.includes(variant)

	for (const start of piecePositions) {
		const piece = getBoard(game).pieces[notationFromCoords(start)]
		if (piece.color !== getBoard(game).toMove) {
			continue
		}
		candidateMoves = [...candidateMoves, ...getMovesFromCoords(start, getBoard(game), game.moveHistory, piece, true, allowSelfChecks)]
	}

	findMoveAmbiguitiesInPlace(candidateMoves)

	if (!allowSelfChecks) {
		candidateMoves = candidateMoves.filter((move) => {
			const [newBoard] = applyMoveToBoard(move, getBoard(game))
			newBoard.toMove = getBoard(game).toMove
			return !inCheck(newBoard)
		})
	}

	return candidateMoves
}

function getMovesFromCoords(
	coords: Coords,
	board: Board,
	history: MoveHistory,
	piece: ColoredPiece | null = null,
	checkCastling: boolean = true,
	allowSelfChecks: boolean = false
) {
	const _piece = piece ?? board.pieces[notationFromCoords(coords)]
	if (_piece.color !== board.toMove) {
		return []
	}
	switch (_piece.type) {
		case 'pawn':
			return pawnMoves(coords, board, history)
		case 'knight':
			return knightMoves(coords, board)
		case 'bishop':
			return bishopMoves(coords, board)
		case 'rook':
			return rookMoves(coords, board)
		case 'queen':
			return [...rookMoves(coords, board), ...bishopMoves(coords, board)]
		case 'king':
			return kingMoves(coords, board, history, checkCastling, allowSelfChecks)
		case 'duck':
			throw new Error('quack?')
		default:
			throw new Error('invalid piece type')
	}
}

function pawnMoves(start: Coords, board: Board, history: MoveHistory) {
	let moves: CandidateMove[] = []
	const direction = board.toMove === 'white' ? 1 : -1
	const onStartingRank = (board.toMove === 'white' && start.y === 1) || (board.toMove === 'black' && start.y === 6)
	const promotingRank = board.toMove === 'white' ? 6 : 1

	type Options = Omit<Omit<CandidateMoveOptions, 'from'>, 'piece'>
	const addMove = (options: Options) => {
		moves.push(
			newCandidateMove({
				from: start,
				piece: 'pawn',
				...options,
			})
		)
	}
	const addMoves = (options: Options[]) => {
		for (const option of options) {
			addMove(option)
		}
	}

	// forward moves
	{
		const [_moves, _terminateReason] = castLegalMoves(
			start,
			{
				x: 0,
				y: direction,
			},
			onStartingRank ? 2 : 1,
			board
		)
		if (_terminateReason === 'capture') {
			_moves.pop()
		}
		addMoves(_moves.map((m) => ({ to: m })))
	}

	// diagonal capture right
	{
		const [_moves, _terminateReason] = castLegalMoves(start, { x: 1, y: direction }, 1, board)
		if (_terminateReason === 'capture') {
			addMoves(_moves.map((m) => ({ to: m, capture: true })))
		}
	}

	// diagonal capture left
	{
		const [_moves, _terminateReason] = castLegalMoves(start, { x: -1, y: direction }, 1, board)
		if (_terminateReason === 'capture') {
			addMoves(_moves.map((m) => ({ to: m })))
		}
	}

	if (promotingRank === start.y) {
		const movesWithPromotions: CandidateMove[] = []
		for (const move of moves) {
			for (const promotion of PROMOTION_PIECES) {
				movesWithPromotions.push({ ...move, promotion })
			}
		}
		moves = movesWithPromotions
	}

	// en passant
	;(() => {
		const lastMove = history[history.length - 1]
		if (!lastMove || lastMove.piece !== 'pawn') {
			return
		}
		const movedTwoRanks = Math.abs(parseInt(lastMove.from[1]) - parseInt(lastMove.to[1])) === 2
		const lastMoveX = coordsFromNotation(lastMove.to).x
		const lastMoveY = coordsFromNotation(lastMove.to).y
		const isHorizontallyAdjacent = Math.abs(start.x - lastMoveX) === 1 && start.y === lastMoveY
		const destinationSquarePiece = board.pieces[notationFromCoords({ x: lastMoveX, y: lastMoveY + direction })]
		if (
			movedTwoRanks &&
			isHorizontallyAdjacent &&
			(!destinationSquarePiece || destinationSquarePiece.color === oppositeColor(board.toMove))
		) {
			addMove({
				to: { x: lastMoveX, y: lastMoveY + direction },
				enPassant: notationFromCoords({ x: lastMoveX, y: lastMoveY }),
			})
		}
	})()

	return moves
}

// annotate moves if there's an ambiguity relevant to expressing the move in algebraic notation, so we don't have to do as much work elsewhere
function findMoveAmbiguitiesInPlace(moves: CandidateMove[]) {
	const rankAmbiguities = new Map<string, CandidateMove[]>()
	const fileAmbiguities = new Map<string, CandidateMove[]>()

	function updateAmbiguityMap(map: Map<string, CandidateMove[]>, key: string, move: CandidateMove) {
		let moves: CandidateMove[] = []
		if (map.has(key)) {
			moves = map.get(key)!
		} else {
			map.set(key, moves)
		}
		if (moves.find((m) => m.from === move.from)) return
		moves.push(move)
	}

	// group by combination of move type and destination square
	for (const move of moves) {
		updateAmbiguityMap(rankAmbiguities, `${move.piece}:${move.to.y}`, move)
		updateAmbiguityMap(fileAmbiguities, `${move.piece}:${move.to.x}`, move)
	}

	for (const moves of rankAmbiguities.values()) {
		if (moves.length === 1) continue
		for (const move of moves) {
			move.algebraicNotationAmbiguity.push('rank')
		}
	}

	for (const moves of fileAmbiguities.values()) {
		if (moves.length === 1) continue
		for (const move of moves) {
			move.algebraicNotationAmbiguity.push('file')
		}
	}
}

function newCandidateMove(options: CandidateMoveOptions) {
	options.promotion ??= undefined
	const move = options as CandidateMove
	move.algebraicNotationAmbiguity = []
	return move
}

function knightMoves(start: Coords, board: Board) {
	let moves: Coords[] = []
	const directions = [
		[1, 2],
		[2, 1],
		[-1, 2],
		[-2, 1],
		[1, -2],
		[2, -1],
		[-1, -2],
		[-2, -1],
	]

	for (const direction of directions) {
		const [_moves] = castLegalMoves(start, { x: direction[0], y: direction[1] }, 1, board)
		moves = [...moves, ..._moves]
	}
	return moves.map((m) =>
		newCandidateMove({
			from: start,
			to: m,
			piece: 'knight',
		})
	)
}

function bishopMoves(start: Coords, board: Board) {
	let moves: Coords[] = []
	const directions = [
		[1, 1],
		[-1, 1],
		[1, -1],
		[-1, -1],
	]

	for (const direction of directions) {
		const [_moves] = castLegalMoves(start, { x: direction[0], y: direction[1] }, 8, board)
		moves = [...moves, ..._moves]
	}
	return moves.map((m) => newCandidateMove({ from: start, to: m, piece: 'bishop' }))
}

function rookMoves(start: Coords, board: Board) {
	let moves: Coords[] = []
	const directions = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	]

	for (const direction of directions) {
		const [_moves] = castLegalMoves(start, { x: direction[0], y: direction[1] }, 8, board)
		moves = [...moves, ..._moves]
	}
	return moves.map((m) => newCandidateMove({ from: start, to: m, piece: 'rook' }))
}

function findBackRankRooks(board: Board, color: Color) {
	let rookLeft = null as Coords | null
	let rookRight = null as Coords | null
	const rank = color === 'white' ? 0 : 7
	let passedKing = false
	for (let i = 0; i < 8; i++) {
		const square = notationFromCoords({ x: i, y: rank })
		const piece = board.pieces[square]
		if (piece?.type === 'king' && piece.color === color) {
			passedKing = true
			continue
		}
		if (piece?.type === 'rook' && piece.color === color) {
			if (!passedKing) rookLeft = { x: i, y: rank } satisfies Coords
			else {
				rookRight = { x: i, y: rank } satisfies Coords
				break
			}
		}
	}
	return { rookLeft, rookRight }
}

function kingMoves(start: Coords, board: Board, moveHistory: MoveHistory, checkCastling: boolean, allowSelfChecks: boolean) {
	let moves: Coords[] = []
	const directions = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
		[1, 1],
		[-1, -1],
		[-1, 1],
		[1, -1],
	]

	for (const direction of directions) {
		const [_moves] = castLegalMoves(start, { x: direction[0], y: direction[1] }, 1, board)
		moves = [...moves, ..._moves]
	}

	const candidateMoves: CandidateMove[] = moves.map((m) =>
		newCandidateMove({
			from: start,
			to: m,
			piece: 'king',
		})
	)

	if (!checkCastling) return candidateMoves
	const rank = board.toMove === 'white' ? 0 : 7

	// we need to look up the rook positions here to account for fischer random
	const { rookLeft, rookRight } = findBackRankRooks(board, board.toMove)

	const eligibleRooks = [] as Coords[]
	if (squarePartOfMove(start, moveHistory)) {
		return candidateMoves
	}
	const sideDirections: ('a' | 'h')[] = []
	if (rookLeft && !squarePartOfMove(rookLeft, moveHistory)) {
		eligibleRooks.push(rookLeft)
		sideDirections.push('a')
	}
	if (rookRight && !squarePartOfMove(rookRight, moveHistory)) {
		eligibleRooks.push(rookRight)
		sideDirections.push('h')
	}

	for (let i = 0; i < eligibleRooks.length; i++) {
		// most of the compexity in here is due to having to account for fischer random rules
		const direction = sideDirections[i]
		const rook = eligibleRooks[i]

		const newKingSquare = {
			x: direction === 'h' ? 6 : 2,
			y: rank,
		} satisfies Coords
		let valid = true
		let kingMovementDirection = newKingSquare.x - start.x
		// normalize to t or -1
		if (kingMovementDirection !== 0) {
			kingMovementDirection = kingMovementDirection / Math.abs(kingMovementDirection)
			for (let i = start.x; i != newKingSquare.x + kingMovementDirection; i += kingMovementDirection) {
				const square = { x: i, y: rank } satisfies Coords
				// we can move through the rook
				if (
					(board.pieces[notationFromCoords(square)] && !deepEquals(square, rook) && !deepEquals(square, start)) ||
					(!allowSelfChecks && squareAttacked(square, board))
				) {
					valid = false
					break
				}
			}
		}
		if (!valid) {
			continue
		}

		const newRookSquare = {
			x: direction === 'h' ? 5 : 3,
			y: rank,
		}
		let rookMovementDirection = newRookSquare.x - rook.x
		if (rookMovementDirection !== 0) {
			// normalize to t or -1
			rookMovementDirection = rookMovementDirection / Math.abs(rookMovementDirection)
			for (let i = rook.x; i != newRookSquare.x + rookMovementDirection; i += rookMovementDirection) {
				const square: Coords = { x: i, y: rank }
				if (board.pieces[notationFromCoords(square)] && !deepEquals(square, start) && !deepEquals(square, rook)) {
					valid = false
					break
				}
			}
		}

		if (!valid) {
			continue
		}

		candidateMoves.push(
			newCandidateMove({
				from: start,
				to: newKingSquare,
				piece: 'king',
				castle: direction === 'a' ? 'queen' : 'king',
			})
		)
	}

	return candidateMoves
}

//#endregion

//#region move helpers
function squarePartOfMove(coords: Coords, history: MoveHistory) {
	const notation = notationFromCoords(coords)
	return history.some((move) => move.from === notation || move.to === notation)
}

type TerminateReason = 'piece' | 'bounds' | 'capture' | 'max'

function castLegalMoves(start: Coords, direction: Coords, max: number, board: Board) {
	const moves: Coords[] = []
	let coords = start
	let terminateReason = 'max' satisfies TerminateReason
	for (let i = 0; i < max; i++) {
		coords = { x: coords.x + direction.x, y: coords.y + direction.y }
		if (!inBounds(coords)) {
			terminateReason = 'bounds'
			break
		}
		const piece = board.pieces[notationFromCoords(coords)]
		if ((piece && piece.color === board.toMove) || piece?.color === 'duck') {
			terminateReason = 'piece'
			break
		}
		moves.push({ ...coords })
		if (piece) {
			terminateReason = 'capture'
			break
		}
	}
	return [moves, terminateReason] as const
}

function inBounds(coords: Coords) {
	return coords.x >= 0 && coords.x < 8 && coords.y >= 0 && coords.y < 8
}

function findPiece(piece: ColoredPiece, board: Board) {
	return Object.keys(board.pieces).find((square) => {
		const _piece = board.pieces[square]!
		return _piece.type === piece.type && _piece.color === piece.color
	})
}

export function inCheck(board: Board) {
	const king = findPiece({ color: board.toMove, type: 'king' }, board)
	if (!king) return false
	return squareAttacked(coordsFromNotation(king), board)
}

function squareAttacked(square: Coords, board: Board) {
	const opponentPieces = [
		...new Set(
			Object.values(board.pieces)
				.filter((piece) => piece.color !== board.toMove && piece.color !== 'duck')
				.map((p) => p.type)
		),
	]
	for (const simulatedPieceType of opponentPieces) {
		const simulatedPiece = {
			color: board.toMove,
			type: simulatedPieceType,
		} as ColoredPiece
		const simulatedMoves = getMovesFromCoords(square, board, [], simulatedPiece, false, true)
		for (const move of simulatedMoves) {
			const attackingPiece = board.pieces[notationFromCoords(move.to)]
			if (attackingPiece && attackingPiece.type === simulatedPieceType) {
				return true
			}
		}
	}
	return false
}

export function getAllLegalMoves(game: GameState, variant: Variant) {
	return getLegalMoves(
		Object.keys(getBoard(game).pieces).map((n) => coordsFromNotation(n)),
		game,
		variant
	)
}

function noMoves(game: GameState, variant: Variant) {
	const legalMoves = getAllLegalMoves(game, variant)
	return legalMoves.length === 0
}

//#endregion

//#region misc
export function hashBoard(board: Board) {
	return JSON.stringify(board)
}

export function oppositeColor(color: Color) {
	return color === 'white' ? 'black' : 'white'
}

//#endregion

//#region parsing
export function timeControlToMs(timeControl: TimeControl) {
	const minutes = parseFloat(timeControl.slice(0, -1))
	return minutes * 60 * 1000
}

export function incrementToMs(increment: Increment) {
	return parseInt(increment) * 1000
}

export function parseGameConfig(config: GameConfig): ParsedGameConfig {
	if (config.timeControl !== 'unlimited') {
		const timeControl = timeControlToMs(config.timeControl)
		const increment = incrementToMs(config.increment)
		return {
			variant: config.variant,
			timeControl,
			increment,
		}
	} else {
		return {
			variant: config.variant,
			timeControl: null,
			increment: 0,
		}
	}
}

//#endregion

export function toShortPieceName(piece: Piece) {
	if (piece === 'knight') {
		return 'N'
	}
	return piece[0].toUpperCase()
}

const shortToLong: Record<string, PieceNoDuck> = {
	N: 'knight',
	K: 'king',
	Q: 'queen',
	R: 'rook',
	B: 'bishop',
	P: 'pawn',
}

export function toLongPieceName(piece: string) {
	return shortToLong[piece]
}

// https://en.wikipedia.org/wiki/Algebraic_notation_(chess)
export function isPlayerTurn(board: Board, color: Color) {
	return board.toMove === color
}

//#region fog of war
export function getVisibleSquares(game: GameState, color: Color) {
	const board = getBoard(game)

	let simulated: GameState
	const playerPieces: [string, ColoredPiece][] = []
	const opponentPieces: [string, ColoredPiece][] = []

	for (const [square, piece] of Object.entries(board.pieces)) {
		if (piece.color === color) {
			playerPieces.push([square, piece])
		} else {
			opponentPieces.push([square, piece])
		}
	}

	if (getBoard(game).toMove === color) {
		simulated = game
	} else {
		simulated = JSON.parse(JSON.stringify(game)) as GameState
		const noopSquareAndPiece = opponentPieces.find(([_, piece]) => piece.type === 'king')!
		// in this case the game is over, and we'll be revealing all squares anyway
		if (!noopSquareAndPiece) return new Set()
		const [noopSquare, noopPiece] = noopSquareAndPiece
		const noopCoords = coordsFromNotation(noopSquare)
		const candidateMove = {
			from: noopCoords,
			to: noopCoords,
			piece: noopPiece.type,
			algebraicNotationAmbiguity: [],
		} satisfies CandidateMove
		const [newBoard] = applyMoveToBoard(candidateMove, getBoard(game))

		simulated.boardHistory.push({ board: newBoard })
		simulated.moveHistory.push(candidateMoveToMove(candidateMove))
	}

	const visibleSquares = new Set<string>()
	for (const [notation] of playerPieces) {
		visibleSquares.add(notation)
	}
	const coords = playerPieces.map(([notation]) => coordsFromNotation(notation))
	const candidateMoves = getLegalMoves(coords, simulated, 'fog-of-war')
	for (const move of candidateMoves) {
		visibleSquares.add(notationFromCoords(move.to))
		if (move.enPassant) {
			visibleSquares.add(move.enPassant)
		}

		if (move.castle) {
			const rank = color === 'white' ? 0 : 7
			const startingRookFile = move.to.x === 2 ? 0 : 7
			const endingRookFile = move.to.x === 2 ? 3 : 5
			for (let i = startingRookFile; i <= endingRookFile; i++) {
				visibleSquares.add(notationFromCoords({ x: i, y: rank }))
			}
		}
	}
	return visibleSquares
}

//#endregion
