
//#region primitives
export const PIECES = ["pawn", "knight", "bishop", "rook", "queen", "king"] as const
export type Piece = typeof PIECES[number]
export const PROMOTION_PIECES = ["knight", "bishop", "rook", "queen"] as const
export const COLORS = ["white", "black"] as const
export type Color = typeof COLORS[number]
export type ColoredPiece = {
    color: Color
    type: typeof PIECES[number]
}
export type Move = {
    from: string
    to: string
    piece: ColoredPiece
    castle: boolean
    promotion?: ColoredPiece
    ts: number
}
//#endregion

//#region organization
export type GameNoGetters = {
    status: GameStatus
    winner: Color | null
    moveHistory: MoveHistory
    boardHistory: BoardHistory
    players: { [id: string]: Color }
}

export type Game = GameNoGetters & {
    board: Board,
    lastMove: Move
}


export type Board = {
    pieces: {
        [squad: string]: ColoredPiece
    },
    toMove: Color
}
export type MoveHistory = Move[]
export type BoardHistory = [string, Board][]
export type Coords = {
    x: number;
    y: number;
}


//#endregion

//#region move conversions
export function coordsFromNotation(notation: string) {
    return {
        x: notation[0].charCodeAt(0) - 'a'.charCodeAt(0),
        y: parseInt(notation[1]) - 1
    } as Coords
}

export function notationFromCoords(coords: Coords) {
    return String.fromCharCode('a'.charCodeAt(0) + coords.x) + (coords.y + 1)
}


export function candidateMoveToMove(candidateMove: CandidateMove, promotion?: ColoredPiece): Move {
    return {
        from: notationFromCoords(candidateMove.from),
        to: notationFromCoords(candidateMove.to),
        piece: candidateMove.piece,
        castle: candidateMove.castle,
        promotion: promotion,
        ts: Date.now()
    } satisfies Move
}

//#region


//#region game status

export type GameStatus =
    'pregame'
    | 'in-progress'
    | 'checkmate'
    | 'stalemate'
    | 'threefold-repetition'
    | 'insufficient-material'
    | 'draw-agreed'
    | 'timeout'
    | 'resigned'
export function inCheck(game: Game) {
    return _inCheck(game.board)
}
export function checkmated(game: Game) {
    return inCheck(game) && noMoves(game)
}

export function stalemated(game: Game) {
    return !inCheck(game) && noMoves(game)
}

export function threefoldRepetition(game: Game) {
    if (game.boardHistory.length === 0) return false
    const currentHash = game.boardHistory[game.boardHistory.length - 1][0];
    const dupeCount = game.boardHistory.filter(([hash]) => hash === currentHash).length;
    return dupeCount == 3
}

export function insufficientMaterial(game: Game) {
    for (let piece of Object.values(game.board.pieces)) {
        if (piece.type === 'pawn' || piece.type === 'rook' || piece.type === 'queen') {
            return false
        }
    }
    return true
}

//#endregion

//#region move application
export function applyMoveToGame(from: string, to: string, game: Game, promotion?: Piece) {
    if (game.board.pieces[from].color !== game.board.toMove) {
        return
    }

    if (from === to) {
        return
    }
    const candidateMoves = getLegalMoves([coordsFromNotation(from)], game.board, game.moveHistory)
    const candidate = candidateMoves.find(m => notationFromCoords(m.to) === to)
    if (!candidate) {
        return
    }
    const move = candidateMoveToMove(candidate)
    const [newBoard, promoted] = applyMoveToBoard(candidate, game.board, promotion)

    return {
        board: newBoard,
        move,
        promoted
    }
}

function applyMoveToBoard(move: CandidateMove, board: Board, promotion?: Piece) {
    const piece = board.pieces[notationFromCoords(move.from)]
    const newBoard = JSON.parse(JSON.stringify(board)) as Board
    let moveToCoords = notationFromCoords(move.to);
    newBoard.pieces[moveToCoords] = piece
    let moveFromCoords = notationFromCoords(move.from);
    delete newBoard.pieces[moveFromCoords]
    newBoard.pieces[moveToCoords] = piece
    if (move.castle) {
        // move rook
        const rank = board.toMove === 'white' ? 0 : 7
        const startingRookFile = move.to.x === 2 ? 0 : 7
        const endingRookFile = move.to.x === 2 ? 3 : 5
        delete newBoard.pieces[notationFromCoords({x: startingRookFile, y: rank})]
        newBoard.pieces[notationFromCoords({x: endingRookFile, y: rank})] = {color: board.toMove, type: 'rook'}
    }
    if (move.enPassant) {
        const enPassantCapture = {x: move.to.x, y: move.from.y} satisfies Coords
        delete newBoard.pieces[notationFromCoords(enPassantCapture)]
    }
    let promoted = false;
    if (piece.type === 'pawn' && (move.to.y === 0 || move.to.y === 7)) {
        newBoard.pieces[moveToCoords] = {color: board.toMove, type: promotion || 'queen'}
        promoted = true
    }

    newBoard.toMove = board.toMove === 'white' ? 'black' : 'white';
    return [newBoard, promoted] as const
}

