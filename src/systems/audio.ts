import captureSound from '~/assets/audio/capture.mp3';
import castleSound from '~/assets/audio/castle.mp3';
import loseSound from '~/assets/audio/lose.mp3';
import lowTimeSound from '~/assets/audio/low-time.mp3';
import checkSound from '~/assets/audio/move-check.mp3';
import moveOpponentSound from '~/assets/audio/move-opponent.mp3';
import moveSelfSound from '~/assets/audio/move-self.mp3';
import promoteSound from '~/assets/audio/promote.mp3';
import quackSound from '~/assets/audio/quack.mp3';
import successBellSound from '~/assets/audio/success-bell.mp3';
import * as GL from '~/systems/game/gameLogic.ts';
import * as P from '~/systems/player.ts';


export const audio = {
	movePlayer: new Audio(moveSelfSound),
	moveOpponent: new Audio(moveOpponentSound),
	capture: new Audio(captureSound),
	check: new Audio(checkSound),
	promote: new Audio(promoteSound),
	castle: new Audio(castleSound),
	lowTime: new Audio(lowTimeSound),
	quack: new Audio(quackSound),
	winner: new Audio(successBellSound),
	loser: new Audio(loseSound),
}

export function playSound(name: keyof typeof audio) {
	if (P.settings.muteAudio) return
	audio[name].play().catch((e) => {
		console.warn('unable to play audio', audio[name], e)
	})
}

export function playSoundEffectForMove(move: GL.Move, isClientPlayer: boolean, isVisible: boolean) {
	if (move.duck && isClientPlayer) {
		playSound('quack')
		return
	}

	if (!isVisible) {
		if (move.capture) {
			playSound('capture')
			return
		}
		playSound('moveOpponent')
		return
	}

	if (move.check) {
		playSound('check')
		return
	}
	if (move.promotion) {
		// play(audio.promote)
		playSound('promote')
		return
	}
	if (move.castle) {
		playSound('castle')
		return
	}
	if (move.capture) {
		playSound('capture')
		return
	}
	if (isClientPlayer) {
		playSound('movePlayer')
		return
	} else {
		playSound('moveOpponent')
		return
	}
}
