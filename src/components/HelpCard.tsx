import { Match, ParentProps, Switch } from 'solid-js'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog.tsx'
import * as GL from '~/systems/game/gameLogic.ts'

import styles from './HelpCard.module.scss'

function DuckChess() {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Duck Chess</DialogTitle>
				<DialogDescription>
					Modified Excerpt from{' '}
					<a href="https://en.wikipedia.org/wiki/List_of_chess_variants#Duck_Chess">
						https://en.wikipedia.org/wiki/List_of_chess_variants#Duck_Chess
					</a>
				</DialogDescription>
			</DialogHeader>
			<p>
				In addition to the usual pieces, the two players have joint control of a small rubber duck which acts as a “blocker” (i.e. nothing
				can move onto or through it), and which must be moved to a new square after every turn.{' '}
			</p>
			<p>
				The goal is to successfully capture the opponent’s king. A stalemated player wins. (But since it is legal to move your King into
				check it is almost impossible to get stalemated.)
			</p>
		</>
	)
}

function FogOfWar() {
	return (
		<article>
			<DialogHeader>
				<DialogTitle>Fog of War Chess</DialogTitle>
				<DialogDescription>
					Excerpt from <a href="https://www.chess.com/variants/fog-of-war">https://www.chess.com/variants/fog-of-war</a>
				</DialogDescription>
			</DialogHeader>
			<p>
				Each player views a different version of the board, on which they can only see their own pieces, and the squares where these pieces
				can legally move, as well as any opponent pieces on those squares (which must therefore be capturable). It is indicated to the
				player which squares are hidden, so a hidden square can never be confused with a visible empty square. As an example, it is always
				clear when an enemy piece is directly in front of a pawn, because that square will be hidden (as capturing it is not a legal move
				for the pawn to make).
			</p>
			<p>
				The goal of this chess variant is not to checkmate the king, but to capture it. A player is not told if their king is in check.
				Failing to move out of check, or moving into check, are both legal, and can obviously result in a capture and loss of the game.
			</p>
			<p>
				En passant capture is allowed; the threatened pawn and the square it moved through are both visible to the capturing player, but
				only until the end of the turn. Unlike standard chess, castling is allowed out of check, into check, and through the positions
				attacked by enemy pieces.
			</p>
		</article>
	)
}

function FischerRandom() {
	return (
		<article>
			<DialogHeader>
				<DialogTitle>Fisher Random Chess</DialogTitle>
				<DialogDescription>
					Excerpt from <a href="https://en.wikipedia.org/wiki/Fischer_random_chess">https://en.wikipedia.org/wiki/Fischer_random_chess</a>
				</DialogDescription>
			</DialogHeader>
			<p>
				Fischer random chess, also known as Chess960 ('chess nine-sixty'), is a variation of the game of chess invented by the former world
				chess champion Bobby Fischer.
			</p>
			<p>
				Fischer random chess employs the same board and pieces as classical chess, but the starting position of the pieces on the players'
				home ranks is randomized, following certain rules. The random setup makes gaining an advantage through the memorization of openings
				impracticable; players instead must rely more on their skill and creativity over the board.
			</p>
			<p>
				As in classical chess, each player may castle once per game, moving both the king and a rook in a single move; however, the castling
				rules were reinterpreted in Fischer random chess to support the different possible initial positions of king and rook. After
				castling, the final positions of king and rook are exactly the same as in classical chess
			</p>
		</article>
	)
}

function RegularChess() {
	return (
		<article>
			<p>Standard FIDE chess rules.</p>
			<p>
				For more information about other variants, selec one and click the <span class="text-primary underline">'?'</span> button again to
				learn more about it.
			</p>
		</article>
	)
}

export function HelpCard(props: { variant: GL.Variant } & ParentProps) {
	return (
		<Dialog>
			<DialogTrigger>{props.children}</DialogTrigger>
			<DialogContent class={styles.helpCard}>
				<Switch>
					<Match when={props.variant === 'duck'}>
						<DuckChess />
					</Match>
					<Match when={props.variant === 'fog-of-war'}>
						<FogOfWar />
					</Match>
					<Match when={props.variant === 'fischer-random'}>
						<FischerRandom />
					</Match>
					<Match when={props.variant === 'regular'}>
						<RegularChess/>
					</Match>
				</Switch>
			</DialogContent>
		</Dialog>
	)
}
