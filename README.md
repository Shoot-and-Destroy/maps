# Shoot and Destroy maps

Every Ace of Spades map listed on [aos.party](https://aos.party), ready for a
Shoot and Destroy server.

## What is here

```
maps/<Name>/<Name>.vxl    the map, as aos.party serves it
maps/<Name>/<Name>.txt    the original pyspades metadata, untouched (when the map has one)
maps/<Name>/<Name>.toml   the Shoot and Destroy settings, generated from the .txt
maps.json                 the index: aos.party id, name, folder, author, source page, files
```

A name aos.party lists more than once gets its aos.party id appended to the
folder (`Name_1234`), so no map replaces another.

The server reads both files: the `.txt` is the author's own data (spawn
points, intel and tent positions, protected areas, fog, water damage, map
extensions) and wins over the `.toml`, which keeps what the game adds
(capture limit, arena timings) and the spawn areas for maps that have no
`.txt`.

## Using a map on your server

1. Copy the map's folder into `Resources/maps/` of your server, so you have
   `Resources/maps/<Name>/<Name>.vxl` (and its `.toml` and `.txt`).
2. Add `"<Name>"` to `maps = [...]` in `Resources/config.toml`, or start the
   server with `--map <Name>`.

To play one against bots in the game, copy its folder into the
`Resources/maps/` folder of the game's local server: the Play with bots
screen lists it under "Your maps" for the modes it is tagged with (below).

## Which modes a map plays

Every map carries the modes it plays well, as a list: `modes = [...]` in the
`[map]` table of its `.toml`, and `"modes"` in its `maps.json` entry. A map
can fit several (`["ngctf", "ctf", "zombie"]`), or none.

| Tag | Mode |
| --- | --- |
| `ngctf` | capture the flag, next gen (perks, classes; bases 200 blocks apart or more) |
| `ctf` | capture the flag, classic rules |
| `babel` | Babel: the intel on a platform in the sky |
| `arena` | arena rounds |
| `zombie` | zombies against survivors |

The tags are measured, not guessed: the server played each map alone with
16 bots for 10 game minutes in each mode, and a map earned a mode when the
bots really played it there (fights and intel pickups in CTF, rounds that end
with zombies). Arena and Babel come from the map's own `.txt`, as its author
made it. A Babel map is tagged `babel` only, since its platform in the sky
means nothing in another mode, and an open sea earns no mode. The game reads
the tags: the zombie mode accepts a map tagged `zombie`, and the Play with
bots screen offers a map under the modes it carries.

## Credits

Each map belongs to its author, named in its `.txt` (`author = ...`) and in
`maps.json`, and comes from the aos.party archive, run by the Ace of Spades
community; every entry in `maps.json` links to its aos.party page. Nothing
here is ours but the `.toml` files and the index.

If you made one of these maps and want it credited differently or taken
out, open an issue and it will be done.