//#endregion

//#region move generation

type CandidateMove = {
    from: Coords,
    to: Coords,
    piece: ColoredPiece,
    castle: boolean,
    enPassant: boolean,
    promotion?: ColoredPiece
}

type CandidateMoveOptions = {
    from: Coords,
    to: Coords,
    piece: ColoredPiece,
    castle?: boolean,
    enPassant?: boolean,
    promotion?: ColoredPiece
}


export function getLegalMoves(piecePositions: Coords[], board: Board, history: MoveHistory): CandidateMove[] {
    let candidateMoves: CandidateMove[] = []


    for (const start of piecePositions) {

        const piece = board.pieces[notationFromCoords(start)]
        if (piece.color !== board.toMove) {
            continue
        }
        candidateMoves = [...candidateMoves, ...(getMovesFromCoords(start, board, history, piece))]
    }

    candidateMoves = candidateMoves.filter((move) => {
        const [newBoard] = applyMoveToBoard(move, board)
        newBoard.toMove = board.toMove
        return !_inCheck(newBoard)
    })

    return candidateMoves
}


function getMovesFromCoords(coords: Coords, board: Board, history: MoveHistory, piece: ColoredPiece | null = null, checkCastling: boolean = true) {
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
            return kingMoves(coords, board, history, checkCastling)
        default:
            throw new Error('invalid piece type')
    }
}

function pawnMoves(start: Coords, board: Board, history: MoveHistory) {
    let moves: CandidateMove[] = []
    let direction = board.toMove === 'white' ? 1 : -1
    const onStartingRank = board.toMove === 'white' && start.y === 1 || board.toMove === 'black' && start.y === 6
    const promotingRank = board.toMove === 'white' ? 6 : 1

    type Options = Omit<Omit<CandidateMoveOptions, 'from'>, 'piece'>
    const addMove = (options: Options) => {
        moves.push(newCandidateMove({
            from: start,
            piece: {color: board.toMove, type: 'pawn'},
            ...options
        }))
    }
    const addMoves = (options: Options[]) => {
        for (let option of options) {
            addMove(option)
        }
    }

    // forward moves
    {
        const [_moves, _terminateReason] = castLegalMoves(start, {
            x: 0,
            y: direction
        }, onStartingRank ? 2 : 1, board)
        if (_terminateReason === 'capture') {
            _moves.pop()
        }
        addMoves(_moves.map(m => ({to: m})))
    }

    // diagonal capture right
    {
        const [_moves, _terminateReason] = castLegalMoves(start, {x: 1, y: direction}, 1, board)
        if (_terminateReason === 'capture') {
            addMoves(_moves.map(m => ({to: m, capture: true})))
        }
    }

    // diagonal capture left
    {
        const [_moves, _terminateReason] = castLegalMoves(start, {x: -1, y: direction}, 1, board)
        if (_terminateReason === 'capture') {
            addMoves(_moves.map(m => ({to: m})))
        }
    }

    if (promotingRank === start.y) {
        const movesWithPromotions = []
        for (let move of moves) {
            for (let promotion of PIECES.filter(p => p !== 'pawn' && p !== 'king')) {
                movesWithPromotions.push({...move, promotion: {color: board.toMove, type: promotion}})
            }
        }
        moves = movesWithPromotions
    }


    // en passant
    (() => {
        const lastMove = history[history.length - 1]
        if (!lastMove || lastMove.piece.type !== 'pawn') {
            return
        }
        const movedTwoRanks = Math.abs(parseInt(lastMove.from[1]) - parseInt(lastMove.to[1])) === 2
        let lastMoveX = coordsFromNotation(lastMove.to).x;
        let lastMoveY = coordsFromNotation(lastMove.to).y;
        const isHorizontallyAdjacent = Math.abs(start.x - lastMoveX) === 1 && start.y === lastMoveY
        if (movedTwoRanks && isHorizontallyAdjacent) {
            addMove({
                to: {x: lastMoveX, y: lastMoveY + direction},
                enPassant: true
            })
        }
    })();

    return moves
}

function newCandidateMove(options: CandidateMoveOptions) {
    options.promotion ??= undefined
    options.enPassant ??= false
    options.castle ??= false
    return options as CandidateMove
}

function knightMoves(start: Coords, board: Board) {
    let moves: Coords[] = []
    const directions = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]

    for (let direction of directions) {
        const [_moves] = castLegalMoves(start, {x: direction[0], y: direction[1]}, 1, board)
        moves = [...moves, ..._moves]
    }
    return moves.map(m => newCandidateMove({
        from: start,
        to: m,
        piece: {color: board.toMove, type: 'knight'},
    })) as CandidateMove[]
}


function bishopMoves(start: Coords, board: Board) {
    let moves: Coords[] = []
    const directions = [[1, 1], [-1, 1], [1, -1], [-1, -1]]

    for (let direction of directions) {
        const [_moves] = castLegalMoves(start, {x: direction[0], y: direction[1]}, 8, board)
        moves = [...moves, ..._moves]
    }
    return moves.map(m => newCandidateMove({from: start, to: m, piece: {color: board.toMove, type: 'bishop'},}))
}


