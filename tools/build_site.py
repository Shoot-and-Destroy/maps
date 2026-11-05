#!/usr/bin/env python3
"""Build the map browser of the maps repository: docs/data.json and docs/img.

The page (docs/index.html) is static and reads one index; this script writes
that index from what the repository already holds, and turns every map's
preview.png into a WebP small enough to serve in a grid:

    maps.json                     name, folder, author, source, modes
    maps/<Name>/<Name>.toml       the server's settings and [map.fitness]
    maps/<Name>/<Name>.txt        the author's pyspades script (description)
    maps/<Name>/preview.png       the isometric picture (1032 x 521)

The .ngmap files are never read: a map's geometry is not needed to describe
it, and skipping them makes the build cheap and lets the CI check out only
the metadata and the previews.

Usage:
    python3 tools/build_site.py                 # write docs/data.json and docs/img
    python3 tools/build_site.py --check         # report whether the docs are stale
    python3 tools/build_site.py --jobs 4        # image conversion workers

The mode tags are the ones the server reads (modes = [...] in the .toml and
in maps.json). The fitness table does not have to agree with them: a map can
be tagged for the classic CTF because its next gen match plays, or for the
zombies because it is named after them, and the figures still say the classic
match failed. The browser shows both, and the reasons are written into the
index (see tag_reasons below).
"""

import argparse
import ast
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import tomllib
from datetime import datetime, timezone

try:
    from PIL import Image
