import {createEffect, createRoot} from "solid-js";
import {createId} from "../utils/ids.ts";
import {useLocalStorage} from "../utils/persistence.ts";
import {room} from "./room.ts";

export type Player = {
	id: string,
	name: string | null
	clientIds: number[]
}

export const [player, setPlayer] = useLocalStorage<Player>("player", {
	id: await createId(6),
	name: null,
	clientIds: []
})


createRoot(() => {
	// broadcast player info
	createEffect(() => {
		const me = room.players.get(player().id)
		if (!me && room.players.size < 2 && player().name) {
			room.players.set(player().id, player())
		} else if (me) {
			me.name = player().name
			let clientId = room.doc.clientID;
			if (!me.clientIds.includes(clientId)) me.clientIds.push(clientId)
		}
	})
});

