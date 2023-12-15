import {createStore} from "solid-js/store";
import {batch} from "solid-js";

export const VARIANTS = ["regular", "fog-of-war", "duck", "fischer-random"] as const
export type Variant = typeof VARIANTS[number]
export const TIME_CONTROLS = ["15m", "10m", "5m", "3m", "1m"] as const
export type TimeControl = typeof TIME_CONTROLS[number]
export const INCREMENTS = ["0", "1", "2", "3", "5", "10"] as const
export type Increment = typeof INCREMENTS[number]

export const PIECES = ["pawn", "knight", "bishop", "rook", "queen", "king"] as const
export type Piece = {
    color: Color
    type: typeof PIECES[number]
}
export const COLORS = ["white", "black"] as const
export type Color = typeof COLORS[number]

export type GameConfig = {
    variant: Variant,
    timeControl: TimeControl,
    increment: Increment
}


export type Move = {
    from: string
    player: Color
    to: string
    castle: boolean
    ts: number
}

export type Position = {
    pieces: {
        [squad: string]: Piece
    },
    toMove: Color
}

export type History = Move[]


export type Game = {
    board: Position
    history: History
    players: { [id: string]: Color }
}

type Coords = {
    x: number;
    y: number;
}

const startPos: Position = {
    pieces: {
        'a1': {color: 'white', type: 'rook'},
        'b1': {color: 'white', type: 'knight'},
        'c1': {color: 'white', type: 'bishop'},
        'd1': {color: 'white', type: 'queen'},
        'e1': {color: 'white', type: 'king'},
        'f1': {color: 'white', type: 'bishop'},
        'g1': {color: 'white', type: 'knight'},
        'h1': {color: 'white', type: 'rook'},
        'a2': {color: 'white', type: 'pawn'},
        'b2': {color: 'white', type: 'pawn'},
        'c2': {color: 'white', type: 'pawn'},
        'd2': {color: 'white', type: 'pawn'},
        'e2': {color: 'white', type: 'pawn'},
        'f2': {color: 'white', type: 'pawn'},
        'g2': {color: 'white', type: 'pawn'},
        'h2': {color: 'white', type: 'pawn'},

        'a8': {color: 'black', type: 'rook'},
        'b8': {color: 'black', type: 'knight'},
        'c8': {color: 'black', type: 'bishop'},
        'd8': {color: 'black', type: 'queen'},
        'e8': {color: 'black', type: 'king'},
        'f8': {color: 'black', type: 'bishop'},
        'g8': {color: 'black', type: 'knight'},
        'h8': {color: 'black', type: 'rook'},
        'a7': {color: 'black', type: 'pawn'},
        'b7': {color: 'black', type: 'pawn'},
        'c7': {color: 'black', type: 'pawn'},
        'd7': {color: 'black', type: 'pawn'},
        'e7': {color: 'black', type: 'pawn'},
        'f7': {color: 'black', type: 'pawn'},
        'g7': {color: 'black', type: 'pawn'},
        'h7': {color: 'black', type: 'pawn'},
    },
    toMove: 'white'
}

export const [game, setGame] = createStore<Game>({
    players: {player1: 'white', player2: 'black'},
    board: startPos,
    history: [],
})

export function newGame(player1: string, player2: string) {
    setGame({board: startPos, history: [], players: {[player1]: 'white', [player2]: 'black'}})
}

function pieceFromCoords(coords: Coords) {
    return game.board.pieces[notationFromCoords(coords)] as Piece | undefined
}

function coordsFromNotation(notation: string) {
    return {
        x: notation[0].charCodeAt(0) - 'a'.charCodeAt(0),
        y: parseInt(notation[1]) + 1
    } satisfies Coords
}

function notationFromCoords(coords: Coords) {
    return String.fromCharCode('a'.charCodeAt(0) + coords.x) + (coords.y + 1)
}

export function makeMove(from: string, to: string) {
    console.log('making move', from, to)
    batch(() => {
    })

    if (game.board.pieces[from].color !== game.board.toMove) {
        return
    }

    if (from === to) {
        return
    }

    const candidateMoves = getLegalMoves([coordsFromNotation(from)], game.board, game.history)
    const toCoords = coordsFromNotation(to)
    const candidate = candidateMoves.find(m => m.to === toCoords)
    if (candidate) {
        const move: Move = {
            from: from,
            to: candidate.to,
            player: game.board.toMove,
            castle: candidate.castle,
            ts: Date.now()
        }
        batch(() => {
            setGame('history', [...game.history, move])
            if (candidate.castle) {
                const rank = game.board.toMove === 'white' ? 0 : 7
                const startingRookFile = candidate.to.x === 2 ? 0 : 7
                const endingRookFile = candidate.to.x === 2 ? 3 : 5
                const endingKingFile = candidate.to.x === 2 ? 2 : 6

                setGame('board', 'pieces', notationFromCoords({x: startingRookFile, y: rank}), undefined)
                setGame('board', 'pieces', notationFromCoords({x: endingRookFile, y: rank}), {color: game.board.toMove, type: 'rook'})
                setGame('board', 'pieces', notationFromCoords({x: endingKingFile, y: rank}), game.board.pieces[from])
                setGame('board', 'pieces', from, undefined)
            } else {
                setGame('board', 'pieces', to, game.board.pieces[from])
                // @ts-ignore
                setGame('board', 'pieces', from, undefined)
            }
            if (game.board.toMove === 'white') {
                setGame('board', 'toMove', 'black')
            } else {
                setGame('board', 'toMove', 'white')
            }
        })
    }

}

type CandidateMove = { from: Coords, to: Coords, castle: boolean }

