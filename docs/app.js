/* Map browser for the Shoot and Destroy maps repository.
   One index (data.json) is read once; everything after that is local: the
   filters, the search, the sorting and the map sheet. No dependencies. */

(() => {
    'use strict';

    const MODES = [
        { id: 'ngctf', short: 'NG CTF', chip: 'Next gen CTF', label: 'Capture the flag (next gen)',
          desc: 'Capture the flag with perks and classes; its bases are 200 blocks apart' },
        { id: 'ctf', short: 'CTF', chip: 'Classic CTF', label: 'Capture the flag (classic)',
          desc: 'The 0.75 rules: two tents, two intels, no perks' },
        { id: 'koth', short: 'KotH', label: 'King of the hill',
          desc: 'Rounds won by holding the hill' },
        { id: 'tc', short: 'TC', label: 'Territory control',
          desc: 'Territories taken and held across the map' },
        { id: 'babel', short: 'Babel', label: 'Babel',
          desc: 'The intel on a platform in the sky' },
        { id: 'arena', short: 'Arena', label: 'Arena',
          desc: 'Rounds: no building, no digging, a team wiped out wins' },
        { id: 'zombie', short: 'Zombie', label: 'Zombies',
          desc: 'Survivors against zombies, at night' },
    ];
    const MODE = Object.fromEntries(MODES.map(mode => [mode.id, mode]));
    const ORDER = MODES.map(mode => mode.id);
    const CHUNK = 48;

    // Why a tagged mode is on a map without its match having earned it, as
    // tools/build_site.py writes the reasons (tools/tag_maps.py's rules).
    const WHY = {
        ngctf: 'a map the next gen CTF plays is a classic CTF map too',
        name: 'a map named for the zombies is the zombies\u2019 whatever its match made of it',
        script: 'the map\u2019s own script or name makes it a map for this mode',
        tag: 'the repository tags this map for it',
    };

    const OBJECTIVE = {
        ngctf: { label: 'intel captures', key: 'captures' },
        ctf: { label: 'intel pickups', key: 'pickups' },
        koth: { label: 'rounds on the hill', key: 'koth_rounds' },
        tc: { label: 'territories taken', key: 'tc_captures' },
        zombie: { label: 'zombie rounds that ended', key: 'zombie_rounds' },
    };

    const number = new Intl.NumberFormat('en-US');
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const dateFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });

    // The picture the map's sheet is showing; the choice follows the reader
    // from one map to the next.
    let heroView = 'iso';

    const state = {
        data: null,
        maps: [],
        families: new Map(),
        byFolder: new Map(),
        list: [],
        totalMaps: 0,
        shown: 0,
        open: null,
        lastFocus: null,
        view: { q: '', mode: 'playable', sort: 'name', group: true },
    };

    const $ = selector => document.querySelector(selector);
    const search = $('#search');
    const sort = $('#sort');
    const groupBox = $('#group');
    const grid = $('#grid');
    const chips = $('#mode-chips');
    const countLine = $('#result-count');
    const clear = $('#clear');
    const empty = $('#empty');
    const emptyClear = $('#empty-clear');
    const more = $('#more');
    const moreBtn = $('#more-btn');
    const stats = $('#stats');
    const build = $('#build');
    const dialog = $('#detail');

    const dImg = $('#d-img');
    const dHero = $('#d-hero');
    const dViews = $('#d-views');
    const dName = $('#d-name');
    const dBy = $('#d-by');
    const dModes = $('#d-modes');
    const dDesc = $('#d-desc');
    const dDescSource = $('#d-desc-source');
    const dFacts = $('#d-facts');
    const dFit = $('#d-fit');
    const dFitBody = $('#d-fit-body');
    const dFitLegend = $('#d-fit-legend');
    const dFitNote = $('#d-fit-note');
    const dWhy = $('#d-why');
    const dDownloads = $('#d-downloads');
    const dInstall = $('#d-install');
    const dSpawns = $('#d-spawns');
    const dSpawnsBox = $('#d-spawns-box');
    const dLink = $('#d-link');
    const dFolder = $('#d-folder');
    const dVariants = $('#d-variants');
    const dVariantsBox = $('#d-variants-box');
    const dVariantsNote = $('#d-variants-note');

    // A name without its accents or its case, for comparing names.
    const fold = text => (text || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();

    // A search and a folded name ignore spaces and punctuation too: "Mini Deck
    // Arena", "mini_deck_arena" and "minideckarena" are one name.
    const key = text => fold(text).replace(/[^a-z0-9]+/g, '');

    /* ---- small helpers ------------------------------------------------- */

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function percent(value) {
        const out = Number((value * 100).toFixed(1));
        return (Number.isInteger(out) ? out : out.toFixed(1)) + '%';
    }

    function modeTag(mode) {
        const tag = element('span', 'tag m-' + mode);
        tag.append(element('i'), document.createTextNode(MODE[mode].short));
        tag.title = MODE[mode].label;
        return tag;
    }

    function untaggedTag() {
        const tag = element('span', 'tag none');
        tag.append(element('i'), document.createTextNode('No mode tag'));
        return tag;
    }

    async function copyText(text, button) {
        const original = button.textContent;
        let done = false;
        try {
            await navigator.clipboard.writeText(text);
            done = true;
        } catch (error) {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.append(area);
            area.select();
            try { done = document.execCommand('copy'); } catch (ignored) { done = false; }
            area.remove();
        }
        button.textContent = done ? 'Copied!' : 'Copy failed';
        setTimeout(() => { button.textContent = original; }, 1400);
    }

    /* ---- the index ----------------------------------------------------- */

    async function init() {
        showSkeletons();
        let data;
        try {
            const response = await fetch('data.json', { cache: 'no-cache' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            data = await response.json();
        } catch (error) {
            stats.textContent = 'The map index could not be loaded (' + error.message + ').';
            grid.replaceChildren();
            return;
        }

        state.data = data;
        state.maps = data.maps;
        for (const map of state.maps) {
            // The name, the folder and the author, never the description: a
            // match on a word a description happens to use buries the map the
            // reader asked for.
            map._search = key([map.name, map.folder, map.author,
                map.original_name].join(' '));
            map._kills = Math.max(0, ...Object.values(map.fitness.modes).map(mode => mode.kills || 0));
            map._area = map.fitness.area_land || 0;
            state.byFolder.set(map.folder, map);
        }
        buildFamilies();

        readURL();
        buildChips();
        buildLegend();
        showStats();
        $('#year').textContent = String(new Date().getFullYear());
        search.value = state.view.q;
        sort.value = state.view.sort;
        groupBox.checked = state.view.group;

        render();
        syncFromHash();
    }

    function showSkeletons() {
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 12; i++) {
            const card = element('div', 'skeleton');
            card.append(element('div', 'sk-img'),
                element('div', 'sk-line'),
                element('div', 'sk-line short'));
            fragment.append(card);
        }
        grid.replaceChildren(fragment);
    }

    function showStats() {
        const counts = state.data.counts;
        const when = new Date(state.data.generated);
        stats.replaceChildren();
        const add = (text, bold) => {
            if (bold) {
                const b = element('b', null, bold);
                stats.append(b);
            }
            stats.append(document.createTextNode(text));
        };
        add('', number.format(counts.maps));
        add(' maps \u00b7 ');
        add('', number.format(counts.playable));
        add(' playable in at least one mode \u00b7 ');
        add('', number.format(counts.untagged));
        add(' with no mode tag \u00b7 updated ');
        add(Number.isNaN(when.getTime()) ? 'recently' : dateFormat.format(when));

        const commit = state.data.commit ? ' from commit ' + state.data.commit : '';
        build.textContent = 'Index built' + commit + '.';
    }

    /* ---- the maps that share a name ------------------------------------- */

    // The archive keeps every upload: a v1 and a v2, a Halloween retexture, an
    // arena edit, the same file sent twice. They are different folders, so
    // they are kept apart, but a reader looking for "Mini Deck Arena" wants
    // one card, not three. The family key is the name without its case,
    // accents, spaces or punctuation.
    function buildFamilies() {
        for (const map of state.maps) {
            const family = key(map.name) || 'folder:' + fold(map.folder);
            map._family = family;
            if (!state.families.has(family)) state.families.set(family, []);
            state.families.get(family).push(map);
        }
        for (const members of state.families.values()) {
            members.sort(familyOrder);
            for (const member of members) member._members = members;
        }
    }

    // Which upload faces a folded card: one that plays a mode, then the name
    // that reads as one a person wrote rather than a file name, then the
    // earliest upload (its id is aos.party's, ascending), then the one with
    // the most modes, then the shortest folder.
    function familyOrder(a, b) {
        const tagged = (b.modes.length > 0 ? 1 : 0) - (a.modes.length > 0 ? 1 : 0);
        if (tagged) return tagged;
        const pretty = aesthetics(b.name) - aesthetics(a.name);
        if (pretty) return pretty;
        const ida = typeof a.id === 'number' ? a.id : Infinity;
        const idb = typeof b.id === 'number' ? b.id : Infinity;
        if (ida !== idb) return ida - idb;
        const modes = b.modes.length - a.modes.length;
        if (modes) return modes;
        if (a.folder.length !== b.folder.length) return a.folder.length - b.folder.length;
        return collator.compare(a.folder, b.folder);
    }

    function aesthetics(name) {
        return (/\s/.test(name || '') ? 2 : 0) + (/[A-Z]/.test(name || '') ? 1 : 0);
    }

    /* ---- URL state ------------------------------------------------------ */

    function readURL() {
        const params = new URLSearchParams(location.search);
        const mode = params.get('mode');
        const known = new Set(['playable', 'all', 'untagged', ...ORDER]);
        if (mode && known.has(mode)) state.view.mode = mode;
        const sortValue = params.get('sort');
        if (sortValue && ['name', 'author', 'modes', 'fights', 'land'].includes(sortValue)) {
            state.view.sort = sortValue;
        }
        state.view.q = (params.get('q') || '').slice(0, 120);
        state.view.group = params.get('group') !== '0';
    }

    function syncURL() {
        const params = new URLSearchParams();
        if (state.view.q) params.set('q', state.view.q);
        if (state.view.mode !== 'playable') params.set('mode', state.view.mode);
        if (state.view.sort !== 'name') params.set('sort', state.view.sort);
        if (!state.view.group) params.set('group', '0');
        const query = params.toString();
        const url = location.pathname + (query ? '?' + query : '') + location.hash;
        history.replaceState(null, '', url);
    }

    /* ---- filters -------------------------------------------------------- */

    function buildChips() {
        const counts = state.data.counts;
        const definitions = [
            { id: 'playable', label: 'Playable', cls: 'm-playable', count: counts.playable,
              title: 'Every map tagged with at least one mode' },
            { id: 'all', label: 'All maps', cls: 'm-all', count: counts.maps,
              title: 'Every map in the repository' },
            ...MODES.map(mode => ({
                id: mode.id, label: mode.chip || mode.label, cls: 'm-' + mode.id,
                count: counts.modes[mode.id], title: mode.label + '. ' + mode.desc,
            })),
            { id: 'untagged', label: 'Untagged', cls: 'm-none', count: counts.untagged,
              title: 'Maps whose match did not earn a mode, or that have not been measured' },
        ];

        const fragment = document.createDocumentFragment();
        for (const definition of definitions) {
            const button = element('button', 'chip ' + definition.cls);
            button.type = 'button';
            button.dataset.mode = definition.id;
            button.title = definition.title;
            button.setAttribute('aria-pressed', String(state.view.mode === definition.id));
            button.append(element('span', 'dot'),
                document.createTextNode(definition.label),
                element('span', 'n', number.format(definition.count)));
            button.addEventListener('click', () => {
                state.view.mode = definition.id;
                for (const chip of chips.querySelectorAll('.chip')) {
                    chip.setAttribute('aria-pressed', String(chip.dataset.mode === definition.id));
                }
                render();
            });
            fragment.append(button);
        }
        chips.replaceChildren(fragment);
    }

    // Sorting is by the map a card shows, except the modes, fights and land,
    // which a family can only gain from its other uploads.
    // The sidebar's list of the modes, with the colours the chips and the
    // tags use: it says what each one plays like.
    function buildLegend() {
        const legend = $('#legend');
        const fragment = document.createDocumentFragment();
        for (const mode of MODES) {
            const item = element('li', 'm-' + mode.id);
            const text = element('div');
            text.append(element('b', null, mode.label), element('small', null, mode.desc));
            item.append(element('i'), text);
            fragment.append(item);
        }
        legend.replaceChildren(fragment);
    }

    const SORTS = {
        name: (a, b) => collator.compare(a.map.name, b.map.name)
            || collator.compare(a.map.folder, b.map.folder),
        author: (a, b) => collator.compare(a.map.author || '\uffff', b.map.author || '\uffff')
            || SORTS.name(a, b),
        modes: (a, b) => b.modeCount - a.modeCount || SORTS.name(a, b),
        fights: (a, b) => b.kills - a.kills || SORTS.name(a, b),
        land: (a, b) => b.area - a.area || SORTS.name(a, b),
    };

    function matchesMode(map, mode) {
        if (mode === 'all') return true;
        if (mode === 'playable') return map.modes.length > 0;
        if (mode === 'untagged') return map.modes.length === 0;
        return map.modes.includes(mode);
    }

    function queryWords() {
        return fold(state.view.q).split(/\s+/)
            .map(word => word.replace(/[^a-z0-9]+/g, ''))
            .filter(Boolean);
    }

    function entryOf(members, candidates) {
        return {
            map: candidates[0],
            members,
            // How many maps of the family the filter and the search keep.
            count: candidates.length,
            modeCount: Math.max(...members.map(map => map.modes.length)),
            kills: Math.max(...members.map(map => map._kills || 0)),
            area: Math.max(...members.map(map => map._area || 0)),
        };
    }

    function filtered() {
        const mode = state.view.mode;
        const words = queryWords();
        // The switch on: one card a name. Off: one card a folder.
        const groups = state.view.group
            ? Array.from(state.families.values())
            : state.maps.map(map => [map]);
        const entries = [];
        for (const members of groups) {
            const matching = words.length
                ? members.filter(map => words.every(word => map._search.includes(word)))
                : members;
            if (!matching.length) continue;
            // The search can land on one upload of a family and the mode on
            // another; the card is then the best upload that answers both.
            const candidates = matching.filter(map => matchesMode(map, mode));
            if (!candidates.length) continue;
            entries.push(entryOf(members, candidates));
        }
        return entries.sort(SORTS[state.view.sort]);
    }

    /* ---- results -------------------------------------------------------- */

    function render() {
        state.list = filtered();
        state.totalMaps = state.list.reduce((total, entry) => total + entry.count, 0);
        state.shown = 0;
        grid.replaceChildren();
        empty.hidden = state.list.length > 0;
        renderCount();
        clear.hidden = !(state.view.q || state.view.mode !== 'playable');
        appendChunk();
        syncURL();
        keepResultsInView();
    }

    /* A filter can be changed from the sticky bar while the page is scrolled
       deep into the list. The list may then be shorter than the scroll, which
       leaves the reader at the footer: bring the results back under the bar. */
    function keepResultsInView() {
        const results = document.querySelector('.results');
        const controls = document.querySelector('.controls');
        if (!results || !controls) return;
        const top = controls.getBoundingClientRect().bottom;
        const line = results.getBoundingClientRect().top;
        if (line < top - 4) {
            window.scrollTo({ top: window.scrollY + line - top - 10, behavior: 'auto' });
        }
    }

    function renderCount() {
        const names = state.list.length;
        const maps = state.totalMaps;
        const mode = state.view.mode;
        let rest;
        if (mode === 'all') rest = maps === 1 ? ' map' : ' maps';
        else if (mode === 'playable') rest = maps === 1 ? ' map plays a mode' : ' maps play a mode';
        else if (mode === 'untagged') rest = maps === 1 ? ' map has no mode tag' : ' maps have no mode tag';
        else rest = maps === 1
            ? ' map for ' + MODE[mode].label
            : ' maps for ' + MODE[mode].label;
        if (state.view.q) rest += ' matching \u201c' + state.view.q + '\u201d';

        countLine.replaceChildren();
        // A folded list counts the names it shows and the folders behind them.
        if (state.view.group && names !== maps) {
            countLine.append(
                element('b', null, number.format(names)),
                document.createTextNode(names === 1 ? ' name \u00b7 ' : ' names \u00b7 '),
                element('b', null, number.format(maps)));
        } else {
            countLine.append(element('b', null, number.format(maps)));
        }
        countLine.append(document.createTextNode(rest));
    }

    function appendChunk() {
        const slice = state.list.slice(state.shown, state.shown + CHUNK);
        if (!slice.length) {
            moreBtn.hidden = true;
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const entry of slice) fragment.append(card(entry));
        grid.append(fragment);
        state.shown += slice.length;
        moreBtn.hidden = state.shown >= state.list.length;
    }

    function card(entry) {
        const map = entry.map;
        const link = element('a', 'card');
        link.href = '#/' + encodeURIComponent(map.folder);
        link.dataset.folder = map.folder;
        link.setAttribute('aria-label', map.name
            + (map.author ? ' by ' + map.author : '')
            + ' \u2014 ' + (map.modes.length
                ? map.modes.map(mode => MODE[mode].label).join(', ')
                : 'no mode tag')
            + (entry.members.length > 1
                ? ' \u2014 one of ' + entry.members.length + ' maps with this name'
                : ''));

        const image = document.createElement('img');
        image.src = 'img/' + encodeURIComponent(map.folder) + '.webp';
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.width = 800;
        image.height = 404;

        const picture = element('div', 'card-img');
        picture.append(image);
        if (entry.members.length > 1) {
            const badge = element('span', 'card-badge', entry.members.length + ' maps');
            badge.title = entry.members.length + ' maps share this name: '
                + entry.members.map(member => member.folder).join(', ');
            picture.append(badge);
        }

        const name = element('h3', 'card-name', map.name);
        name.title = map.name;
        const author = element('p', 'card-author', map.author ? 'by ' + map.author : 'Author unknown');
        author.title = author.textContent;
        const tags = element('div', 'tags');
        if (map.modes.length) {
            for (const mode of map.modes) tags.append(modeTag(mode));
        } else {
            tags.append(untaggedTag());
        }

        const body = element('div', 'card-body');
        body.append(name, author, tags);
        link.append(picture, body);
        return link;
    }

    /* ---- the map sheet -------------------------------------------------- */

    function syncFromHash() {
        const match = location.hash.match(/^#\/(.+)$/);
        let folder = null;
        if (match) {
            try { folder = decodeURIComponent(match[1]); } catch (error) { folder = null; }
        }
        if (folder && state.byFolder.has(folder)) {
            openMap(folder);
        } else if (dialog.open) {
            dialog.close();
        } else if (folder) {
            history.replaceState(null, '', location.pathname + location.search);
        }
    }

    function openMap(folder) {
        const map = state.byFolder.get(folder);
        if (!map) return;
        state.open = folder;
        if (!dialog.open) {
            state.lastFocus = document.activeElement;
            fillSheet(map);
            dialog.showModal();
            document.body.classList.add('locked');
        } else {
            fillSheet(map);
            // A variant chosen from the sheet's list starts at its top again.
            const body = dialog.querySelector('.detail-body');
            if (body) body.scrollTop = 0;
        }
    }

    function fillSheet(map) {
        fillViews(map);
        dName.textContent = map.name;

        dModes.replaceChildren();
        if (map.modes.length) {
            for (const mode of map.modes) dModes.append(modeTag(mode));
        } else {
            dModes.append(untaggedTag());
        }

        dBy.replaceChildren();
        if (map.author) {
            dBy.append(document.createTextNode('by '), element('b', null, map.author));
        } else {
            dBy.append(document.createTextNode('Author unknown'));
        }
        if (map.source) {
            dBy.append(document.createTextNode(' \u00b7 '));
            const link = element('a', null, 'aos.party' + (map.id ? ' #' + map.id : ''));
            link.href = map.source;
            link.target = '_blank';
            link.rel = 'noopener';
            dBy.append(link);
        }
        if (map.original_name) {
            dBy.append(document.createTextNode(' \u00b7 original name ' + map.original_name));
        }

        if (map.description) {
            dDesc.textContent = map.description;
            dDesc.classList.remove('empty-desc');
            dDescSource.hidden = true;
        } else {
            // No words from the author: a factual line from what the
            // repository knows of the map, said as such under it.
            dDesc.textContent = generatedDescription(map);
            dDesc.classList.remove('empty-desc');
            dDescSource.hidden = false;
            dDescSource.textContent = 'The map\u2019s script carries no description; this one is'
                + ' written from the map\u2019s measurements.';
        }

        dFolder.textContent = map.folder;
        dFolder.title = 'Copy the folder name';

        fillVariants(map);
        fillFacts(map);
        fillFitness(map);
        fillDownloads(map);
        fillSpawns(map);

        dInstall.textContent = installText(map);
        dSpawnsBox.open = false;

        dLink.onclick = () => copyText(
            location.origin + location.pathname + location.search + '#/' + encodeURIComponent(map.folder),
            dLink);
        dFolder.onclick = () => copyText(map.folder, dFolder);
    }

    /* ---- the map's sheet: pictures and words ---------------------------- */

    function fillViews(map) {
        const hasTop = Boolean(map.top);
        dViews.hidden = !hasTop;
        const top = hasTop && heroView === 'top';
        dImg.src = (top ? 'top/' : 'img/') + encodeURIComponent(map.folder) + '.webp';
        dImg.alt = (top ? 'Top-down picture of ' : 'Isometric picture of ') + map.name;
        dImg.width = top ? 512 : 800;
        dImg.height = top ? 512 : 404;
        dHero.classList.toggle('top', top);
        for (const button of dViews.querySelectorAll('button')) {
            button.setAttribute('aria-pressed',
                String(button.dataset.view === (top ? 'top' : 'iso')));
        }
    }

    function joinList(items) {
        if (items.length <= 1) return items.join('');
        return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
    }

    // A map whose script says nothing about itself still has things worth
    // reading: what it is, where its spawns are and how its bots played it.
    function generatedDescription(map) {
        const parts = [];
        const size = map.size && map.size.length === 3
            ? map.size[0] + ' \u00d7 ' + map.size[1] + ' blocks'
            : 'An Ace of Spades map';
        parts.push(size + (map.author ? ', by ' + map.author : '') + '.');
        if (map.modes.length) {
            parts.push('Tagged for ' + joinList(map.modes.map(mode => MODE[mode].label)) + '.');
        } else {
            parts.push('No mode tag yet, so a server will not pick it by mode.');
        }

        const fitness = map.fitness || {};
        if (typeof fitness.area_land === 'number') {
            let land = percent(fitness.area_land) + ' of its play area is land';
            if (typeof fitness.land === 'number') {
                land += ' (' + percent(fitness.land) + ' of the whole map)';
            }
            parts.push(land + '.');
        }

        const spawns = spawnSummary(map);
        if (spawns) parts.push(spawns);

        const fight = bestFight(map);
        if (fight) {
            parts.push('In a bot match its bots make ' + fight.kills + ' kills a match in '
                + fight.label + '.');
        }
        if (map.water) {
            parts.push('Its water hurts ' + map.water.per_second + ' hp a second.');
        }
        return parts.join(' ');
    }

    function spawnSummary(map) {
        const boxes = map.spawns || [];
        if (!boxes[0] || !boxes[1]) return '';
        const centre = box => [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
        const a = centre(boxes[0]);
        const b = centre(boxes[1]);
        const distance = Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
        let text = 'Its two spawns are ' + distance + ' blocks apart';
        const dry = map.fitness && map.fitness.spawn_dry;
        if (Array.isArray(dry) && dry.length === 2) {
            if (Math.min(...dry) >= 0.999) text += ' and both dry';
            else text += ' and dry on ' + percent(dry[0]) + ' and ' + percent(dry[1])
                + ' of their columns';
        }
        return text + '.';
    }

    function bestFight(map) {
        const measured = map.fitness && map.fitness.modes;
        if (!measured) return null;
        let best = null;
        for (const mode of (map.modes.length ? map.modes : ORDER)) {
            const figures = measured[mode];
            if (!figures || !figures.kills) continue;
            if (!best || figures.kills > best.kills) {
                best = { kills: figures.kills, label: MODE[mode].label };
            }
        }
        return best;
    }

    // Every upload of this map's name, so a reader can tell the v1 from the
    // Halloween retexture from the arena edit, and pick the folder to copy.
    function fillVariants(map) {
        const members = map._members || [map];
        dVariantsBox.hidden = members.length < 2;
        if (members.length < 2) {
            dVariants.replaceChildren();
            return;
        }
        dVariantsNote.textContent = members.length
            + ' maps share this name. Each is a folder of its own, and the folder is what a'
            + ' server names: open one for its own settings, fitness and files.';

        const fragment = document.createDocumentFragment();
        for (const member of members) {
            const link = element('a', 'variant' + (member === map ? ' current' : ''));
            link.href = '#/' + encodeURIComponent(member.folder);
            if (member === map) link.setAttribute('aria-current', 'true');

            const image = document.createElement('img');
            image.src = 'img/' + encodeURIComponent(member.folder) + '.webp';
            image.alt = '';
            image.loading = 'lazy';
            image.width = 74;
            image.height = 38;

            const text = element('div', 'variant-text');
            text.append(
                element('b', null, member.folder),
                element('small', null, (member.author || 'Author unknown')
                    + ' \u00b7 ' + (member.modes.length
                        ? member.modes.map(mode => MODE[mode].short).join(', ')
                        : 'no mode tag')));
            link.append(image, text);
            fragment.append(link);
        }
        dVariants.replaceChildren(fragment);
    }

    function fact(label, value, sub, valueClass) {
        const box = element('div', 'fact');
        const dd = element('dd', valueClass || null, value);
        if (sub) dd.append(element('small', null, sub));
        box.append(element('dt', null, label), dd);
        return box;
    }

    function fillFacts(map) {
        const facts = [];
        if (map.size && map.size.length === 3) {
            facts.push(fact('Size', map.size.join(' \u00d7 '), 'columns \u00d7 columns \u00d7 depth'));
        }
        const fitness = map.fitness || {};
        if (typeof fitness.area_land === 'number') {
            facts.push(fact('Play area land', percent(fitness.area_land),
                'whole map ' + percent(fitness.land || 0)));
        }
        if (Array.isArray(fitness.spawn_dry) && fitness.spawn_dry.length === 2) {
            facts.push(fact('Spawns dry', fitness.spawn_dry.map(percent).join(' / '),
                'team 1 / team 2'));
        }
        if (map.capture_limit) {
            facts.push(fact('Capture limit', String(map.capture_limit), 'captures a match'));
        }
        if (map.fog && map.fog.length === 3) {
            const box = element('div', 'fact');
            const dd = element('dd');
            const swatch = element('span', 'swatch');
            swatch.style.background = 'rgb(' + map.fog.join(',') + ')';
            dd.append(swatch, document.createTextNode('#' + map.fog
                .map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()));
            box.append(element('dt', null, 'Fog colour'), dd);
            facts.push(box);
        }
        facts.push(fact('Water damage', map.water ? map.water.per_second + ' hp/s' : 'None'));
        facts.push(fact('Script', map.has_txt ? 'pyspades' : 'None',
            map.has_txt ? (map.version ? 'v' + map.version : '.txt') : 'no .txt'));
        facts.push(fact('Folder', map.folder, 'the server names it by this', 'mono'));

        dFacts.replaceChildren(...facts);
    }

    function fillFitness(map) {
        const rules = state.data.rules;
        const measured = ORDER.filter(mode => map.fitness.modes[mode]);
        dFitBody.replaceChildren();

        if (!measured.length) {
            dFitNote.textContent = 'This map has not been measured in a bot match.';
        } else {
            dFitNote.textContent = 'The figures are from a bot match: 16 bots alone on the map '
                + 'for ten game minutes, twice. A red figure missed its limit.';
        }

        for (const mode of measured) {
            const figures = map.fitness.modes[mode];
            const rule = rules[mode] || {};
            const tagged = map.modes.includes(mode);
            const failed = new Set(figures.failed || []);

            const row = element('tr');
            const modeCell = element('td', 'fit-mode');
            modeCell.append(modeTag(mode));
            if (mode === 'ngctf') modeCell.title = 'Bases 200 blocks apart or more';

            const taggedCell = element('td', tagged ? 'tagged' : 'untagged', tagged ? '\u2713' : '\u2014');
            taggedCell.dataset.label = 'Tagged';
            taggedCell.title = tagged ? 'Tagged for this mode' : 'Not tagged for this mode';

            const measuredCell = element('td', figures.pass ? 'good' : 'bad',
                figures.pass ? 'Playable' : 'Not playable');
            measuredCell.dataset.label = 'Measured';
            if (!figures.pass && figures.failed && figures.failed.length) {
                measuredCell.title = 'Failed: ' + figures.failed.join(', ');
            }

            const water = element('td', failed.has('water') ? 'bad' : '');
            water.dataset.label = 'Water';
            water.append(document.createTextNode(figures.water + '%'));
            water.append(element('span', 'limit', '\u2264 ' + (rule.water ?? '?') + '%'));

            const deaths = element('td', failed.has('map_deaths') ? 'bad' : '');
            deaths.dataset.label = 'Map deaths';
            deaths.append(document.createTextNode(percent(figures.deaths)));
            deaths.append(element('span', 'limit', '\u2264 ' + percent(rule.map_deaths ?? 0)));

            const kills = element('td', failed.has('fight_kills') ? 'bad' : '');
            kills.dataset.label = 'Fight kills';
            kills.append(document.createTextNode(String(figures.kills)));
            kills.append(element('span', 'limit', '\u2265 ' + (rule.fight_kills ?? '?')));

            const objective = OBJECTIVE[mode] || { label: 'objective', key: 'objective' };
            const need = rule.objective ? rule.objective[objective.key] : null;
            const objectiveCell = element('td', failed.has('objective') ? 'bad' : '');
            objectiveCell.dataset.label = 'Objective';
            objectiveCell.append(document.createTextNode(String(figures.objective)));
            objectiveCell.append(element('span', 'limit',
                (need !== null && need !== undefined ? '\u2265 ' + need + ' ' : '') + objective.label));

            row.append(modeCell, taggedCell, measuredCell, water, deaths, kills, objectiveCell);
            dFitBody.append(row);
        }

        const notes = [];
        if (measured.includes('ngctf')) {
            notes.push('The next gen CTF also needs 6 intel pickups a match; its captures are the figure above.');
        }
        const scriptModes = map.modes.filter(mode => mode === 'babel' || mode === 'arena');
        if (scriptModes.length) {
            notes.push(scriptModes.map(mode => MODE[mode].label).join(' and ')
                + (scriptModes.length > 1 ? ' are' : ' is')
                + ' not measured in a bot match: the map\u2019s own script or name decides.');
        }
        dFitLegend.textContent = notes.join(' ');

        dWhy.replaceChildren();
        for (const mode of map.modes) {
            const reason = map.why ? map.why[mode] : 'tag';
            if (reason === 'measured') continue;
            const item = element('li', null,
                'Tagged for ' + MODE[mode].label + ': ' + (WHY[reason] || WHY.tag) + '.');
            dWhy.append(item);
        }
        if (!map.modes.length) {
            dWhy.append(element('li', null,
                'This map has no mode tag yet, so a server will not pick it by mode; the figures above are still what its match made of it.'));
        }

        dFit.closest('.table-wrap').hidden = !measured.length;
    }

    function fileSize(value) {
        if (!Number.isFinite(value) || value <= 0) return '';
        if (value < 1024) return value + ' B';
        if (value < 1024 * 1024) {
            return (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0) + ' KB';
        }
        return (value / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function fillDownloads(map) {
        const folder = encodeURIComponent(map.folder);
        const raw = 'https://raw.githubusercontent.com/ngspades/maps/main/maps/' + folder + '/';
        const sizes = map.sizes || {};
        const files = [
            { name: 'The map', ext: '.ngmap', href: raw + folder + '.ngmap', size: sizes.ngmap },
            { name: 'Server settings', ext: '.toml', href: raw + folder + '.toml', size: sizes.toml },
        ];
        if (map.has_txt !== false) {
            files.push({ name: 'Map script', ext: '.txt', href: raw + folder + '.txt',
                size: sizes.txt });
        }
        files.push({ name: 'Isometric picture', ext: '.png', href: raw + 'preview.png',
            size: sizes.preview });
        if (map.top) {
            files.push({ name: 'Top view', ext: '.webp', href: raw + 'top.webp', size: sizes.top });
        }

        dDownloads.replaceChildren();
        for (const file of files) {
            const link = element('a', 'dl');
            link.href = file.href;
            link.target = '_blank';
            link.rel = 'noopener';
            const measured = fileSize(file.size);
            link.append(element('b', null, file.name),
                element('span', null, file.ext + (measured ? ' \u00b7 ' + measured : '')));
            dDownloads.append(link);
        }
    }

    function fillSpawns(map) {
        dSpawns.replaceChildren();
        const names = ['Team 1', 'Team 2'];
        let any = false;
        map.spawns.forEach((box, index) => {
            if (!box) return;
            any = true;
            const [start, end] = box;
            const line = element('div');
            line.append(element('b', null, names[index] + '  '),
                document.createTextNode('(' + start.join(', ') + ') \u2192 (' + end.join(', ') + ')'));
            dSpawns.append(line);
        });
        if (!any) {
            dSpawns.append(element('div', null,
                'The map names no spawn points; the server searches the map for them.'));
        }
    }

    function installText(map) {
        const folder = map.folder;
        const lines = [
            '# copy the folder into the server\u2019s maps',
            'server/Resources/maps/' + folder + '/',
            '    ' + folder + '.ngmap',
            '    ' + folder + '.toml',
        ];
        if (map.has_txt !== false) lines.push('    ' + folder + '.txt');
        lines.push(
            '',
            '# then name it in Resources/config.toml',
            'maps = ["' + folder + '"]',
            '',
            '# or start the server with it',
            'ngspades-server --map ' + folder);
        return lines.join('\n');
    }

    /* ---- events --------------------------------------------------------- */

    let queryTimer = 0;
    search.addEventListener('input', () => {
        clearTimeout(queryTimer);
        queryTimer = setTimeout(() => {
            state.view.q = search.value.trim();
            render();
        }, 120);
    });
    search.addEventListener('search', () => {
        clearTimeout(queryTimer);
        state.view.q = search.value.trim();
        render();
    });
    search.addEventListener('keydown', event => {
        if (event.key === 'Escape' && search.value) {
            search.value = '';
            state.view.q = '';
            render();
        }
    });

    sort.addEventListener('change', () => {
        state.view.sort = sort.value;
        render();
    });

    clear.addEventListener('click', () => {
        state.view.q = '';
        state.view.mode = 'playable';
        search.value = '';
        for (const chip of chips.querySelectorAll('.chip')) {
            chip.setAttribute('aria-pressed', String(chip.dataset.mode === 'playable'));
        }
        render();
    });

    emptyClear.addEventListener('click', () => {
        state.view.q = '';
        state.view.mode = 'all';
        search.value = '';
        for (const chip of chips.querySelectorAll('.chip')) {
            chip.setAttribute('aria-pressed', String(chip.dataset.mode === 'all'));
        }
        render();
    });

    $('#random').addEventListener('click', () => {
        if (!state.list.length) return;
        const entry = state.list[Math.floor(Math.random() * state.list.length)];
        location.hash = '#/' + encodeURIComponent(entry.map.folder);
    });

    groupBox.addEventListener('change', () => {
        state.view.group = groupBox.checked;
        render();
    });

    dViews.addEventListener('click', event => {
        const button = event.target.closest('button[data-view]');
        if (!button) return;
        heroView = button.dataset.view;
        const map = state.open ? state.byFolder.get(state.open) : null;
        if (map) fillViews(map);
    });

    moreBtn.addEventListener('click', appendChunk);

    const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) appendChunk();
    }, { rootMargin: '700px 0px' });
    observer.observe(more);

    window.addEventListener('hashchange', syncFromHash);

    dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
    });

    dialog.addEventListener('close', () => {
        document.body.classList.remove('locked');
        const folder = state.open;
        state.open = null;
        if (location.hash) {
            history.replaceState(null, '', location.pathname + location.search);
        }
        const back = folder && grid.querySelector('.card[data-folder="' + CSS.escape(folder) + '"]');
        if (back) back.focus();
        else if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
    });

    document.addEventListener('keydown', event => {
        const typing = event.target instanceof HTMLElement
            && (event.target.matches('input, textarea, select') || event.target.isContentEditable);
        if (event.key === '/' && !typing && !dialog.open) {
            event.preventDefault();
            search.focus();
            search.select();
        }
    });

    init();
})();
