[https://livechess.xyz](https://livechess.xyz)
# livechess.xyz

A free and open-source chess site.
The goal is to provide a convenient way to play chess with your friends without requiring sign-ups or accounts of any
kind.
Just paste a link or have your friend scan a QR code and you're ready to play.

## Features

- Start a game within ~5 seconds from opening the site, and easily invite your friends
- 4 gamemodes: Standard, Fischer Random, Fog of war, and Duck chess, as well as various time controls
- Rollback(ish) netcode with optimistic updates for responsive moves and all other replicated interactions
- sound effects for moves and other interactions
- Rewind history of current game to see previous moves
- Spectator mode allowing third parties to spectate
- Desktop and mobile friendly

## Screenshots

## Planned features

- premoves
- more gamemodes
- pause game
- take back move requests

## Contributing

Contributions are welcome! If you want to contribute, open an issue discussing a proposed change or comment on an
existing issue that you want to work on. If you want to work on an issue, please assign yourself to it so that others
know that you are working on it. When you are done, open a pull request and request a review.

Not all are required depending on what you'll be working on, but here are some technologies that you might need to learn:
solidjs, tailwindcss, nodejs, websockets, and rxjs

If you need some help, feel free shoot me an email(pjvanderpol@gmail.com)

## Setup
### Requirements
nodejs (tested with v19)
pnpm (`npm i -g pnpm`)


```bash
pnpm i
cp .env.example .env
pnpm run dev

# in another terminal
pnpm run server
```

## License
MIT