function rookMoves(start: Coords, board: Board) {
    let moves: Coords[] = []
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]]

    for (let direction of directions) {
        const [_moves] = castLegalMoves(start, {x: direction[0], y: direction[1]}, 8, board)
        moves = [...moves, ..._moves]
    }
    return moves.map(m => newCandidateMove({from: start, to: m, piece: {color: board.toMove, type: 'rook'}}))
}

function kingMoves(start: Coords, board: Board, history: MoveHistory, checkCastling: boolean) {
    let moves: Coords[] = []
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [-1, 1], [1, -1]]

    for (let direction of directions) {
        const [_moves] = castLegalMoves(start, {x: direction[0], y: direction[1]}, 1, board)
        moves = [...moves, ..._moves]
    }

    const candidateMoves: CandidateMove[] = moves.map(m => newCandidateMove({
        from: start,
        to: m,
        piece: {color: board.toMove, type: 'king'}
    }))

    const rank = board.toMove === 'white' ? 0 : 7
    const rookDirections = [] as Coords[]
    const rookA = {x: 0, y: rank} satisfies Coords
    const rookH = {x: 7, y: rank} satisfies Coords
    const eligibleRooks = [] as Coords[]
    if (pieceHasMoved(start, history)) {
        return candidateMoves
    }

    if (!pieceHasMoved(rookA, history)) {
        eligibleRooks.push(rookA)
        rookDirections.push({x: -1, y: 0} satisfies Coords)
    }
    if (!pieceHasMoved(rookH, history)) {
        eligibleRooks.push(rookH)
        rookDirections.push({x: 1, y: 0} satisfies Coords)
    }

    if (!checkCastling) return candidateMoves;

    for (let i = 0; i < eligibleRooks.length; i++) {
        const direction = rookDirections[i]
        const rook = eligibleRooks[i]
        const [_moves, termination] = castLegalMoves(start, direction, 8, board)
        const beforeRook = {x: rook.x - direction.x, y: rook.y} satisfies Coords
        const movesNotation = _moves.map(m => notationFromCoords(m))

        const newKingSquare = {x: start.x + direction.x * 2, y: start.y} satisfies Coords
        const kingSquares: Coords[] = [];
        for (let i = 0; i < 3; i++) {
            kingSquares.push({x: start.x + i * direction.x, y: start.y} satisfies Coords)
        }
        const noChecksInKingPath = kingSquares.every(n => !squareAttacked(n, board))
        const castlingSquaresClear = movesNotation.includes(notationFromCoords(beforeRook)) && termination !== 'capture';

        if (!castlingSquaresClear || !noChecksInKingPath) {
            continue;
        }

        candidateMoves.push(newCandidateMove({
            from: start,
            to: newKingSquare,
            piece: {color: board.toMove, type: 'king'},
            castle: true
        }))
    }

    return candidateMoves
}

//#endregion

//#region move helpers
function pieceHasMoved(coords: Coords, history: MoveHistory) {
    return history.some(move => move.from === notationFromCoords(coords))
}

type TerminateReason = 'piece' | 'bounds' | 'capture' | 'max'

function castLegalMoves(start: Coords, direction: Coords, max: number, board: Board) {
    let moves: Coords[] = []
    let coords = start
    let terminateReason = 'max' satisfies TerminateReason
    for (let i = 0; i < max; i++) {
        coords = {x: coords.x + direction.x, y: coords.y + direction.y}
        if (!inBounds(coords)) {
            terminateReason = 'bounds'
            break
        }
        const piece = board.pieces[notationFromCoords(coords)]
        if (piece && piece.color === board.toMove) {
            terminateReason = 'piece'
            break;
        }
        moves.push({...coords})
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
    return Object.entries(board.pieces).find(([_, _piece]) => _piece?.type === piece.type && _piece.color === piece.color)![0]
}

function _inCheck(board: Board) {
    const king = coordsFromNotation(findPiece({color: board.toMove, type: 'king'}, board))
    return squareAttacked(king, board)
}


function squareAttacked(square: Coords, board: Board) {
    const opponentPieces = [...new Set(Object.values(board.pieces).filter((piece) => piece.color !== board.toMove).map(p => p.type))]
    for (let simulatedPieceType of opponentPieces) {
        const simulatedPiece = {color: board.toMove, type: simulatedPieceType} as ColoredPiece
        const simulatedMoves = getMovesFromCoords(square, board, [], simulatedPiece, false)
        for (let move of simulatedMoves) {
            const attackingPiece = board.pieces[notationFromCoords(move.to)]
            if (attackingPiece && attackingPiece.type === simulatedPieceType) {
                return true
            }
        }
    }
    return false;
}

function noMoves(game: Game) {
    let legalMoves = getLegalMoves(Object.keys(game.board.pieces).map(n => coordsFromNotation(n)), game.board, game.moveHistory);
    return legalMoves.length === 0;
}

//#endregion

