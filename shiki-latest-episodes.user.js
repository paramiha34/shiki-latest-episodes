// ==UserScript==
// @name         Shikimori: Latest Episodes
// @namespace    shiki-latest-episodes
// @version      1.9
// @description  Replaces the home page “Currently Airing” block with the 8 most recently aired episodes (newest on the left), with filters
// @match        https://shikimori.io/*
// @run-at       document-idle
// @grant        none
// @author       paramiha34
// @homepageURL  https://github.com/paramiha34/shiki-latest-episodes
// @supportURL   https://github.com/paramiha34/shiki-latest-episodes/issues
// @downloadURL  https://github.com/paramiha34/shiki-latest-episodes/raw/main/shiki-latest-episodes.user.js
// @updateURL    https://github.com/paramiha34/shiki-latest-episodes/raw/main/shiki-latest-episodes.user.js
// ==/UserScript==

// The script runs on every page: Shikimori navigates between pages without
// a full reload, so if you reach the home page from another page, the script
// must already be running to notice it.
//
// Even with @grant none, Greasemonkey runs the script in a sandbox where fetch
// does not resolve relative paths, so every URL is built as an absolute one.

(() => {
  'use strict';

  const LIMIT = 8;                        // cards in the block
  const HALF = LIMIT / 2;                 // "upcoming | aired" mode: 4 on each side
  const SKELETON_MS = 300;                // how long the placeholder shows when content changes
  const DEBUG = false;                    // true shows the debug panel under the block
  const DAY = 24 * 60 * 60 * 1000;
  const DATA_TTL = 10 * 60 * 1000;        // data cache lifetime: 10 minutes
  const SETTINGS_KEY = 'sle_settings_v3';
  const DATA_KEY = 'sle_data_v5';
  const POSTER_KEY = 'sle_posters_v1';
  const HENTAI_KEY = 'sle_hentai_id';
  const log = [];


  // ---------- language ----------
  // Shikimori writes the user's settings into <body> attributes:
  //   data-locale            — interface language (ru / en)
  //   data-localized_genres  — language of genre names
  //   data-localized_names   — language of anime titles
  // These are three independent profile settings, so each is read separately.
  // They are re-read every time, since the language can change without
  // the script being restarted.
  const bodyLang = (attr) => (document.body?.dataset[attr] === 'en' ? 'en' : 'ru');
  const uiLang = () => bodyLang('locale');
  const genresLang = () => bodyLang('localized_genres');
  const namesLang = () => bodyLang('localized_names');

  // Button icon for the help text: literal [ ] brackets around the icon, in a
  // fixed-width box so every description starts at the same position
  const keyIcon = (c) =>
    `<span class="sle-key"><span>[</span><span class="sle-key-icon">${c}\uFE0E</span><span>]</span></span>`;

  const I18N = {
    ru: {
      heading: 'Последние серии',
      kinds: {
        tv: 'TV Сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA', special: 'Спешл',
        tv_special: 'TV Спешл', music: 'Клип', pv: 'Проморолик', cm: 'Реклама',
      },
      lists: {
        none: 'Не в списке', planned: 'Запланировано', watching: 'Смотрю',
        rewatching: 'Пересматриваю', completed: 'Просмотрено', on_hold: 'Отложено',
        dropped: 'Брошено',
      },
      groups: { list: 'Мой список', kind: 'Тип', genre: 'Жанры', theme: 'Темы' },
      any: 'любой', loading: 'загрузка…', failed: 'не загрузились',
      reset: 'Сбросить фильтры', empty: 'Ничего не подходит под фильтры', debug: 'отладка',
      tSplit: 'Скоро выйдут | Уже вышли', tFilters: 'Фильтры', tReload: 'Обновить данные',
      ep: 'Эп.',
      justNow: 'только что', hAgo: (n) => `${n} ч. назад`, dAgo: (n) => `${n} дн. назад`,
      inMin: (n) => `через ${n} мин.`, inH: (n) => `через ${n} ч.`,
      today: (t) => `сегодня ${t}`, tomorrow: (t) => `завтра ${t}`,
      dateLocale: 'ru-RU',
      tInfo: 'Как это работает',
      info: `
        <ul>
          <li>${keyIcon('⇆')}<span>Слева 4 серии, которые скоро выйдут, справа 4 уже вышедшие.
            Время будущих серий Шикимори указывает примерно, поэтому при переносах оно может сдвигаться.</span></li>
          <li>${keyIcon('⚙')}<span>Фильтры по личным спискам, типу, жанрам и темам.</span></li>
          <li>${keyIcon('↻')}<span>Обновить данные. Сами они обновляются раз в 10 минут.</span></li>
        </ul>
        <p class="sle-info-note">Данные берутся из ленты обновлений и календаря Шикимори,
          поэтому время выхода серий может быть неточным.</p>`,
    },
    en: {
      heading: 'Latest Episodes',
      kinds: {
        tv: 'TV Series', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special',
        tv_special: 'TV Special', music: 'Music', pv: 'PV', cm: 'CM',
      },
      lists: {
        none: 'Not in list', planned: 'Planned', watching: 'Watching',
        rewatching: 'Rewatching', completed: 'Completed', on_hold: 'On Hold',
        dropped: 'Dropped',
      },
      groups: { list: 'My list', kind: 'Kind', genre: 'Genres', theme: 'Themes' },
      any: 'any', loading: 'loading…', failed: 'failed to load',
      reset: 'Reset filters', empty: 'Nothing matches the filters', debug: 'debug',
      tSplit: 'Upcoming | Aired', tFilters: 'Filters', tReload: 'Refresh data',
      ep: 'Ep.',
      justNow: 'just now', hAgo: (n) => `${n}h ago`, dAgo: (n) => `${n}d ago`,
      inMin: (n) => `in ${n} min`, inH: (n) => `in ${n}h`,
      today: (t) => `today ${t}`, tomorrow: (t) => `tomorrow ${t}`,
      dateLocale: 'en-US',
      tInfo: 'How it works',
      info: `
        <ul>
          <li>${keyIcon('⇆')}<span>Episodes airing soon on the left, already aired on the right.
            Upcoming times are Shikimori’s estimate and may shift if an episode is delayed.</span></li>
          <li>${keyIcon('⚙')}<span>Filter by your personal lists, kind, genres and themes.</span></li>
          <li>${keyIcon('↻')}<span>Refresh data. It also refreshes on its own every 10 minutes.</span></li>
        </ul>
        <p class="sle-info-note">Data comes from Shikimori’s updates feed and calendar,
          so air times may be inaccurate.</p>`,
    },
  };
  const T = () => I18N[uiLang()];

  // Internal list-status keys (used to strip planned/watching… classes from cards)
  const LIST_KEYS = Object.keys(I18N.ru.lists);
  // Kind labels in both languages, to find them inside the template card
  const ALL_KIND_LABELS = [...Object.values(I18N.ru.kinds), ...Object.values(I18N.en.kinds)];

  const GROUPS = ['list', 'kind', 'genre', 'theme'].map((key) => ({ key }));

  // ---------- storage ----------

  const store = {
    get(key, def) {
      try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
    },
  };

  // Hentai is hidden by default. On Shikimori it is genre id 12; once the genre
  // list loads, the id is re-checked by name (see fixHentaiId).
  const hentaiId = () => store.get(HENTAI_KEY, '12');

  // include — "only these", exclude — "without these"
  const defaultFilters = () => {
    const f = Object.fromEntries(GROUPS.map((g) => [g.key, { include: [], exclude: [] }]));
    f.genre.exclude.push(hentaiId());
    return f;
  };

  const settings = Object.assign({ open: true, split: false, filters: defaultFilters() },
    store.get(SETTINGS_KEY, {}));
  for (const g of GROUPS) settings.filters[g.key] ??= { include: [], exclude: [] };
  const saveSettings = () => store.set(SETTINGS_KEY, settings);

  // ---------- network ----------

  async function getJSON(url, opts = {}) {
    const full = new URL(url, location.origin).href;
    const res = await fetch(full, {
      credentials: 'include',
      ...opts,
      headers: { Accept: 'application/json', ...(opts.headers || {}) },
    });
    const type = (res.headers.get('content-type') || '').split(';')[0];
    log.push(`${opts.method || 'GET'} ${url.split('?')[0]} → ${res.status} ${type}`);
    if (!res.ok || !type.includes('json')) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }

  const graphql = (query) =>
    getJSON('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    }).then((r) => {
      if (r.errors) throw new Error(r.errors[0]?.message || 'graphql error');
      return r.data;
    });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const abs = (u) => (!u ? '' : u.startsWith('http') ? u : location.origin + u);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- candidates: recently aired episodes ----------

  const normalize = (anime, episode, date) => ({
    id: anime.id,
    name: anime.name,
    russian: anime.russian || anime.name,
    url: abs(anime.url),
    kind: anime.kind,
    score: anime.score,
    year: String(anime.aired_on || '').slice(0, 4),
    episode,
    total: anime.episodes,
    date,
  });

  // "Episode N aired" events — exact air time
  async function fromTopicUpdates() {
    const topics = await getJSON('/api/topics/updates?limit=50');
    return topics
      .filter((t) => t.event === 'episode' && t.linked)
      .map((t) => normalize(t.linked, t.episode, t.created_at));
  }

  // Calendar: last episode ≈ next one − 7 days (for weekly shows)
  async function fromCalendar(list) {
    if (!list) throw new Error('calendar failed to load');
    const now = Date.now();
    return list
      .filter((e) => e.anime && e.anime.episodes_aired > 0 && e.next_episode_at)
      .map((e) => normalize(e.anime, e.anime.episodes_aired,
        new Date(new Date(e.next_episode_at).getTime() - 7 * DAY).toISOString()))
      .filter((a) => new Date(a.date).getTime() <= now);
  }

  // Use both sources: filters need a pool of spare candidates
  async function loadCandidates(cal) {
    const all = [];
    for (const src of [fromTopicUpdates, () => fromCalendar(cal)]) {
      try { all.push(...(await src())); } catch (e) { log.push('  ✗ ' + e.message); }
    }
    all.sort((a, b) => new Date(b.date) - new Date(a.date));
    const seen = new Set();
    return all.filter((a) => !seen.has(a.id) && seen.add(a.id));
  }

  // Upcoming episodes: each ongoing in the calendar has the time of its next episode.
  // Shikimori stores only the next one, so "4 upcoming" means 4 different titles.
  function upcomingFrom(cal) {
    if (!cal) return [];
    const now = Date.now();
    const seen = new Set();
    return cal
      .filter((e) => e.anime && e.next_episode_at && new Date(e.next_episode_at).getTime() > now)
      .map((e) => normalize(e.anime, e.next_episode || (e.anime.episodes_aired || 0) + 1,
        e.next_episode_at))
      .sort((a, b) => new Date(a.date) - new Date(b.date)) // soonest first
      .filter((a) => !seen.has(a.id) && seen.add(a.id));
  }

  // ---------- genres, themes and posters ----------

  // genre.kind on Shikimori: "genre", "demographic" (shounen, seinen…) or "theme".
  // Demographics are shown together with genres, as in the site's own filters.
  const groupOf = (g) => (g.kind === 'theme' ? 'theme' : 'genre');

  // Also fetch current poster URLs: the old REST API image paths
  // return a "404" placeholder on the new engine.
  async function loadGenresByAnime(ids, posters) {
    const map = {}; // animeId → [{id, group}]
    try {
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50).join(',');
        const data = await graphql(
          `{ animes(ids: "${chunk}", limit: 50) { id genres { id kind } poster { previewUrl mainUrl } } }`);
        for (const a of data.animes) {
          map[a.id] = a.genres.map((g) => ({ id: String(g.id), group: groupOf(g) }));
          const p = a.poster?.previewUrl || a.poster?.mainUrl;
          if (p) posters[a.id] = abs(p);
        }
      }
      return map;
    } catch (e) {
      log.push('  ✗ graphql: ' + e.message + ' → REST one by one');
    }
    // Fallback: /api/animes/:id, with pauses because of the rate limit
    for (const id of ids.slice(0, 30)) {
      try {
        const a = await getJSON(`/api/animes/${id}`);
        map[id] = (a.genres || []).map((g) => ({ id: String(g.id), group: groupOf(g) }));
      } catch {}
      await sleep(250);
    }
    return map;
  }

  async function loadGenreOptions(byAnime) {
    try {
      const data = await graphql('{ genres(entryType: Anime) { id name russian kind } }');
      return data.genres.map((g) => ({
        id: String(g.id), name: g.name, russian: g.russian, group: groupOf(g),
      }));
    } catch (e) {
      log.push('  ✗ genre list (graphql): ' + e.message);
    }
    try {
      const list = await getJSON('/api/genres');
      return list
        .filter((g) => !g.entry_type || g.entry_type === 'Anime')
        .map((g) => ({ id: String(g.id), name: g.name, russian: g.russian, group: groupOf(g) }));
    } catch (e) {
      log.push('  ✗ genre list (REST): ' + e.message);
      // Without the genre list, show only the ids that were seen
      const seen = new Map();
      Object.values(byAnime).flat().forEach((g) => seen.set(g.id, g));
      return [...seen.values()].map((g) => ({ ...g, name: '#' + g.id }));
    }
  }

  async function loadMyRates() {
    try {
      const me = await getJSON('/api/users/whoami');
      if (!me?.id) return {};
      const rates = await getJSON(
        `/api/v2/user_rates?user_id=${me.id}&target_type=Anime&limit=1000`);
      return Object.fromEntries(rates.map((r) => [r.target_id, r.status]));
    } catch (e) {
      log.push('  ✗ my list: ' + e.message);
      return {};
    }
  }

  // Poster cache is separate and long-lived: a title's poster rarely changes
  const getPosterCache = () => store.get(POSTER_KEY, {});
  const posterOf = (a) => getPosterCache()[a.id] || '';

  // Fallback: open the anime page and take og:image from <head>
  async function fetchPosterFromPage(url) {
    const res = await fetch(url, { credentials: 'include' });
    log.push(`GET ${url.replace(location.origin, '')} → ${res.status} (poster)`);
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
    // For 18+ titles the site puts its logo into og:image instead of the poster;
    // skip that — real posters live under /uploads/poster/animes/
    if (!m || !/\/animes\//.test(m[1])) return null;
    return abs(m[1]);
  }

  async function fixMissingPosters(items) {
    const cache = getPosterCache();
    for (const a of items) {
      if (cache[a.id]) continue;
      try {
        const src = await fetchPosterFromPage(a.url);
        if (!src) continue;
        cache[a.id] = src;
        store.set(POSTER_KEY, cache);
        document.querySelectorAll(`img[data-sle-anime="${a.id}"]`).forEach((img) => (img.src = src));
      } catch {}
      await sleep(250);
    }
  }

  // ---------- loading with cache ----------

  async function loadData(force = false) {
    const cached = store.get(DATA_KEY, null);
    if (!force && cached && Date.now() - cached.time < DATA_TTL) {
      log.push('data from cache');
      return cached;
    }
    let cal = null;
    try { cal = await getJSON('/api/calendar'); } catch (e) { log.push('  ✗ ' + e.message); }
    const candidates = await loadCandidates(cal);
    const upcoming = upcomingFrom(cal);
    const posters = getPosterCache();
    const ids = [...new Set([...candidates, ...upcoming].map((a) => a.id))];
    const byAnime = await loadGenresByAnime(ids, posters);
    store.set(POSTER_KEY, posters);
    const [genreOptions, rates] = await Promise.all([loadGenreOptions(byAnime), loadMyRates()]);
    const data = { time: Date.now(), candidates, upcoming, byAnime, genreOptions, rates };
    if (candidates.length) store.set(DATA_KEY, data); // don't cache a failed load
    return data;
  }

  // If "Hentai" has a different id in the genre list, fix the default filter
  function fixHentaiId(d) {
    const h = d.genreOptions.find((g) => /^(hentai|хентай)$/i.test(g.name) || /^хентай$/i.test(g.russian || ''));
    if (!h || h.id === hentaiId()) return;
    const ex = settings.filters.genre.exclude;
    const i = ex.indexOf(hentaiId());
    if (i !== -1) ex[i] = h.id;
    store.set(HENTAI_KEY, h.id);
    saveSettings();
  }

  // ---------- filtering ----------

  function valuesOf(a, key, d) {
    switch (key) {
      case 'kind': return [a.kind];
      case 'list': return [d.rates[a.id] || 'none'];
      case 'genre':
      case 'theme': {
        const g = d.byAnime[a.id];
        return g ? g.filter((x) => x.group === key).map((x) => x.id) : null; // null = unknown
      }
    }
  }

  function passes(a, d) {
    for (const { key } of GROUPS) {
      const { include, exclude } = settings.filters[key];
      if (!include.length && !exclude.length) continue;
      const vals = valuesOf(a, key, d);
      if (include.length && !(vals && vals.some((v) => include.includes(v)))) return false;
      if (exclude.length && vals && vals.some((v) => exclude.includes(v))) return false;
    }
    return true;
  }

  function optionsFor(key, d) {
    if (key === 'kind') return Object.entries(T().kinds).map(([id, label]) => ({ id, label }));
    if (key === 'list') return Object.entries(T().lists).map(([id, label]) => ({ id, label }));
    const ru = genresLang() === 'ru';
    return (d?.genreOptions || [])
      .filter((g) => g.group === key)
      .map((g) => ({ id: g.id, label: (ru && g.russian) || g.name || '#' + g.id }))
      .sort((a, b) => a.label.localeCompare(b.label, ru ? 'ru' : 'en'));
  }

  // ---------- styles and theme ----------
  // Colors are not hardcoded: text and background colors are read from the page
  // (getComputedStyle), so the UI adapts both to plain Shikimori and to Dark Reader
  // (including its brightness/contrast settings). Other shades (borders, tags,
  // hints) are mixed from those two.
  //
  // Our <style> gets class="stylus": Dark Reader skips such styles (that is how
  // it leaves the Stylus extension alone); otherwise it would darken
  // the already-adapted dark colors a second time.

  const style = document.createElement('style');
  style.className = 'stylus sle-style';
  style.textContent = `
    .sle-tools { position: absolute; right: 34px; top: 50%; transform: translateY(-50%);
      display: flex; gap: 4px; align-items: center; z-index: 2; }
    .sle-ibtn { background: none; border: 0; padding: 2px 5px; margin: 0; color: inherit;
      font: inherit; font-size: 16px; line-height: 1; cursor: pointer; opacity: .6;
      transition: opacity .15s; }
    .sle-ibtn:hover, .sle-ibtn.on { opacity: 1; }
    .sle-ibtn.spin { animation: sle-spin .8s linear infinite; }
    @keyframes sle-spin { to { transform: rotate(360deg); } }

    .sle-filters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
      gap: 12px; align-items: end; margin: 4px 0 14px; color: var(--sle-text); }
    .sle-filters[hidden] { display: none; }
    .sle-f-title { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
    .sle-select { position: relative; min-height: 30px; box-sizing: border-box;
      padding: 4px 26px 4px 8px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
      background: var(--sle-bg); color: var(--sle-text);
      border: 1px solid var(--sle-border); border-radius: 3px; cursor: pointer; font-size: 13px; }
    .sle-select:hover, .sle-select.open { border-color: var(--sle-border-hover); }
    .sle-select::after { content: ''; position: absolute; right: 10px; top: 50%; margin-top: -2px;
      border: 4px solid transparent; border-top-color: var(--sle-muted); }
    .sle-select.open::after { margin-top: -6px; border-top-color: transparent;
      border-bottom-color: var(--sle-muted); }
    .sle-placeholder { color: var(--sle-muted); }
    .sle-tag { padding: 0 6px; border-radius: 3px; font-size: 12px; line-height: 20px;
      white-space: nowrap; }
    .sle-tag.inc { background: var(--sle-blue-bg); color: var(--sle-blue); }
    .sle-tag.exc { background: var(--sle-red-bg); color: var(--sle-red); text-decoration: line-through; }

    .sle-pop { position: absolute; left: -1px; top: calc(100% + 4px); z-index: 50;
      width: max(calc(100% + 2px), 300px); max-height: 280px; overflow-y: auto;
      box-sizing: border-box; padding: 8px; display: flex; flex-wrap: wrap; gap: 4px;
      background: var(--sle-pop-bg); border: 1px solid var(--sle-border); border-radius: 3px;
      box-shadow: 0 6px 18px var(--sle-shadow); cursor: default; }
    .sle-chip { font: inherit; font-size: 12px; line-height: 20px; padding: 0 8px; margin: 0;
      background: var(--sle-chip-bg); border: 1px solid var(--sle-border); border-radius: 3px;
      color: var(--sle-text); cursor: pointer; }
    .sle-chip:hover { border-color: var(--sle-border-hover); }
    .sle-chip.inc { background: var(--sle-blue-bg); border-color: var(--sle-blue-border);
      color: var(--sle-blue); }
    .sle-chip.exc { background: var(--sle-red-bg); border-color: var(--sle-red-border);
      color: var(--sle-red); text-decoration: line-through; }

    .sle-reset { font: inherit; font-size: 12px; line-height: 20px; padding: 4px 10px; margin: 0;
      white-space: nowrap; cursor: pointer; border-radius: 3px;
      background: var(--sle-red-bg); border: 1px solid var(--sle-red-border); color: var(--sle-red); }
    .sle-reset:hover { border-color: var(--sle-red); }

    /* "i" — a letter in a circle, like an info icon */
    .sle-ibtn-i { width: 15px; height: 15px; padding: 0; margin: 0 3px; box-sizing: border-box;
      border: 1.5px solid currentColor; border-radius: 50%;
      font: italic 700 10px/12px Georgia, 'Times New Roman', serif; text-align: center; }

    .sle-info { margin: 4px 0 14px; padding: 10px 14px; box-sizing: border-box;
      background: var(--sle-pop-bg); color: var(--sle-text);
      border: 1px solid var(--sle-border); border-radius: 3px; font-size: 13px; line-height: 1.5; }
    .sle-info[hidden] { display: none; }
    .sle-info p { margin: 0 0 6px; }
    .sle-info ul { margin: 0 0 8px; padding: 0; list-style: none; }
    .sle-info li { margin: 4px 0; display: flex; align-items: flex-start; gap: 6px; line-height: 20px; }
    /* Literal [ ] around the icon; fixed width so all descriptions line up */
    .sle-key { flex: none; width: 34px; display: flex; justify-content: space-between;
      align-items: center; font-family: monospace; font-size: 13px; line-height: 20px;
      color: var(--sle-muted); }
    .sle-key-icon { width: 18px; text-align: center; overflow: visible; white-space: nowrap;
      font-family: system-ui, sans-serif; color: var(--sle-text); }
    .sle-info .sle-tag { display: inline-block; }
    .sle-info-note { color: var(--sle-muted); font-size: 12px; margin: 0 !important; }

    /* Placeholders: a copy of the site's card with the same size but no content,
       so the block doesn't jump while cards change */
    .sle-skel { pointer-events: none; }
    .sle-skel * { visibility: hidden !important; }
    .sle-skel .sle-skel-box, .sle-skel .sle-skel-line {
      visibility: visible !important; border-radius: 3px; background: var(--sle-chip-bg); }
    .sle-skel .sle-skel-line { color: transparent !important; text-decoration: none !important; }
    .sle-skel-anim .sle-skel-box, .sle-skel-anim .sle-skel-line {
      background: linear-gradient(90deg, var(--sle-chip-bg) 25%, var(--sle-border) 50%, var(--sle-chip-bg) 75%);
      background-size: 300% 100%; animation: sle-shimmer 1.2s ease-in-out infinite; }
    @keyframes sle-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
    /* Empty slot (fewer cards than places): just a dashed outline */
    .sle-skel-slot .sle-skel-box { background: none; outline: 1px dashed var(--sle-border);
      outline-offset: -1px; }
    .sle-skel-slot .sle-skel-line { visibility: hidden !important; }

    .sle-fade { animation: sle-fade .25s ease-out; }
    @keyframes sle-fade { from { opacity: 0; } to { opacity: 1; } }

    /* "Nothing here": takes the same space as a row of cards */
    .sle-empty { flex: 1 1 100%; box-sizing: border-box; display: flex; align-items: center;
      justify-content: center; flex-direction: column; gap: 6px; text-align: center;
      border: 1px dashed var(--sle-border); border-radius: 4px; color: var(--sle-muted);
      font-size: 13px; margin-bottom: 30px; }
    .sle-empty-icon { font-size: 22px; line-height: 1; opacity: .7; }
    /* "upcoming | aired" mode: label over an empty half */
    .sle-empty-half { position: absolute; z-index: 3; display: flex; align-items: center;
      justify-content: center; text-align: center; padding: 0 12px; box-sizing: border-box;
      color: var(--sle-muted); font-size: 13px; pointer-events: none; }
    .sle-badge { position: absolute; left: 4px; top: 4px; z-index: 2; pointer-events: none;
      padding: 1px 5px; border-radius: 3px; font-size: 11px; line-height: 16px; white-space: nowrap;
      background: rgba(0,0,0,.72); color: #fff; }
    .sle-badge-future { background: rgba(23,96,147,.88); }

    .sle-debug { margin: 6px 0 0; font-size: 11px; }
    .sle-debug summary { cursor: pointer; opacity: .5; }
    .sle-debug pre { font: 10px/1.4 monospace; opacity: .6; white-space: pre-wrap; margin: 4px 0 0; }
  `;

  // A separate small <style> holding only theme variables; it gets rewritten
  const themeStyle = document.createElement('style');
  themeStyle.className = 'stylus sle-theme';

  const rgbOf = (c) => (String(c).match(/[\d.]+/g) || []).map(Number);
  const isTransparent = (c) => { const v = rgbOf(c); return v.length < 3 || v[3] === 0; };
  const lum = (c) => { const [r, g, b] = rgbOf(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

  function sampleBg(el) {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (!isTransparent(c)) return c;
    }
    const c = getComputedStyle(document.documentElement).backgroundColor;
    return isTransparent(c) ? null : c;
  }

  function updateTheme() {
    const ref = current?.inner?.isConnected ? current.inner : document.body;
    if (!ref) return;
    const text = getComputedStyle(ref).color;
    // Decide dark vs light by text color: Shikimori's background may be an image
    const dark = lum(text) > 0.5;
    let bg = sampleBg(ref);
    // Background must match the theme, otherwise use the default (Dark Reader's is #181a1b)
    if (!bg || (dark ? lum(bg) > 0.4 : lum(bg) < 0.6)) bg = dark ? '#181a1b' : '#ffffff';
    const blue = dark ? '#72b7ec' : '#176093';
    const red = dark ? '#e57b72' : '#c0392b';
    const mix = (c, p, base = 'var(--sle-bg)') => `color-mix(in srgb, ${c} ${p}%, ${base})`;
    const css = `:root {
      --sle-bg: ${bg}; --sle-text: ${text};
      --sle-muted: ${mix('var(--sle-text)', 45)};
      --sle-border: ${mix('var(--sle-text)', dark ? 18 : 22)};
      --sle-border-hover: ${mix('var(--sle-text)', 40)};
      --sle-chip-bg: ${mix('var(--sle-text)', dark ? 7 : 5)};
      --sle-pop-bg: ${dark ? mix('var(--sle-text)', 5) : 'var(--sle-bg)'};
      --sle-shadow: ${dark ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.18)'};
      --sle-blue: ${blue}; --sle-blue-bg: ${mix(blue, dark ? 20 : 14)};
      --sle-blue-border: ${mix(blue, dark ? 45 : 35)};
      --sle-red: ${red}; --sle-red-bg: ${mix(red, dark ? 18 : 10)};
      --sle-red-border: ${mix(red, dark ? 45 : 35)};
    }`;
    if (themeStyle.textContent !== css) themeStyle.textContent = css;
  }

  // Dark Reader can be toggled live; it marks this with attributes on <html>
  new MutationObserver(() => requestAnimationFrame(updateTheme))
    .observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-darkreader-mode', 'data-darkreader-scheme', 'class', 'data-theme'],
    });

  // ---------- cards ----------

  let data = null;
  let current = null;      // elements of the currently mounted block
  let openGroup = null;    // which dropdown is open right now
  let infoOpen = false;    // whether the "i" help is open

  function replaceText(root, from, to) {
    if (!from || from === to) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.split(from).join(to);
    }
    root.querySelectorAll('[title]').forEach((el) => { el.title = el.title.split(from).join(to); });
  }

  const leaves = (root) => [...root.querySelectorAll('*')].filter((el) => !el.children.length);

  // "in 40 min", "in 5h", "tomorrow 17:00", "Oct 14 17:00"
  function timeUntil(iso) {
    const d = new Date(iso);
    const ms = d - Date.now();
    const t = T();
    const hm = d.toLocaleTimeString(t.dateLocale, { hour: '2-digit', minute: '2-digit', hour12: false });
    if (ms < 36e5) return t.inMin(Math.max(1, Math.round(ms / 6e4)));
    if (ms < 12 * 36e5) return t.inH(Math.round(ms / 36e5));
    const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
    const today = d < tomorrow;
    const isTomorrow = !today && d < new Date(tomorrow.getTime() + DAY);
    if (today) return t.today(hm);
    if (isTomorrow) return t.tomorrow(hm);
    return `${d.toLocaleDateString(t.dateLocale, { day: 'numeric', month: 'short' })} ${hm}`;
  }

  function timeAgo(iso) {
    const h = Math.floor((Date.now() - new Date(iso)) / 36e5);
    const t = T();
    if (h < 1) return t.justNow;
    if (h < 24) return t.hAgo(h);
    return t.dAgo(Math.floor(h / 24));
  }

  function buildCard(a, future = false) {
    const { template, tpl } = current;
    const card = template.cloneNode(true);
    const newId = String(a.id);

    // Every attribute holding the old id (id, entry-XXXX, data-track_user_rate…) → new id
    if (tpl.id) {
      [card, ...card.querySelectorAll('*')].forEach((el) => {
        for (const attr of [...el.attributes]) {
          if (attr.name === 'src' || attr.name === 'srcset') continue;
          if (attr.value.includes(tpl.id)) {
            el.setAttribute(attr.name, attr.value.split(tpl.id).join(newId));
          }
        }
      });
    }
    card.querySelectorAll('a[href*="/animes/"]').forEach((el) => el.setAttribute('href', a.url));

    // My-list status (planned, watching…) comes from the new title, not the template
    LIST_KEYS.forEach((s) => card.classList.remove(s));
    if (data.rates[a.id]) card.classList.add(data.rates[a.id]);

    // Title in the language chosen in profile settings
    const shownName = namesLang() === 'ru' ? a.russian : a.name;

    // Poster
    const poster = posterOf(a);
    card.querySelectorAll('source').forEach((s) => s.remove());
    card.querySelectorAll('img').forEach((img) => {
      img.removeAttribute('srcset');
      poster ? (img.src = poster) : img.removeAttribute('src');
      img.dataset.sleAnime = newId;
      img.alt = shownName;
    });

    // Titles
    // tpl.russian — the label the template displayed (from the poster's alt),
    // tpl.name — the original title (from the link's title attribute)
    replaceText(card, tpl.russian, shownName);
    replaceText(card, tpl.name, a.name);

    // Score, kind, year
    const kindLabels = ALL_KIND_LABELS;
    for (const el of leaves(card)) {
      const t = el.textContent.trim();
      if (/^★?\s*\d{1,2}(\.\d{1,2})?$/.test(t) && el.closest('a, div, span') && t !== a.year) {
        if (+a.score > 0) el.textContent = el.textContent.replace(/\d{1,2}(\.\d{1,2})?/, a.score);
        else el.remove();
      } else if (kindLabels.includes(t)) {
        el.textContent = T().kinds[a.kind] || a.kind || t;
      } else if (/^\d{4}$/.test(t) && a.year) {
        el.textContent = a.year;
      }
    }

    // Episode badge over the poster
    const imgWrap = card.querySelector('img')?.parentElement;
    if (imgWrap) {
      if (getComputedStyle(imgWrap).position === 'static') imgWrap.style.position = 'relative';
      const badge = document.createElement('span');
      badge.className = 'sle-badge' + (future ? ' sle-badge-future' : '');
      badge.textContent = `${T().ep} ${a.episode}${a.total ? '/' + a.total : ''} · `
        + (future ? timeUntil(a.date) : timeAgo(a.date));
      imgWrap.appendChild(badge);
    }
    return card;
  }

  // ---------- rendering ----------

  // Which cards the block should contain right now
  function computeItems() {
    const now = Date.now();
    if (!settings.split) {
      return { future: [], past: data.candidates.filter((a) => passes(a, data)).slice(0, LIMIT) };
    }
    // Future on the left, past on the right; the whole row runs from later to earlier:
    // furthest upcoming … soonest upcoming | most recently aired … older
    const future = (data.upcoming || [])
      .filter((a) => new Date(a.date).getTime() > now && passes(a, data))
      .slice(0, HALF)
      .reverse();
    const past = data.candidates.filter((a) => passes(a, data)).slice(0, HALF);
    return { future, past };
  }

  const clearInner = () => current.inner
    .querySelectorAll('article.b-catalog_entry, .sle-empty, .sle-empty-half, .sle-skel')
    .forEach((el) => el.remove());

  // Placeholder = a copy of the site's card, same size, no content
  function makeSkel(kind) { // kind: 'anim' — shimmering, 'slot' — empty place
    const t = current.template;
    const el = t.cloneNode(true);
    el.removeAttribute('id');
    el.className = [...t.classList].filter((c) => /^(c-|b-)/.test(c)).join(' ')
      + ' sle-skel ' + (kind === 'anim' ? 'sle-skel-anim' : 'sle-skel-slot');
    el.setAttribute('aria-hidden', 'true');
    el.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    el.querySelectorAll('a').forEach((n) => { n.removeAttribute('href'); n.tabIndex = -1; });
    const box = el.querySelector('img')?.parentElement;
    box?.classList.add('sle-skel-box');
    // Turn text lines into bars of the same width
    leaves(el).forEach((n) => {
      if (n.textContent.trim() && !(box && box.contains(n))) n.classList.add('sle-skel-line');
    });
    return el;
  }

  function showSkeleton() {
    const { inner } = current;
    // Remember the row height so the empty state takes the same space
    current.rowHeight = Math.max(current.rowHeight || 0, inner.offsetHeight || 0);
    clearInner();
    inner.append(...Array.from({ length: LIMIT }, () => makeSkel('anim')));
  }

  function emptyBlock() {
    const el = document.createElement('div');
    el.className = 'sle-empty';
    el.style.minHeight = Math.max((current.rowHeight || 0) - 30, 160) + 'px';
    el.innerHTML = `<span class="sle-empty-icon">∅</span><span>${esc(T().empty)}</span>`;
    return el;
  }

  // Label over an empty half in "upcoming | aired" mode
  function overlayHalf(slots) {
    if (!slots.length) return;
    const { inner } = current;
    if (getComputedStyle(inner).position === 'static') inner.style.position = 'relative';
    const base = inner.getBoundingClientRect();
    const a = slots[0].querySelector('.sle-skel-box') || slots[0];
    const b = slots[slots.length - 1].querySelector('.sle-skel-box') || slots[slots.length - 1];
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'sle-empty-half';
    el.style.left = Math.min(ra.left, rb.left) - base.left + 'px';
    el.style.top = ra.top - base.top + 'px';
    el.style.width = Math.abs(rb.right - ra.left) + 'px';
    el.style.height = ra.height + 'px';
    el.textContent = T().empty;
    inner.append(el);
  }

  function paint(future, past) {
    const { inner } = current;
    clearInner();
    if (!future.length && !past.length) {
      inner.append(emptyBlock());
      return;
    }
    const slot = () => makeSkel('slot');
    const fill = (cards, n, atStart) => {
      while (cards.length < n) atStart ? cards.unshift(slot()) : cards.push(slot());
      return cards;
    };
    let cards;
    let emptyFuture = [];
    let emptyPast = [];
    if (settings.split) {
      const f = fill(future.map((a) => buildCard(a, true)), HALF, true);
      const p = fill(past.map((a) => buildCard(a)), HALF, false);
      if (!future.length) emptyFuture = f;
      if (!past.length) emptyPast = p;
      cards = [...f, ...p];
    } else {
      cards = fill(past.map((a) => buildCard(a)), LIMIT, false); // newest episode on the left
    }
    cards.forEach((c) => c.classList.add('sle-fade'));
    inner.append(...cards);
    overlayHalf(emptyFuture);
    overlayHalf(emptyPast);
    current.rowHeight = Math.max(current.rowHeight || 0, inner.offsetHeight || 0);
    fixMissingPosters([...future, ...past]);
  }

  // Repaint the row only when its contents change. Briefly show a same-size
  // placeholder first so the block doesn't jump.
  let paintToken = 0;
  function renderCards() {
    const { future, past } = computeItems();
    const key = [settings.split, uiLang(), namesLang(),
      ...future.map((a) => 'f' + a.id), ...past.map((a) => a.id)].join(',');
    if (key === current.renderedKey) return;
    current.renderedKey = key;
    const token = ++paintToken;
    const target = current;
    showSkeleton();
    setTimeout(() => {
      if (token !== paintToken || target !== current || !target.inner.isConnected) return;
      paint(future, past);
    }, SKELETON_MS);
  }

  function renderFilters() {
    const el = current.filtersEl;
    el.hidden = !settings.open;
    if (!settings.open) { el.innerHTML = ''; return; }

    const pop = el.querySelector('.sle-pop');
    const popScroll = pop ? pop.scrollTop : 0;

    const t = T();
    el.innerHTML = GROUPS.map(({ key }) => {
      const title = t.groups[key];
      const f = settings.filters[key];
      const opts = optionsFor(key, data);
      const label = (id) => opts.find((o) => o.id === id)?.label || '#' + id;
      const tags = [
        ...f.include.map((id) => `<span class="sle-tag inc">${esc(label(id))}</span>`),
        ...f.exclude.map((id) => `<span class="sle-tag exc">${esc(label(id))}</span>`),
      ].join('');
      const isOpen = openGroup === key;
      const chips = opts.length
        ? opts.map((o) => {
            const st = f.include.includes(o.id) ? 'inc' : f.exclude.includes(o.id) ? 'exc' : '';
            return `<button type="button" class="sle-chip ${st}" data-id="${esc(o.id)}">${esc(o.label)}</button>`;
          }).join('')
        : `<span class="sle-placeholder">${data ? t.failed : t.loading}</span>`;
      return `
        <div class="sle-f" data-key="${key}">
          <div class="sle-f-title">${title}</div>
          <div class="sle-select ${isOpen ? 'open' : ''}">
            ${tags || `<span class="sle-placeholder">${t.any}</span>`}
            ${isOpen ? `<div class="sle-pop">${chips}</div>` : ''}
          </div>
        </div>`;
    }).join('') + `<button type="button" class="sle-reset" data-act="reset">${esc(t.reset)}</button>`;

    const newPop = el.querySelector('.sle-pop');
    if (newPop) newPop.scrollTop = popScroll;
  }

  function renderDebug() {
    current.debugEl.querySelector('pre').textContent = log.join('\n');
  }

  function renderAll() {
    if (!current || !current.inner.isConnected) return;
    updateTheme();
    // Language-dependent labels are refreshed on every render
    const t = T();
    if (current.headingNode && current.headingNode.nodeValue !== t.heading) {
      current.headingNode.nodeValue = t.heading;
    }
    current.splitBtn.title = t.tSplit;
    current.gearBtn.title = t.tFilters;
    current.reloadBtn.title = t.tReload;
    current.debugEl.querySelector('summary').textContent = t.debug;
    current.infoBtn.title = t.tInfo;
    current.infoBtn.classList.toggle('on', infoOpen);
    current.infoEl.hidden = !infoOpen;
    if (infoOpen && current.infoEl.dataset.lang !== uiLang()) {
      current.infoEl.innerHTML = t.info;
      current.infoEl.dataset.lang = uiLang();
    }
    current.gearBtn.classList.toggle('on', settings.open);
    current.splitBtn.classList.toggle('on', settings.split);
    if (data) renderCards();
    renderFilters();
    renderDebug();
  }

  // ---------- mounting into the "Currently Airing" block ----------

  function setup(inner) {
    const fc = inner.closest('.fc-ongoings');
    const block = inner.closest('.block2') || fc.parentElement;
    const head = block.querySelector('.subheadline');
    const first = inner.querySelector('article.b-catalog_entry');
    if (!first) return;

    // If the page was restored from the navigation cache, our old elements
    // may still be there without handlers — remove them
    block.querySelectorAll('.sle-tools, .sle-filters, .sle-debug').forEach((el) => el.remove());

    const template = first.cloneNode(true);
    template.querySelectorAll('.sle-badge').forEach((el) => el.remove());
    const link = template.querySelector('a[href*="/animes/"]');
    const tpl = {
      id: template.id,
      russian: template.querySelector('img')?.getAttribute('alt') || '',
      name: link?.getAttribute('title') || '',
    };

    // Heading
    // Its text depends on the site language, so instead of matching a phrase,
    // replace the longest text in the heading — that is the block title
    let headingNode = null;
    if (head) {
      const walker = document.createTreeWalker(head, NodeFilter.SHOW_TEXT);
      let node, longest = null;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('.sle-tools')) continue;
        if (node.nodeValue.trim().length > (longest?.nodeValue.trim().length || 0)) longest = node;
      }
      if (longest) {
        headingNode = longest;
      }
      if (getComputedStyle(head).position === 'static') head.style.position = 'relative';
    }

    // Heading buttons: mode, filters, info, refresh
    const tools = document.createElement('span');
    tools.className = 'sle-tools';
    tools.innerHTML = `
      <button type="button" class="sle-ibtn" data-act="split">⇆</button>
      <button type="button" class="sle-ibtn" data-act="toggle">⚙</button>
      <button type="button" class="sle-ibtn sle-ibtn-i" data-act="info">i</button>
      <button type="button" class="sle-ibtn" data-act="reload">↻</button>`;
    (head || block).appendChild(tools);

    const infoEl = document.createElement('div');
    infoEl.className = 'sle-info';
    infoEl.hidden = true;
    fc.before(infoEl);

    const filtersEl = document.createElement('div');
    filtersEl.className = 'sle-filters';
    fc.before(filtersEl);

    const debugEl = document.createElement('details');
    debugEl.className = 'sle-debug';
    debugEl.innerHTML = '<summary></summary><pre></pre>';
    debugEl.hidden = !DEBUG; // the panel is kept in code; flip DEBUG to show it
    fc.after(debugEl);

    current = {
      inner, headingNode, tools, template, tpl, filtersEl, debugEl, infoEl,
      infoBtn: tools.querySelector('[data-act="info"]'),
      gearBtn: tools.querySelector('[data-act="toggle"]'),
      splitBtn: tools.querySelector('[data-act="split"]'),
      reloadBtn: tools.querySelector('[data-act="reload"]'),
    };

    tools.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.act === 'split') {
        settings.split = !settings.split;
        saveSettings();
        renderAll();
      } else if (btn.dataset.act === 'info') {
        infoOpen = !infoOpen;
        renderAll();
      } else if (btn.dataset.act === 'toggle') {
        settings.open = !settings.open;
        openGroup = null;
        saveSettings();
        renderAll();
      } else if (btn.dataset.act === 'reload' && !btn.classList.contains('spin')) {
        btn.classList.add('spin');
        log.length = 0;
        try {
          data = await loadData(true);
          fixHentaiId(data);
        } catch (err) {
          log.push('✗ ' + err.message);
        }
        btn.classList.remove('spin');
        current.renderedKey = null; // after a manual refresh, repaint regardless
        renderAll();
      }
    });

    filtersEl.addEventListener('click', (e) => {
      const key = e.target.closest('.sle-f')?.dataset.key;
      const chip = e.target.closest('.sle-chip');

      if (chip && key) {
        // cycle: off → only → without → off
        const f = settings.filters[key];
        const id = chip.dataset.id;
        const drop = (arr) => { const i = arr.indexOf(id); if (i !== -1) arr.splice(i, 1); };
        if (f.include.includes(id)) { drop(f.include); f.exclude.push(id); }
        else if (f.exclude.includes(id)) drop(f.exclude);
        else f.include.push(id);
        saveSettings();
        if (data) renderCards();
        renderFilters();
      } else if (e.target.closest('[data-act="reset"]')) {
        settings.filters = defaultFilters();
        openGroup = null;
        saveSettings();
        renderAll();
      } else if (key && e.target.closest('.sle-select') && !e.target.closest('.sle-pop')) {
        openGroup = openGroup === key ? null : key;
        renderFilters();
      }
    });

    showSkeleton(); // until data arrives, placeholders instead of random ongoings
    renderAll();
  }

  // Close the dropdown on a click outside it
  document.addEventListener('click', (e) => {
    if (openGroup && current && !e.target.closest('.sle-f')) {
      openGroup = null;
      renderFilters();
    }
  });

  // ---------- page transitions ----------
  // Shikimori swaps <body> on navigation without a reload, and Greasemonkey does
  // not re-run the script. So we watch the DOM: as soon as an ongoings block
  // we haven't touched appears, we mount into it.

  function check() {
    if (!style.isConnected && document.head) document.head.appendChild(style);
    if (!themeStyle.isConnected && document.head) document.head.appendChild(themeStyle);
    updateTheme();
    if (location.pathname !== '/') return;
    const inner = document.querySelector('.block2 .fc-ongoings .inner')
               || document.querySelector('.fc-ongoings .inner');
    if (!inner || inner === current?.inner) return;
    setup(inner);
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; check(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  ['turbolinks:load', 'turbo:load', 'page:load'].forEach((ev) => document.addEventListener(ev, check));
  window.addEventListener('popstate', check);

  // ---------- start ----------

  check();
  loadData()
    .then((d) => { data = d; fixHentaiId(d); })
    .catch((e) => {
      log.push('✗ ' + e.message);
      // Empty data, so "nothing here" shows instead of an endless placeholder
      data = { time: 0, candidates: [], upcoming: [], byAnime: {}, genreOptions: [], rates: {} };
    })
    .finally(() => {
      renderAll();
      if (DEBUG) console.log('[sle]', { data, settings, log });
    });
})();
