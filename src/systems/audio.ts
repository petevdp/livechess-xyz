import captureSound from '~/assets/audio/capture.mp3'
import castleSound from '~/assets/audio/castle.mp3'
import lowTimeSound from '~/assets/audio/low-time.mp3'
import checkSound from '~/assets/audio/move-check.mp3'
import moveOpponentSound from '~/assets/audio/move-opponent.mp3'
import moveSelfSound from '~/assets/audio/move-self.mp3'
import promoteSound from '~/assets/audio/promote.mp3'
import quackSound from '~/assets/audio/quack.mp3'
import * as GL from '~/systems/game/gameLogic.ts'


export const audio = {
	movePlayer: new Audio(moveSelfSound),
	moveOpponent: new Audio(moveOpponentSound),
	capture: new Audio(captureSound),
	check: new Audio(checkSound),
	promote: new Audio(promoteSound),
	castle: new Audio(castleSound),
	lowTime: new Audio(lowTimeSound),
	quack: new Audio(quackSound),
}

export function playLowTimeSound() {
	audio.lowTime.play()
}

export function playSoundEffectForMove(move: GL.Move, isClientPlayer: boolean) {
	if (move.duck && isClientPlayer) {
		play(audio.quack)
		return
	}
	if (move.check) {
		play(audio.check)
		return
	}
	if (move.promotion) {
		play(audio.promote)
		return
	}
	if (move.castle) {
		play(audio.castle)
		return
	}
	if (move.capture) {
		play(audio.capture)
		return
	}
	if (isClientPlayer) {
		play(audio.movePlayer)
		return
	} else {
		play(audio.moveOpponent)
		return
	}
}

function play(elt: HTMLAudioElement) {
	try {
		elt.play()
	} catch (e) {
		console.warn('unable to play audio', elt, e)
	}
}
