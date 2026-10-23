// ==UserScript==
// @name         Shikimori: Latest Episodes
// @namespace    shiki-latest-episodes
// @version      1.13
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

// Runs on every page, not just the home page: Shikimori switches pages without
// reloading, so the script has to be around already when you land on home.
//
// Note: Greasemonkey sandboxes the script even with @grant none, and fetch there
// doesn't understand relative paths. That's why all URLs are made absolute.

(() => {
  'use strict';

  const LIMIT = 8;                        // how many cards to show
  const HALF = LIMIT / 2;                 // split mode: 4 upcoming + 4 aired
  const SKELETON_MS = 300;                // placeholder time, so the row doesn't jump
  const DEBUG = false;                    // set to true to see the debug panel
  // which copy of the script this is (release or dev), taken from the header
  const SCRIPT_ID = (typeof GM !== 'undefined' && GM.info?.script?.namespace)
    || (typeof GM_info !== 'undefined' && GM_info.script?.namespace)
    || 'shiki-latest-episodes';
  const priority = (id) => (/-dev$/.test(id) ? 2 : 1); // dev beats release
  // false if the other copy of the script has taken over the block
  const isOwner = () => current?.inner.closest('.block2')?.dataset.sleOwner === SCRIPT_ID;
  const DAY = 24 * 60 * 60 * 1000;
  const DATA_TTL = 10 * 60 * 1000;        // refetch data every 10 min
  const SETTINGS_KEY = 'sle_settings_v3';
  const DATA_KEY = 'sle_data_v7';
  const POSTER_KEY = 'sle_posters_v1';
  const HENTAI_KEY = 'sle_hentai_id';
  const log = [];


  // Language. Shikimori puts the profile settings on <body>:
  //   data-locale           - site language (ru / en)
  //   data-localized_genres - genre names language
  //   data-localized_names  - anime titles language
  // They're separate checkboxes in the profile, so we check each one.
  // Read fresh every time in case the user switches language.
  const bodyLang = (attr) => (document.body?.dataset[attr] === 'en' ? 'en' : 'ru');
  const uiLang = () => bodyLang('locale');
  const genresLang = () => bodyLang('localized_genres');
  const namesLang = () => bodyLang('localized_names');

  // [icon] for the help popup. Fixed width so all the lines start in the same place
  // funnel icon for the filters button (there's no good funnel character in fonts)
  const FUNNEL = '<svg class="sle-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
    + '<path d="M2 3h12l-4.6 5.4V13l-2.8 1.4V8.4z" fill="none" stroke="currentColor" '
    + 'stroke-width="1.6" stroke-linejoin="round"/></svg>';
  // "upcoming | aired" icon: two arrows
  const SWAP = '<svg class="sle-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
    + '<path d="M2.5 5.2h10M9.6 2.4l2.9 2.8-2.9 2.8M13.5 10.8h-10M6.4 8l-2.9 2.8 2.9 2.8" fill="none" '
    + 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // settings icon: a gear (the teeth are a dashed thick circle)
  const GEAR = '<svg class="sle-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
    + '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="2.2 2.2"/>'
    + '<circle cx="8" cy="8" r="3.7" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
  // refresh icon: a circle with an arrow, drawn around the centre so it spins evenly
  const REFRESH = '<svg class="sle-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
    + '<path d="M13.2 8A5.2 5.2 0 1 1 11.7 4.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M12.2 1.6v3.1H9.1" fill="none" stroke="currentColor" stroke-width="1.6" '
    + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const keyIcon = (c) =>
    `<span class="sle-key"><span>[</span><span class="sle-key-icon">${c.startsWith('<') ? c : c + '\uFE0E'}</span><span>]</span></span>`;

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
      tipKind: 'Тип', tipEpisodes: 'Эпизоды', tipNext: 'Следующий эпизод', tipGenres: 'Жанры',
      tipRating: 'рейтинг', addToList: 'Добавить в список', removeFromList: 'Удалить из списка',
      iconTitle: 'Значок списка', tSettings: 'Настройки',
      setAnim: 'Анимации', setAnimHint: 'Плавные появления, затухания и выезжающие панели',
      on: 'вкл', off: 'выкл', setPreview: 'Пример',
      colorsTitle: 'Цвета плашек', colorsAdvanced: 'Расширенные цвета', colorsReset: 'Сбросить цвета',
      colorLabels: {
        bgAired: 'Фон: вышла', bgFuture: 'Фон: скоро', bgFinal: 'Фон: последняя', text: 'Текст',
        textAired: 'Текст: вышла', textFuture: 'Текст: скоро', textFinal: 'Текст: последняя',
      }, setIconLoggedOut: 'войдите в аккаунт, чтобы его настроить',
      iconPos: { top: 'сверху', 'bottom-right': 'справа внизу', 'bottom-left': 'слева внизу' },
      signIn: 'войдите в аккаунт', signInHint: 'Фильтр по спискам работает, только когда вы вошли на Шикимори',
      ep: 'Эп.',
      justNow: 'только что', hAgo: (n) => `${n} ч. назад`, dAgo: (n) => `${n} дн. назад`,
      inMin: (n) => `через ${n} мин.`, inH: (n) => `через ${n} ч.`,
      today: (t) => `сегодня ${t}`, tomorrow: (t) => `завтра ${t}`,
      dateLocale: 'ru-RU',
      tInfo: 'Как это работает',
      info: `
        <ul>
          <li>${keyIcon(SWAP)}<span>Слева 4 серии, которые скоро выйдут, справа 4 уже вышедшие.
            Время будущих серий Шикимори указывает примерно, поэтому при переносах оно может сдвигаться.</span></li>
          <li>${keyIcon(FUNNEL)}<span>Фильтры по личным спискам, типу, жанрам и темам.</span></li>
          <li>${keyIcon(GEAR)}<span>Настройки: анимации и где показывать значок списка.</span></li>
          <li>${keyIcon(REFRESH)}<span>Обновить данные. Сами они обновляются раз в 10 минут.</span></li>
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
      tipKind: 'Kind', tipEpisodes: 'Episodes', tipNext: 'Next episode', tipGenres: 'Genres',
      tipRating: 'rating', addToList: 'Add to list', removeFromList: 'Remove from list',
      iconTitle: 'List icon', tSettings: 'Settings',
      setAnim: 'Animations', setAnimHint: 'Smooth fades and sliding panels',
      on: 'on', off: 'off', setPreview: 'Example',
      colorsTitle: 'Badge colours', colorsAdvanced: 'Advanced colours', colorsReset: 'Reset colours',
      colorLabels: {
        bgAired: 'Background: aired', bgFuture: 'Background: upcoming', bgFinal: 'Background: final', text: 'Text',
        textAired: 'Text: aired', textFuture: 'Text: upcoming', textFinal: 'Text: final',
      }, setIconLoggedOut: 'sign in to change it',
      iconPos: { top: 'top', 'bottom-right': 'bottom right', 'bottom-left': 'bottom left' },
      signIn: 'sign in first', signInHint: 'The list filter only works when you are signed in to Shikimori',
      ep: 'Ep.',
      justNow: 'just now', hAgo: (n) => `${n}h ago`, dAgo: (n) => `${n}d ago`,
      inMin: (n) => `in ${n} min`, inH: (n) => `in ${n}h`,
      today: (t) => `today ${t}`, tomorrow: (t) => `tomorrow ${t}`,
      dateLocale: 'en-US',
      tInfo: 'How it works',
      info: `
        <ul>
          <li>${keyIcon(SWAP)}<span>Episodes airing soon on the left, already aired on the right.
            Upcoming times are Shikimori’s estimate and may shift if an episode is delayed.</span></li>
          <li>${keyIcon(FUNNEL)}<span>Filter by your personal lists, kind, genres and themes.</span></li>
          <li>${keyIcon(GEAR)}<span>Settings: animations and where the list icon goes.</span></li>
          <li>${keyIcon(REFRESH)}<span>Refresh data. It also refreshes on its own every 10 minutes.</span></li>
        </ul>
        <p class="sle-info-note">Data comes from Shikimori’s updates feed and calendar,
          so air times may be inaccurate.</p>`,
    },
  };
  const T = () => I18N[uiLang()];

  // list statuses, used to clear planned/watching/etc classes from cards
  const LIST_KEYS = Object.keys(I18N.ru.lists);
  // kind names in both languages, to find them in the site's card
  const ALL_KIND_LABELS = [...Object.values(I18N.ru.kinds), ...Object.values(I18N.en.kinds)];

  const GROUPS = ['list', 'kind', 'genre', 'theme'].map((key) => ({ key }));

  // localStorage helpers

  const store = {
    get(key, def) {
      try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
    },
  };

  // Hentai is hidden by default. It's genre 12 on Shikimori, but we double check
  // by name once genres load, just in case (fixHentaiId).
  const hentaiId = () => store.get(HENTAI_KEY, '12');

  // include = only these, exclude = hide these
  const defaultFilters = () => {
    const f = Object.fromEntries(GROUPS.map((g) => [g.key, { include: [], exclude: [] }]));
    f.genre.exclude.push(hentaiId());
    return f;
  };

  const settings = Object.assign({ open: true, split: false, iconPos: 'top', animations: true, colors: {}, colorsAdvanced: false, filters: defaultFilters() },
    store.get(SETTINGS_KEY, {}));
  for (const g of GROUPS) settings.filters[g.key] ??= { include: [], exclude: [] };
  const saveSettings = () => store.set(SETTINGS_KEY, settings);

  // Network

  // In Firefox a script's own fetch goes out "from the extension", and the site
  // doesn't treat it as you (login cookies may not be sent). content.fetch sends
  // the request as the page itself, so we use it when it's there.
  async function siteFetch(url, opts) {
    try {
      if (typeof content !== 'undefined' && typeof content?.fetch === 'function') {
        return await content.fetch(url, opts);
      }
    } catch (e) {
      log.push('  content.fetch failed, using normal fetch: ' + e.message);
    }
    return fetch(url, opts);
  }

  async function getJSON(url, opts = {}) {
    const full = new URL(url, location.origin).href;
    const res = await siteFetch(full, {
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

  // Recently aired episodes

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

  // "Episode N aired" news, these have the exact time
  async function fromTopicUpdates() {
    const topics = await getJSON('/api/topics/updates?limit=50');
    return topics
      .filter((t) => t.event === 'episode' && t.linked)
      .map((t) => normalize(t.linked, t.episode, t.created_at));
  }

  // From the calendar: last episode is roughly next episode minus a week
  async function fromCalendar(list) {
    if (!list) throw new Error('calendar failed to load');
    const now = Date.now();
    return list
      .filter((e) => e.anime && e.anime.episodes_aired > 0 && e.next_episode_at)
      .map((e) => normalize(e.anime, e.anime.episodes_aired,
        new Date(new Date(e.next_episode_at).getTime() - 7 * DAY).toISOString()))
      .filter((a) => new Date(a.date).getTime() <= now);
  }

  // Use both sources, so there's enough left after filtering
  async function loadCandidates(cal) {
    const all = [];
    for (const src of [fromTopicUpdates, () => fromCalendar(cal)]) {
      try { all.push(...(await src())); } catch (e) { log.push('  ✗ ' + e.message); }
    }
    all.sort((a, b) => new Date(b.date) - new Date(a.date));
    const seen = new Set();
    return all.filter((a) => !seen.has(a.id) && seen.add(a.id));
  }

  // Upcoming episodes. The calendar only knows the next episode of each show,
  // so the 4 upcoming cards are always 4 different anime.
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

  // Genres, themes, posters

  // Shikimori has genre, demographic (shounen, seinen...) and theme.
  // Demographics go with genres, same as the site's filters.
  const groupOf = (g) => (g.kind === 'theme' ? 'theme' : 'genre');

  // Grab posters here too: the old API image links show a "404" picture now.
  async function loadGenresByAnime(ids, posters) {
    const map = {}; // anime id -> its genres
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
    // Plan B: ask for each anime separately, slowly, because of the rate limit
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
      // no genre names at all, so just show the ids we have
      const seen = new Map();
      Object.values(byAnime).flat().forEach((g) => seen.set(g.id, g));
      return [...seen.values()].map((g) => ({ ...g, name: '#' + g.id }));
    }
  }

  // Besides the status we keep the rate id (needed to change or remove it)
  // and the user id (needed to add new ones)
  // Who's logged in: the site puts it on <body data-user='{"id": ...}'>,
  // so we don't depend on /api/users/whoami (it needs login cookies)
  function myUserId() {
    try { return JSON.parse(document.body?.dataset.user || 'null')?.id || null; } catch { return null; }
  }

  async function loadMyRates() {
    const empty = { rates: {}, rateInfo: {}, userId: null };
    try {
      let userId = myUserId();
      if (!userId) userId = (await getJSON('/api/users/whoami'))?.id;
      if (!userId) return empty;
      // the list comes in pages of up to 1000
      const list = [];
      for (let page = 1; page <= 20; page++) {
        const part = await getJSON(
          `/api/v2/user_rates?user_id=${userId}&target_type=Anime&limit=1000&page=${page}`);
        list.push(...part);
        if (part.length < 1000) break;
      }
      log.push(`  my list: ${list.length} anime`);
      return {
        userId,
        rates: Object.fromEntries(list.map((r) => [r.target_id, r.status])),
        rateInfo: Object.fromEntries(list.map((r) => [r.target_id, { id: r.id, episodes: r.episodes }])),
      };
    } catch (e) {
      log.push('  ✗ my list: ' + e.message);
      return { ...empty, userId: myUserId() };
    }
  }

  // Posters are cached separately and kept for good, they almost never change
  const getPosterCache = () => store.get(POSTER_KEY, {});
  const posterOf = (a) => getPosterCache()[a.id] || '';

  // Plan B: open the anime page and take the og:image
  async function fetchPosterFromPage(url) {
    const res = await siteFetch(url, { credentials: 'include' });
    log.push(`GET ${url.replace(location.origin, '')} → ${res.status} (poster)`);
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
    // 18+ titles have the site logo there instead of a poster, skip those.
    // Real posters are under /uploads/poster/animes/
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

  // Loading (with cache)

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
    const [genreOptions, mine] = await Promise.all([loadGenreOptions(byAnime), loadMyRates()]);
    const data = { time: Date.now(), candidates, upcoming, byAnime, genreOptions, ...mine };
    // don't cache an empty result, or a broken list load (we'd be stuck with it for 10 min)
    const listBroken = data.userId && !Object.keys(data.rates).length;
    if (candidates.length && !listBroken) store.set(DATA_KEY, data);
    return data;
  }

  // if Hentai turns out to have another id, fix the default filter
  function fixHentaiId(d) {
    const h = d.genreOptions.find((g) => /^(hentai|хентай)$/i.test(g.name) || /^хентай$/i.test(g.russian || ''));
    if (!h || h.id === hentaiId()) return;
    const ex = settings.filters.genre.exclude;
    const i = ex.indexOf(hentaiId());
    if (i !== -1) ex[i] = h.id;
    store.set(HENTAI_KEY, h.id);
    saveSettings();
  }

  // Filters

  function valuesOf(a, key, d) {
    switch (key) {
      case 'kind': return [a.kind];
      case 'list': return [d.rates[a.id] || 'none'];
      case 'genre':
      case 'theme': {
        const g = d.byAnime[a.id];
        return g ? g.filter((x) => x.group === key).map((x) => x.id) : null; // null if we don't know
      }
    }
  }

  function passes(a, d) {
    const loggedIn = Boolean(myUserId());
    for (const { key } of GROUPS) {
      if (key === 'list' && !loggedIn) continue; // no account, no lists to filter by
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

  // Styles. No fixed colors: we read text and background color from the page,
  // so it fits both normal Shikimori and Dark Reader. Everything else
  // (borders, tags, hints) is mixed from those two.
  //
  // class="stylus" is a small trick: Dark Reader leaves Stylus styles alone,
  // so it won't darken our already dark colors a second time.

  const style = document.createElement('style');
  style.className = 'stylus sle-style';
  style.textContent = `
    .sle-tools { position: absolute; right: 34px; top: 50%; transform: translateY(-50%);
      display: flex; gap: 4px; align-items: center; z-index: 2; }
    .sle-ibtn { background: none; border: 0; padding: 2px 5px; margin: 0; color: inherit;
      font: inherit; font-size: 16px; line-height: 1; cursor: pointer; opacity: .6;
      transition: opacity .15s; }
    .sle-ibtn:hover, .sle-ibtn.on { opacity: 1; }
    /* only the drawing spins, around its own centre (a text arrow wobbles because
       the character isn't centred in its line) */
    .sle-ibtn.spin .sle-svg { animation: sle-spin .8s linear infinite; transform-origin: 50% 50%; }
    @keyframes sle-spin { to { transform: rotate(360deg); } }

    .sle-filters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
      gap: 12px; align-items: end; margin: 4px 0 14px; color: var(--sle-text); }
    /* filters slide open/closed: the wrapper animates its height (0fr -> 1fr) */
    .sle-filters-wrap { display: grid; grid-template-rows: 0fr; opacity: 0;
      transition: grid-template-rows .22s ease, opacity .22s ease; }
    .sle-filters-wrap.open { grid-template-rows: 1fr; opacity: 1; }
    .sle-filters-wrap > .sle-filters { min-height: 0; overflow: hidden; margin: 0; }
    .sle-filters-wrap.open > .sle-filters { padding: 4px 0 14px; }
    /* once fully open, let the dropdowns hang outside */
    .sle-filters-wrap.settled > .sle-filters { overflow: visible; }

    /* help and settings: windows floating over the cards, full width of the block */
    .sle-window { position: absolute; left: 0; right: 0; z-index: 30; box-sizing: border-box;
      padding: 12px 14px; background: var(--sle-pop-bg); color: var(--sle-text);
      border: 1px solid var(--sle-border); border-radius: 3px; font-size: 13px; line-height: 1.5;
      box-shadow: 0 8px 24px var(--sle-shadow);
      opacity: 0; transform: translateY(-6px); visibility: hidden; pointer-events: none;
      transition: opacity .18s ease, transform .18s ease, visibility 0s linear .18s; }
    .sle-window.open { opacity: 1; transform: none; visibility: visible; pointer-events: auto;
      transition: opacity .18s ease, transform .18s ease; }
    .sle-svg { display: block; }
    .sle-key-icon .sle-svg { display: inline-block; vertical-align: -2px; }

    /* settings window */
    .sle-set-row { display: flex; gap: 16px; align-items: flex-start; padding: 6px 0; }
    .sle-set-row + .sle-set-row { border-top: 1px solid var(--sle-border); padding-top: 12px; margin-top: 6px; }
    .sle-set-label { flex: 0 0 160px; font-weight: 700; }
    .sle-set-label small { display: block; font-weight: 400; color: var(--sle-muted); font-size: 12px; }
    .sle-switch { display: inline-flex; border: 1px solid var(--sle-border); border-radius: 3px; overflow: hidden; }
    .sle-switch button { font: inherit; font-size: 12px; padding: 2px 12px; margin: 0; border: 0;
      background: none; color: var(--sle-muted); cursor: pointer; }
    .sle-switch button.on { background: var(--sle-blue-bg); color: var(--sle-blue); }
    /* settings on the left, one big live preview card on the right */
    .sle-settings-body { display: flex; gap: 40px; align-items: flex-start; }
    .sle-settings-list { flex: 0 1 640px; min-width: 0; }
    .sle-preview-big { flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .sle-preview-cardslot { width: 140px; }
    .sle-preview-cardslot article.b-catalog_entry { width: 140px !important; float: none !important;
      margin: 0 !important; display: block !important; }
    .sle-preview-caption { font-size: 12px; color: var(--sle-muted); }
    /* not signed in: the poster becomes a plain block of colour */
    .sle-preview-big.sle-no-poster .image-decor { background: var(--sle-chip-bg); }
    .sle-preview-big.sle-no-poster img { visibility: hidden; }
    .sle-switch button:disabled { cursor: not-allowed; }
    /* fixed column sizes: the layout never depends on which labels are showing */
    .sle-colors { display: grid; grid-template-columns: repeat(2, 206px); gap: 6px 20px; }
    /* advanced fields slide and fade in below the others (same 0fr -> 1fr trick as the
       filters row), so nothing that's already there moves and the window grows smoothly */
    .sle-colors-adv-wrap { display: grid; grid-template-rows: 0fr; opacity: 0;
      transition: grid-template-rows .22s ease, opacity .22s ease; }
    .sle-colors-wrap.adv .sle-colors-adv-wrap { grid-template-rows: 1fr; opacity: 1; }
    .sle-colors-adv { min-height: 0; overflow: hidden; }
    .sle-colors-adv > :first-child, .sle-colors-adv > :nth-child(2) { margin-top: 6px; }
    .sle-color { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .sle-color-name { flex: 0 0 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--sle-text); }
    .sle-color input { flex: none; }
    .sle-color input[type="color"] { width: 26px; height: 22px; padding: 0; margin: 0; cursor: pointer;
      border: 1px solid var(--sle-border); border-radius: 3px; background: none; }
    .sle-color input[type="text"] { width: 66px; box-sizing: border-box; padding: 2px 5px; margin: 0;
      font: 12px monospace; color: var(--sle-text); background: var(--sle-bg);
      border: 1px solid var(--sle-border); border-radius: 3px; }
    .sle-color input[type="text"].bad { border-color: var(--sle-red); }
    .sle-colors-buttons { display: flex; gap: 12px; margin-top: 8px; }
    .sle-linkbtn { font: inherit; font-size: 12px; background: none; border: 0; padding: 0; margin: 0;
      color: var(--sle-blue); cursor: pointer; }
    .sle-linkbtn.danger { color: var(--sle-red); }
    .sle-adv-toggle, .sle-reset-colors { display: block; font-weight: 400; margin-top: 3px; text-align: left; }
    .sle-adv-toggle::after { content: ' ▾'; }
    .sle-adv-toggle.on::after { content: ' ▴'; }
    /* with the advanced colours on, the common text colour stays visible but greyed out */
    .sle-color.off { opacity: .45; }
    .sle-color.off input { cursor: not-allowed; }
    .sle-set-row.sle-f-disabled .sle-switch { opacity: .6; }

    /* animations switched off in the settings: everything changes instantly */
    .sle-no-anim .sle-filters-wrap, .sle-no-anim .sle-window, .sle-no-anim .sle-fade,
    .sle-no-anim .sle-colors-adv-wrap,
    .sle-no-anim .sle-skel-anim .sle-skel-box, .sle-no-anim .sle-skel-anim .sle-skel-line,
    .sle-no-anim article[data-sle-card] .sle-badge,
    .sle-no-anim article[data-sle-card] .collection_score,
    .sle-no-anim article[data-sle-card] .image-decor::before,
    .sle-no-anim article[data-sle-card] .image-decor::after {
      transition: none !important; animation: none !important; }
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
    /* greyed out (list filter when you're not signed in) */
    .sle-f-disabled { opacity: .45; cursor: not-allowed; }
    .sle-f-disabled .sle-select { cursor: not-allowed; pointer-events: none; }
    .sle-f-disabled .sle-select::after { display: none; }
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

    /* the i button, a letter in a circle */
    .sle-ibtn-i { width: 15px; height: 15px; padding: 0; margin: 0 3px; box-sizing: border-box;
      border: 1.5px solid currentColor; border-radius: 50%;
      font: italic 700 10px/12px Georgia, 'Times New Roman', serif; text-align: center; }

    .sle-info { box-sizing: border-box;
      background: var(--sle-pop-bg); color: var(--sle-text);
      border: 1px solid var(--sle-border); border-radius: 3px; font-size: 13px; line-height: 1.5; }
    .sle-info[hidden] { display: none; }
    .sle-info p { margin: 0 0 6px; }
    .sle-info ul { margin: 0 0 8px; padding: 0; list-style: none; }
    .sle-info li { margin: 4px 0; display: flex; align-items: flex-start; gap: 6px; line-height: 20px; }
    /* [icon] with a fixed width, so the text lines up */
    .sle-key { flex: none; width: 34px; display: flex; justify-content: space-between;
      align-items: center; font-family: monospace; font-size: 13px; line-height: 20px;
      color: var(--sle-muted); }
    .sle-key-icon { width: 18px; text-align: center; overflow: visible; white-space: nowrap;
      font-family: system-ui, sans-serif; color: var(--sle-text); }
    .sle-info .sle-tag { display: inline-block; }
    .sle-info-note { color: var(--sle-muted); font-size: 12px; margin: 0 !important; }

    /* Placeholders: same size as real cards, so nothing jumps while they change */
    .sle-skel { pointer-events: none; }
    .sle-skel * { visibility: hidden !important; }
    .sle-skel .sle-skel-box, .sle-skel .sle-skel-line {
      visibility: visible !important; border-radius: 3px; background: var(--sle-chip-bg); }
    .sle-skel .sle-skel-line { color: transparent !important; text-decoration: none !important; }
    .sle-skel-anim .sle-skel-box, .sle-skel-anim .sle-skel-line {
      background: linear-gradient(90deg, var(--sle-chip-bg) 25%, var(--sle-border) 50%, var(--sle-chip-bg) 75%);
      background-size: 300% 100%; animation: sle-shimmer 1.2s ease-in-out infinite; }
    @keyframes sle-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
    /* empty slot when there aren't enough cards */
    .sle-skel-slot .sle-skel-box { background: none; outline: 1px dashed var(--sle-border);
      outline-offset: -1px; }
    .sle-skel-slot .sle-skel-line { visibility: hidden !important; }

    .sle-fade { animation: sle-fade .25s ease-out; }
    @keyframes sle-fade { from { opacity: 0; } to { opacity: 1; } }

    /* nothing found, takes the same space as the cards */
    .sle-empty { flex: 1 1 100%; box-sizing: border-box; display: flex; align-items: center;
      justify-content: center; flex-direction: column; gap: 6px; text-align: center;
      border: 1px dashed var(--sle-border); border-radius: 4px; color: var(--sle-muted);
      font-size: 13px; margin-bottom: 30px; }
    .sle-empty-icon { font-size: 22px; line-height: 1; opacity: .7; }
    /* split mode: text over an empty half */
    .sle-empty-half { position: absolute; z-index: 3; display: flex; align-items: center;
      justify-content: center; text-align: center; padding: 0 12px; box-sizing: border-box;
      color: var(--sle-muted); font-size: 13px; pointer-events: none; }
    .sle-badge { position: absolute; left: 4px; top: 4px; z-index: 2; pointer-events: none;
      display: flex; flex-direction: column; max-width: calc(100% - 8px); box-sizing: border-box;
      padding: 2px 5px; border-radius: 3px; font-size: 11px; line-height: 14px;
      background: var(--sle-bg-aired, rgba(0,0,0,.72)); color: var(--sle-text-aired, #fff); }
    /* each line gets cut with "..." instead of sticking out of the card */
    .sle-badge > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sle-badge-ep { font-weight: 600; }
    .sle-badge-future { background: var(--sle-bg-future, rgba(23,96,147,.88)); color: var(--sle-text-future, #fff); }
    .sle-badge-final { background: var(--sle-bg-final, rgba(46,125,50,.9)); color: var(--sle-text-final, #fff); }
    /* The round list-status icon is drawn by the site on the poster in two layers:
       .image-decor::before is the circle, .image-decor::after is the symbol inside it.
       Where it goes in our cards is a setting (data-sle-icon on the row, and on the
       preview in the settings window):
       top = where the site puts it, bottom-right = right above the score,
       bottom-left = bottom left corner, same gaps as the score has on the right.
       The exact numbers are worked out in placeStatusIcon(). */
    [data-sle-icon="bottom-right"] article[data-sle-card] .image-decor::before,
    [data-sle-icon="bottom-right"] article[data-sle-card] .image-decor::after {
      top: auto !important; bottom: var(--sle-icon-bottom, 26px) !important; }
    [data-sle-icon="bottom-left"] article[data-sle-card] .image-decor::before,
    [data-sle-icon="bottom-left"] article[data-sle-card] .image-decor::after {
      top: auto !important; right: auto !important;
      bottom: var(--sle-icon-corner-bottom, 4px) !important;
      left: var(--sle-icon-corner-left, 4px) !important; }
    /* hovering a card fades out the badge, status icon and score, so you can see the poster */
    :is(.fc-ongoings .inner, .sle-preview-big) article[data-sle-card] .sle-badge,
    :is(.fc-ongoings .inner, .sle-preview-big) article[data-sle-card] .collection_score,
    :is(.fc-ongoings .inner, .sle-preview-big) article[data-sle-card] .image-decor::before,
    :is(.fc-ongoings .inner, .sle-preview-big) article[data-sle-card] .image-decor::after {
      transition: opacity .15s ease; }
    :is(.fc-ongoings .inner, .sle-preview-big) article[data-sle-card]:hover .sle-badge,
    :is(.fc-ongoings .inner, .sle-preview-big) article[data-sle-card]:hover .collection_score,
    :is(.fc-ongoings .inner, .sle-preview-big) article[data-sle-card]:hover .image-decor::before,
    :is(.fc-ongoings .inner, .sle-preview-big) article[data-sle-card]:hover .image-decor::after {
      opacity: 0 !important; }

    /* tooltip on hover, uses the site's own classes so it looks the same */
    .sle-tooltip { z-index: 10 !important; }
    .sle-tooltip .b-user_rate.sle-saving { opacity: .55; pointer-events: none; }
    .sle-tooltip .b-user_rate.sle-error { outline: 1px solid var(--sle-red); outline-offset: 2px; }
    .sle-tooltip .expanded-options { overflow: hidden; }

    .sle-debug { margin: 6px 0 0; font-size: 11px; }
    .sle-debug summary { cursor: pointer; opacity: .5; }
    .sle-debug pre { font: 10px/1.4 monospace; opacity: .6; white-space: pre-wrap; margin: 4px 0 0; }
  `;

  // small separate <style> just for the color variables, rewritten when needed
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
    // light text means dark theme (can't trust the background, it may be a picture)
    const dark = lum(text) > 0.5;
    let bg = sampleBg(ref);
    // if the background doesn't fit the theme, use a default one (#181a1b is Dark Reader's)
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

  // Dark Reader can be turned on/off any time, it changes attributes on <html>
  new MutationObserver(() => requestAnimationFrame(updateTheme))
    .observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-darkreader-mode', 'data-darkreader-scheme', 'class', 'data-theme'],
    });

  // Cards

  let data = null;
  let current = null;      // our stuff on the current page
  let openGroup = null;    // open filter dropdown, if any
  let openWindow = null;   // 'info' or 'settings' when one of those windows is open

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

  // like "in 40 min", "in 5h", "tomorrow 17:00", "Oct 14 17:00"
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

  function fillBadge(badge, a, future) {
    // the last episode of the show gets a green badge
    const final = a.total > 0 && a.episode >= a.total;
    badge.className = 'sle-badge' + (final ? ' sle-badge-final' : future ? ' sle-badge-future' : '');
    // two short lines instead of one long one, so it fits on the poster in any language
    badge.innerHTML = `<span class="sle-badge-ep">${T().ep} ${a.episode}${a.total ? '/' + a.total : ''}</span>`
      + `<span class="sle-badge-time">${esc(future ? timeUntil(a.date) : timeAgo(a.date))}</span>`;
  }

  function buildCard(a, future = false) {
    const { template, tpl } = current;
    const card = template.cloneNode(true);
    card.setAttribute('data-sle-card', '');
    const newId = String(a.id);

    // swap the old anime id for the new one everywhere (id, entry-XXXX, data attrs)
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

    // The site only adds its tooltip to cards that exist when the page loads,
    // so our cards don't get one. Remove the site's hooks (so we never get two
    // tooltips) and use our own.
    const tipHost = card.hasAttribute('data-tooltip_url') ? card : card.querySelector('[data-tooltip_url]');
    const siteTipUrl = tipHost?.getAttribute('data-tooltip_url');
    [card, ...card.querySelectorAll('*')].forEach((el) => {
      el.removeAttribute('data-tooltip_url');
      el.classList.remove('bubbled', 'bubbled-processed');
    });
    const tipUrls = [a.url.replace(/\/$/, '') + '/tooltip', siteTipUrl].filter(Boolean);
    card.addEventListener('mouseenter', () => onCardEnter(card, a, future, tipUrls));
    card.addEventListener('mouseleave', onCardLeave);

    // list status should be for this anime, not the one we copied the card from
    LIST_KEYS.forEach((s) => card.classList.remove(s));
    if (data.rates[a.id]) card.classList.add(data.rates[a.id]);

    // title in the language from the profile
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

    // Titles. tpl.russian is what the copied card showed (poster alt),
    // tpl.name is the original title (link title)
    replaceText(card, tpl.russian, shownName);
    replaceText(card, tpl.name, a.name);

    // score, type, year
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

    // episode badge on the poster
    const imgWrap = card.querySelector('img')?.parentElement;
    if (imgWrap) {
      if (getComputedStyle(imgWrap).position === 'static') imgWrap.style.position = 'relative';
      const badge = document.createElement('span');
      fillBadge(badge, a, future);
      imgWrap.appendChild(badge);
    }
    return card;
  }

  // Put the status icon right above the score, with the same gap between the icon
  // and the score as between the score and the bottom of the poster.
  // The score sits in a different box than the icon, so we measure where both
  // really are and hand the result to the CSS through --sle-icon-bottom.
  function placeStatusIcon(card) {
    const decor = card.querySelector('.image-decor');
    const img = decor?.querySelector('img') || card.querySelector('img');
    const score = card.querySelector('.collection_score');
    if (!decor || !img || !score) return;
    const poster = img.getBoundingClientRect();
    if (poster.height < 40) {
      // poster not loaded yet, try again once it is
      img.addEventListener('load', () => placeStatusIcon(card), { once: true });
      return;
    }
    const s = score.getBoundingClientRect();
    if (!s.height) return;
    const d = decor.getBoundingClientRect();
    const gap = Math.min(Math.max(poster.bottom - s.bottom, 0), 20);    // score to poster bottom
    const sideGap = Math.min(Math.max(poster.right - s.right, 0), 20);  // score to poster right edge

    // bottom right: above the score, with the same gap as below it
    const iconBottom = s.top - gap; // where the bottom of the icon should be on screen
    card.style.setProperty('--sle-icon-bottom', `${Math.round(d.bottom - iconBottom)}px`);

    // bottom left: the score's gaps mirrored to the left corner
    card.style.setProperty('--sle-icon-corner-bottom', `${Math.round(d.bottom - (poster.bottom - gap))}px`);
    card.style.setProperty('--sle-icon-corner-left', `${Math.round(poster.left + sideGap - d.left)}px`);
  }

  // Tooltip on hover. We load the same HTML the site uses (/animes/<id>/tooltip)
  // and put it in the site's tooltip box. If that fails, we make a simpler one
  // from what we already know.

  const tipCache = new Map(); // anime id -> tooltip html
  let tipEl = null;
  let tipFor = null;          // which anime the tooltip is for
  let tipCard = null;
  let showTimer = 0;
  let hideTimer = 0;
  const SHOW_DELAY = 350;     // same delay as the site
  const HIDE_DELAY = 250;

  function fetchTooltip(id, urls) {
    if (!tipCache.has(id)) {
      const job = (async () => {
        for (const url of urls) {
          try {
            const full = new URL(url, location.origin).href;
            const res = await siteFetch(full, {
              credentials: 'include',
              headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' },
            });
            log.push(`GET ${full.replace(location.origin, '')} → ${res.status} (tooltip)`);
            if (!res.ok) continue;
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            doc.querySelectorAll('script, style').forEach((n) => n.remove());
            const node = doc.querySelector('.b-catalog_entry-tooltip')
                      || doc.querySelector('.tooltip-details');
            if (!node) continue;
            cleanTooltip(node);
            return node.classList.contains('tooltip-details') ? node.innerHTML : node.outerHTML;
          } catch (e) {
            log.push('  ✗ tooltip: ' + e.message);
          }
        }
        throw new Error('no tooltip');
      })();
      job.catch(() => tipCache.delete(id)); // try again next time
      tipCache.set(id, job);
    }
    return tipCache.get(id);
  }

  // The tooltip page also has a big poster, but the site's own hover tooltip
  // doesn't show it (and it squeezes the text into a narrow column), so drop it.
  // Small images inside the description text are left alone.
  function cleanTooltip(root) {
    // poster: the image link and anything left of it
    root.querySelectorAll('.image-link, picture').forEach((n) => n.remove());
    root.querySelectorAll('img').forEach((img) => {
      if (img.closest('.b-text_with_paragraphs, .text')) return;
      // remove the whole wrapper around the poster, not just the <img>
      let target = img;
      while (
        target.parentElement && target.parentElement !== root &&
        target.parentElement.children.length === 1 &&
        !target.parentElement.matches('.inner, .entry-tooltip_container')
      ) target = target.parentElement;
      target.remove();
    });
    // the site's scripts turn these into links, we do it ourselves
    root.querySelectorAll('.linkeable[data-href]').forEach((n) => {
      const link = document.createElement('a');
      link.className = n.className.replace(/\blinkeable\b/, '').trim();
      link.href = n.dataset.href;
      link.innerHTML = n.innerHTML;
      n.replaceWith(link);
    });
    // the button wrapper has a class on the site, the styles depend on it
    const rate = root.querySelector('.b-user_rate');
    if (rate && rate.parentElement && rate.parentElement !== root) {
      rate.parentElement.classList.add('flexible-button');
    }
  }

  // simple tooltip from our own data, in case the site's one doesn't load
  function fallbackTooltip(a, future) {
    const t = T();
    const ru = genresLang() === 'ru';
    const name = namesLang() === 'ru' ? a.russian : a.name;
    const genres = (data.byAnime[a.id] || [])
      .map((g) => data.genreOptions.find((o) => o.id === g.id))
      .filter(Boolean)
      .map((g) => `<span class="b-tag">${esc((ru && g.russian) || g.name)}</span>`)
      .join('');
    const line = (key, value) => !value ? '' : `
      <div class="line-container"><div class="line">
        <div class="key">${key}:</div><div class="value">${value}</div>
      </div></div>`;
    const kind = [t.kinds[a.kind] || a.kind, a.year].filter(Boolean).map(esc)
      .map((v) => `<span class="b-tag">${v}</span>`).join('');
    const aired = future ? a.episode - 1 : a.episode;
    return `
      <div class="b-catalog_entry-tooltip"><div class="entry-tooltip_container"><div class="inner">
        <div class="line name"><a class="data name" href="${esc(a.url)}">${esc(name)}</a></div>
        ${line(t.tipKind, kind)}
        ${line(t.tipEpisodes, `${aired} / ${a.total || '?'}`)}
        ${future ? line(t.tipNext, esc(timeUntil(a.date))) : ''}
        ${line(t.tipGenres, genres)}
        ${+a.score > 0 ? `<div class="rating"><span>${esc(a.score)}</span>
          <span class="text">${t.tipRating}</span></div>` : ''}
      </div></div>
      <div class="flexible-button">
        <div class="b-user_rate anime-${a.id}" data-target_id="${a.id}" data-target_type="Anime"></div>
      </div></div>`;
  }

  function ensureTip() {
    if (tipEl?.isConnected) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip minified sle-tooltip';
    tipEl.style.cssText = 'position: absolute; display: none;';
    // same structure as the site's tooltip, the border/shadow pieces live inside .clearfix
    const shadows = ['top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left']
      .map((d) => `<div class="dropshadow-${d}"></div>`).join('');
    tipEl.innerHTML = `
      <div class="tooltip-inner">
        <div class="tooltip-arrow" style="top: 40px;"></div>
        <div class="clearfix">
          <div class="close"></div>
          <div class="tooltip-details"></div>
          ${shadows}
        </div>
      </div>`;
    tipEl.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    tipEl.addEventListener('mouseleave', scheduleHide);
    tipEl.addEventListener('click', onTipClick);
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function onCardEnter(card, a, future, urls) {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (tipFor === a.id && tipEl?.style.display === 'block') return;
    showTimer = setTimeout(() => showTip(card, a, future, urls), SHOW_DELAY);
  }

  function onCardLeave() {
    clearTimeout(showTimer);
    scheduleHide();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTip, HIDE_DELAY);
  }

  function hideTip() {
    if (tipEl) tipEl.style.display = 'none';
    tipFor = null;
    tipCard = null;
  }

  async function showTip(card, a, future, urls) {
    const el = ensureTip();
    tipFor = a.id;
    tipCard = { card, a, future, urls };
    let html;
    try {
      html = await fetchTooltip(a.id, urls);
    } catch {
      html = fallbackTooltip(a, future);
    }
    if (tipFor !== a.id || !card.isConnected) return; // mouse is already somewhere else
    const details = el.querySelector('.tooltip-details');
    details.innerHTML = html;
    // the tooltip page sometimes comes without the rating, add it from our data
    const inner = details.querySelector('.inner');
    if (inner && !inner.querySelector('.rating') && +a.score > 0) {
      inner.querySelector(':scope > .data:empty')?.remove();
      inner.insertAdjacentHTML('beforeend', `<div class="rating"><span>${esc(a.score)}</span>`
        + `<span class="text">${T().tipRating}</span></div>`);
    }
    fillUserRate(details.querySelector('.b-user_rate'), a.id);
    el.style.display = 'block';
    positionTip(el, card);
  }

  // To the right of the poster like on the site, or to the left if there's no room.
  // The tooltip's top lines up with the top of the poster, so the anime title sits at that level.
  function positionTip(el, card) {
    // measure the poster <img> itself: its wrapper is an inline element, and an inline
    // wrapper reports a thin box down at the bottom of the image, not the image's top
    const img = card.querySelector('img');
    const imgRect = img?.getBoundingClientRect();
    const r = imgRect && imgRect.height > 20 ? imgRect : card.getBoundingClientRect();
    const arrow = el.querySelector('.tooltip-arrow');
    const box = el.querySelector('.tooltip-inner');

    // Don't guess what the tooltip is positioned against: put it at 0,0, see where
    // the visible box actually lands, and shift by the difference.
    // (The outer div is just a frame for the arrow; the box sits 20px right and ~44px lower.)
    el.style.left = '0px';
    el.style.top = '0px';
    const b = box.getBoundingClientRect();

    // The arrow sticks out of the box to the left, so leave room for it plus a small gap
    // (the arrow's tip ends up ~8px from the poster)
    const arrowWidth = arrow.offsetWidth || 22;
    let boxLeft = r.right + arrowWidth + 8;
    const flip = boxLeft + b.width > document.documentElement.clientWidth - 8;
    if (flip) boxLeft = Math.max(8, r.left - 8 - b.width);
    arrow.style.display = flip ? 'none' : '';

    el.style.left = boxLeft - b.left + 'px';
    el.style.top = r.top - b.top + 'px'; // top of the box = top of the poster, like on the site
  }

  // The "Add to list" button. On the site it's drawn by the site's scripts
  // (the tooltip page only has an empty <div class="b-user_rate to-process">),
  // so we draw the same markup ourselves.
  const STATUS_ORDER = ['completed', 'dropped', 'on_hold', 'planned', 'rewatching', 'watching'];

  function fillUserRate(rateEl, animeId) {
    if (!rateEl) return;
    rateEl.classList.remove('to-process');
    const userId = data.userId || myUserId();
    if (!userId) { rateEl.innerHTML = ''; return; } // not logged in

    const t = T();
    const id = Number(animeId || rateEl.dataset.target_id);
    const status = data.rates[id];
    const info = data.rateInfo?.[id];
    const saved = Boolean(status && info?.id);
    const name = (st) => `<span class="status-name" data-text="${esc(t.lists[st] || st)}"></span>`;

    rateEl.dataset.target_id = id;
    rateEl.dataset.model = JSON.stringify({ id: info?.id ?? null, target_id: id, status: status || 'planned' });

    const trigger = saved
      ? `<div class="text add-trigger"><span class="edit"></span>${name(status)}${
        info.episodes > 0 && /watching/.test(status) ? `<span class="current-episodes"> – ${info.episodes}</span>` : ''}</div>`
      : `<div class="text add-trigger" data-status="planned"><span class="plus"></span>`
        + `<span class="status-name" data-text="${esc(t.addToList)}"></span></div>`;

    const options = STATUS_ORDER
      .filter((st) => !saved || st !== status)
      .map((st) => `<div class="option add-trigger" data-status="${st}"><div class="text">${name(st)}</div></div>`)
      .join('');
    const remove = saved
      ? `<div class="option remove-trigger" data-action="/api/v2/user_rates/${info.id}" data-method="delete">`
        + `<div class="text"><span class="status-name" data-text="${esc(t.removeFromList)}"></span></div></div>`
      : '';

    rateEl.innerHTML = `
      <div>
        <div class="b-add_to_list ${saved ? status : 'planned'}">
          <form action="/api/v2/user_rates${saved ? '/' + info.id : ''}" data-method="${saved ? 'PATCH' : 'POST'}">
            <input type="hidden" name="frontend" value="1">
            <input type="hidden" name="user_rate[user_id]" value="${userId}">
            <input type="hidden" name="user_rate[target_id]" value="${id}">
            <input type="hidden" name="user_rate[target_type]" value="Anime">
            <input type="hidden" name="user_rate[status]" value="${saved ? status : 'planned'}">
            <div class="trigger"><div class="trigger-arrow"></div>${trigger}</div>
            <div class="expanded-options" style="height: 0px; display: block;">${options}${remove}</div>
          </form>
        </div>
      </div>`;
  }

  function toggleOptions(rateEl) {
    const options = rateEl.querySelector('.expanded-options');
    if (!options) return;
    const open = options.style.height === '0px';
    options.style.height = open ? options.scrollHeight + 'px' : '0px';
    rateEl.querySelector('.b-add_to_list')?.classList.toggle('expanded', open);
  }

  // "Add to list" in the tooltip. The site's scripts don't know about our tooltip,
  // so we handle the clicks and send the form ourselves.
  async function onTipClick(e) {
    if (e.target.closest('.close')) {
      hideTip();
      return;
    }
    const rateEl = e.target.closest('.b-user_rate');
    if (!rateEl) return;
    const mainButton = e.target.closest('.trigger .add-trigger');
    if (e.target.closest('.trigger-arrow') || (mainButton && !mainButton.dataset.status)) {
      e.preventDefault();
      toggleOptions(rateEl);
      return;
    }
    // "Remove from list" has the request url right on it:
    // <div class="option remove-trigger" data-action="/api/v2/user_rates/ID" data-method="delete">
    const remove = e.target.closest('.remove-trigger[data-action]');
    if (remove) {
      e.preventDefault();
      await saveRate(rateEl, null, remove);
      return;
    }
    const trigger = e.target.closest('.add-trigger[data-status]');
    if (!trigger) return;
    e.preventDefault();
    await saveRate(rateEl, trigger.dataset.status);
  }

  // pass a status to change it, or null + removeEl to remove from the list
  async function saveRate(rateEl, status, removeEl = null) {
    const form = rateEl.querySelector('form');
    if (!form && !removeEl) return;
    let model = {};
    try { model = JSON.parse(rateEl.dataset.model || '{}'); } catch {}
    const targetId = Number(model.target_id || rateEl.dataset.target_id);

    // CSRF token from <meta>, the field name depends on the site version
    const csrfParam = document.querySelector('meta[name="csrf-param"]')?.content;
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

    let body;
    let method;
    let action;
    if (removeEl) {
      method = (removeEl.dataset.method || 'DELETE').toUpperCase();
      action = new URL(removeEl.dataset.action, location.origin).href;
      if (csrfParam && csrfToken) {
        body = new FormData();
        body.set(csrfParam, csrfToken);
      }
    } else {
      body = new FormData(form);
      body.set('user_rate[status]', status);
      if (csrfParam && csrfToken) body.set(csrfParam, csrfToken);
      method = (form.dataset.method || form.getAttribute('method') || 'POST').toUpperCase();
      action = new URL(form.getAttribute('action'), location.origin).href;
    }

    rateEl.classList.add('sle-saving');
    try {
      const res = await siteFetch(action, {
        method,
        body,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken, 'X-CSRFToken': csrfToken } : {}),
        },
      });
      log.push(`${method} ${action.replace(location.origin, '')} → ${res.status}`);
      if (!res.ok) throw new Error('user_rate ' + res.status);
      let saved = null;
      try { saved = await res.json(); } catch {}

      // save the new status (in the cache too) and update the card
      if (targetId) {
        const apply = (d) => {
          d.rateInfo ??= {};
          if (status) {
            d.rates[targetId] = status;
            const old = d.rateInfo[targetId] || {};
            d.rateInfo[targetId] = { id: saved?.id ?? old.id, episodes: saved?.episodes ?? old.episodes ?? 0 };
          } else {
            delete d.rates[targetId];
            delete d.rateInfo[targetId];
          }
        };
        apply(data);
        const cached = store.get(DATA_KEY, null);
        if (cached) { apply(cached); store.set(DATA_KEY, cached); }
        current?.inner.querySelectorAll('article.b-catalog_entry').forEach((card) => {
          if (card.id !== String(targetId)) return;
          LIST_KEYS.forEach((k) => card.classList.remove(k));
          if (status) card.classList.add(status);
        });
      }
      fillUserRate(rateEl, targetId); // redraw the button with the new status
      renderCards(); // the list filter might hide or show it now
    } catch (err) {
      log.push('  ✗ ' + err.message);
      rateEl.classList.add('sle-error');
      setTimeout(() => rateEl.classList.remove('sle-error'), 1500);
    } finally {
      rateEl.classList.remove('sle-saving');
    }
  }

  // Drawing the row

  // which cards should be shown right now
  function computeItems() {
    const now = Date.now();
    if (!settings.split) {
      return { future: [], past: data.candidates.filter((a) => passes(a, data)).slice(0, LIMIT) };
    }
    // Upcoming on the left, aired on the right, so the row goes from later to earlier
    // and "now" is right in the middle
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

  // placeholder: copy of the site's card, same size, no content
  function makeSkel(kind) { // 'anim' shimmers, 'slot' is just an empty place
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
    // text becomes gray bars of the same width
    leaves(el).forEach((n) => {
      if (n.textContent.trim() && !(box && box.contains(n))) n.classList.add('sle-skel-line');
    });
    return el;
  }

  function showSkeleton() {
    const { inner } = current;
    // remember the height so the empty message takes the same space
    current.rowHeight = Math.max(current.rowHeight || 0, inner.offsetHeight || 0);
    // keep at least that height, so the row doesn't collapse while posters load
    if (current.rowHeight) inner.style.minHeight = current.rowHeight + 'px';
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

  // text over an empty half in split mode
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
      cards = fill(past.map((a) => buildCard(a)), LIMIT, false); // newest on the left
    }
    cards.forEach((c) => c.classList.add('sle-fade'));
    inner.append(...cards);
    requestAnimationFrame(() => cards.forEach((c) => {
      if (c.hasAttribute('data-sle-card')) placeStatusIcon(c);
    }));
    if (tipCard && !tipCard.card.isConnected) hideTip(); // its card is gone
    overlayHalf(emptyFuture);
    overlayHalf(emptyPast);
    current.rowHeight = Math.max(current.rowHeight || 0, inner.offsetHeight || 0);
    if (current.rowHeight) inner.style.minHeight = current.rowHeight + 'px';
    fixMissingPosters([...future, ...past]);
  }

  // Only redraw when the cards actually change, and show placeholders for a moment
  // first so it doesn't jump
  let paintToken = 0;
  function renderCards() {
    const { future, past } = computeItems();
    const key = [settings.split, uiLang(), namesLang(), Boolean(myUserId()),
      ...future.map((a) => 'f' + a.id), ...past.map((a) => a.id)].join(',');
    if (key === current.renderedKey) return;
    current.renderedKey = key;
    const token = ++paintToken;
    const target = current;
    showSkeleton();
    setTimeout(() => {
      if (token !== paintToken || target !== current || !target.inner.isConnected || !isOwner()) return;
      paint(future, past);
    }, SKELETON_MS);
  }

  // Settings window: animations on/off, and where the list icon goes,
  // shown as three small poster previews you click on
  const ICON_POSITIONS = ['top', 'bottom-right', 'bottom-left'];
  let previewPoster = null;       // a random poster from your favourites
  let previewPosterLoading = null;

  // Badge colours. Backgrounds stay slightly see-through like the defaults.
  // The common "text" colour is used for all three badges unless the advanced
  // per-badge text colours are set.
  const BASIC_COLORS = ['bgAired', 'bgFuture', 'bgFinal', 'text'];
  const ADVANCED_COLORS = ['textAired', 'textFuture', 'textFinal'];
  const DEFAULT_COLORS = { bgAired: '#000000', bgFuture: '#176093', bgFinal: '#2e7d32', text: '#ffffff' };
  // which badge the example card shows while you edit a colour
  const COLOR_STATE = {
    bgAired: 'aired', textAired: 'aired', bgFuture: 'future', textFuture: 'future',
    bgFinal: 'final', textFinal: 'final', text: null,
  };

  const colorValue = (key) => settings.colors?.[key]
    || (key.startsWith('text') && key !== 'text' ? colorValue('text') : DEFAULT_COLORS[key]);

  function colorField(key, t, extra = '') {
    return `
      <div class="sle-color ${extra}" data-color="${key}">
        <span class="sle-color-name">${esc(t.colorLabels[key])}</span>
        <input type="color" value="${colorValue(key)}">
        <input type="text" value="${colorValue(key)}" maxlength="7" spellcheck="false">
      </div>`;
  }

  // put the chosen colours on the block as CSS variables (the badge styles read them)
  function applyColors() {
    const el = current?.block;
    if (!el) return;
    const c = settings.colors || {};
    const bg = (hex) => (hex ? `color-mix(in srgb, ${hex} 85%, transparent)` : '');
    const set = (name, value) => (value ? el.style.setProperty(name, value) : el.style.removeProperty(name));
    set('--sle-bg-aired', bg(c.bgAired));
    set('--sle-bg-future', bg(c.bgFuture));
    set('--sle-bg-final', bg(c.bgFinal));
    const adv = Boolean(settings.colorsAdvanced);
    set('--sle-text-aired', (adv && c.textAired) || c.text);
    set('--sle-text-future', (adv && c.textFuture) || c.text);
    set('--sle-text-final', (adv && c.textFinal) || c.text);
  }

  // the example card's badge: aired / upcoming / final
  let previewState = 'aired';
  let colorFocus = null; // the colour field being typed in, if any
  function setPreviewState(state) {
    if (!state || !current) return;
    previewState = state;
    const badge = current.settingsEl.querySelector('.sle-preview-big .sle-badge');
    if (!badge) return;
    const now = Date.now();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(17, 45, 0, 0);
    const sample = {
      aired: { episode: 3, total: 12, date: new Date(now - 2 * 36e5).toISOString() },
      future: { episode: 4, total: 12, date: tomorrow.toISOString() },
      final: { episode: 12, total: 12, date: new Date(now - 2 * 36e5).toISOString() },
    }[state];
    fillBadge(badge, sample, state === 'future');
  }

  // Build the window once; after that clicks only flip classes and attributes,
  // so the preview card (and its poster) isn't recreated and nothing jumps.
  // It's rebuilt only when the language, login or preview poster changes.
  let previewHeight = 0; // remembered height of the preview card, used as its minimum

  function renderSettings() {
    const el = current.settingsEl;
    const t = T();
    const loggedIn = Boolean(myUserId());
    const signature = [uiLang(), namesLang(), loggedIn, previewPoster].join('|');
    if (el.dataset.signature !== signature) {
      el.dataset.signature = signature;
      buildSettings(el, t, loggedIn);
    }
    // just update the current state
    const anim = settings.animations !== false;
    el.querySelectorAll('[data-anim]').forEach((b) =>
      b.classList.toggle('on', (b.dataset.anim === 'on') === anim));
    el.querySelectorAll('[data-icon]').forEach((b) =>
      b.classList.toggle('on', b.dataset.icon === settings.iconPos));
    const adv = Boolean(settings.colorsAdvanced);
    el.querySelector('.sle-colors-wrap')?.classList.toggle('adv', adv);
    el.querySelector('.sle-adv-toggle')?.classList.toggle('on', adv);
    // advanced on: the common text field is greyed out; off: the per-badge ones are hidden
    el.querySelectorAll('[data-color]').forEach((field) => {
      const key = field.dataset.color;
      const off = key === 'text' ? adv : ADVANCED_COLORS.includes(key) && !adv;
      field.classList.toggle('off', key === 'text' && adv);
      field.querySelectorAll('input').forEach((i) => { i.disabled = off; });
    });
    el.querySelectorAll('[data-color]').forEach((field) => {
      const value = colorValue(field.dataset.color);
      field.querySelectorAll('input').forEach((input) => {
        if (input === document.activeElement) return; // don't fight someone typing
        input.value = value;
        input.classList.remove('bad');
      });
    });
    const preview = el.querySelector('.sle-preview-big');
    preview.dataset.sleIcon = settings.iconPos;
    const card = preview.querySelector('article');
    if (card) requestAnimationFrame(() => placeStatusIcon(card));
  }

  function buildSettings(el, t, loggedIn) {
    const iconButtons = ICON_POSITIONS.map((pos) =>
      `<button type="button" data-icon="${pos}"${loggedIn ? '' : ' disabled'}>${esc(t.iconPos[pos])}</button>`)
      .join('');
    el.innerHTML = `
      <div class="sle-settings-body">
        <div class="sle-settings-list">
          <div class="sle-set-row">
            <div class="sle-set-label">${esc(t.setAnim)}<small>${esc(t.setAnimHint)}</small></div>
            <div class="sle-switch">
              <button type="button" data-anim="on">${esc(t.on)}</button>
              <button type="button" data-anim="off">${esc(t.off)}</button>
            </div>
          </div>
          <div class="sle-set-row ${loggedIn ? '' : 'sle-f-disabled'}"${loggedIn ? '' : ` title="${esc(t.setIconLoggedOut)}"`}>
            <div class="sle-set-label">${esc(t.iconTitle)}${loggedIn ? '' : `<small>${esc(t.setIconLoggedOut)}</small>`}</div>
            <div class="sle-switch">${iconButtons}</div>
          </div>
          <div class="sle-set-row">
            <div class="sle-set-label">${esc(t.colorsTitle)}
              <button type="button" class="sle-linkbtn sle-adv-toggle" data-colors-adv>${esc(t.colorsAdvanced)}</button>
              <button type="button" class="sle-linkbtn danger sle-reset-colors" data-colors-reset>${esc(t.colorsReset)}</button>
            </div>
            <div class="sle-colors-wrap">
              <div class="sle-colors">${BASIC_COLORS.map((k) => colorField(k, t)).join('')}</div>
              <div class="sle-colors-adv-wrap">
                <div class="sle-colors sle-colors-adv">${ADVANCED_COLORS.map((k) => colorField(k, t)).join('')}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="sle-preview-big ${loggedIn && previewPoster ? '' : 'sle-no-poster'}">
          <div class="sle-preview-cardslot"${previewHeight ? ` style="min-height: ${previewHeight}px"` : ''}></div>
        </div>
      </div>`;

    // The preview is a real card, made the same way as the ones in the row,
    // so every setting (now and later) shows on it exactly as it will look
    const sample = {
      id: 0, name: 'Example', russian: t.setPreview, url: '#', kind: 'tv', score: '8.1',
      year: String(new Date().getFullYear()), episode: 3, total: 12,
      date: new Date(Date.now() - 2 * 36e5).toISOString(),
    };
    const card = buildCard(sample).cloneNode(true); // the copy has no hover tooltip attached
    LIST_KEYS.forEach((k) => card.classList.remove(k));
    if (loggedIn) card.classList.add('watching'); // so the site draws its list icon
    card.querySelectorAll('a').forEach((a) => a.removeAttribute('href'));
    const slot = el.querySelector('.sle-preview-cardslot');
    slot.appendChild(card);
    // remember the full height once the poster is in, so a rebuild never shrinks it
    const remember = () => {
      previewHeight = Math.max(previewHeight, slot.offsetHeight);
      if (previewHeight) slot.style.minHeight = previewHeight + 'px';
    };
    card.querySelectorAll('img').forEach((img) => {
      if (loggedIn && previewPoster) {
        img.addEventListener('load', remember, { once: true });
        img.src = previewPoster;
      } else {
        img.removeAttribute('src');
      }
    });
    requestAnimationFrame(remember);
    setPreviewState(previewState);
  }

  // Poster for the previews: a random anime from your favourites,
  // or, if that doesn't work out, one of the posters already on the page
  function loadPreviewPoster() {
    if (previewPoster || previewPosterLoading) return;
    const userId = myUserId();
    if (!userId) return;
    previewPosterLoading = (async () => {
      try {
        const fav = await getJSON(`/api/users/${userId}/favourites`);
        const animes = fav?.animes || [];
        if (animes.length) {
          const pick = animes.find((x) => x.id === 51678) || animes[Math.floor(Math.random() * animes.length)];
          const cache = getPosterCache();
          if (cache[pick.id]) return cache[pick.id];
          const r = await graphql(`{ animes(ids: "${pick.id}", limit: 1) { poster { previewUrl mainUrl } } }`);
          const p = r.animes?.[0]?.poster;
          if (p?.previewUrl || p?.mainUrl) return abs(p.previewUrl || p.mainUrl);
        }
      } catch (e) {
        log.push('  ✗ favourites: ' + e.message);
      }
      const posters = Object.values(getPosterCache());
      return posters.length ? posters[Math.floor(Math.random() * posters.length)] : null;
    })().then((url) => {
      previewPoster = url;
      if (current && openWindow === 'settings') renderSettings();
    });
  }

  function renderFilters() {
    const el = current.filtersEl;

    const pop = el.querySelector('.sle-pop');
    const popScroll = pop ? pop.scrollTop : 0;

    const t = T();
    const loggedIn = Boolean(myUserId());
    el.innerHTML = GROUPS.map(({ key }) => {
      const title = t.groups[key];
      // logged out: the list filter is greyed out and says why
      if (key === 'list' && !loggedIn) {
        return `
          <div class="sle-f sle-f-disabled" data-key="list" title="${esc(t.signInHint)}">
            <div class="sle-f-title">${title}</div>
            <div class="sle-select"><span class="sle-placeholder">${esc(t.signIn)}</span></div>
          </div>`;
      }
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
    if (!isOwner()) { current = null; return; } // the dev copy took over, stay out of its way
    updateTheme();
    // labels, in case the language changed
    const t = T();
    if (current.headingNode && current.headingNode.nodeValue !== t.heading) {
      current.headingNode.nodeValue = t.heading;
    }
    current.splitBtn.title = t.tSplit;
    current.gearBtn.title = t.tFilters;
    current.reloadBtn.title = t.tReload;
    current.debugEl.querySelector('summary').textContent = t.debug;
    current.infoBtn.title = t.tInfo;
    current.settingsBtn.title = t.tSettings;
    current.block.classList.toggle('sle-no-anim', settings.animations === false);
    applyColors();

    // windows: put them right under the heading, fill in, show the open one
    const top = current.head ? current.head.offsetTop + current.head.offsetHeight + 6 : 0;
    for (const [name, el, btn] of [['info', current.infoEl, current.infoBtn],
                                   ['settings', current.settingsEl, current.settingsBtn]]) {
      el.style.top = top + 'px';
      el.classList.toggle('open', openWindow === name);
      btn.classList.toggle('on', openWindow === name);
    }
    if (current.infoEl.dataset.lang !== uiLang()) {
      current.infoEl.innerHTML = t.info;
      current.infoEl.dataset.lang = uiLang();
    }
    renderSettings();

    current.gearBtn.classList.toggle('on', settings.open);
    current.filtersWrap.classList.toggle('open', Boolean(settings.open));
    if (!settings.open) current.filtersWrap.classList.remove('settled');
    current.splitBtn.classList.toggle('on', settings.split);
    current.inner.dataset.sleIcon = settings.iconPos || 'top';
    if (data) renderCards();
    renderFilters();
    renderDebug();
  }

  // Hooking into the "Currently Airing" block

  function setup(inner) {
    const fc = inner.closest('.fc-ongoings');
    const block = inner.closest('.block2') || fc.parentElement;
    const head = block.querySelector('.subheadline');
    // We copy the site's own card to make ours. Keep an untouched copy of it inside
    // the block, so whoever sets up later (the dev copy taking over, or the page
    // coming back from cache) copies the real card, not one of our placeholders.
    let original = block.querySelector('template.sle-original');
    if (!original) {
      const all = [...inner.querySelectorAll('article.b-catalog_entry')];
      // best: one of the site's own cards
      let first = all.find((c) => !c.classList.contains('sle-skel') && !c.querySelector('.sle-badge'));
      if (first) {
        first = first.cloneNode(true);
      } else {
        // another copy of the script (e.g. an old release) already swapped the cards:
        // take one of its finished cards and clean our additions off it
        const used = all.find((c) => !c.classList.contains('sle-skel'));
        if (!used) return false; // only placeholders on the page yet, try again in a moment
        first = used.cloneNode(true);
        first.querySelectorAll('.sle-badge').forEach((n) => n.remove());
        first.classList.remove('sle-fade');
        first.removeAttribute('data-sle-card');
      }
      original = document.createElement('template');
      original.className = 'sle-original';
      original.content.appendChild(first);
      block.appendChild(original);
    }

    // when you go back, the page can come from cache with our old (dead) buttons, remove them
    // (also removes the release copy's stuff when the dev copy takes over)
    block.querySelectorAll('.sle-tools, .sle-filters-wrap, .sle-filters, .sle-window, .sle-debug')
      .forEach((el) => el.remove());

    const template = original.content.firstElementChild.cloneNode(true);
    const link = template.querySelector('a[href*="/animes/"]');
    const tpl = {
      id: template.id,
      russian: template.querySelector('img')?.getAttribute('alt') || '',
      name: link?.getAttribute('title') || '',
    };

    // Heading. Its text depends on the language, so just replace the longest text in it
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

    // buttons in the heading
    const tools = document.createElement('span');
    tools.className = 'sle-tools';
    tools.innerHTML = `
      <button type="button" class="sle-ibtn" data-act="split">${SWAP}</button>
      <button type="button" class="sle-ibtn" data-act="toggle">${FUNNEL}</button>
      <button type="button" class="sle-ibtn" data-act="settings">${GEAR}</button>
      <button type="button" class="sle-ibtn sle-ibtn-i" data-act="info">i</button>
      <button type="button" class="sle-ibtn" data-act="reload">${REFRESH}</button>`;
    (head || block).appendChild(tools);

    // help and settings float over the cards, so the block needs to be their anchor
    if (getComputedStyle(block).position === 'static') block.style.position = 'relative';
    const infoEl = document.createElement('div');
    infoEl.className = 'sle-window sle-info';
    block.appendChild(infoEl);
    const settingsEl = document.createElement('div');
    settingsEl.className = 'sle-window sle-settings';
    block.appendChild(settingsEl);

    // the filters row sits in a wrapper that slides open and closed
    const filtersWrap = document.createElement('div');
    filtersWrap.className = 'sle-filters-wrap';
    const filtersEl = document.createElement('div');
    filtersEl.className = 'sle-filters';
    filtersWrap.appendChild(filtersEl);
    fc.before(filtersWrap);
    // dropdowns may hang outside the row, but only once it has finished opening
    filtersWrap.addEventListener('transitionend', (e) => {
      if (e.target === filtersWrap && e.propertyName === 'grid-template-rows') {
        filtersWrap.classList.toggle('settled', settings.open);
      }
    });
    if (settings.open) filtersWrap.classList.add('open', 'settled');

    const debugEl = document.createElement('details');
    debugEl.className = 'sle-debug';
    debugEl.innerHTML = '<summary></summary><pre></pre>';
    debugEl.hidden = !DEBUG; // hidden unless DEBUG is on
    fc.after(debugEl);

    current = {
      inner, block, head, headingNode, tools, template, tpl, filtersEl, filtersWrap, debugEl,
      infoEl, settingsEl,
      infoBtn: tools.querySelector('[data-act="info"]'),
      settingsBtn: tools.querySelector('[data-act="settings"]'),
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
      } else if (btn.dataset.act === 'info' || btn.dataset.act === 'settings') {
        openWindow = openWindow === btn.dataset.act ? null : btn.dataset.act;
        if (openWindow === 'settings') loadPreviewPoster();
        renderAll();
      } else if (btn.dataset.act === 'toggle') {
        settings.open = !settings.open;
        openGroup = null;
        current.filtersWrap.classList.remove('settled'); // clip while it slides
        if (!settings.animations && settings.open) current.filtersWrap.classList.add('settled');
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
        current.renderedKey = null; // redraw anyway after a manual refresh
        renderAll();
      }
    });

    // colour fields: typing / picking, and which badge the example shows
    settingsEl.addEventListener('focusin', (e) => {
      const field = e.target.closest('[data-color]');
      if (!field) return;
      colorFocus = field.dataset.color;
      setPreviewState(COLOR_STATE[colorFocus]);
    });
    settingsEl.addEventListener('focusout', (e) => {
      const field = e.target.closest('[data-color]');
      if (field && !field.contains(e.relatedTarget)) colorFocus = null;
    });
    settingsEl.addEventListener('mouseover', (e) => {
      const field = e.target.closest('[data-color]');
      if (field && !colorFocus) setPreviewState(COLOR_STATE[field.dataset.color]); // typing wins over hovering
    });
    settingsEl.addEventListener('input', (e) => {
      const field = e.target.closest('[data-color]');
      if (!field) return;
      let value = e.target.value.trim();
      if (e.target.type === 'text') {
        if (/^[0-9a-f]{6}$/i.test(value)) value = '#' + value;
        const ok = /^#[0-9a-f]{6}$/i.test(value);
        e.target.classList.toggle('bad', !ok);
        if (!ok) return;
        field.querySelector('input[type="color"]').value = value;
      } else {
        field.querySelector('input[type="text"]').value = value;
      }
      settings.colors = { ...(settings.colors || {}), [field.dataset.color]: value.toLowerCase() };
      saveSettings();
      applyColors();
      // the per-badge text fields follow the common text colour until set on their own
      if (field.dataset.color === 'text') renderSettings();
    });

    settingsEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-colors-adv]')) {
        settings.colorsAdvanced = !settings.colorsAdvanced;
        saveSettings();
        applyColors();
        renderSettings();
        return;
      }
      if (e.target.closest('[data-colors-reset]')) {
        settings.colors = {};
        saveSettings();
        applyColors();
        renderSettings();
        return;
      }
      const anim = e.target.closest('[data-anim]');
      if (anim) {
        settings.animations = anim.dataset.anim === 'on';
        saveSettings();
        renderAll();
        return;
      }
      const icon = e.target.closest('[data-icon]');
      if (icon && myUserId()) {
        settings.iconPos = icon.dataset.icon;
        saveSettings();
        renderAll();
      }
    });

    filtersEl.addEventListener('click', (e) => {
      if (e.target.closest('.sle-f-disabled')) return;
      const key = e.target.closest('.sle-f')?.dataset.key;
      const chip = e.target.closest('.sle-chip');

      if (chip && key) {
        // click: only this, again: hide this, again: off
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

    showSkeleton(); // placeholders instead of random ongoings until data loads
    renderAll();
  }

  // close the help/settings window when clicking outside it or pressing Esc
  // (a click that redrew the window leaves e.target detached from the page, that's not "outside")
  document.addEventListener('click', (e) => {
    if (!e.target.isConnected) return;
    if (openWindow && current && !e.target.closest('.sle-window, .sle-tools')) {
      openWindow = null;
      renderAll();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openWindow && current) {
      openWindow = null;
      renderAll();
    }
  });

  // close the dropdown when clicking somewhere else
  document.addEventListener('click', (e) => {
    if (!e.target.isConnected) return;
    if (openGroup && current && !e.target.closest('.sle-f')) {
      openGroup = null;
      renderFilters();
    }
  });

  // Page changes. Shikimori swaps the page without reloading, and Greasemonkey
  // doesn't run the script again, so we watch the page and hook in whenever
  // a fresh "Currently Airing" block shows up.

  function check() {
    if (!style.isConnected && document.head) document.head.appendChild(style);
    if (!themeStyle.isConnected && document.head) document.head.appendChild(themeStyle);
    updateTheme();
    if (location.pathname !== '/') return;
    const inner = document.querySelector('.block2 .fc-ongoings .inner')
               || document.querySelector('.fc-ongoings .inner');
    if (!inner || inner === current?.inner) return;
    // If both the release and the dev version are turned on, dev wins: it takes
    // the block even if the release got there first, and the release backs off
    const block = inner.closest('.block2');
    const owner = block?.dataset.sleOwner;
    if (owner && owner !== SCRIPT_ID && priority(owner) >= priority(SCRIPT_ID)) return;
    // setup also clears out the other copy's buttons and filters;
    // it says false when there's no real card to copy yet, then we just try again later
    if (setup(inner) === false) return;
    block?.setAttribute('data-sle-owner', SCRIPT_ID);
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; check(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  ['turbolinks:load', 'turbo:load', 'page:load'].forEach((ev) => document.addEventListener(ev, check));
  window.addEventListener('popstate', check);

  // Go

  check();
  loadData()
    .then((d) => { data = d; fixHentaiId(d); })
    .catch((e) => {
      log.push('✗ ' + e.message);
      // empty data, so it says "nothing found" instead of loading forever
      data = { time: 0, candidates: [], upcoming: [], byAnime: {}, genreOptions: [],
        rates: {}, rateInfo: {}, userId: null };
    })
    .finally(() => {
      renderAll();
      if (DEBUG) console.log('[sle]', { data, settings, log });
    });
})();
