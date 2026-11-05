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

    const state = {
        data: null,
        maps: [],
        byFolder: new Map(),
        list: [],
        shown: 0,
        open: null,
        lastFocus: null,
        view: { q: '', mode: 'playable', sort: 'name' },
    };

    const $ = selector => document.querySelector(selector);
    const search = $('#search');
    const sort = $('#sort');
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
    const dName = $('#d-name');
    const dBy = $('#d-by');
    const dModes = $('#d-modes');
    const dDesc = $('#d-desc');
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

    const normalise = text => (text || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();

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
            map._search = normalise([map.name, map.folder, map.author,
                map.original_name].join(' '));
            map._kills = Math.max(0, ...Object.values(map.fitness.modes).map(mode => mode.kills || 0));
            map._area = map.fitness.area_land || 0;
            state.byFolder.set(map.folder, map);
        }

        readURL();
        buildChips();
        showStats();
        search.value = state.view.q;
        sort.value = state.view.sort;

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
    }

    function syncURL() {
        const params = new URLSearchParams();
        if (state.view.q) params.set('q', state.view.q);
        if (state.view.mode !== 'playable') params.set('mode', state.view.mode);
        if (state.view.sort !== 'name') params.set('sort', state.view.sort);
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

    const SORTS = {
        name: (a, b) => collator.compare(a.name, b.name) || collator.compare(a.folder, b.folder),
        author: (a, b) => collator.compare(a.author || '\uffff', b.author || '\uffff')
            || SORTS.name(a, b),
        modes: (a, b) => b.modes.length - a.modes.length || SORTS.name(a, b),
        fights: (a, b) => b._kills - a._kills || SORTS.name(a, b),
        land: (a, b) => b._area - a._area || SORTS.name(a, b),
    };

    function filtered() {
        const mode = state.view.mode;
        const words = normalise(state.view.q).split(/\s+/).filter(Boolean);
        const list = state.maps.filter(map => {
            if (mode === 'playable' && map.modes.length === 0) return false;
            if (mode === 'untagged' && map.modes.length > 0) return false;
            if (mode !== 'all' && mode !== 'playable' && mode !== 'untagged'
                && !map.modes.includes(mode)) return false;
            if (words.length && !words.every(word => map._search.includes(word))) return false;
            return true;
        });
        return list.sort(SORTS[state.view.sort]);
    }

    /* ---- results -------------------------------------------------------- */

    function render() {
        state.list = filtered();
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
        const total = state.list.length;
        const mode = state.view.mode;
        let rest;
        if (mode === 'all') rest = total === 1 ? ' map' : ' maps';
        else if (mode === 'playable') rest = total === 1 ? ' map plays a mode' : ' maps play a mode';
        else if (mode === 'untagged') rest = total === 1 ? ' map has no mode tag' : ' maps have no mode tag';
        else rest = total === 1
            ? ' map for ' + MODE[mode].label
            : ' maps for ' + MODE[mode].label;
        if (state.view.q) rest += ' matching \u201c' + state.view.q + '\u201d';

        countLine.replaceChildren(element('b', null, number.format(total)),
            document.createTextNode(rest));
    }

    function appendChunk() {
        const slice = state.list.slice(state.shown, state.shown + CHUNK);
        if (!slice.length) {
            moreBtn.hidden = true;
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const map of slice) fragment.append(card(map));
        grid.append(fragment);
        state.shown += slice.length;
        moreBtn.hidden = state.shown >= state.list.length;
    }

    function card(map) {
        const link = element('a', 'card');
        link.href = '#/' + encodeURIComponent(map.folder);
        link.dataset.folder = map.folder;
        link.setAttribute('aria-label', map.name
            + (map.author ? ' by ' + map.author : '')
            + ' \u2014 ' + (map.modes.length
                ? map.modes.map(mode => MODE[mode].label).join(', ')
                : 'no mode tag'));

        const image = document.createElement('img');
        image.src = 'img/' + encodeURIComponent(map.folder) + '.webp';
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.width = 800;
        image.height = 404;

        const picture = element('div', 'card-img');
        picture.append(image);

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
        }
    }

    function fillSheet(map) {
        dImg.src = 'img/' + encodeURIComponent(map.folder) + '.webp';
        dImg.alt = 'Isometric picture of ' + map.name;
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
        } else {
            dDesc.textContent = 'This map\u2019s script carries no description.';
            dDesc.classList.add('empty-desc');
        }

        dFolder.textContent = map.folder;
        dFolder.title = 'Copy the folder name';

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

    function fillDownloads(map) {
        const folder = encodeURIComponent(map.folder);
        const base = 'https://raw.githubusercontent.com/ngspades/maps/main/maps/'
            + folder + '/' + folder;
        const files = [
            { name: 'The map', ext: '.ngmap', href: base + '.ngmap' },
            { name: 'Server settings', ext: '.toml', href: base + '.toml' },
        ];
        if (map.has_txt !== false) {
            files.push({ name: 'Map script', ext: '.txt', href: base + '.txt' });
        }
        files.push({ name: 'The picture', ext: '.png',
            href: 'https://raw.githubusercontent.com/ngspades/maps/main/maps/'
                + folder + '/preview.png' });

        dDownloads.replaceChildren();
        for (const file of files) {
            const link = element('a', 'dl');
            link.href = file.href;
            link.target = '_blank';
            link.rel = 'noopener';
            link.append(element('b', null, file.name), element('span', null, file.ext));
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
        const pool = state.list.length ? state.list : state.maps;
        if (!pool.length) return;
        const map = pool[Math.floor(Math.random() * pool.length)];
        location.hash = '#/' + encodeURIComponent(map.folder);
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
