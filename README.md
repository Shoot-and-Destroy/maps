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

Game modes that only fit some maps (zombie maps, arenas, Babel towers) say
so in their name or in the `.txt`'s `extensions`.

## Credits

Each map belongs to its author, named in its `.txt` (`author = ...`) and in
`maps.json`, and comes from the aos.party archive, run by the Ace of Spades
community; every entry in `maps.json` links to its aos.party page. Nothing
here is ours but the `.toml` files and the index.

If you made one of these maps and want it credited differently or taken
out, open an issue and it will be done.
