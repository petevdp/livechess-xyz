import {createStore, produce} from "solid-js/store";
import {createEffect, createRoot, createSignal} from "solid-js";
import * as GL from "./gameLogic.ts";
import {Piece} from "./gameLogic.ts";

export const VARIANTS = ["regular", "fog-of-war", "duck", "fischer-random"] as const
export type Variant = typeof VARIANTS[number]
export const TIME_CONTROLS = ["15m", "10m", "5m", "3m", "1m"] as const
export type TimeControl = typeof TIME_CONTROLS[number]
export const INCREMENTS = ["0", "1", "2", "3", "5", "10"] as const
export type Increment = typeof INCREMENTS[number]


export type GameConfig = {
    variant: Variant,
    timeControl: TimeControl,
    increment: Increment
}


const startPos = () => ({
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
} as GL.Board)

function getNewGame(player1: string, player2: string, board?: GL.Board): GL.GameNoGetters {
    return {
        status: 'pregame',
        winner: null,
        moveHistory: [],
        boardHistory: [toBoardHistoryEntry(board || startPos())],
        players: {[player1]: 'white', [player2]: 'black'},
    }
}

export const [game, setGame] = createStore({
    ...getNewGame('player1', 'player2'),
    get board() {
        return this.boardHistory[this.boardHistory.length - 1][1]
    },
    get lastMove() {
        return this.moveHistory[this.moveHistory.length - 1]
    }
} as GL.Game)

type PromotionSelection = {
    status: 'selecting'
    from: string
    to: string
} | {
    from: string
    to: string
    status: 'selected'
    piece: typeof GL.PIECES[number]
}
export const [promotionSelection, setPromotionSelection] = createSignal<null | PromotionSelection>(null)

createRoot(() => {
    createEffect(() => {

        setGame(produce((s) => {
            if (GL.checkmated(game)) {
                s.status = 'checkmate'
                s.winner = game.board.toMove === 'white' ? 'black' : 'white'
            } else if (GL.stalemated(game)) {
                s.status = 'stalemate'
            } else if (GL.insufficientMaterial(game)) {
                s.status = 'insufficient-material'
            } else if (GL.threefoldRepetition(game)) {
                s.status = 'threefold-repetition'
            }
        }))
    })

    createEffect(() => {
        if (game.moveHistory.length > 0 && game.status === 'pregame') {
            setGame('status', 'in-progress')
        }
    })

    createEffect(() => {
        if (game.status === 'in-progress' && game.moveHistory.length === 0) {
            setGame('status', 'pregame')
        }
    })

    // handle promotion
    createEffect(() => {
        const _promotionSelection = promotionSelection()
        if (_promotionSelection && _promotionSelection.status === 'selected') {
            tryMakeMove(_promotionSelection.from, _promotionSelection.to, _promotionSelection.piece)
            setPromotionSelection(null)
        }
    })
})

export function newGame(player1: string, player2: string, gameStartPosition: GL.Board | null = null) {
    console.log('creating new game')
    let board = gameStartPosition || startPos();
    setGame(getNewGame(player1, player2, board))
}


export function tryMakeMove(from: string, to: string, promotion?: Piece) {
    console.log(`attempting move ${from} -> ${to}`)
    if (!isPlayerTurn()) return
    let result = GL.applyMoveToGame(from, to, game, promotion)
    let _promotionSelection = promotionSelection();
    if (!result || _promotionSelection != null && _promotionSelection.status === 'selecting') return

    if (result.promoted && !_promotionSelection && !promotion) {
        setPromotionSelection({status: 'selecting', from, to})
        return
    }

    console.log(`committing move ${from} -> ${to}`)
    setGame(produce(((state) => {
        state.boardHistory.push(toBoardHistoryEntry(result!.board))
        state.moveHistory.push(result!.move)
    })))
}

export function toBoardHistoryEntry(board: GL.Board) {
    return [JSON.stringify(board), board] as [string, GL.Board]
}

export const playForBothSides = true;
export const playerColor = () => game.players['player1']
export const isPlayerTurn = () => (game.board.toMove === playerColor() || playForBothSides) && isPlaying()


export function isPlaying() {
    return game.status === 'in-progress' || game.status === 'pregame'
}


// uncritically makes a move on the board

