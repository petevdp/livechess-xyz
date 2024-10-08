import { Match, Switch, createEffect, on } from 'solid-js'
import * as G from 'systems/game/game.ts'
import * as P from 'systems/player.ts'
import * as VB from 'systems/vsBot.ts'

import { AppContainer, ScreenFittingContent } from '~/components/AppContainer.tsx'
import Game from '~/components/Game.tsx'
import { GameConfig } from '~/components/GameConfig.tsx'
import { Button } from '~/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card.tsx'
import * as Audio from '~/systems/audio.ts'
import * as GlobalLoading from '~/systems/globalLoading.ts'
import * as Pieces from '~/systems/piece.tsx'

export default function VsBot() {
	P.ensurePlayerSystemSetup()
	Pieces.ensureSetupPieceSystem()
	VB.setupVsBot()
	GlobalLoading.clear()
	createEffect(
		on(
			() => VB.vsBotContext()?.rollbackState.activeGameId,
			(id) => {
				if (!id) return
				Audio.playSound('gameStart')
			}
		)
	)
	return (
		<AppContainer>
			<Switch>
				<Match when={G.game()?.gameId}>
					<Game />
				</Match>
				<Match when={VB.vsBotContext()}>
					<VsBotConfig ctx={VB.vsBotContext()!} />
				</Match>
			</Switch>
		</AppContainer>
	)
}

function VsBotConfig(props: { ctx: VB.VsAIContext }) {
	return (
		<ScreenFittingContent class="grid place-items-center p-2">
			<Card class="w-[95vw] p-1 sm:w-auto space-y-2">
				<CardHeader class="w-[95vw] p-1 sm:w-auto">
					<CardTitle class="text-center">Configure Game vs AI</CardTitle>
					<CardDescription>Opponent: Stockfish classical</CardDescription>
				</CardHeader>
				<CardContent class="p-1 flex flex-col space-y-2">
					<GameConfig ctx={props.ctx.gameConfigContext} />
				</CardContent>
				<Button
					class="w-full"
					onclick={() => {
						props.ctx.startGame()
					}}
				>
					Start Game
				</Button>
			</Card>
		</ScreenFittingContent>
	)
}
