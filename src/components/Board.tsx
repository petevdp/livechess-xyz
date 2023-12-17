import {batch, createEffect, createSignal, onMount, Show} from "solid-js";
import * as G from '../systems/game/game.ts'
import * as GL from '../systems/game/gameLogic.ts'
import {ColoredPiece} from '../systems/game/gameLogic.ts'

function resolvePieceImagePath(piece: ColoredPiece) {
    const abbrs = {
        'pawn': 'p',
        'knight': 'n',
        'bishop': 'b',
        'rook': 'r',
        'queen': 'q',
        'king': 'k'
    }
    const color = piece.color == 'white' ? 'l' : 'd'

    return `/pieces/${abbrs[piece.type]}${color}t45.svg`
}


export function Board() {
    const [boardFlipped, setBoardFlipped] = createSignal(false)


    const canvas = <canvas width={600} height={600}/> as HTMLCanvasElement
    const squareSize = canvas.width / 8
    const [hoveredSquare, setHoveredSquare] = createSignal(null as null | string)
    const [grabbedSquare, setGrabbedSquare] = createSignal(null as null | string)
    const [clickedSquare, setClickedSquare] = createSignal(null as null | string)
    const [grabbedSquareMousePos, setGrabbedSquareMousePos] = createSignal(null as null | { x: number, y: number })

    let imageCache: Record<string, HTMLImageElement> = {}

    const player = 'player1';
    const playerColor = () => G.game.players[player]

    function loadImage(src: string) {
        return new Promise<HTMLImageElement>((resolve) => {
            const img = new Image()
            img.src = src
            img.onload = () => {
                resolve(img)
            }
        })
    }


    function render() {
        const ctx = canvas.getContext('2d')!

        // set background to light brown
        ctx.fillStyle = '#eaaa69'
        ctx.fillRect(0, 0, canvas.width, canvas.height)


        // fill in squars as dark brown
        const highlightColor = '#aff682';



        ctx.fillStyle = '#a05a2c'
        if (!boardFlipped()) {
            for (let i = 0; i < 8; i++) {
                for (let j = i % 2; j < 8; j += 2) {
                    ctx.fillRect(j * squareSize, i * squareSize, squareSize, squareSize)
                }
            }
        } else {
            for (let i = 0; i < 8; i++) {
                for (let j = (i + 1) % 2; j < 8; j += 2) {
                    ctx.fillRect(j * squareSize, i * squareSize, squareSize, squareSize)
                }
            }
        }

        const highlightedSquares =  G.game.moveHistory.length > 0 ? [G.game.lastMove.from, G.game.lastMove.to] : []
        for (let square of highlightedSquares) {
            if (!square) continue
            let x = square[0].charCodeAt(0) - 'a'.charCodeAt(0)
            let y = 8 - parseInt(square[1])
            if (boardFlipped()) {
                x = 7 - x
                y = 7 - y
            }
            ctx.fillStyle = highlightColor
            ctx.fillRect(x * squareSize, y * squareSize, squareSize, squareSize)
        }


        for (let [square, piece] of Object.entries(G.game.board.pieces)) {
            if (square === grabbedSquare()) {
                continue
            }
            const _promotionSelection = G.promotionSelection()
            if (_promotionSelection && _promotionSelection.status === 'selecting' && _promotionSelection.to === square) {
                continue
            }

            if (_promotionSelection && _promotionSelection.status === 'selecting' && _promotionSelection.from === square) {
                square = _promotionSelection.to
            }


            let x = square[0].charCodeAt(0) - 'a'.charCodeAt(0)
            let y = 8 - parseInt(square[1])
            if (boardFlipped()) {
                x = 7 - x
                y = 7 - y
            }
            ctx.drawImage(imageCache[resolvePieceImagePath(piece)], x * squareSize, y * squareSize, squareSize, squareSize)
        }

        if (grabbedSquare() && grabbedSquareMousePos()) {
            let x = grabbedSquareMousePos()!.x
            let y = grabbedSquareMousePos()!.y
            ctx.drawImage(imageCache[resolvePieceImagePath(G.game.board.pieces[grabbedSquare()!]!)], x - squareSize / 2, y - squareSize / 2, squareSize, squareSize)
        }
        requestAnimationFrame(render)
    }

    onMount(async () => {
        if (playerColor() === 'black') {
            setBoardFlipped(true)
        }


        function getSquareFromCoords(x: number, y: number) {
            let col = Math.floor(x / squareSize)
            let row = Math.floor(y / squareSize)
            if (boardFlipped()) {
                col = 7 - col
                row = 7 - row
            }

            return String.fromCharCode('a'.charCodeAt(0) + col) + (8 - row)
        }


        // track mouse

        canvas.addEventListener('mousemove', (e) => {
            batch(() => {
                const rect = canvas.getBoundingClientRect()
                const x = e.clientX - rect.left
                const y = e.clientY - rect.top
                // check if mouse is over a square with a piece
                setHoveredSquare(getSquareFromCoords(x, y))
                if (grabbedSquare()) {
                    setGrabbedSquareMousePos({x, y})
                }
            })
        })

        canvas.addEventListener('mousedown', (e) => {
            batch(() => {
                if (clickedSquare() && hoveredSquare() && clickedSquare() !== hoveredSquare()) {
                    G.tryMakeMove(clickedSquare()!, hoveredSquare()!)
                    setClickedSquare(null)
                } else if (hoveredSquare() && G.game.board.pieces[hoveredSquare()!] && (G.playForBothSides || G.game.board.pieces[hoveredSquare()!]!.color === playerColor())) {
                    setGrabbedSquare(hoveredSquare)
                    const rect = canvas.getBoundingClientRect()
                    setGrabbedSquareMousePos({x: e.clientX - rect.left, y: e.clientY - rect.top})
                }
            })
        })

        canvas.addEventListener('mouseup', (e) => {
            batch(() => {
                const rect = canvas.getBoundingClientRect()
                const square = getSquareFromCoords(e.clientX - rect.left, e.clientY - rect.top)
                const _grabbedSquare = grabbedSquare()
                if (_grabbedSquare && _grabbedSquare === hoveredSquare()) {
                    setClickedSquare(square)
                    setGrabbedSquare(null)
                } else if (_grabbedSquare && _grabbedSquare !== hoveredSquare()) {
                    G.tryMakeMove(_grabbedSquare!, square)
                    setGrabbedSquare(null)
                }
            })
        })

        await Promise.all(Object.values(G.game.board.pieces).map(async piece => {
            const src = resolvePieceImagePath(piece)
            imageCache[src] = await loadImage(src)
        }))

        requestAnimationFrame(render)
    })

    // contextually set cursor
    createEffect(() => {
        if (grabbedSquare()) {
            canvas.style.cursor = 'grabbing'
        } else if (hoveredSquare() && G.game.board.pieces[hoveredSquare()!] && (G.playForBothSides || G.game.board.pieces[hoveredSquare()!]!.color === playerColor())) {
            canvas.style.cursor = 'grab'
        } else {
            canvas.style.cursor = 'default'
        }
    })

    const [_pastedPosition, setPastedPosition] = createSignal(null as null | string)
    createEffect(() => {
        if (_pastedPosition()) {
            G.newGame('player1', 'player2', JSON.parse(_pastedPosition()!))
            setPastedPosition(null)
        }
    })

    function copyPosition() {
        return navigator.clipboard.writeText(JSON.stringify(G.game.board))
    }

    function resign() {
        if (!G.isPlaying()) return
        batch(() => {
            G.setGame('status', 'resigned')
            G.setGame('winner', G.game.board.toMove === 'white' ? 'black' : 'white')
        })
    }
    const setPromotion = (piece: GL.Piece) => G.setPromotionSelection(s => ({
        status: 'selected',
        piece,
        from: s!.from,
        to: s!.to
    }));

    return <div class="flex flex-col justify-center items-center">
        {canvas}
        <span>{G.isPlaying() ? `${G.game.board.toMove} to move` : G.game.status + (G.game.winner ? ` ${G.game.winner} wins` : '')}</span>
        <Show when={GL.inCheck(G.game)}>Check!</Show>
        <button onclick={() => setBoardFlipped(!boardFlipped())}>flip</button>
        <button onclick={() => G.newGame('player1', 'player2')}>new game</button>
        <button onclick={() => copyPosition()}>copy game state</button>
        <button onclick={() => resign()}>resign</button>
        <Show when={G.promotionSelection()?.status === 'selecting'}>
            {GL.PROMOTION_PIECES.map(piece => {
                return <button onclick={() => setPromotion(piece)}>{piece}</button>;
            })}
        </Show>
        <textarea class="border-2 border-black" value={_pastedPosition() || ''}
                  oninput={(e) => setPastedPosition(e.currentTarget.value)}/>
    </div>
}