function getLegalMoves(piecePositions: Coords[], board: Position, history: History): CandidateMove[] {
    let candidateMoves: CandidateMove[] = []


    function add(moves: CandidateMove[]) {
        candidateMoves = [...candidateMoves, ...moves]
    }

    for (const start of piecePositions) {

        const piece = pieceFromCoords(start)!
        if (piece.color !== board.toMove) {
            continue
        }
        switch (piece.type) {
            case 'pawn':
                add(pawnMoves(start, board))
                break;
            case 'knight':
                add(knightMoves(start, board))
                break;
            case 'bishop':
                add(bishopMoves(start, board))
                break;
            case 'rook':
                add(rookMoves(start, board))
                break;
            case 'queen':
                add([...rookMoves(start, board), ...bishopMoves(start, board)])
                break;
            case 'king':
                add(kingMoves(start, board, history))
                break;
        }
    }
    return candidateMoves
}

function pawnMoves(start: Coords, board: Position) {
    let moves: Coords[] = []
    let direction = board.toMove === 'white' ? 1 : -1

    if (board.toMove === 'white' && start.y === 6 || board.toMove === 'black' && start.y === 1) {
        const [_moves, _terminateReason] = castLegalMoves(start, {x: 0, y: direction * 2}, 2, board)
        if (_terminateReason === 'capture') {
            _moves.pop()
        }
        moves = [...moves, ..._moves]
    }

    {
        const [_moves, _terminateReason] = castLegalMoves(start, {x: 0, y: direction}, 1, board)
        moves = [...moves, ..._moves]
    }

    {
        const [_moves, _terminateReason] = castLegalMoves(start, {x: 1, y: direction}, 1, board)
        if (_terminateReason === 'capture') {
            moves = [...moves, ..._moves]
        }
    }

    {
        const [_moves, _terminateReason] = castLegalMoves(start, {x: -1, y: direction}, 1, board)
        if (_terminateReason === 'capture') {
            moves = [...moves, ..._moves]
        }
    }
    return moves.map(m => ({from: start, to: m, castle: false} satisfies CandidateMove))
}

function knightMoves(start: Coords, board: Position) {
    let moves: Coords[] = []
    const directions = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]

    for (let direction of directions) {
        const [_moves] = castLegalMoves(start, {x: direction[0], y: direction[1]}, 1, board)
        moves = [...moves, ..._moves]
    }
    return moves.map(m => ({from: start, to: m, castle: false} satisfies CandidateMove))
}


function bishopMoves(start: Coords, board: Position) {
    let moves: Coords[] = []
    const directions = [[1, 1], [-1, 1], [1, -1], [-1, -1]]

    for (let direction of directions) {
        const [_moves] = castLegalMoves(start, {x: direction[0], y: direction[1]}, 8, board)
        moves = [...moves, ..._moves]
    }
    return moves.map(m => ({from: start, to: m, castle: false} satisfies CandidateMove))
}


function rookMoves(start: Coords, board: Position) {
    let moves: Coords[] = []
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]]

    for (let direction of directions) {
        const [_moves] = castLegalMoves(start, {x: direction[0], y: direction[1]}, 8, board)
        moves = [...moves, ..._moves]
    }
    return moves.map(m => ({from: start, to: m, castle: false} satisfies CandidateMove))
}

function kingMoves(start: Coords, board: Position, history: History) {
    let moves: Coords[] = []
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [-1, 1], [1, -1]]

    for (let direction of directions) {
        const [_moves] = castLegalMoves(start, {x: direction[0], y: direction[1]}, 1, board)
        moves = [...moves, ..._moves]
    }

    const candidateMoves = moves.map(m => ({from: start, to: m, castle: false} as CandidateMove))

    const rank = board.toMove === 'white' ? 0 : 7
    const rookDirections = [] as Coords[]
    const rookA = {x: 1, y: rank} satisfies Coords
    const rookH = {x: 6, y: rank} satisfies Coords
    const rooks = [] as Coords[]
    if (pieceHasMoved(start, history)) {
        return candidateMoves
    }

    if (!pieceHasMoved(rookA, history)) {
        rooks.push(rookA)
        rookDirections.push({x: -1, y: 0} satisfies Coords)
    }
    if (!pieceHasMoved(rookH, history)) {
        rooks.push(rookA)
        rookDirections.push({x: 1, y: 0} satisfies Coords)
    }

    for (let i = 0; i < rooks.length; i++) {
        const direction = rookDirections[i]
        const rook = rooks[i]
        const [_moves, termination] = castLegalMoves(start, direction, 8, board)
        const beforeRook = {x: rook.x - direction.x, y: rook.y} satisfies Coords
        const movesNotation = _moves.map(m => notationFromCoords(m))
        if (movesNotation.includes(notationFromCoords(beforeRook)) && termination !== 'capture') {
            candidateMoves.push({
                from: start,
                to: {y: rank, x: start.x + direction.x * 2},
                castle: true
            } satisfies CandidateMove)
        }
    }

    return candidateMoves
}

function pieceHasMoved(coord: Coords, history: History) {
    return history.some(move => move.from === notationFromCoords(coord))
}

type TerminateReason = 'piece' | 'bounds' | 'capture' | 'max'

function castLegalMoves(start: Coords, direction: Coords, max: number, board: Position) {
    let moves: Coords[] = []
    let coords = start
    let terminateReason = 'max' satisfies TerminateReason
    for (let i = 0; i < max; i++) {
        coords = {x: coords.x + direction.x, y: coords.y + direction.y}
        if (!inBounds) {
            terminateReason = 'bounds'
            break
        }
        const piece = pieceFromCoords(coords)
        if (piece && piece.color === board.toMove) {
            terminateReason = 'piece'
            break;
        }
        moves.push(coords)
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
