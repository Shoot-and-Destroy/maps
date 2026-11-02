# Shoot and Destroy maps

Ace of Spades maps from the community's archives, ready for a Shoot and
Destroy server: every map listed on [aos.party](https://aos.party), plus the
maps of the [hosting.dgd.cx map search](https://hosting.dgd.cx/map-search)
that are not already here.

## What is here

```
maps/<Name>/<Name>.ngmap   the map, as ngmap at quality 100 (below)
maps/<Name>/<Name>.txt     the original pyspades metadata, untouched (when the map has one)
maps/<Name>/<Name>.toml    the Shoot and Destroy settings, generated from the .txt
maps/<Name>/preview.png    an isometric picture of the map
maps.json                  the index: name, folder, author, source page, files, modes
```

### Why ngmap

ngmap is the map format of protocol 1.0 (OpenSpades' ngspades codec). At
quality 100 every block of the map is exactly where the original VXL had
it and every visible colour is within one step of the original, in a
seventh of the bytes: the aos.party maps are ~325 MB as ngmap against
~2.3 GB as VXL. The server downloads a map's `.ngmap` and turns it back
into the `.vxl` it loads by itself; a folder copied from here works as it
is.

A name listed more than once gets a number or its aos.party id appended to
the folder (`Name_2`, `Name_1234`), so no map replaces another. A map of
the map search is only added when no map here has the same blocks, whatever
its name or colours, so the same map never comes twice.

## Using a map on your server

1. Copy the map's folder into `Resources/maps/` of your server, so you have
   `Resources/maps/<Name>/<Name>.ngmap` (and its `.toml` and `.txt`).
2. Add `"<Name>"` to `maps = [...]` in `Resources/config.toml`, or start the
   server with `--map <Name>`.

A server whose config names a map it does not have downloads it from here at
start-up. To play one against bots in the game, copy its folder into the
`maps/` folder of the game's data: the Play with bots screen lists it under
"Your maps" for the modes it is tagged with (below).

## Which modes a map plays

Every map carries the modes it plays well, as a list: `modes = [...]` in the
`[map]` table of its `.toml`, and `"modes"` in its `maps.json` entry. A map
can fit several (`["ngctf", "ctf", "zombie"]`), or none.

| Tag | Mode |
| --- | --- |
| `ngctf` | capture the flag, next gen (perks, classes; bases 200 blocks apart or more) |
| `ctf` | capture the flag, classic rules |
| `koth` | king of the hill |
| `tc` | territory control |
| `babel` | Babel: the intel on a platform in the sky |
| `arena` | arena rounds |
| `zombie` | zombies against survivors |

The tags are measured, not guessed: the server played each map with 16 bots
for 10 game minutes in each mode, twice, and a map earned a mode when its
land, the bots' time in the water, their deaths to the map itself, the
fights and the mode's objective (intel pickups and captures, hills and
territories taken, zombie rounds that end) all passed the mode's limits.
The figures are in each `.toml` under `[map.fitness]`. Arena and Babel come
from the map's own `.txt`, as its author made it. A Babel map is tagged
`babel` only, a Counter-Strike map (`cs_*`, `de_*`) `arena` only, and a map
named for zombies is always tagged `zombie`.

## Credits

Each map belongs to its author, named in its `.txt` (`author = ...`) and in
`maps.json`. They come from the aos.party archive and the hosting.dgd.cx map
search, both run by the Ace of Spades community, and from the
[piqueserver arena](https://github.com/piqueserver/arena) repository
(`de_train`); every entry in `maps.json` links to its source. Nothing here is
ours but the `.toml` files, the previews and the index.

If you made one of these maps and want it credited differently or taken
out, open an issue and it will be done.
