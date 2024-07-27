import * as G from 'systems/game/game.ts'
import * as P from 'systems/player.ts'
import * as VB from 'systems/vsBot.ts'

import { AppContainer } from '~/components/AppContainer.tsx'
import Game from '~/components/Game.tsx'
import * as Pieces from '~/systems/piece.tsx'

export function VsBot() {
	P.ensurePlayerSystemSetup()
	Pieces.ensureSetupPieceSystem()
	VB.setupVsBot()
	const gameId = G.game()!.gameId!

	return (
		<AppContainer>
			<Game gameId={gameId} />
		</AppContainer>
	)
}
