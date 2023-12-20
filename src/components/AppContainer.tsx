import {ParentProps} from "solid-js";
import {ModalContainer} from "./Modal.tsx";
import {A} from "@solidjs/router";

export function AppContainer(props: ParentProps) {
	return <div class="w-full bg-gray-800 text-white">
		<ModalContainer/>
		<NavBar/>
		{props.children}
	</div>
}

function NavBar() {
	return <div class="flex flex-row justify-between items-center bg-gray-900 text-white h-16">
		<div class="flex flex-row items-center">
			<img src="/favicon.ico" class="h-10 w-10"/>
			<h1 class="text-3xl ml-2">Chess</h1>
		</div>
		<div class="flex flex-row items-center">
			<A href="/" class="mr-4">Home</A>
		</div>
	</div>
}
