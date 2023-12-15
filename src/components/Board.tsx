import {batch, createEffect, createSignal, onMount} from "solid-js";
import * as G from '../systems/game.ts'
import {makeMove} from '../systems/game.ts'

function resolvePieceImagePath(piece: G.Piece) {
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

        for (let [square, piece] of Object.entries(G.game.board.pieces)) {
            if (square === grabbedSquare()) {
                continue
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
        // if (R.room.players.has(playerId) && G.getPlayerColor(P.player().id) === 'black')  {
        //     setBoardFlipped(true)
        // }


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
                    makeMove(clickedSquare()!, hoveredSquare()!)
                    setClickedSquare(null)
                } else if (hoveredSquare() && G.game.board.pieces[hoveredSquare()!]) {
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
                    makeMove(_grabbedSquare!, square)
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
        } else if (hoveredSquare() && G.game.board.pieces[hoveredSquare()!]) {
            canvas.style.cursor = 'grab'
        } else {
            canvas.style.cursor = 'default'
        }
    })


    createEffect(() => {
        console.log({grabbedSquareMousePos: grabbedSquareMousePos()})
    })

    return <div class="flex flex-col justify-center items-center">
        {canvas}
        <span>{grabbedSquareMousePos()?.x}, {grabbedSquareMousePos()?.y}</span>
        <span>{squareSize}</span>
        <button onclick={() => setBoardFlipped(!boardFlipped())}>flip</button>
    </div>
}