except ModuleNotFoundError:  # pragma: no cover - the CI installs it
    sys.exit("build_site.py needs Pillow: python3 -m pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS_DIR = os.path.join(ROOT, "maps")
INDEX = os.path.join(ROOT, "maps.json")

# The mode order of the repository's README and of tools/tag_maps.py.
MODE_ORDER = ["ngctf", "ctf", "koth", "tc", "babel", "arena", "zombie"]

# The limits a map was measured against, mirroring tools/tag_maps.py's RULES
# of the game repository. They are shown next to each figure so a person
# reads 1.4% (limit 4.0%) instead of a number with no scale. A limit changed
# there is changed here.
RULES = {
    "ngctf": {"area_land": 0.60, "water": 2.0, "map_deaths": 0.15, "fight_kills": 20,
              "bases": 200, "objective": {"pickups": 6, "captures": 2}},
    "ctf": {"area_land": 0.30, "water": 4.0, "map_deaths": 0.25, "fight_kills": 20,
            "objective": {"pickups": 2}},
    "koth": {"area_land": 0.50, "water": 3.0, "map_deaths": 0.25, "fight_kills": 20,
             "objective": {"koth_rounds": 3}},
    "tc": {"area_land": 0.40, "water": 3.0, "map_deaths": 0.25, "fight_kills": 20,
           "objective": {"tc_captures": 5}},
    "zombie": {"area_land": 0.60, "water": 2.0, "map_deaths": 0.25, "fight_kills": 20,
               "objective": {"zombie_rounds": 3}},
}

# The figure the .toml stores is the last objective of the mode's rule
# (tools/tag_maps.py's objective_of): the next gen CTF writes its captures.
MEASURED = ["ngctf", "ctf", "koth", "tc", "zombie"]

IMAGE_WIDTH = 800
IMAGE_QUALITY = 80


def round_number(value, digits):
    """A float as the index writes it: 1.45, 0.024, 205.5, never 1.4500001."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    out = round(float(value), digits)
    return int(out) if out == int(out) and digits <= 1 else out


def literal(text, key, lines):
    """The value of a top-level `key = ...` line of a pyspades map script.

    Most are one line; a few wrap a parenthesised string over several, so a
    value that does not parse is retried with the next lines appended.
    Anything that still does not parse is dropped, never guessed."""
    for i, line in enumerate(lines):
        match = re.match(r"^%s\s*=\s*(.*)$" % re.escape(key), line)
        if not match:
            continue
        chunk = match.group(1)
        for j in range(i, min(i + 6, len(lines))):
            try:
                value = ast.literal_eval(chunk.strip())
            except (ValueError, SyntaxError):
                if j + 1 < len(lines):
                    chunk += "\n" + lines[j + 1]
                continue
            return value if isinstance(value, str) else None
        return None
    return None


def read_script(path):
    """name, version and description of a map's pyspades .txt, if it has one."""
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return {}
    out = {}
    for key in ("name", "version", "author", "description"):
        value = literal(path, key, lines)
        if value:
            out[key] = " ".join(value.split())
    return out


def tag_reasons(name, tagged, fitness):
    """Why each tagged mode is on the map, as the browser words it.

    tools/tag_maps.py's modes_of: Babel and the arena come from the map's own
    script or name, a map named for the zombies is the zombies' whatever its
    fitness, and a map the next gen CTF plays is a classic CTF map too. Any
    other tag that its match did not earn is labelled "tag" so the page never
    invents an explanation."""
    why = {}
    for mode in tagged:
        figures = fitness.get(mode) if isinstance(fitness.get(mode), dict) else None
        if mode in ("babel", "arena"):
            why[mode] = "script"
        elif mode == "zombie":
            why[mode] = "measured" if figures and figures.get("pass") else "name"
        elif mode == "ctf":
            if figures and figures.get("pass"):
                why[mode] = "measured"
            elif isinstance(fitness.get("ngctf"), dict) and fitness["ngctf"].get("pass"):
                why[mode] = "ngctf"
            else:
                why[mode] = "tag"
        else:
            why[mode] = "measured" if figures and figures.get("pass") else "tag"
    return why


def load_map(entry):
    """One map's index entry, from the repository's own files."""
    folder = entry["folder"]
    base = os.path.join(MAPS_DIR, folder, folder)
    toml = {}
    try:
        toml = tomllib.load(open(base + ".toml", "rb"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise SystemExit("bad toml for %s: %s" % (folder, exc))
    meta = toml.get("map") or {}
    has_script = os.path.exists(base + ".txt")
    script = read_script(base + ".txt") if has_script else {}

    tagged = [m for m in MODE_ORDER if m in (meta.get("modes") or entry.get("modes") or [])]
    fitness = {}
    for mode in MEASURED:
        figures = meta.get("fitness", {}).get(mode)
        if not isinstance(figures, dict):
            continue
        fitness[mode] = {
            "pass": bool(figures.get("pass")),
            "water": round_number(figures.get("water", 0), 2),
            "deaths": round_number(figures.get("map_deaths", 0), 3),
            "kills": round_number(figures.get("fight_kills", 0), 1),
            "objective": int(figures.get("objective", 0)),
            "failed": list(figures.get("failed") or []),
        }

    spawns = toml.get("spawnpoints") or {}
    spawn_boxes = []
    for team in ("team1", "team2"):
        box = spawns.get(team) or {}
        start, end = box.get("start"), box.get("end")
        spawn_boxes.append([start, end] if start and end else None)

    water = None
    if meta.get("water_damage_enabled"):
        water = {"per_second": round_number(meta.get("water_damage_per_second", 0), 1)}

    original = script.get("name")
    item = {
        "folder": folder,
        "name": entry.get("name") or folder,
        "author": (entry.get("author") or "").strip(),
        "id": entry.get("id"),
        "source": entry.get("source") or "",
        "modes": tagged,
        "why": tag_reasons(entry.get("name") or folder, tagged, fitness),
        "description": script.get("description") or "",
        "version": script.get("version") or "",
        "has_txt": has_script,
        "size": [int(v) for v in (meta.get("map_size") or [])],
        "fog": [int(v) for v in (meta.get("fog_color") or [])],
        "capture_limit": int(meta.get("capture_limit") or 0),
        "water": water,
        "spawns": spawn_boxes,
        "fitness": {
            "land": round_number(meta.get("fitness", {}).get("land", 0), 3),
            "area_land": round_number(meta.get("fitness", {}).get("area_land", 0), 3),
            "spawn_dry": [round_number(v, 2) for v in (meta.get("fitness", {}).get("spawn_dry") or [])],
            "modes": fitness,
        },
    }
    if original and original.strip() and original.strip() != item["name"]:
        item["original_name"] = original.strip()
    return item


def write_image(job):
    """The map's preview as an 800 wide WebP; a source older than the output
    is left alone so a rebuild only pays for what changed."""
    source, target = job
    if os.path.exists(target) and os.path.getmtime(target) >= os.path.getmtime(source):
        return False
    image = Image.open(source).convert("RGB")
    width = min(IMAGE_WIDTH, image.width)
    height = max(1, round(image.height * width / image.width))
    if (width, height) != image.size:
        image = image.resize((width, height), Image.LANCZOS)
    temporary = target + ".part"
    image.save(temporary, "WEBP", quality=IMAGE_QUALITY, method=5)
    os.replace(temporary, target)
    return True


def build_time():
    """The commit that last changed maps.json, which is the one the index
    describes. Any other commit (a page change) would make the file differ on
    every build for no reason, and the page would say it was newer than the
    data it shows."""
    try:
        commit = subprocess.check_output(
            ["git", "-C", ROOT, "log", "-1", "--format=%h", "--", "maps.json"],
            text=True, stderr=subprocess.DEVNULL).strip()
        when = subprocess.check_output(
            ["git", "-C", ROOT, "log", "-1", "--format=%cI", "--", "maps.json"],
            text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        commit, when = "", datetime.now(timezone.utc).isoformat(timespec="seconds")
    if not commit:
        return "", datetime.now(timezone.utc).isoformat(timespec="seconds")
    return commit, when


def build(out_dir, jobs):
    entries = json.load(open(INDEX, encoding="utf-8"))
    maps = [load_map(entry) for entry in sorted(entries, key=lambda e: e["folder"].lower())]

    modes = {mode: 0 for mode in MODE_ORDER}
    for item in maps:
        for mode in item["modes"]:
            modes[mode] += 1
    playable = sum(1 for item in maps if item["modes"])

    commit, when = build_time()
    index = {
        "generated": when,
        "commit": commit,
        "repo": "https://github.com/ngspades/maps",
        "rules": RULES,
        "mode_order": MODE_ORDER,
        "counts": {"maps": len(maps), "playable": playable,
                   "untagged": len(maps) - playable, "modes": modes},
        "maps": maps,
    }

    data = json.dumps(index, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    target = os.path.join(out_dir, "data.json")
    os.makedirs(os.path.join(out_dir, "img"), exist_ok=True)
    fresh = False
    try:
        fresh = open(target, encoding="utf-8").read() == data
    except OSError:
        pass
    if not fresh:
        temporary = target + ".part"
        with open(temporary, "w", encoding="utf-8") as handle:
            handle.write(data)
        os.replace(temporary, target)

    wanted = {item["folder"] + ".webp" for item in maps}
    image_jobs = []
    for item in maps:
        folder = item["folder"]
        image_jobs.append((os.path.join(MAPS_DIR, folder, "preview.png"),
                           os.path.join(out_dir, "img", folder + ".webp")))

    changed = 0
    if jobs <= 1:
        changed = sum(1 for job in image_jobs if write_image(job))
    else:
        with concurrent.futures.ProcessPoolExecutor(max_workers=jobs) as pool:
            changed = sum(1 for done in pool.map(write_image, image_jobs, chunksize=8) if done)

    # A map taken out of the repository takes its picture with it; the rest of
    # docs/ (index.html, app.js, style.css) is hand written and never touched.
    removed = 0
    for name in os.listdir(os.path.join(out_dir, "img")):
        if name.endswith(".webp") and name not in wanted:
            os.remove(os.path.join(out_dir, "img", name))
            removed += 1

    return index, fresh, changed, removed


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=os.path.join(ROOT, "docs"),
                        help="where the page lives (default: docs/)")
    parser.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 1),
                        help="image conversion workers (default: 8)")
    parser.add_argument("--check", action="store_true",
                        help="write nothing, exit 1 when the docs are stale")
    args = parser.parse_args()

    out_dir = os.path.abspath(args.out)
    if args.check:
        # The timestamps of the index change on every commit, so a check
        # rebuilds in memory and compares the pictures' presence and age.
        entries = json.load(open(INDEX, encoding="utf-8"))
        maps = [load_map(entry) for entry in sorted(entries, key=lambda e: e["folder"].lower())]
        stale = []
        for item in maps:
            target = os.path.join(out_dir, "img", item["folder"] + ".webp")
            source = os.path.join(MAPS_DIR, item["folder"], "preview.png")
            if not os.path.exists(target) or os.path.getmtime(target) < os.path.getmtime(source):
                stale.append(item["folder"])
        if not os.path.exists(os.path.join(out_dir, "data.json")):
            stale.append("data.json")
        if stale:
            print("stale: %d (e.g. %s)" % (len(stale), ", ".join(stale[:5])))
            return 1
        print("up to date: %d maps" % len(maps))
        return 0

    index, fresh, changed, removed = build(out_dir, args.jobs)
    counts = index["counts"]
    print("maps: %d (%d playable, %d untagged)" %
          (counts["maps"], counts["playable"], counts["untagged"]))
    print("modes: %s" % ", ".join("%s %d" % (m, counts["modes"][m]) for m in MODE_ORDER))
    print("data.json: %s" % ("unchanged" if fresh else "written"))
    print("images: %d written, %d removed" % (changed, removed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
