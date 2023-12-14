import {Accessor, createEffect, Setter} from "solid-js";
import {createId} from "../utils/ids.ts";
import {useLocalStorage} from "../utils/persistence.ts";
import {room} from "./room.ts";

export type Player = {
    id: string,
    name: string | null
    clientIds: number[]
}

export let player = null as unknown as Accessor<Player>;
export let setPlayer = null as unknown as Setter<Player>


const id = await createId(6)
export async function setup() {
    [player, setPlayer] = useLocalStorage<Player>("player", {
        id: id,
        name: null,
        clientIds: []
    })
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
}

