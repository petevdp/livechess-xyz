import {getOwner} from "solid-js";
import {AppContainer} from "./AppContainer.tsx";
import * as R from "../systems/room.ts";
import {useNavigate} from "@solidjs/router";
import {Button} from "./Button.tsx";

export function Home() {
	const owner = getOwner()!;
	const navigate = useNavigate();

	async function createRoom() {
		await R.createRoom(owner);
		navigate(`/room/${R.room()!.roomId}`)
	}

	return <AppContainer>
		<div class="h-[calc(100vh_-_4rem)] grid place-items-center">
			<div
				class="flex flex-col bg-gray-900 rounded p-2 w-[24em]">
				<h2 class="text-center">Welcome!</h2>
				<p class="text-sm mb-2">Click below to host a new game, or copy the link from your opponent into your browser to
					join theirs.</p>
				<Button kind="primary" onClick={createRoom}>Play</Button>
			</div>
		</div>
	</AppContainer>
}
