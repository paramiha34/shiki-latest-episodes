// ==UserScript==
// @name         Shikimori: Latest Episodes
// @namespace    shiki-latest-episodes
// @version      1.14
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
  const DATA_KEY = 'sle_data_v8';
  const EPISODES_KEY = 'sle_episodes_v1';
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
  // help icon: an "i" in a circle, drawn by hand so it sits exactly in the middle
  const INFO = '<svg class="sle-svg" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">'
    + '<circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + '<circle cx="8" cy="4.7" r="1.05" fill="currentColor"/>'
    + '<path d="M8 7.1v4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  // refresh icon: a circle with an arrow, drawn around the centre so it spins evenly
  const REFRESH = '<svg class="sle-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
    + '<path d="M13.2 8A5.2 5.2 0 1 1 11.7 4.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M12.2 1.6v3.1H9.1" fill="none" stroke="currentColor" stroke-width="1.6" '
    + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // "turned off" icon: the power symbol
  const POWER = '<svg class="sle-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">'
    + '<path d="M5.2 3.9a5.4 5.4 0 1 0 5.6 0M8 1.8v6" fill="none" stroke="currentColor" stroke-width="1.8" '
    + 'stroke-linecap="round"/></svg>';
  // search icon: a magnifying glass
  const SEARCH = '<svg class="sle-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
    + '<circle cx="6.8" cy="6.8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/>'
    + '<path d="M10.2 10.2l3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  // a little coloured sample of a badge for the help text (follows your colour settings)
  const legend = (kind, label) =>
    `<span class="sle-legend-item"><span class="sle-badge-sample sle-badge-${kind}"></span>${label}</span>`;
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
      hintTitle: 'Впервые здесь?', hintText: 'Загляните в справку: там коротко о том, что умеет этот блок.',
      hintClose: 'нажмите, чтобы скрыть',
      unconfirmedHint: 'Должна была выйти, но поста о выходе на Шикимори ещё нет',
      uncertainHint: 'Прошлые серии выходили неровно, поэтому дата с Шикимори может быть неточной',
      postedHint: 'Пост о выходе уже есть, просто Шикимори ещё не обновил число серий',
      unconfirmedNextHint: 'Посчитано от серии, о выходе которой ещё нет поста, поэтому может быть неточно',
      setPage: 'Страницы аниме', setPageHint: 'Поправлять число серий и дату следующей на странице самого аниме', predictedHint: 'Посчитано расширением по прошлым сериям. На Шикимори:',
      tipRating: 'рейтинг', addToList: 'Добавить в список', removeFromList: 'Удалить из списка',
      iconTitle: 'Значок списка', tSettings: 'Настройки',
      setAnim: 'Анимации', setAnimHint: 'Плавные появления, затухания и выезжающие панели',
      on: 'вкл', off: 'выкл', setPreview: 'Пример',
      colorsTitle: 'Цвета плашек', colorsAdvanced: 'Расширенные цвета', colorsReset: 'Сбросить цвета',
      colorLabels: {
        bgAired: 'Фон: вышла', bgFuture: 'Фон: скоро', bgFinal: 'Фон: последняя', text: 'Текст',
        bgFirst: 'Фон: первая', bgUncertain: 'Фон: неточно',
        textAired: 'Текст: вышла', textFuture: 'Текст: скоро', textFinal: 'Текст: последняя',
        textFirst: 'Текст: первая', textUncertain: 'Текст: неточно',
        bgVague: 'Фон: без даты', textVague: 'Текст: без даты',
      }, setIconLoggedOut: 'войдите в аккаунт, чтобы его настроить',
      iconPos: { top: 'сверху', 'bottom-right': 'справа внизу', 'bottom-left': 'слева внизу' },
      signIn: 'войдите в аккаунт', signInHint: 'Фильтр по спискам работает, только когда Вы вошли на Шикимори',
      ep: 'Эп.',
      healthTitle: 'Шикимори обновился',
      healthText: (n) => `Из-за изменений на сайте расширение «${n}» сейчас может работать неправильно. `
        + 'Приносим извинения: исправление выйдет в одном из ближайших обновлений расширения. '
        + 'Выключить его до исправления?',
      healthOff: 'Выключить', healthFalse: 'Ложная тревога',
      healthOffHint: (n) => `Расширение «${n}» выключено: после обновления Шикимори оно могло работать неправильно. `
        + 'Оно включится само, когда выйдет исправление. Нажмите, чтобы включить сейчас.',
      healthFixed: (n, v) => `Расширение «${n}» обновлено до версии ${v} и снова работает как надо.`,
      healthFixedClose: 'нажмите в любом месте, чтобы скрыть',
      healthStrip: 'Шикимори обновился, и расширение сейчас может работать неправильно. '
        + 'Исправление выйдет в обновлении расширения.',
      tSearch: 'Поиск', searchPlaceholder: 'Поиск среди анонсов, онгоингов и недавно вышедших',
      searchClose: 'Закрыть поиск', searchEmpty: 'Ничего не найдено под эти фильтры',
      searchFailed: 'Поиск не удался, попробуйте ещё раз',
      searchCount: (shown, all) => (shown < all ? `${shown} из ${all}` : `найдено: ${all}`),
      anons: 'Анонс', released: 'Вышло', ongoing: 'онгоинг', noDate: 'дата неизвестна',
      out: (d) => `выйдет ${d}`, epCount: (n) => `${n} эп.`,
      seasons: { winter: 'зима', spring: 'весна', summer: 'лето', fall: 'осень' },
      vague: {
        year: 'Точной даты выхода пока нет, известен только год',
        season: 'Точной даты выхода пока нет, известен только сезон (квартал)',
        month: 'Точной даты выхода пока нет, известен только месяц',
        none: 'Дата выхода пока неизвестна',
      },
      justNow: 'только что', hAgo: (n) => `${n} ч. назад`, dAgo: (n) => `${n} дн. назад`,
      inMin: (n) => `через ${n} мин.`, inH: (n) => `через ${n} ч.`,
      today: (t) => `сегодня ${t}`, tomorrow: (t) => `завтра ${t}`,
      dateLocale: 'ru-RU',
      tInfo: 'Как это работает',
      info: `
        <ul>
          <li>${keyIcon(SEARCH)}<span>Кнопка слева от фильтров: поиск по анонсам, онгоингам и недавно вышедшим аниме
            с учётом фильтров. У анонса без точной даты плашка красная, подробности при наведении.</span></li>
          <li>${keyIcon(SWAP)}<span>Слева 4 серии, которые скоро выйдут, справа 4 уже вышедшие.
            Время будущих серий Шикимори указывает примерно, поэтому при переносах оно может сдвигаться.</span></li>
          <li>${keyIcon(FUNNEL)}<span>Фильтры по личным спискам, типу, жанрам и темам.</span></li>
          <li>${keyIcon(GEAR)}<span>Настройки: анимации, значок списка, цвета плашек
            и поправки на страницах аниме.</span></li>
          <li>${keyIcon(REFRESH)}<span>Обновить данные. Сами они обновляются раз в 10 минут.</span></li>
        </ul>
        <p class="sle-legend">Плашки:
          ${legend('aired', 'вышла')} ${legend('future', 'скоро')} ${legend('first', 'первая серия')}
          ${legend('final', 'последняя')} ${legend('uncertain', 'дата неточная')}
          ${legend('vague', 'анонс без точной даты')}</p>
        <p class="sle-legend">Начиная с 4-й серии расширение само считает дату следующей по трём прошлым.
          Если она расходится с Шикимори, перед временем стоит <b>≈</b>
          (при наведении на карточку над подсказкой видно дату Шикимори). Если серии выходили неровно,
          дата берётся с Шикимори, а плашка жёлтая. Если серия уже должна была выйти, но поста о ней
          на Шикимори ещё нет, она показывается вышедшей, но тоже с жёлтой плашкой, пока пост не появится.</p>
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
      hintTitle: 'New here?', hintText: 'Have a look at the help: it briefly shows what this block can do.',
      hintClose: 'click to hide',
      unconfirmedHint: 'Should be out, but Shikimori has no post about it yet',
      uncertainHint: 'Past episodes came out unevenly, so the date from Shikimori may be off',
      postedHint: 'There is already a post about it, Shikimori just hasn\'t updated the episode count',
      unconfirmedNextHint: 'Worked out from an episode that has no post yet, so it may be off',
      setPage: 'Anime pages', setPageHint: 'Fix the episode count and next episode date on the anime\'s own page', predictedHint: 'Worked out by the extension from past episodes. Shikimori says:',
      tipRating: 'rating', addToList: 'Add to list', removeFromList: 'Remove from list',
      iconTitle: 'List icon', tSettings: 'Settings',
      setAnim: 'Animations', setAnimHint: 'Smooth fades and sliding panels',
      on: 'on', off: 'off', setPreview: 'Example',
      colorsTitle: 'Badge colours', colorsAdvanced: 'Advanced colours', colorsReset: 'Reset colours',
      colorLabels: {
        bgAired: 'Background: aired', bgFuture: 'Background: upcoming', bgFinal: 'Background: final', text: 'Text',
        bgFirst: 'Background: first', bgUncertain: 'Background: unsure',
        textAired: 'Text: aired', textFuture: 'Text: upcoming', textFinal: 'Text: final',
        textFirst: 'Text: first', textUncertain: 'Text: unsure',
        bgVague: 'Background: no date', textVague: 'Text: no date',
      }, setIconLoggedOut: 'sign in to change it',
      iconPos: { top: 'top', 'bottom-right': 'bottom right', 'bottom-left': 'bottom left' },
      signIn: 'sign in first', signInHint: 'The list filter only works when you are signed in to Shikimori',
      ep: 'Ep.',
      healthTitle: 'Shikimori has changed',
      healthText: (n) => `Because of changes on the site, the “${n}” extension may not work properly right now. `
        + 'Sorry about that: a fix will come in one of the next extension updates. '
        + 'Turn it off until then?',
      healthOff: 'Turn off', healthFalse: 'False alarm',
      healthOffHint: (n) => `The “${n}” extension is off: after a Shikimori update it may not have worked properly. `
        + 'It turns itself back on when the fix is out. Click to turn it on now.',
      healthFixed: (n, v) => `The “${n}” extension has been updated to ${v} and works properly again.`,
      healthFixedClose: 'click anywhere to hide',
      healthStrip: 'Shikimori has changed, and the extension may not work properly right now. '
        + 'A fix will come in an extension update.',
      tSearch: 'Search', searchPlaceholder: 'Search announced, airing and recently finished',
      searchClose: 'Close search', searchEmpty: 'Nothing found with these filters',
      searchFailed: 'Search failed, please try again',
      searchCount: (shown, all) => (shown < all ? `${shown} of ${all}` : `found: ${all}`),
      anons: 'Announced', released: 'Finished', ongoing: 'airing', noDate: 'date unknown',
      out: (d) => `out ${d}`, epCount: (n) => `${n} ep.`,
      seasons: { winter: 'winter', spring: 'spring', summer: 'summer', fall: 'fall' },
      vague: {
        year: 'No exact release date yet, only the year is known',
        season: 'No exact release date yet, only the season (quarter) is known',
        month: 'No exact release date yet, only the month is known',
        none: 'The release date is not known yet',
      },
      justNow: 'just now', hAgo: (n) => `${n}h ago`, dAgo: (n) => `${n}d ago`,
      inMin: (n) => `in ${n} min`, inH: (n) => `in ${n}h`,
      today: (t) => `today ${t}`, tomorrow: (t) => `tomorrow ${t}`,
      dateLocale: 'en-US',
      tInfo: 'How it works',
      info: `
        <ul>
          <li>${keyIcon(SEARCH)}<span>The button left of the filters: search announced, airing and recently finished anime,
            with your filters applied. An announcement without an exact date gets a red badge, hover for details.</span></li>
          <li>${keyIcon(SWAP)}<span>Episodes airing soon on the left, already aired on the right.
            Upcoming times are Shikimori’s estimate and may shift if an episode is delayed.</span></li>
          <li>${keyIcon(FUNNEL)}<span>Filter by your personal lists, kind, genres and themes.</span></li>
          <li>${keyIcon(GEAR)}<span>Settings: animations, the list icon, badge colours
            and fixes on anime pages.</span></li>
          <li>${keyIcon(REFRESH)}<span>Refresh data. It also refreshes on its own every 10 minutes.</span></li>
        </ul>
        <p class="sle-legend">Badges:
          ${legend('aired', 'aired')} ${legend('future', 'upcoming')} ${legend('first', 'first episode')}
          ${legend('final', 'final')} ${legend('uncertain', 'unsure date')}
          ${legend('vague', 'announced, no exact date')}</p>
        <p class="sle-legend">From the 4th episode on, the extension works out the next date from the last three.
          If it differs from Shikimori, the time gets a <b>≈</b>
          (hover the card to see Shikimori's date above the tooltip). If the episodes came out unevenly,
          Shikimori's date is used and the badge turns yellow. If an episode should be out but Shikimori
          has no post about it yet, it shows as aired with a yellow badge until the post appears.</p>
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

  const settings = Object.assign({ open: true, split: false, iconPos: 'top', animations: true, colors: {}, colorsAdvanced: false, hintSeen: false, animePage: false, filters: defaultFilters() },
    store.get(SETTINGS_KEY, {}));
  for (const g of GROUPS) settings.filters[g.key] ??= { include: [], exclude: [] };
  const saveSettings = () => store.set(SETTINGS_KEY, settings);
  // test mode (only exists in the dev version, see the top of that file)
  const testMode = typeof SLE_TEST_MODE !== 'undefined' && SLE_TEST_MODE === 1;
  if (testMode) settings.hintSeen = false; // every page load counts as the first visit

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

  // Health check. The script leans on a few things of the site: the "Currently Airing"
  // block with its cards, and some API answers in a certain shape. If one of those keeps
  // missing, Shikimori has most likely changed something, and we say so (bottom left)
  // and offer to turn the extension off until a fixed version comes out.
  // One-off failures don't count, and neither does the site being down (5xx, no
  // network): a problem has to show up at least twice, a couple of minutes apart.
  const HEALTH_KEY = 'sle_health_v1:' + SCRIPT_ID; // separate for the release and the dev copy
  const VERSION = (typeof GM !== 'undefined' && GM.info?.script?.version)
    || (typeof GM_info !== 'undefined' && GM_info.script?.version) || '?';
  const HEALTH_SPAN = 2 * 60 * 1000;
  // test switch (only exists in the dev version): pretend the site broke
  const testBreak = typeof SLE_TEST_BREAK !== 'undefined' && SLE_TEST_BREAK === 1;
  const health = Object.assign(
    { fails: {}, alert: null, dismissed: null, disabled: false, version: VERSION, fixedPending: false },
    store.get(HEALTH_KEY, {}));
  // A new version came in: turn back on, forget old problems, and once things are
  // checked and fine, say so in green
  if (health.version !== VERSION) {
    health.fixedPending = Boolean(health.disabled || health.alert);
    Object.assign(health, { fails: {}, alert: null, dismissed: null, disabled: false, version: VERSION });
  }
  const saveHealth = () => store.set(HEALTH_KEY, health);
  saveHealth();
  let greenReady = false;

  function reportProblem(key) {
    const now = Date.now();
    const f = (health.fails[key] ??= { first: now, last: 0, count: 0 });
    if (now - f.last > 30e3) { f.count++; f.last = now; }
    if (testBreak) Object.assign(f, { first: 0, count: 9 });
    const broken = Object.entries(health.fails)
      .filter(([, x]) => x.count >= 2 && x.last - x.first >= HEALTH_SPAN)
      .map(([k]) => k).sort();
    if (broken.length) {
      health.alert = broken.join(',');
      health.fixedPending = false; // the update didn't fix it after all
      greenReady = false;
    }
    log.push('  ⚠ health: ' + key);
    saveHealth();
    renderHealth();
  }

  function reportOk(key) {
    if (testBreak) return;
    delete health.fails[key];
    // everything that set off the warning works again
    if (health.alert && !health.alert.split(',').some((k) => health.fails[k])) health.alert = null;
    // "fixed" only after the full check of the home page block, not after any small one
    if (health.fixedPending && !health.alert && key === 'layout:block') greenReady = true;
    saveHealth();
    renderHealth();
  }

  // An API answer: a missing endpoint, an HTML page instead of JSON, an answer of another
  // shape or GraphQL not knowing our fields means the site changed. 5xx, rate limits
  // and network errors are just the site having a bad moment, those are ignored.
  function apiCheck(key, error, shapeOk = true) {
    if (!error) return shapeOk ? reportOk(key) : reportProblem(key);
    const msg = String(error.message || '');
    const status = Number(msg.match(/: (\d{3})$/)?.[1]);
    if ([200, 400, 404, 410].includes(status)) return reportProblem(key);
    // GraphQL complaining about our fields, or our code tripping over an answer of another
    // shape ("x is undefined"); a failed fetch is a TypeError too, but says "fetch"/"network"
    if (!status && !/fetch|network/i.test(msg)
      && /field|argument|doesn't exist|cannot query|not defined|unknown|undefined|null|is not/i.test(msg)) {
      reportProblem(key);
    }
  }

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

  // where an aired item came from: 'feed' = an "episode N aired" post (always real),
  // 'calendar' = guessed from the calendar, needs a post to be confirmed
  const fromSource = (item, src) => ({ ...item, src });

  // "Episode N aired" news, these have the exact time
  async function fromTopicUpdates() {
    let topics;
    try {
      topics = await getJSON('/api/topics/updates?limit=50');
    } catch (e) {
      apiCheck('api:updates', e);
      throw e;
    }
    apiCheck('api:updates', null, Array.isArray(topics)
      && (!topics.length || topics.some((t) => t && 'event' in t && 'linked' in t)));
    return topics
      .filter((t) => t.event === 'episode' && t.linked)
      .map((t) => fromSource(normalize(t.linked, t.episode, t.created_at), 'feed'));
  }

  // From the calendar: last episode is roughly next episode minus a week
  async function fromCalendar(list) {
    if (!list) throw new Error('calendar failed to load');
    const now = Date.now();
    return list
      .filter((e) => e.anime && e.anime.episodes_aired > 0 && e.next_episode_at)
      .map((e) => fromSource(normalize(e.anime, e.anime.episodes_aired,
        new Date(new Date(e.next_episode_at).getTime() - 7 * DAY).toISOString()), 'calendar'))
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

  // Real episode times.
  // When an episode actually comes out, Shikimori posts "Episode N" in the anime's forum.
  // Those posts are the proof that it aired, and their times are what we use to work out
  // when the next one comes. Saved per anime: { t: when we checked, eps: { N: time } }
  let episodeTimes = store.get(EPISODES_KEY, {});
  const CHECK_AGAIN = 3 * 36e5;   // look at an anime's posts again after 3 hours
  const MAX_CHECKS = 40;          // at most this many anime per load (the site limits requests)
  let episodesApiWorks = true;
  let recheckTimer = 0;
  let checking = false;

  async function fetchEpisodeTimes(id) {
    const list = await getJSON(`/api/animes/${id}/topics?kind=episode&limit=30`);
    const eps = {};
    for (const t of list) {
      if (t.episode && (!t.event || t.event === 'episode')) eps[t.episode] = t.created_at;
    }
    return eps;
  }

  const timeOf = (id, n) => {
    const v = episodeTimes[id]?.eps?.[n];
    return v ? new Date(v).getTime() : null;
  };
  const latestPosted = (id) => {
    const eps = Object.keys(episodeTimes[id]?.eps || {}).map(Number);
    return eps.length ? Math.max(...eps) : 0;
  };

  // look at the posts of the anime that can show up in the row
  async function checkEpisodes() {
    if (!data?.calendar || !episodesApiWorks || checking) return;
    checking = true;
    try { await checkEpisodesNow(); } finally { checking = false; }
  }

  async function checkEpisodesNow() {
    const now = Date.now();
    // posts from the updates feed come for free, note them first
    for (const a of data.candidates) {
      if (a.src !== 'feed') continue;
      const rec = (episodeTimes[a.id] ??= { t: 0, eps: {} });
      rec.eps[a.episode] = a.date;
    }
    // Which anime to look at. There are a lot of ongoings (plenty of daily shows), so we
    // only take the ones that can show up for you (they pass your filters):
    // first the ones in the row right now and a few after them, then the rest, soonest first.
    const shown = (x) => passes(x, data);
    const inRow = [
      ...upcomingList().filter(shown).slice(0, 12),
      ...airedList().filter(shown).slice(0, 12),
    ].map((a) => a.id);
    const rest = [...data.calendar]
      .filter((c) => c.nextAt && new Date(c.nextAt).getTime() > now - 2 * DAY && shown(c.base))
      .sort((x, y) => new Date(x.nextAt) - new Date(y.nextAt))
      .map((c) => c.base.id);
    const ids = [...new Set([...inRow, ...rest])];

    let checks = 0;
    for (const id of ids) {
      const rec = episodeTimes[id];
      const entry = data.calendar.find((c) => c.base.id === id);
      const expected = entry?.nextAt ? new Date(entry.nextAt).getTime() : 0;
      // fresh enough, unless the next episode was due after our last look
      const fresh = rec?.t && now - rec.t < CHECK_AGAIN && !(expected && rec.t < expected && now > expected);
      if (fresh) continue;
      if (checks >= MAX_CHECKS) break;
      checks++;
      try {
        const eps = await fetchEpisodeTimes(id);
        if (checks === 1) apiCheck('api:topics'); // once per round is enough
        episodeTimes[id] = { t: now, eps: { ...(rec?.eps || {}), ...eps } };
      } catch (e) {
        log.push('  ✗ episode posts: ' + e.message);
        apiCheck('api:topics', e);
        if (/: 404$/.test(e.message)) { episodesApiWorks = false; break; } // the site doesn't have this
      }
      await sleep(300);
    }
    // forget anime that aren't around anymore
    const keep = new Set(data.calendar.map((c) => c.base.id).concat(data.candidates.map((a) => a.id)));
    for (const id of Object.keys(episodeTimes)) if (!keep.has(Number(id))) delete episodeTimes[id];
    store.set(EPISODES_KEY, episodeTimes);
    if (current) renderCards();
  }

  // Anime pages (a setting, off by default): the same forecast applied to the
  // "Episodes" and "Next episode" lines of the page's info block, with the same colours.
  const ANIME_PAGE = /^\/animes\/[a-z]?(\d+)/;
  let pageFetching = null;

  function findInfoValue(keys, root = document) {
    for (const k of root.querySelectorAll('.key')) {
      const text = k.textContent.trim().replace(/:$/, '').toLowerCase();
      if (keys.includes(text)) return k.parentElement.querySelector('.value') || k.nextElementSibling;
    }
    return null;
  }

  const fmtDate = (ms) => {
    const t = T();
    const d = new Date(ms);
    return `${d.toLocaleDateString(t.dateLocale, { day: 'numeric', month: 'short' })} `
      + d.toLocaleTimeString(t.dateLocale, { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  async function enhanceAnimePage() {
    if (!settings.animePage || !data) return;
    const m = location.pathname.match(ANIME_PAGE);
    if (!m) return;
    const id = Number(m[1]);
    const c = data.calendar?.find((x) => x.base.id === id);
    if (!c) return; // not airing, nothing to do
    // both copies on? dev wins here too
    const owner = document.body.dataset.sleAnimeOwner;
    if (owner && owner !== SCRIPT_ID && priority(owner) >= priority(SCRIPT_ID)) return;
    // don't redo the same work on every little change of the page
    const stamp = [id, uiLang(), episodeTimes[id]?.t || 0].join(':');
    if (document.body.dataset.sleAnimeDone === stamp) return;
    document.body.dataset.sleAnimeDone = stamp;
    document.body.dataset.sleAnimeOwner = SCRIPT_ID;

    // the posts of this anime, if we haven't looked lately
    const rec = episodeTimes[id];
    if (episodesApiWorks && (!rec?.t || Date.now() - rec.t > CHECK_AGAIN) && pageFetching !== id) {
      pageFetching = id;
      try {
        const eps = await fetchEpisodeTimes(id);
        episodeTimes[id] = { t: Date.now(), eps: { ...(rec?.eps || {}), ...eps } };
        store.set(EPISODES_KEY, episodeTimes);
      } catch (e) {
        log.push('  ✗ episode posts: ' + e.message);
      }
      pageFetching = null;
      document.body.dataset.sleAnimeDone = [id, uiLang(), episodeTimes[id]?.t || 0].join(':');
    }

    markInfo(document, c);
  }

  // Fix the "Episodes" / "Next episode" lines inside root (an anime page or our tooltip)
  function markInfo(root, c) {
    const t = T();
    const id = c.base.id;
    const epEl = findInfoValue(['эпизоды', 'episodes'], root);
    const nextEl = findInfoValue(['следующий эпизод', 'next episode'], root);
    // put back what the site had (in case we, or the other copy, changed it before)
    for (const el of [epEl, nextEl]) {
      if (el && el.dataset.sleOrig !== undefined) el.innerHTML = el.dataset.sleOrig;
    }
    const mark = (el, text, kind, title) => {
      if (!el) return;
      if (el.dataset.sleOrig === undefined) el.dataset.sleOrig = el.innerHTML;
      el.innerHTML = `<span class="sle-page-mark sle-badge-${kind}" data-hint="${esc(title)}">${esc(text)}</span>`;
    };

    const f = forecast(c);
    const posted = latestPosted(id);
    const total = c.base.total || '?';
    // episodes: one more than Shikimori says if it should be out (yellow until the post shows up),
    // or the post is already there and only the counter is behind (blue)
    if (f?.unconfirmed) mark(epEl, `${f.n} / ${total}`, 'uncertain', t.unconfirmedHint);
    else if (posted > c.aired) mark(epEl, `${posted} / ${total}`, 'future', t.postedHint);
    // next episode
    if (f?.unconfirmed) {
      mark(nextEl, fmtDate(f.date + f.gap), 'uncertain', t.unconfirmedNextHint);
    } else if (f?.mode === 'predicted') {
      mark(nextEl, '≈ ' + fmtDate(f.date), 'future', `${t.predictedHint} ${f.shiki ? fmtDate(f.shiki) : '?'}`);
    } else if (f?.mode === 'uncertain') {
      mark(nextEl, fmtDate(f.date), 'uncertain', t.uncertainHint);
    }
  }

  // Aired: posts from the feed as they are, calendar guesses only once a post confirms them
  function airedList() {
    const out = [];
    for (const a of data.candidates) {
      const checked = episodeTimes[a.id]?.t > 0;
      const posted = latestPosted(a.id);
      if (posted > a.episode) {
        out.push({ ...a, episode: posted, date: new Date(timeOf(a.id, posted)).toISOString(), src: 'feed' });
      } else if (a.src === 'calendar' && checked) {
        const t = timeOf(a.id, a.episode);
        if (t) out.push({ ...a, date: new Date(t).toISOString() }); // confirmed
        // no post for it: it didn't really come out yet, leave it out
      } else {
        out.push(a);
      }
    }
    out.push(...outlook().unconfirmed);
    out.sort((x, y) => new Date(y.date) - new Date(x.date));
    const seen = new Set();
    return out.filter((a) => !seen.has(a.id) && seen.add(a.id));
  }

  // Worked out from the calendar plus the real episode times:
  //  - from the 4th episode on: next date = last episode + the usual gap between
  //    the last three, if those gaps are even;
  //  - uneven gaps (a break, a double episode): Shikimori's date, marked as unsure (yellow);
  //  - its time has passed but there's no post yet: it counts as aired, but stays yellow
  //    until the post shows up (and the one after it is a guess, so it's yellow too).
  // The forecast for one anime from the calendar: which episode is next, when, and how sure we are
  function forecast(c, now = Date.now()) {
    const n = Math.max(c.next, latestPosted(c.base.id) + 1);
    if (c.base.total && n > c.base.total) return null; // the show is over
    const shiki = c.nextAt && n === c.next ? new Date(c.nextAt).getTime() : null;
    const t1 = timeOf(c.base.id, n - 3), t2 = timeOf(c.base.id, n - 2), t3 = timeOf(c.base.id, n - 1);
    let date = shiki;
    let mode = 'normal';
    let gap = 7 * DAY; // usual gap between episodes, a week unless we know better
    if (n - 1 >= 3 && t1 && t2 && t3) {
      const d1 = t2 - t1, d2 = t3 - t2;
      const even = d1 > DAY / 2 && d2 > DAY / 2 && Math.abs(d1 - d2) <= Math.max(DAY, 0.15 * Math.max(d1, d2));
      if (even) {
        gap = (d1 + d2) / 2;
        const predicted = t3 + gap;
        if (!shiki || Math.abs(predicted - shiki) > 12 * 36e5) {
          date = predicted;
          mode = 'predicted';
        }
      } else {
        mode = 'uncertain';
      }
    }
    if (!date) return null;
    if (date < now - 2 * DAY) return null; // long overdue with no post: probably on a break
    return { n, date, mode, gap, shiki, unconfirmed: date <= now };
  }

  function outlook() {
    const now = Date.now();
    const upcoming = [];
    const unconfirmed = [];
    for (const c of data.calendar || []) {
      const f = forecast(c, now);
      if (!f) continue;
      const item = { ...c.base, shikiDate: f.shiki ? new Date(f.shiki).toISOString() : null };
      if (!f.unconfirmed) {
        upcoming.push({ ...item, episode: f.n, date: new Date(f.date).toISOString(), mode: f.mode });
        continue;
      }
      // should be out by now, but no post yet
      unconfirmed.push({ ...item, episode: f.n, date: new Date(f.date).toISOString(), mode: 'unconfirmed', src: 'unconfirmed' });
      if (!c.base.total || f.n + 1 <= c.base.total) {
        upcoming.push({ ...item, episode: f.n + 1, date: new Date(f.date + f.gap).toISOString(), mode: 'uncertain', shikiDate: null });
      }
    }
    upcoming.sort((x, y) => new Date(x.date) - new Date(y.date)); // soonest first
    const seen = new Set();
    return { upcoming: upcoming.filter((a) => !seen.has(a.id) && seen.add(a.id)), unconfirmed };
  }
  const upcomingList = () => outlook().upcoming;

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
      apiCheck('api:graphql');
      return map;
    } catch (e) {
      log.push('  ✗ graphql: ' + e.message + ' → REST one by one');
      apiCheck('api:graphql', e);
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
      const list = data.genres.map((g) => ({
        id: String(g.id), name: g.name, russian: g.russian, group: groupOf(g),
      }));
      apiCheck('api:genres');
      return list;
    } catch (e) {
      log.push('  ✗ genre list (graphql): ' + e.message);
      apiCheck('api:genres', e);
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
    try {
      cal = await getJSON('/api/calendar');
      apiCheck('api:calendar', null, Array.isArray(cal)
        && (!cal.length || cal.some((e) => e && e.anime && 'next_episode_at' in e)));
    } catch (e) {
      log.push('  ✗ ' + e.message);
      apiCheck('api:calendar', e);
    }
    const candidates = await loadCandidates(cal);
    const upcoming = upcomingFrom(cal);
    const posters = getPosterCache();
    const ids = [...new Set([...candidates, ...upcoming].map((a) => a.id))];
    const byAnime = await loadGenresByAnime(ids, posters);
    store.set(POSTER_KEY, posters);
    const [genreOptions, mine] = await Promise.all([loadGenreOptions(byAnime), loadMyRates()]);
    // keep the calendar itself: the upcoming list is worked out from it on every render
    const calendar = (cal || [])
      .filter((e) => e.anime)
      .map((e) => ({
        base: normalize(e.anime, 0, null),
        aired: e.anime.episodes_aired || 0,
        next: e.next_episode || (e.anime.episodes_aired || 0) + 1,
        nextAt: e.next_episode_at,
      }));
    const data = { time: Date.now(), candidates, upcoming, calendar, byAnime, genreOptions, ...mine };
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

  // Search. Same search as the site's anime catalogue, but only among announced,
  // airing and recently finished anime, and only what passes your filters.
  // Results take the place of the cards while there's something typed in.
  const SEARCH_LIMIT = 16;   // two rows of cards
  const SEARCH_FIELDS = `id name russian kind status score episodes episodesAired url season nextEpisodeAt
    airedOn { year month day } releasedOn { year month day } genres { id kind } poster { previewUrl mainUrl }`;
  let searchOpen = false;
  let searchQuery = '';
  let searchTimer = 0;
  let searchArgs = null;               // which way of asking the site accepted (see fetchSearch)
  const searchCache = new Map();       // query -> { list } or { error }

  const searchText = () => searchQuery.trim();
  const searchActive = () => searchText().length >= 2;

  // "recently finished" (latest) and the censored switch may not be understood
  // everywhere, so if the site complains we ask in a simpler way
  async function fetchSearch(q) {
    const variants = searchArgs ? [searchArgs] : [
      'status: "anons,ongoing,latest", censored: false',
      'status: "anons,ongoing,latest"',
      'status: "anons,ongoing"',
    ];
    let error;
    for (const args of variants) {
      try {
        const r = await graphql(`{ animes(search: ${JSON.stringify(q)}, ${args}, limit: 50) { ${SEARCH_FIELDS} } }`);
        searchArgs = args;
        apiCheck('api:search');
        return r.animes || [];
      } catch (e) {
        error = e;
        log.push('  ✗ search: ' + e.message);
      }
    }
    apiCheck('api:search', error); // all the ways of asking failed
    throw error;
  }

  async function runSearch(q) {
    if (!searchCache.has(q)) {
      try {
        searchCache.set(q, { list: await fetchSearch(q) });
      } catch {
        searchCache.set(q, { error: true });
        setTimeout(() => searchCache.delete(q), 5000); // let a retry go to the site again
      }
    }
    if (current && searchText() === q) renderCards();
  }

  // a day, "Jan 5" (with the year if it's not this year)
  function fmtDay(d) {
    if (!d?.year || !d.month || !d.day) return '';
    const date = new Date(d.year, d.month - 1, d.day);
    return date.toLocaleDateString(T().dateLocale, {
      day: 'numeric', month: 'short',
      ...(d.year !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    }).replace(/\s*г\.$/, '');
  }

  // An announcement: blue with the date if the day is known, red if it's only
  // the month, the season, the year or nothing at all (the reason goes into the note)
  function anonsBadge(r) {
    const t = T();
    const d = r.airedOn || {};
    if (d.year && d.month && d.day) {
      return { badge: { kind: 'future', lines: [t.anons, t.out(fmtDay(d))] } };
    }
    let when, why;
    const season = String(r.season || '').match(/^(winter|spring|summer|fall)_(\d{4})$/);
    if (d.year && d.month) {
      when = new Date(d.year, d.month - 1, 1)
        .toLocaleDateString(t.dateLocale, { month: 'short', year: 'numeric' }).replace(/\s*г\.$/, '');
      why = t.vague.month;
    } else if (season) {
      when = `${t.seasons[season[1]]} ${season[2]}`;
      why = t.vague.season;
    } else if (d.year) {
      when = String(d.year);
      why = t.vague.year;
    } else {
      when = t.noDate;
      why = t.vague.none;
    }
    return { badge: { kind: 'vague', lines: [t.anons, when] }, note: why, noteKind: 'vague' };
  }

  // When something comes out, for sorting the results. For a date that's only roughly
  // known we take the latest it can be (the end of that month, season or year), so
  // "2027" lands to the left of "spring 2027". No date at all counts as furthest away.
  const SEASON_END = { winter: 3, spring: 6, summer: 9, fall: 12 }; // month a season ends with
  function latestTime(d, season) {
    if (d?.year && d.month && d.day) return new Date(d.year, d.month - 1, d.day).getTime();
    if (d?.year && d.month) return new Date(d.year, d.month, 0).getTime();
    const m = String(season || '').match(/^(winter|spring|summer|fall)_(\d{4})$/);
    if (m) return new Date(+m[2], SEASON_END[m[1]], 0).getTime();
    if (d?.year) return new Date(d.year, 12, 0).getTime();
    return Infinity;
  }

  // one search result -> what buildCard needs, plus when it comes out (for the order)
  function toSearchItem(r) {
    const item = searchItem(r);
    if (r.status === 'anons') item.time = latestTime(r.airedOn, r.season);
    else if (item.future && item.date) item.time = new Date(item.date).getTime();
    else if (r.status === 'ongoing') item.time = Date.now(); // airing, next date unknown
    else item.time = r.releasedOn?.year ? Math.min(latestTime(r.releasedOn), Date.now()) : Date.now() - 1;
    return item;
  }

  function searchItem(r) {
    const t = T();
    const id = Number(r.id);
    // genres go where the filters look for them
    data.byAnime[id] = (r.genres || []).map((g) => ({ id: String(g.id), group: groupOf(g) }));
    const base = {
      id, name: r.name, russian: r.russian || r.name, url: abs(r.url), kind: r.kind,
      score: r.score, year: r.airedOn?.year ? String(r.airedOn.year) : '', total: r.episodes,
      poster: abs(r.poster?.mainUrl || r.poster?.previewUrl || ''),
    };
    if (r.status === 'ongoing') {
      // already known from the calendar: same badge as in the row (with our own forecast)
      const up = upcomingList().find((x) => x.id === id);
      if (up) return { ...up, poster: base.poster, future: true };
      if (r.nextEpisodeAt && new Date(r.nextEpisodeAt) > Date.now()) {
        return { ...base, episode: (r.episodesAired || 0) + 1, date: r.nextEpisodeAt, future: true };
      }
      const n = r.episodesAired || 0;
      return { ...base, episode: n, badge: { kind: 'aired', lines: [`${t.ep} ${n}${r.episodes ? '/' + r.episodes : ''}`, t.ongoing] } };
    }
    if (r.status === 'anons') return { ...base, ...anonsBadge(r), future: true };
    // recently finished
    const day = fmtDay(r.releasedOn);
    return { ...base, badge: { kind: 'final', lines: [t.released, day || (r.episodes ? t.epCount(r.episodes) : '')] } };
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
    /* the buttons take the whole height of the heading, so a click near the edge
       still hits the button and not the site's link behind it */
    .sle-tools { position: absolute; right: 34px; top: 0; bottom: 0;
      display: flex; align-items: stretch; z-index: 2; }
    .sle-ibtn { display: flex; align-items: center; justify-content: center; height: 100%;
      background: none; border: 0; padding: 0 6px; margin: 0; color: inherit;
      font: inherit; font-size: 16px; line-height: 1; cursor: pointer; opacity: .6;
      transition: opacity .15s; }
    .sle-ibtn:hover, .sle-ibtn.on { opacity: 1; }
    /* only the drawing spins, around its own centre (a text arrow wobbles because
       the character isn't centred in its line) */
    .sle-ibtn.spin .sle-svg { animation: sle-spin .8s linear infinite; transform-origin: 50% 50%; }
    @keyframes sle-spin { to { transform: rotate(360deg); } }

    .sle-filters { display: grid; grid-template-columns: auto repeat(4, minmax(0, 1fr)) auto;
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
    /* no poster to show: the site's own "no image" picture keeps the card's shape */
    .sle-preview-big.sle-no-poster .image-decor { background: var(--sle-chip-bg); }
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
    .sle-no-anim .sle-colors-adv-wrap, .sle-no-anim .sle-pop-wrap, .sle-no-anim .sle-pop-clip,
    .sle-no-anim .sle-tagbox, .sle-no-anim .sle-search, .sle-no-anim .fc-ongoings,
    .sle-no-anim .sle-skel-anim .sle-skel-box, .sle-no-anim .sle-skel-anim .sle-skel-line,
    .sle-no-anim article[data-sle-card] .sle-badge,
    .sle-no-anim article[data-sle-card] .collection_score,
    .sle-no-anim article[data-sle-card] .image-decor::before,
    .sle-no-anim article[data-sle-card] .image-decor::after {
      transition: none !important; animation: none !important; }
    .sle-f-title { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
    /* A filter box keeps its one-line height in the row. The visible box (.sle-tagbox)
       sits on top of it and, on hover or when open, grows down over the cards in one
       piece: first all the chosen tags, then the list of options. */
    .sle-select { position: relative; height: 30px; cursor: pointer; font-size: 13px; color: var(--sle-text); }
    .sle-tagbox { position: absolute; left: 0; right: 0; top: 0; min-height: 30px; box-sizing: border-box;
      padding: 4px 26px 4px 8px; background: var(--sle-bg); border: 1px solid var(--sle-border);
      border-radius: 3px; z-index: 1;
      transition: z-index 0s linear .2s; } /* stays on top until it has finished closing */
    .sle-select:hover .sle-tagbox, .sle-select.open .sle-tagbox {
      border-color: var(--sle-border-hover); z-index: 45; box-shadow: 0 8px 20px var(--sle-shadow);
      transition-delay: 0s; }
    .sle-tagbox::after { content: ''; position: absolute; right: 10px; top: 13px;
      border: 4px solid transparent; border-top-color: var(--sle-muted); }
    .sle-select.open .sle-tagbox::after { top: 9px; border-top-color: transparent;
      border-bottom-color: var(--sle-muted); }
    /* collapsed: one line of tags (newest first), the rest counted as "+N" */
    .sle-tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; max-height: 20px; overflow: hidden; }
    .sle-select:hover .sle-tags, .sle-select.open .sle-tags { max-height: none; }
    .sle-more { position: absolute; right: 24px; top: 4px; padding: 0 5px; line-height: 20px; font-size: 11px;
      color: var(--sle-muted); background: var(--sle-bg); border-radius: 3px; }
    .sle-more:not(.on), .sle-select:hover .sle-more, .sle-select.open .sle-more { display: none; }
    .sle-placeholder { color: var(--sle-muted); }
    /* greyed out (list filter when you're not signed in) */
    .sle-f-disabled { opacity: .45; cursor: not-allowed; }
    .sle-f-disabled .sle-select { cursor: not-allowed; pointer-events: none; }
    .sle-f-disabled .sle-tagbox::after { display: none; }
    .sle-tag { padding: 0 6px; border-radius: 3px; font-size: 12px; line-height: 20px;
      white-space: nowrap; }
    .sle-tag.inc { background: var(--sle-blue-bg); color: var(--sle-blue); }
    .sle-tag.exc { background: var(--sle-red-bg); color: var(--sle-red); text-decoration: line-through; }

    /* the options, inside the same box right under the tags. They slide open and closed
       (same 0fr -> 1fr trick as the filters row) */
    .sle-pop-wrap { display: grid; grid-template-rows: 0fr; margin-right: -18px;
      transition: grid-template-rows .2s ease; }
    .sle-select.open .sle-pop-wrap { grid-template-rows: 1fr; }
    .sle-pop-clip { min-height: 0; overflow: hidden; opacity: 0; transition: opacity .2s ease; }
    .sle-select.open .sle-pop-clip { opacity: 1; }
    .sle-pop { margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid var(--sle-border);
      max-height: 280px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 4px; cursor: default; }
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

    /* search button: a square the height of a filter box, left of the filters */
    .sle-search-btn { width: 30px; height: 30px; box-sizing: border-box; margin: 0; padding: 0;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      background: var(--sle-bg); color: var(--sle-muted); border: 1px solid var(--sle-border); border-radius: 3px;
      transition: color .15s, border-color .15s; }
    .sle-search-btn:hover { color: var(--sle-text); border-color: var(--sle-border-hover); }
    .sle-search-btn.on { color: var(--sle-blue); border-color: var(--sle-blue-border); background: var(--sle-blue-bg); }
    /* search bar: grows from the left edge when it opens */
    .sle-search { position: absolute; z-index: 25; height: 30px; box-sizing: border-box;
      display: flex; align-items: center; gap: 6px; padding: 0 2px 0 8px;
      background: var(--sle-bg); color: var(--sle-text); border: 1px solid var(--sle-border-hover);
      border-radius: 3px; box-shadow: 0 6px 18px var(--sle-shadow);
      clip-path: inset(-30px 100% -30px -30px); opacity: 0; visibility: hidden; pointer-events: none;
      transition: clip-path .25s ease, opacity .2s ease, visibility 0s linear .25s,
        left .2s ease, top .2s ease, width .2s ease; }
    .sle-search.open { clip-path: inset(-30px -30px -30px -30px); opacity: 1; visibility: visible;
      pointer-events: auto;
      transition: clip-path .25s ease, opacity .2s ease, left .2s ease, top .2s ease, width .2s ease; }
    .sle-search:focus-within { border-color: var(--sle-blue-border); }
    .sle-search-icon { flex: none; color: var(--sle-muted); }
    .sle-search input { flex: 1; min-width: 0; height: 100%; margin: 0; padding: 0; border: 0;
      background: none; color: inherit; font: inherit; font-size: 13px; outline: none; box-shadow: none; }
    .sle-search input::placeholder { color: var(--sle-muted); opacity: 1; }
    .sle-search-count { flex: none; font-size: 12px; color: var(--sle-muted); white-space: nowrap; }
    .sle-search-x { flex: none; width: 26px; height: 26px; margin: 0; padding: 0; border: 0; background: none;
      color: var(--sle-muted); font: 18px/26px system-ui, sans-serif; cursor: pointer; }
    .sle-search-x:hover { color: var(--sle-text); }
    .sle-search-measure { position: absolute; visibility: hidden; white-space: pre; font-size: 13px; }
    /* folded into a pill: no shadow, a bit quieter */
    .sle-search.compact { box-shadow: none; border-color: var(--sle-border); }
    .sle-search.compact:hover { border-color: var(--sle-border-hover); }
    /* over the cards: once there are results, the row moves down under the bar */
    [data-sle-owner] .fc-ongoings { transition: padding-top .2s ease; }
    .sle-search-push .fc-ongoings { padding-top: 40px; }


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
    .sle-badge-first { background: var(--sle-bg-first, rgba(123,75,183,.9)); color: var(--sle-text-first, #fff); }
    .sle-badge-uncertain { background: var(--sle-bg-uncertain, rgba(201,162,39,.92)); color: var(--sle-text-uncertain, #222); }
    .sle-badge-vague { background: var(--sle-bg-vague, rgba(179,38,30,.9)); color: var(--sle-text-vague, #fff); }
    /* a short note stuck on top of the hover tooltip (why a date is unsure, etc.);
       it sits above the box, so the anime info inside doesn't move */
    .sle-tip-note { position: absolute; left: -1px; right: -1px; bottom: 100%; margin-bottom: 4px;
      padding: 4px 10px; border-radius: 3px; font-size: 12px; line-height: 1.4; box-sizing: border-box; }
    .sle-tip-note[hidden] { display: none; }
    /* marks on anime pages */
    .sle-page-mark { padding: 0 6px; border-radius: 3px; cursor: help; }
    /* our own little hint above a mark: the browser's one appears next to the cursor,
       and a big custom cursor can cover it. Colours follow the page (light or dark). */
    .sle-mini-tip { position: absolute; z-index: 3000; max-width: 320px; padding: 5px 9px; box-sizing: border-box;
      background: var(--sle-pop-bg, #fff); color: var(--sle-text, #333); border: 1px solid var(--sle-border, #ccc);
      border-radius: 3px; font-size: 12px; line-height: 1.4;
      pointer-events: none; box-shadow: 0 4px 14px var(--sle-shadow, rgba(0,0,0,.18)); }
    .sle-mini-tip[hidden] { display: none; }
    /* colour samples in the help */
    .sle-legend { margin: 6px 0 0 !important; }
    .sle-legend-item { display: inline-flex; align-items: center; gap: 5px; margin-right: 12px; white-space: nowrap; }
    .sle-badge-sample { display: inline-block; width: 22px; height: 12px; border-radius: 2px; }
    .sle-badge-sample.sle-badge-aired { background: var(--sle-bg-aired, rgba(0,0,0,.72)); }
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

    /* first visit: a hint over the cards with an arrow to the help button */
    .sle-hint { position: absolute; left: 0; right: 0; z-index: 20; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .sle-hint[hidden] { display: none; }
    .sle-hint-box { max-width: 420px; padding: 16px 22px; text-align: center; line-height: 1.5;
      background: var(--sle-pop-bg); color: var(--sle-text); border: 1px solid var(--sle-border);
      border-radius: 4px; box-shadow: 0 8px 24px var(--sle-shadow); animation: sle-fade .25s ease-out; }
    .sle-hint-box b { display: block; font-size: 15px; margin-bottom: 4px; }
    .sle-hint-box small { display: block; margin-top: 8px; color: var(--sle-muted); font-size: 11px; }
    .sle-hint-arrow { position: absolute; left: 0; top: 0; width: 100%; height: 100%; z-index: 21;
      pointer-events: none; overflow: visible; color: var(--sle-blue); }
    .sle-hint-arrow[hidden] { display: none; }
    .sle-hint-on .fc-ongoings .inner { visibility: hidden; }
    .sle-hint-on .sle-ibtn-i { opacity: 1; color: var(--sle-blue); }
    .sle-no-anim .sle-hint-box { animation: none; }

    /* tooltip on hover, uses the site's own classes so it looks the same */
    .sle-tooltip { z-index: 10 !important; }
    .sle-tooltip .b-user_rate.sle-saving { opacity: .55; pointer-events: none; }
    .sle-tooltip .b-user_rate.sle-error { outline: 1px solid var(--sle-red); outline-offset: 2px; }
    .sle-tooltip .expanded-options { overflow: hidden; }

    /* site-change notice, bottom left. Fixed colours: it has to stand out on any page */
    .sle-health { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; max-width: 380px;
      box-sizing: border-box; padding: 12px 14px; border-radius: 4px; font: 13px/1.45 system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.35); animation: sle-fade .25s ease-out; }
    .sle-health b { display: block; margin-bottom: 4px; font-size: 14px; }
    .sle-health small { display: block; margin-top: 6px; font-size: 11px; opacity: .8; }
    /* !important on the colours: the site's (and Dark Reader's) button styles must not win here */
    .sle-health-warn { background: #e8bd3f !important; color: #222 !important; border-left: 4px solid #b3261e; }
    .sle-health-warn b { color: #8f1d14 !important; }
    .sle-health-ok { background: #2e7d32 !important; color: #fff !important; cursor: pointer; }
    .sle-health-buttons { display: flex; gap: 8px; margin-top: 10px; }
    .sle-health .sle-health-buttons button { font: inherit; font-size: 12px; font-weight: 600; line-height: 18px;
      padding: 4px 12px; margin: 0; border-radius: 3px; cursor: pointer; box-shadow: none; text-shadow: none;
      color: #222 !important; background: #f6dc8e !important; border: 1px solid rgba(0,0,0,.35) !important; }
    .sle-health .sle-health-buttons button:hover { background: #fbe9b5 !important; }
    .sle-health .sle-health-buttons button.main { color: #fff !important; background: #8f1d14 !important;
      border-color: #8f1d14 !important; }
    .sle-health .sle-health-buttons button.main:hover { background: #6f150e !important; }
    .sle-health-off { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; width: 36px; height: 36px;
      margin: 0; padding: 0; border: 0; border-radius: 50%; display: flex; align-items: center;
      justify-content: center; cursor: pointer; background: #e8bd3f !important; color: #222 !important;
      box-shadow: 0 4px 14px rgba(0,0,0,.35); opacity: .75; transition: opacity .15s; }
    .sle-health-off:hover { opacity: 1; }
    /* the same warning at the bottom of our windows */
    .sle-health-strip { margin: 12px -14px -12px; padding: 8px 14px; border-radius: 0 0 3px 3px;
      background: #e8bd3f !important; color: #222 !important; font-size: 12px; line-height: 1.45; }

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
    const t = T();
    // search results that aren't a plain episode (announcements, finished shows) bring their own lines
    if (a.badge) {
      badge.className = 'sle-badge sle-badge-' + a.badge.kind;
      badge.innerHTML = a.badge.lines.filter(Boolean)
        .map((line, i) => `<span class="${i ? 'sle-badge-time' : 'sle-badge-ep'}">${esc(line)}</span>`).join('');
      badge.removeAttribute('title');
      return;
    }
    const final = a.total > 0 && a.episode >= a.total;
    const first = a.episode === 1;
    // colour: unsure date (yellow) > last episode (green) > first episode (violet) > upcoming / aired
    const kind = (future && a.mode === 'uncertain') || a.mode === 'unconfirmed' ? 'uncertain'
      : final ? 'final' : first ? 'first' : future ? 'future' : '';
    badge.className = 'sle-badge' + (kind ? ' sle-badge-' + kind : '');
    let when = future ? timeUntil(a.date) : timeAgo(a.date);
    if (future && a.mode === 'predicted') when = '≈ ' + when;
    // two short lines instead of one long one, so it fits on the poster in any language
    badge.innerHTML = `<span class="sle-badge-ep">${t.ep} ${a.episode}${a.total ? '/' + a.total : ''}</span>`
      + `<span class="sle-badge-time">${esc(when)}</span>`;
    badge.removeAttribute('title');
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
    const rate = data?.rates?.[a.id]; // data may not be loaded yet (the settings example)
    if (rate) card.classList.add(rate);

    // title in the language from the profile
    const shownName = namesLang() === 'ru' ? a.russian : a.name;

    // Poster
    const poster = a.poster || posterOf(a);
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

    // score: on the site it's <span class="collection_score">…<span>★</span>7.78…</span>
    const scoreBox = card.querySelector('.collection_score');
    if (scoreBox) {
      const walker = document.createTreeWalker(scoreBox, NodeFilter.SHOW_TEXT);
      let node, done = false;
      while ((node = walker.nextNode())) {
        if (!/\d/.test(node.nodeValue)) continue;
        if (+a.score > 0 && !done) {
          node.nodeValue = node.nodeValue.replace(/\d{1,2}(\.\d{1,2})?/, a.score);
          done = true;
        }
      }
      if (!(+a.score > 0)) scoreBox.style.display = 'none'; // no score yet
    }

    // type, year (and the score, if the card has it in a simpler form)
    const kindLabels = ALL_KIND_LABELS;
    for (const el of leaves(card)) {
      const t = el.textContent.trim();
      if (/^★?\s*\d{1,2}(\.\d{1,2})?$/.test(t) && !el.closest('.collection_score') && t !== a.year) {
        if (+a.score > 0) el.textContent = el.textContent.replace(/\d{1,2}(\.\d{1,2})?/, a.score);
        else el.remove();
      } else if (kindLabels.includes(t)) {
        el.textContent = T().kinds[a.kind] || a.kind || t;
      } else if (/^\d{4}$/.test(t)) {
        el.textContent = a.year || ''; // an announcement may have no year yet
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
        ${a.episode != null ? line(t.tipEpisodes, `${aired} / ${a.total || '?'}`) : ''}
        ${future && a.date && !a.badge ? line(t.tipNext, esc(timeUntil(a.date))) : ''}
        ${line(t.tipGenres, genres)}
        ${+a.score > 0 ? `<div class="rating"><span>${esc(a.score)}</span>
          <span class="text">${t.tipRating}</span></div>` : ''}
      </div></div>
      <div class="flexible-button">
        <div class="b-user_rate anime-${a.id}" data-target_id="${a.id}" data-target_type="Anime"></div>
      </div></div>`;
  }

  // Why the badge is yellow / has a ≈: shown on top of the tooltip, since the badge
  // itself fades out while you hover the card
  function setTipNote(el, a, future) {
    const t = T();
    const box = el.querySelector('.tooltip-inner');
    let note = box.querySelector('.sle-tip-note');
    if (!note) {
      note = document.createElement('div');
      box.appendChild(note);
    }
    let text = '';
    let kind = 'uncertain';
    if (a.note) {
      text = a.note; // search results: why an announcement has no exact date
      kind = a.noteKind || kind;
    } else if (a.mode === 'unconfirmed') {
      text = t.unconfirmedHint;
    } else if (future && a.mode === 'uncertain') {
      text = t.uncertainHint;
    } else if (future && a.mode === 'predicted' && a.shikiDate) {
      text = `${t.predictedHint} ${timeUntil(a.shikiDate)}`;
      kind = 'future';
    }
    note.className = 'sle-tip-note sle-badge-' + kind;
    note.textContent = text;
    note.hidden = !text;
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
    setTipNote(el, a, future);
    const entry = data?.calendar?.find((x) => x.base.id === a.id);
    if (entry) markInfo(details, entry);
    // the tooltip page sometimes comes without the rating, add it from our data
    const inner = details.querySelector('.inner');
    if (inner && !inner.querySelector('.rating') && +a.score > 0) {
      inner.querySelector(':scope > .data:empty')?.remove();
      inner.insertAdjacentHTML('beforeend', `<div class="rating"><span>${esc(a.score)}</span>`
        + `<span class="text">${T().tipRating}</span></div>`);
    }
    fillUserRate(details.querySelector('.b-user_rate'), a.id);
    el.style.display = 'block';
    keepRatingClear(details);
    positionTip(el, card);
  }

  // The rating is pinned to the bottom right corner of the tooltip. Signed in, the
  // "Add to list" button below the info gives it room; signed out there's no button,
  // and it would sit on top of the last lines. So make room under them if needed.
  function keepRatingClear(details) {
    const rating = details.querySelector('.rating');
    const box = rating?.offsetParent;
    if (!box) return;
    box.style.paddingBottom = '';
    const lines = [...details.querySelectorAll('.line-container, .line')].filter((n) => !rating.contains(n));
    const lastBottom = Math.max(0, ...lines.map((n) => n.getBoundingClientRect().bottom));
    const overlap = lastBottom + 6 - rating.getBoundingClientRect().top;
    if (overlap > 0) {
      const pad = parseFloat(getComputedStyle(box).paddingBottom) || 0;
      box.style.paddingBottom = pad + overlap + 'px';
    }
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
    if (!settings.split) {
      return { future: [], past: airedList().filter((a) => passes(a, data)).slice(0, LIMIT) };
    }
    // Upcoming on the left, aired on the right, so the row goes from later to earlier
    // and "now" is right in the middle
    const future = upcomingList()
      .filter((a) => passes(a, data))
      .slice(0, HALF)
      .reverse();
    const past = airedList().filter((a) => passes(a, data)).slice(0, HALF);
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
    // (search results can take two rows, that's not the row's height)
    if (!current.searchShown) current.rowHeight = Math.max(current.rowHeight || 0, inner.offsetHeight || 0);
    // keep at least that height, so the row doesn't collapse while posters load
    if (current.rowHeight) inner.style.minHeight = current.rowHeight + 'px';
    clearInner();
    inner.append(...Array.from({ length: LIMIT }, () => makeSkel('anim')));
  }

  function emptyBlock(text = T().empty) {
    const el = document.createElement('div');
    el.className = 'sle-empty';
    el.style.minHeight = Math.max((current.rowHeight || 0) - 30, 160) + 'px';
    el.innerHTML = `<span class="sle-empty-icon">∅</span><span>${esc(text)}</span>`;
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
    current.searchShown = false;
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
    positionHint();
    fixMissingPosters([...future, ...past]);
  }

  // Only redraw when the cards actually change, and show placeholders for a moment
  // first so it doesn't jump
  let paintToken = 0;
  function renderCards() {
    renderSearchBar();
    if (searchActive()) { renderSearchResults(); return; }
    const { future, past } = computeItems();
    const key = [settings.split, uiLang(), namesLang(), Boolean(myUserId()),
      ...future.map((a) => `f${a.id}:${a.episode}:${a.mode}:${Math.round(new Date(a.date) / 6e4)}`),
      ...past.map((a) => `${a.id}:${a.episode}:${a.mode}:${Math.round(new Date(a.date) / 6e4)}`)].join(',');
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

  // Search results in place of the cards: placeholders while it's loading,
  // then up to two rows of cards (the second row only if there's that much)
  function renderSearchResults() {
    const q = searchText();
    const res = searchCache.get(q);
    const t = T();
    let items = [];
    let all = 0;
    if (res?.list) {
      const found = res.list.map(toSearchItem).filter((a) => passes(a, data));
      all = found.length;
      // the most fitting ones (Shikimori sorts by how well the title matches),
      // then in time order like the split row: furthest future on the left,
      // what's coming soon in the middle, the most recently finished on the right
      items = found.slice(0, SEARCH_LIMIT).sort((x, y) => y.time - x.time);
    }
    current.searchCount.textContent = res?.list ? t.searchCount(items.length, all) : '';
    renderSearchBar(); // the pill's width depends on the count
    const key = ['search', q, uiLang(), namesLang(), Boolean(myUserId()), res ? (res.error ? 'error' : 'ok') : 'loading',
      ...items.map((a) => `${a.id}:${a.episode}:${a.mode}:${a.badge?.lines.join('/')}:${a.date}`)].join(',');
    if (key === current.renderedKey) return;
    current.renderedKey = key;
    const token = ++paintToken;
    const target = current;
    current.searchShown = true;
    showSkeleton();
    if (!res) return; // runSearch draws again when the answer comes
    setTimeout(() => {
      if (token !== paintToken || target !== current || !target.inner.isConnected || !isOwner()) return;
      const { inner } = current;
      clearInner();
      if (res.error || !items.length) {
        inner.append(emptyBlock(res.error ? t.searchFailed : t.searchEmpty));
        return;
      }
      const cards = items.map((a) => buildCard(a, Boolean(a.future)));
      while (cards.length % LIMIT) cards.push(makeSkel('slot')); // finish the row
      cards.forEach((c) => c.classList.add('sle-fade'));
      inner.append(...cards);
      requestAnimationFrame(() => cards.forEach((c) => {
        if (c.hasAttribute('data-sle-card')) placeStatusIcon(c);
      }));
      if (tipCard && !tipCard.card.isConnected) hideTip();
      fixMissingPosters(items.filter((a) => !a.poster));
    }, SKELETON_MS);
  }

  // The search bar floats over the cards. At first it covers their top, and once results
  // show up the row moves down a little so their badges aren't hidden under it.
  //
  // Closed with something typed in, the results stay (so you can narrow them down with
  // the filters), and the bar shrinks to a small pill with your query above them.
  // Clicking into the pill opens it wide again.
  function renderSearchBar() {
    const { block, searchEl, filtersEl, inner } = current;
    const t = T();
    const expanded = searchOpen;
    const compact = !expanded && searchActive();
    const searchBtn = filtersEl.querySelector('[data-act="search"]');
    if (searchBtn) {
      searchBtn.dataset.hint = t.tSearch;
      searchBtn.classList.toggle('on', expanded || searchActive());
    }
    const input = searchEl.querySelector('input');
    input.placeholder = t.searchPlaceholder;
    searchEl.querySelector('.sle-search-x').dataset.hint = t.searchClose;
    if (input.value !== searchQuery) input.value = searchQuery;
    if (!searchActive()) current.searchCount.textContent = '';

    block.classList.toggle('sle-search-push', searchActive());
    searchEl.classList.toggle('open', expanded || compact);
    searchEl.classList.toggle('compact', compact);

    // where: measured from the page, relative to the block
    const b = block.getBoundingClientRect();
    const ox = b.left + block.clientLeft;
    const oy = b.top + block.clientTop;
    const r = (inner.closest('.fc-ongoings') || inner).getBoundingClientRect();
    const box = { left: r.left - ox, top: r.top - oy, width: r.width };
    let width = Math.max(box.width, 200);
    if (compact) {
      // just wide enough for the query, the count and the ×
      const measure = searchEl.querySelector('.sle-search-measure');
      measure.textContent = searchQuery;
      const rest = searchEl.offsetWidth - input.offsetWidth; // icon, count, ×, paddings
      width = Math.min(width, Math.max(160, Math.ceil(measure.offsetWidth) + rest + 4));
    }
    searchEl.style.left = box.left + 'px';
    searchEl.style.top = box.top + 'px';
    searchEl.style.width = width + 'px';
  }

  // Closing keeps what you typed (a stray click shouldn't lose it), only × clears it.
  // Opening again brings the text back, selected, so you can just type over it.
  function setSearchOpen(open, clear = false) {
    searchOpen = open;
    clearTimeout(searchTimer);
    if (clear) searchQuery = '';
    if (!open) current?.searchEl.querySelector('input').blur();
    openGroup = null;
    renderAll();
    if (open) {
      const q = searchText();
      if (q.length >= 2 && !searchCache.has(q)) runSearch(q);
      const input = current?.searchEl.querySelector('input');
      input?.focus({ preventScroll: true });
      input?.select();
    }
  }

  function onSearchInput(value) {
    searchQuery = value;
    clearTimeout(searchTimer);
    const q = searchText();
    if (q.length >= 2 && !searchCache.has(q)) {
      searchTimer = setTimeout(() => runSearch(q), 350); // wait until typing pauses
    }
    if (data) renderCards();
    else renderSearchBar();
  }

  // First-visit hint: covers the cards until you click it or any of our buttons
  function renderHint() {
    const { hintEl, hintArrow, block } = current;
    const show = !settings.hintSeen;
    block.classList.toggle('sle-hint-on', show);
    hintEl.hidden = !show;
    if (!show) { hintArrow.setAttribute('hidden', ''); return; }
    const t = T();
    if (hintEl.dataset.lang !== uiLang()) {
      hintEl.dataset.lang = uiLang();
      hintEl.innerHTML = `<div class="sle-hint-box"><b>${esc(t.hintTitle)}</b>${esc(t.hintText)}`
        + `<small>${esc(t.hintClose)}</small></div>`;
    }
    positionHint();
  }

  // the hint sits where the cards are; the arrow goes from it up to the help button
  function positionHint() {
    if (!current || settings.hintSeen) return;
    const { hintEl, hintArrow, block, inner, infoBtn } = current;
    const fc = inner.closest('.fc-ongoings') || inner;
    hintEl.style.top = fc.offsetTop + 'px';
    hintEl.style.height = Math.max(fc.offsetHeight, 200) + 'px';
    const b = block.getBoundingClientRect();
    const from = hintEl.querySelector('.sle-hint-box')?.getBoundingClientRect();
    const to = infoBtn.getBoundingClientRect();
    if (!from || !to.width) { hintArrow.setAttribute('hidden', ''); return; }
    // from the right side of the hint: straight right, a rounded turn, straight up to the help button
    const sx = from.right - b.left + 8, sy = from.top + from.height / 2 - b.top;
    const ex = to.left + to.width / 2 - b.left, ey = to.bottom - b.top + 6;
    const r = 22;
    let d;
    if (ex - sx > r + 10 && sy - ey > r + 10) {
      d = `M${sx} ${sy} H${ex - r} Q${ex} ${sy} ${ex} ${sy - r} V${ey}`;
    } else {
      // not enough room for that shape: a simple curve
      const midY = (sy + ey) / 2;
      d = `M${sx} ${sy} C ${sx} ${midY}, ${ex} ${midY}, ${ex} ${ey}`;
    }
    hintArrow.removeAttribute('hidden');
    hintArrow.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-dasharray="5 4"/>`;
  }

  // Settings window: animations on/off, and where the list icon goes,
  // shown as three small poster previews you click on
  const ICON_POSITIONS = ['top', 'bottom-right', 'bottom-left'];
  const NO_POSTER = '/assets/globals/missing_preview.jpg'; // Shikimori's "no image" picture
  let previewPoster = null;       // a random poster from your favourites
  let previewAnimeId = null;
  let previewPosterLoading = null;

  // Badge colours. Backgrounds stay slightly see-through like the defaults.
  // The common "text" colour is used for all three badges unless the advanced
  // per-badge text colours are set.
  const BASIC_COLORS = ['bgAired', 'bgFuture', 'bgFinal', 'bgFirst', 'bgUncertain', 'bgVague', 'text'];
  const ADVANCED_COLORS = ['textAired', 'textFuture', 'textFinal', 'textFirst', 'textUncertain', 'textVague'];
  const DEFAULT_COLORS = {
    bgAired: '#000000', bgFuture: '#176093', bgFinal: '#2e7d32', bgFirst: '#7b4bb7', bgUncertain: '#c9a227',
    bgVague: '#b3261e', text: '#ffffff', textUncertain: '#222222', // dark text reads better on yellow
  };
  // which badge the example card shows while you edit a colour
  const COLOR_STATE = {
    bgAired: 'aired', textAired: 'aired', bgFuture: 'future', textFuture: 'future',
    bgFinal: 'final', textFinal: 'final', bgFirst: 'first', textFirst: 'first',
    bgUncertain: 'uncertain', textUncertain: 'uncertain', bgVague: 'vague', textVague: 'vague', text: null,
  };

  const colorValue = (key) => settings.colors?.[key]
    || (key.startsWith('text') && key !== 'text'
      ? (settings.colors?.text || DEFAULT_COLORS[key] || colorValue('text'))
      : DEFAULT_COLORS[key]);

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
    set('--sle-bg-first', bg(c.bgFirst));
    set('--sle-bg-uncertain', bg(c.bgUncertain));
    set('--sle-bg-vague', bg(c.bgVague));
    const adv = Boolean(settings.colorsAdvanced);
    set('--sle-text-aired', (adv && c.textAired) || c.text);
    set('--sle-text-future', (adv && c.textFuture) || c.text);
    set('--sle-text-final', (adv && c.textFinal) || c.text);
    set('--sle-text-first', (adv && c.textFirst) || c.text);
    set('--sle-text-uncertain', (adv && c.textUncertain) || c.text);
    set('--sle-text-vague', (adv && c.textVague) || c.text);
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
      first: { episode: 1, total: 12, date: new Date(now - 2 * 36e5).toISOString() },
      uncertain: { episode: 5, total: 12, date: tomorrow.toISOString(), mode: 'uncertain' },
      vague: { badge: { kind: 'vague', lines: [T().anons, `${T().seasons.spring} ${new Date().getFullYear() + 1}`] } },
    }[state];
    fillBadge(badge, sample, state === 'future' || state === 'uncertain');
  }

  // Build the window once; after that clicks only flip classes and attributes,
  // so the preview card (and its poster) isn't recreated and nothing jumps.
  // It's rebuilt only when the language, login or preview poster changes.
  let previewHeight = 0; // remembered height of the preview card, used as its minimum

  function renderSettings() {
    const el = current.settingsEl;
    const t = T();
    const loggedIn = Boolean(myUserId());
    const signature = [uiLang(), namesLang(), loggedIn, previewPoster, previewAnimeId].join('|');
    if (el.dataset.signature !== signature) {
      el.dataset.signature = signature;
      buildSettings(el, t, loggedIn);
    }
    // just update the current state
    const anim = settings.animations !== false;
    el.querySelectorAll('[data-anim]').forEach((b) =>
      b.classList.toggle('on', (b.dataset.anim === 'on') === anim));
    el.querySelectorAll('[data-page]').forEach((b) =>
      b.classList.toggle('on', (b.dataset.page === 'on') === Boolean(settings.animePage)));
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
          <div class="sle-set-row">
            <div class="sle-set-label">${esc(t.setPage)}<small>${esc(t.setPageHint)}</small></div>
            <div class="sle-switch">
              <button type="button" data-page="on">${esc(t.on)}</button>
              <button type="button" data-page="off">${esc(t.off)}</button>
            </div>
          </div>
          <div class="sle-set-row ${loggedIn ? '' : 'sle-f-disabled'}"${loggedIn ? '' : ` data-hint="${esc(t.setIconLoggedOut)}"`}>
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
      id: 0, name: 'Example', russian: t.setPreview, url: '#', kind: 'tv',
      score: previewAnimeId === 51678 ? '10.00' : '8.1',
      year: previewAnimeId === 51678 ? '2023' : String(new Date().getFullYear()), episode: 3, total: 12,
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
      img.addEventListener('load', remember, { once: true });
      // signed out (or no favourite found): Shikimori's own "no image" placeholder
      img.src = loggedIn && previewPoster ? previewPoster : abs(NO_POSTER);
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
          previewAnimeId = pick.id;
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
      if (current && openWindow === 'settings') { renderSettings(); renderHealthStrips(); }
    });
  }

  function renderFilters() {
    const el = current.filtersEl;

    const pop = el.querySelector('.sle-select.open .sle-pop');
    const popScroll = pop ? pop.scrollTop : 0;
    // Every box has its options in it, open or not, so they can slide.
    // The new HTML starts the way it was before (which one was open),
    // and then flips to the new state, so the change animates.
    const wasOpen = el.dataset.open || '';
    const nowOpen = openGroup || '';

    const t = T();
    const loggedIn = Boolean(myUserId());
    el.innerHTML = GROUPS.map(({ key }) => {
      const title = t.groups[key];
      // logged out: the list filter is greyed out and says why
      if (key === 'list' && !loggedIn) {
        return `
          <div class="sle-f sle-f-disabled" data-key="list" data-hint="${esc(t.signInHint)}">
            <div class="sle-f-title">${title}</div>
            <div class="sle-select"><div class="sle-tagbox"><div class="sle-tags">
              <span class="sle-placeholder">${esc(t.signIn)}</span></div></div></div>
          </div>`;
      }
      const f = settings.filters[key];
      const opts = optionsFor(key, data);
      const label = (id) => opts.find((o) => o.id === id)?.label || '#' + id;
      // newest choice first
      const chosen = [...f.include, ...f.exclude];
      const order = (f.recent || []).filter((id) => chosen.includes(id));
      const ordered = [...order, ...chosen.filter((id) => !order.includes(id))];
      const tags = ordered.map((id) => f.include.includes(id)
        ? `<span class="sle-tag inc">${esc(label(id))}</span>`
        : `<span class="sle-tag exc">${esc(label(id))}</span>`).join('');
      const chips = opts.length
        ? opts.map((o) => {
            const st = f.include.includes(o.id) ? 'inc' : f.exclude.includes(o.id) ? 'exc' : '';
            return `<button type="button" class="sle-chip ${st}" data-id="${esc(o.id)}">${esc(o.label)}</button>`;
          }).join('')
        : `<span class="sle-placeholder">${data ? t.failed : t.loading}</span>`;
      return `
        <div class="sle-f" data-key="${key}">
          <div class="sle-f-title">${title}</div>
          <div class="sle-select ${wasOpen === key ? 'open' : ''}">
            <div class="sle-tagbox">
              <div class="sle-tags">${tags || `<span class="sle-placeholder">${t.any}</span>`}</div>
              <span class="sle-more"></span>
              <div class="sle-pop-wrap"><div class="sle-pop-clip"><div class="sle-pop">${chips}</div></div></div>
            </div>
          </div>
        </div>`;
    }).join('') + `<button type="button" class="sle-reset" data-act="reset">${esc(t.reset)}</button>`;
    // search button, left of the filters, level with the boxes
    el.insertAdjacentHTML('afterbegin',
      `<button type="button" class="sle-search-btn${searchOpen ? ' on' : ''}" data-act="search" data-hint="${esc(t.tSearch)}">${SEARCH}</button>`);

    const newPop = el.querySelector('.sle-select.open .sle-pop');
    if (newPop) newPop.scrollTop = popScroll;
    if (wasOpen !== nowOpen) {
      void el.offsetHeight; // let the browser see the old state first
      el.querySelectorAll('.sle-f').forEach((f) =>
        f.querySelector('.sle-select')?.classList.toggle('open', f.dataset.key === nowOpen));
    }
    el.dataset.open = nowOpen;

    // "+N" for the tags that don't fit on the first line
    el.querySelectorAll('.sle-tags').forEach((box) => {
      const tagEls = [...box.children];
      const firstTop = tagEls[0]?.offsetTop ?? 0;
      const hidden = tagEls.filter((n) => n.offsetTop > firstTop).length;
      const more = box.parentElement.querySelector('.sle-more');
      if (!more) return;
      more.textContent = '+' + hidden;
      more.classList.toggle('on', hidden > 0);
    });
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
    current.splitBtn.dataset.hint = t.tSplit;
    current.gearBtn.dataset.hint = t.tFilters;
    current.reloadBtn.dataset.hint = t.tReload;
    current.debugEl.querySelector('summary').textContent = t.debug;
    current.infoBtn.dataset.hint = t.tInfo;
    current.settingsBtn.dataset.hint = t.tSettings;
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
    renderHint();

    current.gearBtn.classList.toggle('on', settings.open);
    current.filtersWrap.classList.toggle('open', Boolean(settings.open));
    if (!settings.open) current.filtersWrap.classList.remove('settled');
    current.splitBtn.classList.toggle('on', settings.split);
    current.inner.dataset.sleIcon = settings.iconPos || 'top';
    if (data) renderCards();
    renderFilters();
    renderSearchBar();
    renderHealthStrips();
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
    block.querySelectorAll('.sle-tools, .sle-filters-wrap, .sle-filters, .sle-window, .sle-debug, .sle-hint, .sle-hint-arrow, .sle-search')
      .forEach((el) => el.remove());

    const template = original.content.firstElementChild.cloneNode(true);
    const link = template.querySelector('a[href*="/animes/"]');
    // the card we copy needs a poster and a link to the anime, or ours come out broken
    if (template.querySelector('img') && link) reportOk('layout:card');
    else reportProblem('layout:card');
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
      <button type="button" class="sle-ibtn sle-ibtn-i" data-act="info">${INFO}</button>
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

    // first-visit hint over the cards, with an arrow pointing at the help button
    const hintEl = document.createElement('div');
    hintEl.className = 'sle-hint';
    hintEl.hidden = true;
    block.appendChild(hintEl);
    const hintArrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    hintArrow.setAttribute('class', 'sle-hint-arrow');
    hintArrow.setAttribute('hidden', '');
    block.appendChild(hintArrow);

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
        if (current) renderSearchBar(); // the cards moved, the bar follows them
      }
    });
    if (settings.open) filtersWrap.classList.add('open', 'settled');

    // search bar, floating over the cards or the filters
    const searchEl = document.createElement('div');
    searchEl.className = 'sle-search';
    searchEl.innerHTML = `<span class="sle-search-icon">${SEARCH}</span>`
      + '<input type="text" autocomplete="off" spellcheck="false"><span class="sle-search-measure"></span>'
      + '<span class="sle-search-count"></span><button type="button" class="sle-search-x">×</button>';
    block.appendChild(searchEl);
    searchEl.querySelector('input').addEventListener('input', (e) => onSearchInput(e.target.value));
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setSearchOpen(false); }
    });
    // the × never takes focus, so pressing it can't open the pill wide under the mouse
    const clearBtn = searchEl.querySelector('.sle-search-x');
    clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
    clearBtn.addEventListener('click', () => setSearchOpen(false, true));
    // clicking into the pill's text opens it wide again
    searchEl.querySelector('input').addEventListener('focus', () => {
      if (searchOpen) return;
      searchOpen = true;
      renderSearchBar();
    });

    const debugEl = document.createElement('details');
    debugEl.className = 'sle-debug';
    debugEl.innerHTML = '<summary></summary><pre></pre>';
    debugEl.hidden = !DEBUG; // hidden unless DEBUG is on
    fc.after(debugEl);

    current = {
      inner, block, head, headingNode, tools, template, tpl, filtersEl, filtersWrap, debugEl,
      infoEl, settingsEl, hintEl, hintArrow, searchEl,
      searchCount: searchEl.querySelector('.sle-search-count'),
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
        setTimeout(checkEpisodes, 500);
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
      const page = e.target.closest('[data-page]');
      if (page) {
        settings.animePage = page.dataset.page === 'on';
        saveSettings();
        renderAll();
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
      if (e.target.closest('[data-act="search"]')) {
        setSearchOpen(!searchOpen);
        return;
      }
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
        // newest choice goes to the front of the tags
        f.recent = (f.recent || []).filter((x) => x !== id);
        if (f.include.includes(id) || f.exclude.includes(id)) f.recent.unshift(id);
        saveSettings();
        if (data) renderCards();
        renderFilters();
        clearTimeout(recheckTimer);
        recheckTimer = setTimeout(checkEpisodes, 1500); // other anime may show up now
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

  // the first-visit hint goes away on a click on it or on any of our buttons/filters,
  // other clicks on the page don't count
  document.addEventListener('click', (e) => {
    if (settings.hintSeen || !current || !e.target.isConnected) return;
    if (!e.target.closest('.sle-tools, .sle-hint, .sle-filters-wrap, .sle-search')) return;
    settings.hintSeen = true;
    saveSettings();
    renderAll();
  }, true);
  window.addEventListener('resize', () => {
    positionHint();
    if (current?.inner.isConnected && isOwner()) renderSearchBar();
  });

  // Our own hints instead of the browser's title popups: those appear next to the cursor,
  // and a big custom cursor covers them. Ours show above the element (or below it if
  // there's no room). Used for the marks on anime pages and in the tooltip, our buttons,
  // and the greyed out filter and setting.
  let miniTip = null;
  const HINT_SELECTOR = '.sle-page-mark[data-hint], .sle-health-off[data-hint], '
    + ':is(.sle-tools, .sle-filters-wrap, .sle-window, .sle-search) [data-hint]';
  document.addEventListener('mouseover', (e) => {
    const markEl = e.target.closest?.(HINT_SELECTOR);
    if (!markEl) return;
    if (!miniTip?.isConnected) {
      miniTip = document.createElement('div');
      miniTip.className = 'sle-mini-tip';
      document.body.appendChild(miniTip);
    }
    miniTip.textContent = markEl.dataset.hint;
    miniTip.hidden = false;
    const r = markEl.getBoundingClientRect();
    miniTip.style.left = '0px';
    miniTip.style.top = '0px';
    const o = miniTip.getBoundingClientRect(); // where 0,0 actually is
    const w = miniTip.offsetWidth, h = miniTip.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), document.documentElement.clientWidth - w - 8);
    const above = r.top - h - 6;
    const top = above > 4 ? above : r.bottom + 6; // below if there's no room above
    miniTip.style.left = left - o.left + 'px';
    miniTip.style.top = top - o.top + 'px';
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest?.(HINT_SELECTOR);
    if (miniTip && el && !el.contains(e.relatedTarget)) miniTip.hidden = true;
  });
  // a click can redraw the element under the mouse (no mouseout then), so hide on clicks too
  document.addEventListener('click', () => { if (miniTip) miniTip.hidden = true; }, true);

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

  // close the search bar when clicking outside it
  document.addEventListener('click', (e) => {
    if (!searchOpen || !current || !e.target.isConnected) return;
    if (e.target.closest('.sle-search, [data-act="search"], .sle-tooltip')) return;
    setSearchOpen(false);
  });

  // close the dropdown when clicking somewhere else
  document.addEventListener('click', (e) => {
    if (!e.target.isConnected) return;
    if (openGroup && current && !e.target.closest('.sle-f')) {
      openGroup = null;
      renderFilters();
    }
  });

  // Layout check, a few seconds after landing on the home page: by then the block
  // should be ours (or the other copy's). Skipped on pages that don't look like a
  // normal Shikimori page (an error page while the site is down has no anime links).
  let layoutBody = null;
  let layoutTimer = 0;
  function scheduleLayoutCheck() {
    if (location.pathname !== '/' || layoutBody === document.body) return;
    layoutBody = document.body;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(checkLayout, 6000);
  }
  function checkLayout() {
    if (location.pathname !== '/' || health.disabled) return;
    if (testBreak) { reportProblem('layout:block'); return; }
    if (document.querySelectorAll('a[href*="/animes/"]').length < 5) return;
    const inner = document.querySelector('.fc-ongoings .inner');
    if (!inner) { reportProblem('layout:block'); return; }
    reportOk('layout:block');
    if (!inner.closest('.block2')?.dataset.sleOwner) reportProblem('layout:card'); // never managed to set up
  }

  // The notice, bottom left: yellow "may not work" with "turn off" / "false alarm",
  // a small round button while turned off (hover says why, click turns back on),
  // and a green "fixed" after an update that hides on any click
  let healthEl = null;
  function renderHealth() {
    if (!document.body) return;
    if (!style.isConnected && document.head) document.head.appendChild(style);
    if (!themeStyle.isConnected && document.head) document.head.appendChild(themeStyle);
    const t = T();
    const name = t.heading;
    const mode = health.disabled ? 'off'
      : health.alert && health.dismissed !== health.alert ? 'warn'
      : greenReady ? 'ok' : null;
    const key = mode && `${mode}|${uiLang()}`;
    if (healthEl?.isConnected && healthEl.dataset.key === key) return;
    healthEl?.remove();
    healthEl = null;
    if (!mode) return;
    if (mode === 'off') {
      healthEl = document.createElement('button');
      healthEl.type = 'button';
      healthEl.className = 'sle-health-off';
      healthEl.dataset.hint = t.healthOffHint(name);
      healthEl.innerHTML = POWER;
    } else {
      healthEl = document.createElement('div');
      healthEl.className = 'sle-health sle-health-' + mode;
      healthEl.innerHTML = mode === 'warn'
        ? `<b>${esc(t.healthTitle)}</b>${esc(t.healthText(name))}
           <div class="sle-health-buttons">
             <button type="button" class="main" data-health="off">${esc(t.healthOff)}</button>
             <button type="button" data-health="dismiss">${esc(t.healthFalse)}</button>
           </div>`
        : `${esc(t.healthFixed(name, VERSION))}<small>${esc(t.healthFixedClose)}</small>`;
    }
    healthEl.dataset.key = key;
    document.body.appendChild(healthEl);
  }

  // the yellow strip at the bottom of our windows (help, settings), shown until a
  // fixed version comes, even after "false alarm"
  function renderHealthStrips() {
    if (!current) return;
    for (const win of current.block.querySelectorAll('.sle-window')) {
      let strip = win.querySelector(':scope > .sle-health-strip');
      if (!health.alert) { strip?.remove(); continue; }
      if (!strip) {
        strip = document.createElement('div');
        strip.className = 'sle-health-strip';
      }
      strip.textContent = T().healthStrip;
      if (win.lastElementChild !== strip) win.appendChild(strip); // always the last thing
    }
  }

  document.addEventListener('click', (e) => {
    // green "fixed": any click hides it for good
    if (greenReady && healthEl?.isConnected && healthEl.classList.contains('sle-health-ok')) {
      greenReady = false;
      health.fixedPending = false;
      saveHealth();
      renderHealth();
      return;
    }
    if (!healthEl || !healthEl.contains(e.target)) return;
    const act = e.target.closest('[data-health]')?.dataset.health;
    if (healthEl.classList.contains('sle-health-off')) {
      // back on: reload, so everything starts fresh
      health.disabled = false;
      saveHealth();
      location.reload();
    } else if (act === 'off') {
      // off: reload, so the site's own block comes back untouched
      health.disabled = true;
      saveHealth();
      location.reload();
    } else if (act === 'dismiss') {
      health.dismissed = health.alert;
      saveHealth();
      renderHealth();
    }
  }, true);

  // Page changes. Shikimori swaps the page without reloading, and Greasemonkey
  // doesn't run the script again, so we watch the page and hook in whenever
  // a fresh "Currently Airing" block shows up.

  function check() {
    if (!style.isConnected && document.head) document.head.appendChild(style);
    if (!themeStyle.isConnected && document.head) document.head.appendChild(themeStyle);
    updateTheme();
    renderHealth(); // page swaps replace <body>, the notice has to come back
    if (health.disabled) return; // turned off until a fixed version comes
    scheduleLayoutCheck();
    if (ANIME_PAGE.test(location.pathname)) enhanceAnimePage();
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
  if (!health.disabled) loadData()
    .then((d) => { data = d; fixHentaiId(d); setTimeout(checkEpisodes, 500); check(); })
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
