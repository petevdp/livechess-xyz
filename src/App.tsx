import {Route, Router, useNavigate, useParams} from "@solidjs/router";
import {createSignal, For, Match, onMount, Show, Switch} from "solid-js";
import * as P from "./systems/player";
import * as R from './systems/room'
import * as G from './systems/game.ts'
import {yMapToSignal, yMapToStore} from "./utils/yjs.ts";
import {RoomState} from "./systems/room.ts";


function App() {
    onMount(() => {
        P.setup()
        R.setup()
    })
    return (
        <Router>
            <Route path="/" component={Home}/>
            <Route path="/room/:id" component={Room}/>
        </Router>
    )
}

function Home() {
    const [variant, setVariant] = createSignal<G.Variant>("regular")
    const [timeControl, setTimeControl] = createSignal<G.TimeControl>("5m")
    const [increment, setIncrement] = createSignal<G.Increment>("0")
    const navigate = useNavigate();


    return <div class="h-screen grid place-items-center">
        <div class="flex flex-col items-center">
            <div>
                <MultiChoiceButton
                    choices={G.VARIANTS.map(c => ({label: c, id: c}) satisfies Choice<G.Variant>)}
                    selected={variant()}
                    onChange={setVariant}/>
            </div>
            <div>
                <MultiChoiceButton
                    choices={G.TIME_CONTROLS.map(tc => ({label: tc, id: tc}) satisfies Choice<G.TimeControl>)}
                    selected={timeControl()} onChange={setTimeControl}/>
            </div>
            <div>
                <MultiChoiceButton choices={G.INCREMENTS.map(i => ({label: i, id: i}) satisfies Choice<G.Increment>)}
                                   selected={increment()} onChange={setIncrement}/>
            </div>
            <button
                onclick={async () => {
                    await R.createRoom({
                        increment: increment(),
                        timeControl: timeControl(),
                        variant: variant()
                    })
                    navigate(`/room/${R.room.roomId}`)
                }}>Play
            </button>
        </div>
    </div>
}


function Room() {
    const params = useParams()
    const {status: roomStatus} = R.useRoomConnection(params.id)
    const [gameState, setGameState] = yMapToSignal<RoomState>(R.room.details, 'status')
    const [players, setPlayers] = yMapToStore<P.Player>(R.room.players)

    const copyInviteLink = () => {
        navigator.clipboard.writeText(window.location.href)
    }
    const startGame = () => {
    }

    return <div><h1>Room {params.id}</h1>
        {/*<pre><code>{roomConnection()?.room.toJSON()}</code></pre>*/}
        {/*<h1>counter</h1>*/}
        {/*<button onClick={incCounter}>{syncedCounter()}</button>*/}
        <div class="h-screen">
            <Switch>
                <Match when={roomStatus() === 'connecting'}>
                    <div>loading...</div>
                </Match>
                <Match when={gameState() === 'pregame' && P.player().name == null}>
                    <DisplayNameForm/>
                </Match>
                <Match when={gameState() === 'pregame' && P.player().name != null}>
                    <div>
                        <div>pregame</div>
                        <button onclick={copyInviteLink}>Copy Invite Link</button>
                        <For each={players}>{([_, player]) => <div>{player.name || '<unnamed>'} is
                            connected</div>}</For>
                        <Show when={R.room.details.get('host') === P.player().id}>
                            <button onClick={startGame} disabled={players.length < 2}>Start Game</button>
                        </Show>
                    </div>
                </Match>
                <Match when={gameState() === 'in-progress'}>
                    <div>Game in progress</div>
                </Match>
                <Match when={gameState() === 'postgame'}>
                    <div>Game over</div>
                </Match>
                <Match when={true}>
                    <div>idk</div>
                </Match>
            </Switch>
        </div>
    </div>
}

function DisplayNameForm() {
    const [displayName, setDisplayName] = createSignal<string>(P.player().name || "")
    const onSubmit = (e: SubmitEvent) => {
        e.preventDefault()
        P.setPlayer(({...P.player(), name: displayName()}))
    }
    return <form onSubmit={onSubmit}>
        <div>Set your Display Name</div>
        <input type="text" value={displayName()}
               required={true}
               pattern={"[a-zA-Z0-9]+"}
               onInput={e => setDisplayName(e.target.value.trim())}/>
        <input type="submit" value="Submit"/>
    </form>
}

type Choice<T> = { id: T; label: string }

function MultiChoiceButton<T extends string>(props: {
    choices: Choice<T>[],
    selected: string,
    onChange: (id: T) => void
}) {
    return <div class={'flex'}>
        <For each={props.choices}>{(choice => <button class="p-0.5"
                                                      classList={{"bg-blue-500": choice.id == props.selected}}
                                                      onClick={() => props.onChange(choice.id)}>{choice.label}</button>)}</For>
    </div>
}


export default App
