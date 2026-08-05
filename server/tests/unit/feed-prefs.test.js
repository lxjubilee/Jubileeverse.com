'use strict';
/**
 * Feed personalization — the ⋯ menu on a story card (Follow / Block / Share)
 * and the Personalize popup write to one store that two feeds read.
 *
 * What was wrong:
 *   - the storage key, the change event and the slug derivation were copied
 *     into four files, identical by luck rather than by construction;
 *   - a topic portal read none of it, so Follow did nothing visible there and
 *     a hidden card came back on reload;
 *   - Follow could not be undone from the card, and a topic blocked from a news
 *     card could not be undone at all — the card vanished and the popup listed
 *     a different vocabulary entirely.
 *
 * The module is TypeScript in src/, so it is compiled here with the real
 * TypeScript compiler rather than by stripping types with regexes — what runs
 * in these assertions is what ships.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'feedPrefs.ts');

/** A fresh module instance over a fresh fake localStorage. */
function loadPrefs(seed) {
  const store = new Map();
  if (seed !== undefined) store.set('jubileeVersePrefs', JSON.stringify(seed));
  const listeners = {};

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const sandbox = {
    console, JSON, Set, Array, String, Date, Boolean,
    localStorage,
    window: {
      localStorage,
      dispatchEvent: (e) => { (listeners[e.type] || []).forEach((f) => f(e)); return true; },
      addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
      removeEventListener: (t, f) => {
        listeners[t] = (listeners[t] || []).filter((x) => x !== f);
      },
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
  };
  sandbox.exports = {};
  sandbox.module = { exports: sandbox.exports };
  vm.createContext(sandbox);

  const js = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInContext(js, sandbox);

  return { api: sandbox.exports, store, window: sandbox.window };
}

/** The home feed's filter + ordering, as page.tsx applies it. */
function homeVisible(api, feed, prefs, hidden = new Set()) {
  const blocked = new Set(prefs.blocked.map((s) => s.toLowerCase()));
  const following = new Set(prefs.following.map((s) => s.toLowerCase()));
  const filtered = feed.filter(
    (s) => !blocked.has(api.topicSlugOf(s)) && !hidden.has(String(s.id)),
  );
  if (following.size === 0) return filtered;
  return [...filtered].sort(
    (a, b) => (following.has(api.topicSlugOf(a)) ? 0 : 1) - (following.has(api.topicSlugOf(b)) ? 0 : 1),
  );
}

/** The topic portal's filter, which keeps the portal's own topic visible. */
function portalVisible(api, stories, prefs, hidden, topic) {
  const blocked = new Set(prefs.blocked.map((s) => s.toLowerCase()));
  return stories.filter((s) => {
    if (hidden.has(String(s.id))) return false;
    const slug = api.topicSlugOf(s);
    return !(slug && slug !== topic && blocked.has(slug));
  });
}

const FEED = [
  { id: 1, topic: 'finance' },
  { id: 2, topic: 'technology' },
  { id: 3, topic: 'finance' },
  { id: 4, topic: 'health' },
  { id: 5, topic: 'entertainment' },
];

describe('one definition of the storage contract', () => {
  test('the key, the hidden key and the event name are exported once', () => {
    const { api } = loadPrefs();
    expect(api.PREFS_KEY).toBe('jubileeVersePrefs');
    expect(api.HIDDEN_KEY).toBe('jubileeVerseHidden');
    expect(api.PREFS_CHANGED_EVENT).toBe('jubilee:prefs-changed');
  });

  test('the slug a card writes is the slug a feed matches on', () => {
    const { api } = loadPrefs();
    expect(api.topicSlugOf({ topic: 'Finance' })).toBe('finance');
    expect(api.topicSlugOf({ category: 'Covenant-Identity' })).toBe('covenant-identity');
    expect(api.topicSlugOf({ topic: null, category: null })).toBe('');
    // topic wins over category, as every call site assumed.
    expect(api.topicSlugOf({ topic: 'health', category: 'faith' })).toBe('health');
  });

  test('malformed stored JSON degrades to empty rather than throwing', () => {
    const { api, store } = loadPrefs();
    store.set('jubileeVersePrefs', '{not json');
    expect(api.readPrefs()).toEqual({ following: [], blocked: [] });
  });
});

describe('Block', () => {
  test('removes the topic from the feed and persists', () => {
    const { api } = loadPrefs();
    api.setTopicPref('block', 'finance');
    expect(homeVisible(api, FEED, api.readPrefs()).map((s) => s.topic))
      .toEqual(['technology', 'health', 'entertainment']);
    // Survives a reload: it is in storage, not just in component state.
    expect(api.readPrefs().blocked).toEqual(['finance']);
  });

  test('blocking a followed topic clears the follow', () => {
    const { api } = loadPrefs();
    api.setTopicPref('follow', 'finance');
    api.setTopicPref('block', 'finance');
    expect(api.readPrefs()).toEqual({ following: [], blocked: ['finance'] });
  });
});

describe('Follow', () => {
  test('surfaces the topic first', () => {
    const { api } = loadPrefs();
    api.setTopicPref('follow', 'entertainment');
    expect(homeVisible(api, FEED, api.readPrefs())[0].topic).toBe('entertainment');
  });

  test('is reversible from the card — the menu toggles it off', () => {
    const { api } = loadPrefs();
    api.setTopicPref('follow', 'entertainment');
    expect(api.readPrefs().following).toEqual(['entertainment']);
    api.setTopicPref('clear', 'entertainment');
    expect(api.readPrefs()).toEqual({ following: [], blocked: [] });
  });

  test('following a blocked topic clears the block', () => {
    const { api } = loadPrefs();
    api.setTopicPref('block', 'finance');
    api.setTopicPref('follow', 'finance');
    expect(api.readPrefs()).toEqual({ following: ['finance'], blocked: [] });
    expect(homeVisible(api, FEED, api.readPrefs()).some((s) => s.topic === 'finance')).toBe(true);
  });

  test('a capitalised label still matches the stories it came from', () => {
    // The card labels topics "Technology"; the feed matches lower-case slugs.
    const { api } = loadPrefs();
    api.setTopicPref('follow', 'Technology');
    expect(api.readPrefs().following).toEqual(['technology']);
    expect(homeVisible(api, FEED, api.readPrefs())[0].topic).toBe('technology');
  });
});

describe('every write notifies the open views', () => {
  test('follow, block and clear each dispatch the change event', () => {
    const { api, window } = loadPrefs();
    let seen = 0;
    window.addEventListener('jubilee:prefs-changed', () => seen++);
    api.setTopicPref('follow', 'health');
    api.setTopicPref('block', 'health');
    api.setTopicPref('clear', 'health');
    expect(seen).toBe(3);
  });

  test('onPrefsChanged unsubscribes cleanly', () => {
    const { api, window } = loadPrefs();
    let seen = 0;
    const off = api.onPrefsChanged(() => seen++);
    api.setTopicPref('follow', 'faith');
    off();
    api.setTopicPref('block', 'faith');
    expect(seen).toBe(1);
  });

  test('an empty slug is ignored rather than stored', () => {
    const { api, window } = loadPrefs();
    let seen = 0;
    window.addEventListener('jubilee:prefs-changed', () => seen++);
    api.setTopicPref('follow', '');
    expect(api.readPrefs()).toEqual({ following: [], blocked: [] });
    expect(seen).toBe(0);
  });
});

describe('hidden stories persist', () => {
  test('a hidden card stays hidden across a reload', () => {
    const { api } = loadPrefs();
    api.addHidden(4);
    expect(api.readHidden().has('4')).toBe(true);
    expect(homeVisible(api, FEED, api.readPrefs(), api.readHidden()).map((s) => s.id))
      .toEqual([1, 2, 3, 5]);
  });

  test('adding builds on what is already stored', () => {
    const { api } = loadPrefs();
    api.addHidden(1);
    api.addHidden(2);
    expect([...api.readHidden()].sort()).toEqual(['1', '2']);
  });
});

describe('topic portal honours the same preferences', () => {
  const STORIES = [{ id: 9, topic: 'finance' }, { id: 10, topic: 'health' }];

  test('a blocked topic is filtered out of another portal', () => {
    const { api } = loadPrefs();
    api.setTopicPref('block', 'finance');
    expect(portalVisible(api, STORIES, api.readPrefs(), new Set(), 'health').map((s) => s.topic))
      .toEqual(['health']);
  });

  test("the portal's own topic is never blanked out", () => {
    // Blocking finance while reading /finance must not empty the page the
    // reader deliberately navigated to.
    const { api } = loadPrefs();
    api.setTopicPref('block', 'finance');
    expect(portalVisible(api, STORIES, api.readPrefs(), new Set(), 'finance').map((s) => s.topic))
      .toEqual(['finance', 'health']);
  });

  test('a hidden card stays hidden on the portal too', () => {
    const { api } = loadPrefs();
    api.addHidden(9);
    expect(portalVisible(api, STORIES, api.readPrefs(), api.readHidden(), 'health').map((s) => s.id))
      .toEqual([10]);
  });
});

describe('choices made from a card remain reversible in the popup', () => {
  test('topics outside the nav list are still surfaced for undo', () => {
    // The popup lists the five-fold nav slugs; a news card writes its own topic
    // slug. Without this the block below would be a one-way door.
    const navSlugs = new Set([
      'celebration-mishpakhah', 'teshuvah-restoration', 'shalom-salvation',
      'covenant-identity', 'torah-hebraic-insights',
    ]);
    const { api } = loadPrefs();
    api.setTopicPref('block', 'finance');
    api.setTopicPref('follow', 'covenant-identity');

    const prefs = api.readPrefs();
    const customized = [...new Set([...prefs.following, ...prefs.blocked])].filter(Boolean).sort();
    const extra = customized.filter((s) => !navSlugs.has(s));

    expect(extra).toEqual(['finance']);         // shown as an extra row
    expect(customized).toContain('covenant-identity'); // already a nav row
  });
});
