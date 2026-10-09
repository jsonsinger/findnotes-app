import * as db from './db.js';
import { createEditor, plainText } from './editor.js';

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'),
  grab: $('grab'),
  who: $('who'),
  whos: $('whos'),
  tileIcon: $('tile-icon'),
  title: $('title'),
  titleInput: $('title-input'),
  listEdit: $('listedit'),
  editScrim: $('edit-scrim'),
  iconGrid: $('icon-grid'),
  listbar: $('listbar'),
  listbarHint: $('listbar-hint'),
  listbarX: $('listbar-x'),
  menuArchiveThis: $('menu-archive-this'),
  stage: $('stage'),
  list: $('list'),
  add: $('add'),
  scrim: $('scrim'),
  drawer: $('drawer'),
  trash: $('trash'),
  itemTitle: $('item-title'),
  itemBody: $('item-body'),
  foot: $('drawer-top'),
  hint: $('hint'),
  hintIcon: $('hint-icon'),
  hintText: $('hint-text'),
  done: $('done'),
  doneIcon: $('done-icon'),
  bookmark: $('bookmark'),
  meta: $('meta'),
  metaDate: $('meta-date'),
  metaList: $('meta-list'),
  toast: $('toast'),
  menuBtn: $('menu-btn'),
  menuScrim: $('menu-scrim'),
  menu: $('menu'),
  allLists: $('all-lists'),
  allRows: $('all-rows'),
  allNew: $('all-new'),
  archive: $('archive'),
  archiveBody: $('archive-body'),
  archiveBack: $('archive-back'),
  search: $('search'),
  searchBack: $('search-back'),
  searchInput: $('search-input'),
  searchBody: $('search-body'),
  searchBtn: $('search-btn'),
  settings: $('settings'),
  settingsBack: $('settings-back'),
  trashIcon: $('trash-icon'),
  dots: $('dots'),
  header: $('header'),
  banner: $('banner'),
  bannerText: $('banner-text'),
  selbar: $('selbar'),
  selFill: $('sel-fill'),
  selHint: $('sel-hint'),
  selKnob: $('sel-knob'),
  selX: $('sel-x'),
  bannerAction: $('banner-action'),
};

// Everything on screen is drawn from this object. IndexedDB is the saved copy.
// lists and items are the live ones. Archived lists and items wait in `archive` until
// they are restored or deleted for good.
const state = { lists: [], items: [], currentId: null, archive: { lists: [], items: [] } };

// Find the list by id. An index would shift whenever a list is deleted.
const currentList = () => state.lists.find((l) => l.id === state.currentId);

const itemsOf = (listId) =>
  state.items.filter((i) => i.listId === listId).sort((a, b) => a.order - b.order);

const firstLine = (text) => text.split('\n').find((line) => line.trim()) || '';

/* ---------- when saving goes wrong ---------- */

function showBanner(message, actionLabel, onAction) {
  el.bannerText.textContent = message;
  el.bannerAction.textContent = actionLabel;
  el.bannerAction.onclick = onAction;
  el.banner.hidden = false;
}

// true when IndexedDB wouldn't even open: the app runs from memory only
let memoryOnly = false;
let saveFailed = false;

// Every write goes through here. The screen has already changed (see "optimistic
// update"), so if the save fails the person has to be told, not left guessing.
function save(write) {
  return write.then(
    () => {
      if (saveFailed) { // a later save worked, so the problem has gone away
        saveFailed = false;
        el.banner.hidden = true;
      }
    },
    (error) => {
      console.error(error);
      if (memoryOnly) return; // already warned at start-up
      saveFailed = true;
      const reason = error?.name === 'QuotaExceededError'
        ? 'This device is out of storage space.'
        : "Couldn't save your last change.";
      showBanner(`${reason} It may be lost if you close the app.`, 'Try again', saveEverything);
    },
  );
}

// "Try again": write everything on screen back to the database in one go.
function saveEverything() {
  return save(db.batch({
    put: [...state.lists.map((l) => ['lists', l]), ...state.items.map((i) => ['items', i])],
  }));
}

/* ---------- remembering the last list ---------- */

// Which list you were looking at is a per-device habit, not part of your
// data, so it lives in localStorage rather than IndexedDB (and not in exports).
// The icons a list can have. Anything else (or nothing) falls back to the plain list icon,
// which also means the name can never be used to smuggle odd text into an href.
const LIST_ICONS = ['flame', 'compass', 'mountain', 'map', 'tent', 'anchor', 'moon', 'sun', 'leaf', 'star', 'heart', 'list'];
const iconOf = (list) => (LIST_ICONS.includes(list.icon) ? list.icon : 'list');
const iconHref = (list) => `#i-${iconOf(list)}`;

const LAST_LIST_KEY = 'find-notes:last-list';

function rememberList(id) {
  try { localStorage.setItem(LAST_LIST_KEY, id); } catch { /* storage blocked */ }
}

function recallList() {
  try { return localStorage.getItem(LAST_LIST_KEY); } catch { return null; }
}

function switchTo(id) {
  hideToast();
  closeListBar(); // an Undo for something on the list you just left would make no sense
  clearSelection();
  state.currentId = id;
  rememberList(id);
  render();
  el.list.scrollTop = 0; // every list opens at its top
}

/* ---------- loading ---------- */

async function load() {
  const lists = await db.getAll('lists');
  const items = await db.getAll('items');
  const newest = (a, b) => b.archivedAt - a.archivedAt;
  state.lists = lists.filter((l) => !l.archivedAt).sort((a, b) => a.order - b.order);
  state.items = items.filter((i) => !i.archivedAt);
  state.archive.lists = lists.filter((l) => l.archivedAt).sort(newest);
  state.archive.items = items.filter((i) => i.archivedAt).sort(newest);
}

// Sample data from the mockup, only used when the database is empty.
async function seed() {
  const home = { id: db.uid(), name: 'Home', icon: 'flame', order: 0 };
  await db.put('lists', home);

  const samples = [
    ['Call the electrician', 'Ask about the kitchen socket'],
    ['Buy lightbulbs', ''],
    ['Fix the gate latch', 'Needs a new spring'],
  ];
  const now = Date.now();
  for (const [order, [title, body]] of samples.entries()) {
    await db.put('items', {
      id: db.uid(), listId: home.id, title, body,
      done: false, order, createdAt: now, updatedAt: now,
    });
  }
}

/* ---------- drawing ---------- */

const selection = new Set(); // ids of the rows picked with a long-press

function renderRow(item) {
  const row = document.createElement('div');
  row.className = 'row' + (item.done ? ' done' : '') + (selection.has(item.id) ? ' selected' : '');
  row.dataset.id = item.id;
  row.setAttribute('role', 'listitem');

  // Fixed markup only. User text is added below with textContent, never innerHTML.
  row.innerHTML = `
    <button class="check" role="checkbox" aria-label="Done">
      <span class="circle"><svg class="icon" aria-hidden="true"><use href="#i-check"/></svg></span>
    </button>
    <button class="row-text">
      <span class="row-title"></span>
      <span class="row-sub"></span>
    </button>`;

  row.querySelector('.check').setAttribute('aria-checked', String(item.done));
  row.querySelector('.row-title').textContent = item.title;

  const sub = row.querySelector('.row-sub');
  const preview = firstLine(plainText(item.body));
  if (preview) sub.textContent = preview;
  else sub.remove();

  return row;
}

function renderEmpty() {
  const box = document.createElement('div');
  box.className = 'empty';
  const title = document.createElement('strong');
  title.textContent = 'A blank page';
  const hint = document.createElement('span');
  hint.textContent = 'Add your first item below.';
  box.append(title, hint);
  return box;
}

function render() {
  const list = currentList();
  el.title.textContent = list.name;
  el.tileIcon.setAttribute('href', iconHref(list));

  const items = itemsOf(list.id);
  el.list.replaceChildren(...(items.length ? items.map(renderRow) : [renderEmpty()]));
  renderDots();
}

/* ---------- ticking or opening an item ---------- */

// One listener on the container instead of one per row. Rows are rebuilt on
// every render, so per-row listeners would be thrown away each time.
el.list.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;

  const item = state.items.find((i) => i.id === row.dataset.id);
  if (!item) return;

  if (selection.size) { toggleSelected(item.id); return; } // while selecting, a tap picks or unpicks

  if (e.target.closest('.check')) {
    item.done = !item.done;
    item.updatedAt = Date.now();
    render();                                   // update the screen first
    save(db.put('items', item)); // then save it
  } else if (e.target.closest('.row-text')) {
    openEdit(item);
  }
});

/* ---------- adding an item ---------- */

function addItem(title, body, extras = {}) {
  const list = currentList();
  const siblings = itemsOf(list.id);
  const now = Date.now();

  const item = {
    id: db.uid(),
    listId: list.id,
    title,
    body,
    done: false,
    // Last item's order plus one. Using the count instead would collide
    // once an item in the middle has been deleted.
    order: siblings.length ? siblings[siblings.length - 1].order + 1 : 0,
    createdAt: now,
    updatedAt: now,
    bookmarked: !!extras.bookmarked,
  };

  state.items.push(item);
  render();
  el.list.scrollTop = el.list.scrollHeight; // bring the new item into view
  save(db.put('items', item));
}

/* ---------- keeping the background out of reach ---------- */

// While the drawer, the menu or All lists is open, everything behind it is "inert":
// it can't be tapped, tabbed to, or read out by a screen reader.
const behind = () => [el.header, el.banner, el.stage, el.dots, el.add];

let opener = null; // whatever had focus when the overlay opened

function lockBackground() {
  opener = document.activeElement;
  for (const node of behind()) node.inert = true;
}

function unlockBackground() {
  for (const node of behind()) node.inert = false;
}

// Hand focus back to where it was. The list is rebuilt after an edit, so the old
// button may be gone. In that case find the same row's new button.
function restoreFocus() {
  const node = opener;
  opener = null;
  if (!node) return;

  const rowId = node.closest?.('.row')?.dataset.id;
  const target = node.isConnected
    ? node
    : rowId && el.list.querySelector(`.row[data-id="${rowId}"] .row-text`);
  target?.focus({ preventScroll: true });
}

/* ---------- toast with undo ---------- */

let toastTimer = null;

function hideToast() {
  clearTimeout(toastTimer);
  el.toast.classList.remove('show');
}

function showToast(message, onUndo, ms = 4000) {
  clearTimeout(toastTimer);

  const text = document.createElement('span');
  text.textContent = message;
  el.toast.replaceChildren(text);

  if (onUndo) {
    const undo = document.createElement('button');
    undo.textContent = 'Undo';
    undo.addEventListener('click', () => {
      hideToast();
      onUndo();
    });
    el.toast.append(undo);
  }

  el.toast.classList.add('show');
  toastTimer = setTimeout(hideToast, ms);
}

/* ---------- the draft: a new note nobody has added yet ---------- */

// One slot, kept apart from the real items so a half-written note never shows up in the
// list. localStorage because it can be written in one go when the page is being closed.
const DRAFT_KEY = 'find-notes-draft';

function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    return d && (d.title?.trim() || d.body?.trim()) ? d : null;
  } catch { return null; }
}

function writeDraft(draft) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* private mode or full: the draft is a bonus, never a reason to complain */ }
}

/* ---------- the drawer ---------- */

// null when closed, otherwise { mode: 'add' | 'edit', item }
let drawer = null;
let saveTimer = null;
let maxTimer = null;
const AUTOSAVE_IDLE_MS = 5000;  // editing saves itself 5 seconds after you pause...
const AUTOSAVE_MAX_MS = 60000;  // ...or a minute after the first unsaved change, however long you type
const cancelSave = () => { clearTimeout(saveTimer); clearTimeout(maxTimer); saveTimer = maxTimer = null; };

let hintError = '';
let expanded = false;  // is the sheet more than half way up?

function setHint(message, isError = false) {
  hintError = isError ? message : '';
  el.foot.classList.toggle('error', isError);
  refreshHint();
}

// An error wins; otherwise it says when the note was last saved.
function refreshHint() {
  const saved = hintError ? '' : savedText();
  el.hintText.textContent = hintError || saved;
  el.hintIcon.toggleAttribute('hidden', !saved); // an SVG has no .hidden property
}

// "Saved just now" / "Saved 2 min ago" (for a new note: "Draft saved ..."). It stays while you
// type again; the gold tick says there is something newer.
function ago(t) {
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function savedText() {
  if (!drawer?.savedAt) return '';
  return (drawer.mode === 'add' ? 'Draft saved ' : 'Saved ') + ago(drawer.savedAt);
}
setInterval(() => { if (drawer?.savedAt) refreshHint(); }, 15000);

// The description is a small rich-text editor that saves plain Markdown (see editor.js).
const editor = createEditor(el.itemBody, {
  onChange: () => { updateKind(); updateTrash(); scheduleSave(); },
  onSelection: () => syncToolbar(),
});
const getBody = () => editor.getMarkdown();

function updateKind() {
  syncMeta();
  refreshHint();
}

function syncMeta() {
  el.drawer.classList.toggle('show-meta', !!drawer && expanded);
}

// Gold plus: adding. White tick: saved. Gold tick: changes still on their way to being saved.
function updateCommit() {
  const adding = drawer?.mode === 'add';
  const state = adding ? 'plus' : drawer?.pending ? 'pending' : 'saved';
  el.done.dataset.state = state;
  el.doneIcon.setAttribute('href', adding ? '#i-plus' : '#i-check');
  const label = adding ? 'Add' : drawer?.pending ? 'Save and close' : 'Close';
  if (el.done.getAttribute('aria-label') !== label) el.done.setAttribute('aria-label', label);
}

// Adding: clear the draft so you can start again. Editing: nothing to show.
function updateTrash() {
  if (!drawer) return;
  const adding = drawer.mode === 'add';
  // Only a new note has a bin (clear the draft). Archiving happens from the list, not inside a note.
  el.trash.hidden = !adding || (!el.itemTitle.value.trim() && editor.isEmpty());
  el.trash.setAttribute('aria-label', adding ? 'Clear draft' : 'Archive item');
  el.trashIcon.setAttribute('href', adding ? '#i-trash' : '#i-archive');
}

// The formatting bar above the keyboard. Its buttons must not take focus from the text.
const fmtButtons = [...document.querySelectorAll('#fmtbar [data-cmd]')];
function syncToolbar() {
  if (!drawer) return;
  const { type, bold, italic } = editor.state();
  const on = { h: type === 'h', b: bold, i: italic, li: type === 'li', task: type === 'task' };
  for (const b of fmtButtons) b.setAttribute('aria-pressed', String(!!on[b.dataset.cmd]));
}
for (const eventName of ['pointerdown', 'mousedown']) {
  $('fmtbar').addEventListener(eventName, (e) => e.preventDefault());
}
$('fmtbar').addEventListener('click', (e) => {
  const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
  if (!cmd || !drawer) return;
  if (cmd === 'b' || cmd === 'i') editor.toggleInline(cmd); else editor.toggleType(cmd);
  syncToolbar();
});

function setBookmark(on) {
  el.bookmark.setAttribute('aria-pressed', String(on));
  el.bookmark.setAttribute('aria-label', on ? 'Remove bookmark' : 'Bookmark');
}

const dateText = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function showDrawer(mode, item) {
  // `original` is what the item looked like when it opened, so a swipe-down can put it back
  drawer = {
    mode, item, pending: false, bookmarked: !!item?.bookmarked,
    original: item && { title: item.title, body: item.body, updatedAt: item.updatedAt },
  };
  hideToast();

  const draft = mode === 'add' ? readDraft() : null; // an unfinished note comes back
  if (draft) { drawer.bookmarked = !!draft.bookmarked; drawer.savedAt = draft.t; }
  el.itemTitle.value = item ? item.title : draft?.title ?? '';
  editor.setMarkdown(item ? item.body : draft?.body ?? '');
  drawer.canon = getBody(); // the saved text may differ from its tidied form; that alone is not an edit
  updateTrash();
  el.metaDate.textContent = dateText(item ? item.createdAt : Date.now());
  el.metaList.textContent = currentList().name;
  setBookmark(drawer.bookmarked);
  expanded = false;
  el.drawer.setAttribute('aria-label', mode === 'add' ? 'New item' : 'Edit item');
  setHint('');
  updateKind();
  updateCommit();

  lockBackground();
  el.drawer.classList.remove('closing');
  el.scrim.classList.remove('closing');
  el.drawer.classList.add('open');
  el.scrim.classList.add('open');
  fitViewport();
  watchViewport();
  animateSheet(PEEK);

  // Opening an existing item to read it shouldn't throw the keyboard up, so focus
  // the Done button there instead of a text field.
  if (mode === 'add') el.itemTitle.focus({ preventScroll: true });
  else el.done.focus({ preventScroll: true });
}

const openAdd = () => showDrawer('add', null);
const openEdit = (item) => showDrawer('edit', item);

function hideDrawer() {
  cancelSave();
  el.itemTitle.blur();
  el.itemBody.blur();
  drag = null;
  drawer = null;
  unlockBackground();
  restoreFocus();

  // Slide away. The app is usable straight away, the sheet just finishes leaving.
  el.drawer.classList.add('closing');
  el.scrim.classList.add('closing');
  animateSheet(0).then((finished) => {
    if (!finished) return; // something else (opening again) took over
    el.drawer.classList.remove('open', 'closing');
    el.scrim.classList.remove('open', 'closing');
  });
}

// Copies what's in the fields onto the item. A blank title becomes "Untitled".
function readEdits(item) {
  item.title = el.itemTitle.value.trim() || 'Untitled';
  item.body = getBody().trimEnd();
  item.bookmarked = drawer ? drawer.bookmarked : !!item.bookmarked;
  item.updatedAt = Date.now();
}

// Edits save themselves (see scheduleSave) and when you leave the app; the tick saves straight away.
function saveEdit() {
  cancelSave();
  if (drawer?.mode === 'add') {
    const title = el.itemTitle.value;
    const body = getBody();
    const empty = !title.trim() && !body.trim();
    writeDraft(empty ? null : { title, body, bookmarked: drawer.bookmarked, t: Date.now() });
    drawer.savedAt = empty ? 0 : Date.now();
    refreshHint();
    return;
  }
  if (drawer?.mode !== 'edit') return;
  readEdits(drawer.item);
  drawer.pending = false;
  // Swiping down now only throws away what was typed after this save.
  drawer.original = { title: drawer.item.title, body: drawer.item.body, updatedAt: drawer.item.updatedAt };
  drawer.canon = drawer.item.body;
  drawer.savedAt = Date.now();
  updateCommit();
  refreshHint();
  save(db.put('items', drawer.item));
}

// Two clocks: the idle one restarts on every keystroke, the other starts at the first
// unsaved change and is never pushed back, so a long burst of typing still saves.
const scheduleSave = () => {
  if (drawer) { drawer.pending = true; updateCommit(); refreshHint(); }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveEdit, AUTOSAVE_IDLE_MS);
  if (!maxTimer) maxTimer = setTimeout(saveEdit, AUTOSAVE_MAX_MS);
};

// Done: keeps what you typed. Adding needs a title, editing saves the fields.
function closeDrawer() {
  if (!drawer) return;

  if (drawer.mode === 'add') {
    const title = el.itemTitle.value.trim();
    if (title) {
      addItem(title, getBody().trim(), { bookmarked: drawer.bookmarked });
      writeDraft(null);
    }
  } else {
    readEdits(drawer.item);
    save(db.put('items', drawer.item));
    render();
  }
  hideDrawer();
}

el.add.addEventListener('click', openAdd);
el.scrim.addEventListener('click', dismissDrawer);

el.done.addEventListener('click', () => {
  if (drawer?.mode === 'add' && !el.itemTitle.value.trim()) {
    setHint('Enter a title first', true);
    el.itemTitle.focus();
    return;
  }
  closeDrawer();
});

el.itemTitle.addEventListener('input', () => {
  setHint('');
  updateTrash();
  scheduleSave();
});

el.bookmark.addEventListener('click', () => {
  if (!drawer) return;
  drawer.bookmarked = !drawer.bookmarked;
  setBookmark(drawer.bookmarked);
  if (drawer.mode === 'add') scheduleSave();
  // A bookmark isn't a change to the text, so it saves at once and leaves the tick alone.
  if (drawer.mode === 'edit') {
    drawer.item.bookmarked = drawer.bookmarked;
    save(db.put('items', drawer.item));
  }
});

// Enter in the title moves to the description instead of submitting.
el.itemTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    editor.caretToStart(); // a scrolled page is what broke the sheet, so no scrolling here
  }
});

// Whatever is on top closes first: the menu or list panel, a full-screen page, a selection, then
// the note. Escape on a keyboard and the Back button on Android both come here.
function closeTop() {
  if (!el.menu.hidden) closeMenu();
  else if (!el.listEdit.hidden) finishRename(false);
  else if (!el.search.hidden) closeSearch();
  else if (!el.settings.hidden) closeSettings();
  else if (!el.archive.hidden) closeArchive();
  else if (!el.allLists.hidden) closeAll();
  else if (!el.listbar.hidden) closeListBar();
  else if (selection.size) clearSelection();
  else dismissDrawer(); // discards edits, like swiping down
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTop();
});

// A phone can kill the page the moment you switch apps, so save straight away.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveEdit();
});
addEventListener('pagehide', saveEdit);

/* ---------- the sheet: dragging, snapping, keyboard ---------- */

// The page itself never scrolls. iOS likes to scroll it to reveal a focused field, which
// shows up as a scroll bar and a jump, so put it straight back.
addEventListener('scroll', () => { if (scrollY || scrollX) scrollTo(0, 0); }, { passive: true });

// Three resting heights: closed (0), small (PEEK) and the whole screen (fullHeight()).
const PEEK = 250;
const vv = window.visualViewport;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let sheetH = 0;   // how many pixels of the sheet are showing right now
let sheetAnim = 0; // bumped to cancel a running animation
let drag = null;
let lastDragEnd = 0;

// The tallest the sheet can be: the app, or what is left above the keyboard.
const fullHeight = () => Math.max(PEEK, Math.min(el.app.clientHeight, vv ? vv.height : innerHeight));

// One function positions the sheet for every state: dragging, animating, resting.
function setSheet(h) {
  sheetH = h;
  const full = fullHeight();
  el.drawer.style.height = Math.max(h, PEEK) + 'px';
  el.drawer.style.transform = h < PEEK ? `translateY(${PEEK - h}px)` : '';
  el.drawer.style.setProperty('--full', clamp((h - PEEK) / (full - PEEK || 1), 0, 1).toFixed(3));
  el.scrim.style.opacity = Math.min(1, h / PEEK).toFixed(3);

  const isExpanded = h > (PEEK + full) / 2;
  if (isExpanded !== expanded) {
    expanded = isExpanded;
    syncMeta();
    refreshHint();
  }
  if (el.grab.getAttribute('aria-expanded') !== String(expanded)) {
    el.grab.setAttribute('aria-expanded', String(expanded));
    el.grab.setAttribute('aria-label', expanded ? 'Make note smaller' : 'Expand note');
  }
}

// Glide to a height. Resolves true when it arrives, false if something interrupted it.
function animateSheet(to) {
  const id = ++sheetAnim;
  const from = sheetH;
  const ms = Math.min(300, 140 + Math.abs(to - from) * 0.5);
  return new Promise((resolve) => {
    if (from === to || prefersReducedMotion()) {
      setSheet(to);
      resolve(true);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      if (id !== sheetAnim) return resolve(false);
      const t = Math.min(1, (now - start) / ms);
      setSheet(from + (to - from) * (1 - (1 - t) ** 3)); // ease out: fast, then settles
      if (t < 1) requestAnimationFrame(step);
      else resolve(true);
    };
    requestAnimationFrame(step);
  });
}

// When the keyboard opens, the whole app shrinks to the space above it, so the sheet
// (which sits at the bottom of the app) needs no keyboard maths of its own. On an
// iPhone the browser also pans the page; the transform undoes that.
let lastFull = 0;
let view = { keyboard: false, height: 0, top: 0 }; // what we last laid out for
let settleTimer = 0;
let watching = 0;
const typingInSheet = () =>
  !!drawer && (document.activeElement === el.itemTitle || document.activeElement === el.itemBody);

function fitViewport(settled) {
  const keyboard = !!vv && innerHeight - vv.height > 120;
  const height = vv ? Math.round(vv.height) : 0;
  const top = keyboard ? Math.round(vv.offsetTop) : 0;
  if (keyboard === view.keyboard && height === view.height && top === view.top) return; // nothing changed

  // Moving from the title to the description makes the browser report "no keyboard" for a
  // moment. While a field has focus, wait and see before believing it.
  if (!keyboard && view.keyboard && settled !== true && typingInSheet()) {
    if (!settleTimer) settleTimer = setTimeout(() => { settleTimer = 0; fitViewport(true); }, 300);
    return;
  }
  clearTimeout(settleTimer);
  settleTimer = 0;

  el.app.style.height = keyboard ? height + 'px' : '';
  el.app.style.transform = top ? `translateY(${top}px)` : '';
  el.drawer.classList.toggle('kb', keyboard);

  const full = fullHeight();
  if (drawer && !drag) {
    // A full-page sheet stays full-page, just above the keyboard instead of behind it.
    const wasFull = lastFull > PEEK && sheetH >= lastFull - 2;
    const target = wasFull ? full : Math.min(sheetH, full);
    if (keyboard !== view.keyboard) animateSheet(target); // glide as the keyboard comes or goes
    else setSheet(target);
  }
  lastFull = full;
  view = { keyboard, height, top };
}

// iPhones don't always announce every change in the visible area (moving between fields is
// the worst), so while the sheet or the keyboard is up, look again on every frame.
// It costs next to nothing: when nothing has changed, fitViewport returns at once.
function watchViewport() {
  if (watching) return;
  watching = setInterval(() => {
    fitViewport();
    if (!drawer && !view.keyboard) { clearInterval(watching); watching = 0; }
  }, 120);
}

// When focus leaves the fields the keyboard really is going away, so re-check.
el.drawer.addEventListener('focusout', () => setTimeout(() => fitViewport(true), 200));
vv?.addEventListener('resize', fitViewport);
vv?.addEventListener('scroll', fitViewport);
addEventListener('resize', fitViewport);

// Dragging starts on the handle or the top row, never on the text fields,
// so selecting text and scrolling a long note still work.
el.drawer.addEventListener('pointerdown', (e) => {
  if (!drawer || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (!e.target.closest('.grab, .drawer-top') || e.target.closest('.drawer-top button')) return;
  drag = { id: e.pointerId, y: e.clientY, h: sheetH, moved: false, samples: [{ y: e.clientY, t: e.timeStamp }] };
});

el.drawer.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved) {
    if (Math.abs(drag.y - e.clientY) < 6) return; // still might be a tap
    drag.moved = true;
    sheetAnim++; // stop any animation under the finger
    drag.y = e.clientY;
    drag.h = sheetH;
    el.drawer.setPointerCapture(e.pointerId);
  }
  setSheet(clamp(drag.h + (drag.y - e.clientY), 0, fullHeight()));

  // Keep roughly the last 100ms of movement to measure how fast the finger was going.
  drag.samples.push({ y: e.clientY, t: e.timeStamp });
  while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (!d.moved) return; // a tap, the click handler deals with it
  lastDragEnd = performance.now();

  const first = d.samples[0];
  const last = d.samples[d.samples.length - 1];
  const velocity = last.t > first.t ? (first.y - last.y) / (last.t - first.t) : 0; // px/ms, up is positive
  const full = fullHeight();
  const stops = [0, PEEK, full];

  let target;
  if (e.type === 'pointercancel') {
    target = sheetH < PEEK ? 0 : PEEK;
  } else if (Math.abs(velocity) > 0.5) {
    // A flick moves one stop in its direction, however short the drag was.
    target = velocity > 0
      ? stops.find((s) => s > sheetH + 1) ?? full
      : [...stops].reverse().find((s) => s < sheetH - 1) ?? 0;
  } else if (sheetH < PEEK * 0.75) {
    target = 0;
  } else {
    target = Math.abs(sheetH - PEEK) <= Math.abs(sheetH - full) ? PEEK : full;
  }

  if (target === 0) dismissDrawer();
  else animateSheet(target);
}
// While the sheet is open, a finger moving over anything but the description must not
// scroll the page (on an iPhone that pulls down to refresh the app).
document.addEventListener('touchmove', (e) => {
  if (drawer && el.drawer.classList.contains('open') && !e.target.closest('#item-body')) e.preventDefault();
}, { passive: false });

el.drawer.addEventListener('pointerup', endDrag);
el.drawer.addEventListener('pointercancel', endDrag);

// Tapping the handle toggles between small and full.
el.grab.addEventListener('click', () => {
  if (performance.now() - lastDragEnd < 400) return; // that was the end of a drag
  animateSheet(sheetH > (PEEK + fullHeight()) / 2 ? PEEK : fullHeight());
});

// Dismissing (swipe down, tap outside, Escape) throws the edits away. Done keeps them.
// Undo is offered because a stray swipe shouldn't cost you a note.
function dismissDrawer() {
  if (!drawer) return;
  const { mode, item, original } = drawer;
  cancelSave();
  const title = el.itemTitle.value;
  const body = getBody();
  const bookmarked = drawer.bookmarked;

  if (mode === 'add') {
    saveEdit(); // closing keeps what you wrote as the draft; the bin clears it
    hideDrawer();
    return;
  }

  const edited = { title: title.trim() || 'Untitled', body: body.trimEnd() };
  if (edited.title === original.title && edited.body === drawer.canon) {
    hideDrawer();
    return;
  }

  // Autosave may already have written the edits, so put the original back.
  Object.assign(item, original);
  save(db.put('items', item));
  render();
  hideDrawer();
  showToast('Changes discarded', () => {
    Object.assign(item, edited, { updatedAt: Date.now() });
    save(db.put('items', item));
    render();
  });
}

/* ---------- archiving an item ---------- */

el.trash.addEventListener('click', () => {
  if (drawer?.mode === 'add') {
    cancelSave();
    writeDraft(null);
    el.itemTitle.value = '';
    editor.setMarkdown('');
    drawer.bookmarked = false;
    drawer.savedAt = 0;
    setBookmark(false);
    updateKind();
    updateTrash();
    refreshHint();
    el.itemTitle.focus();
    return;
  }
});

// Archiving keeps everything, it just moves items out of sight. Their place in the
// list is kept, so restoring puts them back where they were.
function archiveItems(items) {
  if (!items.length) return;
  const now = Date.now();
  const ids = new Set(items.map((i) => i.id));
  state.items = state.items.filter((i) => !ids.has(i.id));
  for (const item of items) item.archivedAt = now;
  state.archive.items.unshift(...items);
  save(db.batch({ put: items.map((i) => ['items', i]) }));
  clearSelection();
  render();
  showToast(items.length === 1 ? 'Item archived' : `${items.length} items archived`, () => {
    state.archive.items = state.archive.items.filter((i) => !ids.has(i.id));
    for (const item of items) {
      delete item.archivedAt;
      state.items.push(item);
    }
    save(db.batch({ put: items.map((i) => ['items', i]) }));
    render();
  });
}

function restoreItem(item, toListId = item.listId) {
  state.archive.items = state.archive.items.filter((i) => i.id !== item.id);
  delete item.archivedAt;
  delete item.archivedWith;
  item.listId = state.lists.some((l) => l.id === toListId) ? toListId : state.currentId;
  state.items.push(item);
  save(db.put('items', item));
  render();
}

/* ---------- the three-dots menu ---------- */

function openMenu() {
  // You can't archive your only list, so say so by greying it out.
  el.menuArchiveThis.disabled = state.lists.length < 2;
  lockBackground();
  el.menu.hidden = false;
  el.menuScrim.hidden = false;
  el.menuBtn.setAttribute('aria-expanded', 'true');
  el.menu.querySelector('button').focus();
}

function closeMenu() {
  el.menu.hidden = true;
  el.menuScrim.hidden = true;
  el.menuBtn.setAttribute('aria-expanded', 'false');
  unlockBackground();
  restoreFocus(); // back on the three-dots button, ready for whatever the menu does next
}

el.menuBtn.addEventListener('click', openMenu);
el.menuScrim.addEventListener('click', closeMenu);

el.menu.addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (!action) return;
  closeMenu();
  ({ all: openAll, new: newList, edit: startRename, 'archive-this': openListBar, archive: openArchive, settings: openSettings })[action]();
});

/* ---------- the All lists screen ---------- */

function renderAll() {
  const rows = state.lists.map((list) => {
    const open = itemsOf(list.id).filter((i) => !i.done).length;

    const row = document.createElement('button');
    row.className = 'all-row' + (list.id === state.currentId ? ' current' : '');
    row.dataset.id = list.id;
    if (list.id === state.currentId) row.setAttribute('aria-current', 'true');
    row.innerHTML = `
      <span class="tile small"><svg class="icon" aria-hidden="true"><use href="#i-list"/></svg></span>
      <span class="all-name"></span>
      <span class="all-count"></span>`;
    row.querySelector('use').setAttribute('href', iconHref(list));
    row.querySelector('.all-name').textContent = list.name;
    row.querySelector('.all-count').textContent = String(open);
    row.setAttribute('aria-label', `${list.name}, ${open} open`);
    return row;
  });
  el.allRows.replaceChildren(...rows);
}

function openAll() {
  renderAll();
  lockBackground();
  el.allLists.hidden = false;
  el.allRows.querySelector('.current')?.focus();
}

function closeAll() {
  el.allLists.hidden = true;
  unlockBackground();
  restoreFocus();
}

el.allRows.addEventListener('click', (e) => {
  const row = e.target.closest('.all-row');
  if (!row) return;
  switchTo(row.dataset.id);
  closeAll();
});

el.allNew.addEventListener('click', () => {
  closeAll();
  newList();
});

/* ---------- new, rename and delete a list ---------- */

function newList() {
  const last = state.lists[state.lists.length - 1];
  const list = { id: db.uid(), name: 'New list', icon: 'list', order: last ? last.order + 1 : 0 };
  state.lists.push(list);
  save(db.put('lists', list));
  switchTo(list.id);
  startRename(); // a new list almost always needs a name
}

// Tapping the list name opens a small panel: name and icon.
let renaming = false;

function buildIconGrid() {
  el.iconGrid.replaceChildren(...LIST_ICONS.map((name) => {
    const b = document.createElement('button');
    b.dataset.icon = name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', name);
    b.innerHTML = '<svg class="icon" aria-hidden="true"><use href=""/></svg>';
    b.querySelector('use').setAttribute('href', `#i-${name}`);
    return b;
  }));
}

function markIcon() {
  const current = iconOf(currentList());
  for (const b of el.iconGrid.children) b.setAttribute('aria-checked', String(b.dataset.icon === current));
}

function startRename() {
  if (renaming) return;
  renaming = true;
  if (!el.iconGrid.children.length) buildIconGrid();
  markIcon();
  lockBackground();
  el.listEdit.hidden = false;
  el.editScrim.hidden = false;
  el.titleInput.value = currentList().name;
  el.titleInput.focus();
  el.titleInput.select();
}

function finishRename(keep) {
  if (!renaming) return;
  renaming = false;

  const list = currentList();
  const name = el.titleInput.value.trim();
  if (keep && name && name !== list.name) {
    list.name = name;
    save(db.put('lists', list));
  }
  el.listEdit.hidden = true;
  el.editScrim.hidden = true;
  el.titleInput.blur();
  unlockBackground();
  restoreFocus();
  render();
}

el.who.addEventListener('click', () => { if (!animating) startRename(); });
el.editScrim.addEventListener('click', () => finishRename(true));
el.titleInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault(); // otherwise the Enter lands on the name button we hand focus back to
  finishRename(true);
});

// An icon applies straight away, so you see it in the header behind the panel.
el.iconGrid.addEventListener('click', (e) => {
  const icon = e.target.closest('button')?.dataset.icon;
  if (!icon) return;
  const list = currentList();
  list.icon = icon;
  save(db.put('lists', list));
  el.tileIcon.setAttribute('href', iconHref(list));
  markIcon();
});

function archiveList() {
  if (state.lists.length < 2) {
    showToast('Keep at least one list');
    return;
  }

  const list = currentList();
  const index = state.lists.indexOf(list);
  const items = itemsOf(list.id);
  const now = Date.now();

  list.archivedAt = now;
  for (const item of items) { item.archivedAt = now; item.archivedWith = list.id; }
  state.lists.splice(index, 1);
  state.items = state.items.filter((i) => i.listId !== list.id);
  state.archive.lists.unshift(list);
  state.archive.items.unshift(...items);
  // One transaction: the list and its items are archived together, or not at all.
  save(db.batch({ put: [['lists', list], ...items.map((i) => ['items', i])] }));

  // Land on the list that took its place, or the new last one.
  switchTo(state.lists[Math.min(index, state.lists.length - 1)].id);

  // A whole list is a bigger move than one item, so Undo stays a bit longer.
  showToast('List archived', () => {
    restoreList(list);
    switchTo(list.id);
  }, 6000);
}

function restoreList(list) {
  const items = state.archive.items.filter((i) => i.archivedWith === list.id);
  state.archive.lists = state.archive.lists.filter((l) => l.id !== list.id);
  state.archive.items = state.archive.items.filter((i) => i.archivedWith !== list.id);
  delete list.archivedAt;
  for (const item of items) { delete item.archivedAt; delete item.archivedWith; }
  state.lists.push(list);
  state.lists.sort((a, b) => a.order - b.order);
  state.items.push(...items);
  save(db.batch({ put: [['lists', list], ...items.map((i) => ['items', i])] }));
  render();
}

/* ---------- the Archive screen ---------- */

const listNameOf = (id) =>
  [...state.lists, ...state.archive.lists].find((l) => l.id === id)?.name ?? 'Deleted list';

function archiveRow(kind, record) {
  const row = document.createElement('div');
  row.className = 'arch-row';
  row.dataset.kind = kind;
  row.dataset.id = record.id;
  row.innerHTML = `
    <span class="tile small"><svg class="icon" aria-hidden="true"><use href="#i-list"/></svg></span>
    <span class="arch-text"><span class="arch-name"></span><span class="arch-sub"></span></span>
    <button class="icon-btn" data-act="restore"><svg class="icon" aria-hidden="true"><use href="#i-restore"/></svg></button>
    <button class="icon-btn" data-act="delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg></button>`;
  const name = kind === 'list' ? record.name : record.title;
  row.querySelector('.arch-name').textContent = name;
  const when = ago(record.archivedAt);
  if (kind === 'list') {
    const count = state.archive.items.filter((i) => i.archivedWith === record.id).length;
    row.querySelector('use').setAttribute('href', iconHref(record));
    row.querySelector('.arch-sub').textContent = `${count} ${count === 1 ? 'item' : 'items'} \u00b7 archived ${when}`;
  } else {
    row.querySelector('use').setAttribute('href', '#i-note');
    row.querySelector('.arch-sub').textContent = `${listNameOf(record.listId)} \u00b7 archived ${when}`;
  }
  row.querySelector('[data-act="restore"]').setAttribute('aria-label', `Restore ${name}`);
  row.querySelector('[data-act="delete"]').setAttribute('aria-label', `Delete ${name} permanently`);
  return row;
}

function renderArchive() {
  const lists = state.archive.lists;
  // Items archived along with a list live inside that list, so they aren't shown twice.
  const items = state.archive.items.filter((i) => !i.archivedWith || !lists.some((l) => l.id === i.archivedWith));
  const nodes = [];
  const heading = (text) => {
    const h = document.createElement('div');
    h.className = 'arch-heading';
    h.textContent = text;
    return h;
  };
  if (lists.length) nodes.push(heading('Lists'), ...lists.map((l) => archiveRow('list', l)));
  if (items.length) nodes.push(heading('Items'), ...items.map((i) => archiveRow('item', i)));
  if (!nodes.length) {
    const box = renderEmpty();
    box.querySelector('strong').textContent = 'Nothing archived';
    box.querySelector('span').textContent = 'Lists and items you archive wait here.';
    nodes.push(box);
  }
  el.archiveBody.replaceChildren(...nodes);
}

function openArchive() {
  renderArchive();
  lockBackground();
  el.archive.hidden = false;
  el.archiveBack.focus();
}

function closeArchive() {
  el.archive.hidden = true;
  unlockBackground();
  restoreFocus();
}

el.archiveBack.addEventListener('click', closeArchive);

// Deleting for good is asked twice: the bin turns into "Delete" for a few seconds.
let sureTimer = 0;
function disarm() {
  clearTimeout(sureTimer);
  el.archiveBody.querySelectorAll('.sure').forEach((b) => {
    b.classList.remove('sure');
    b.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>';
  });
}

el.archiveBody.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-act]');
  const row = e.target.closest('.arch-row');
  if (!button || !row) return;
  const { kind, id } = row.dataset;

  if (button.dataset.act === 'restore') {
    if (kind === 'list') {
      restoreList(state.archive.lists.find((l) => l.id === id));
    } else {
      const item = state.archive.items.find((i) => i.id === id);
      restoreItem(item, item.listId);
    }
    renderArchive();
    showToast(kind === 'list' ? 'List restored' : 'Item restored');
    return;
  }

  if (!button.classList.contains('sure')) {
    disarm();
    button.classList.add('sure');
    button.textContent = 'Delete';
    sureTimer = setTimeout(disarm, 3000);
    return;
  }
  clearTimeout(sureTimer);
  if (kind === 'list') {
    const items = state.archive.items.filter((i) => i.archivedWith === id);
    state.archive.lists = state.archive.lists.filter((l) => l.id !== id);
    state.archive.items = state.archive.items.filter((i) => i.archivedWith !== id);
    save(db.batch({ remove: [['lists', id], ...items.map((i) => ['items', i.id])] }));
  } else {
    state.archive.items = state.archive.items.filter((i) => i.id !== id);
    save(db.remove('items', id));
  }
  renderArchive();
});

/* ---------- the dots ---------- */

const MAX_DOTS = 9; // past this, one dot per list gets too wide, so show "3 / 12"

const currentIndex = () => state.lists.findIndex((l) => l.id === state.currentId);

function renderDots() {
  const n = state.lists.length;
  el.dots.hidden = n < 2; // one list needs no indicator
  if (n < 2) return;

  if (n > MAX_DOTS) {
    const count = document.createElement('button');
    count.className = 'dots-count';
    count.textContent = `${currentIndex() + 1} / ${n}`;
    count.setAttribute('aria-label', `List ${currentIndex() + 1} of ${n}. Open all lists`);
    el.dots.replaceChildren(count);
    return;
  }

  el.dots.replaceChildren(...state.lists.map((list) => {
    const dot = document.createElement('button');
    dot.className = 'dot';
    dot.dataset.id = list.id;
    dot.setAttribute('aria-label', list.name); // list.name is user text, so no innerHTML
    if (list.id === state.currentId) dot.setAttribute('aria-current', 'true');
    return dot;
  }));
}

el.dots.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  if (button.classList.contains('dots-count')) {
    openAll();
    return;
  }
  const target = state.lists.find((l) => l.id === button.dataset.id);
  if (target && target.id !== state.currentId) {
    slideTo(target, state.lists.indexOf(target) > currentIndex() ? 1 : -1);
  }
});

/* ---------- moving between lists ---------- */

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ms = (time) => (reducedMotion() ? 0 : time);

let animating = false;

// A pane is a throwaway copy of another list. It waits off-screen beside the
// real list, so you can see it arrive while you swipe.
function buildPane(list) {
  const pane = document.createElement('div');
  pane.className = 'list pane';
  pane.setAttribute('aria-hidden', 'true');
  pane.inert = true; // not focusable or clickable, it is only a picture
  const items = itemsOf(list.id);
  pane.replaceChildren(...(items.length ? items.map(renderRow) : [renderEmpty()]));
  el.stage.append(pane);
  return pane;
}

// A track is the current list plus its panes. Each has a slot: 0 is the list you
// are on, -1 the screen to its left, 1 the screen to its right.
function placeTrack(track, x) {
  const width = el.stage.offsetWidth;
  for (const { node, slot } of track) node.style.transform = `translateX(${x + slot * width}px)`;
}

function clearTrack(track) {
  for (const { node } of track) node.style.transform = '';
}

// The icon and name stay in place while the list slides. The current ones fade out and
// the neighbour's fade in. A ghost is a copy of the header identity for another list.
function makeGhost(list) {
  const ghost = el.who.cloneNode(true);
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  ghost.removeAttribute('id');
  ghost.querySelector('input')?.remove();
  const name = ghost.querySelector('h1');
  name.hidden = false;
  name.textContent = list.name;
  ghost.querySelector('use').setAttribute('href', iconHref(list));
  ghost.classList.add('ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.style.opacity = '0';
  el.whos.append(ghost);
  return ghost;
}

// Follow the finger: the current identity is gone by halfway, the next one arrives after.
function fadeHeader(ghosts, dx) {
  const progress = Math.min(1, Math.abs(dx) / el.stage.offsetWidth);
  el.who.style.opacity = String(Math.max(0, 1 - 2 * progress));
  const showing = dx < 0 ? 1 : -1;
  for (const [direction, ghost] of Object.entries(ghosts)) {
    ghost.style.opacity = Number(direction) === showing ? String(Math.max(0, 2 * progress - 1)) : '0';
  }
}

// Finish the fade from wherever it is. `arrive` is the direction whose ghost should end
// fully visible, or 0 when the swipe is cancelled and the current list comes back.
function settleHeader(ghosts, arrive) {
  const fade = (node, to) => node.animate(
    [{ opacity: parseFloat(node.style.opacity || '1') }, { opacity: to }],
    { duration: ms(200), easing: 'ease-out', fill: 'forwards' },
  );
  return [
    fade(el.who, arrive ? 0 : 1),
    ...Object.entries(ghosts).map(([direction, ghost]) => fade(ghost, Number(direction) === arrive ? 1 : 0)),
  ];
}

function endHeader(ghosts, animations) {
  Object.values(ghosts).forEach((ghost) => ghost.remove());
  animations.forEach((a) => a.cancel());
  el.who.style.opacity = '';
}

// Slide the whole track from one position to another.
function settle(track, from, to) {
  const width = el.stage.offsetWidth;
  const animations = track.map(({ node, slot }) => node.animate(
    [
      { transform: `translateX(${from + slot * width}px)` },
      { transform: `translateX(${to + slot * width}px)` },
    ],
    { duration: ms(200), easing: 'ease-out', fill: 'forwards' },
  ));
  return Promise.all(animations.map((a) => a.finished)).then(() => animations);
}

// Throw the panes away. Everything happens in one go, so there is no flash.
function endTrack(track, animations) {
  for (const { node } of track) if (node !== el.list) node.remove();
  animations.forEach((a) => a.cancel());
}

// direction 1 = towards the next list (content moves left), -1 = the previous.
// `from` is how far the finger had already dragged. A swipe passes in the track it
// built while dragging. A tap on a dot has none, so one pane is built for it.
// async function slideTo(target, direction, from = 0, track = null) {
//   if (animating) return;
//   animating = true;

//   track ??= [{ node: el.list, slot: 0 }, { node: buildPane(target), slot: direction }];
//   clearTrack(track);

//   const animations = await settle(track, from, -direction * el.stage.offsetWidth);
//   switchTo(target.id); // now the real list shows the target, exactly where the pane was
//   endTrack(track, animations);
//   animating = false;
// }

async function slideTo(target, direction, from = 0, track = null, ghosts = null) {
  if (animating) return;
  animating = true;
  try {
    track ??= [{ node: el.list, slot: 0 }, { node: buildPane(target), slot: direction }];
    ghosts ??= { [direction]: makeGhost(target) };
    clearTrack(track);
    const headerAnimations = settleHeader(ghosts, direction);
    const animations = await settle(track, from, -direction * el.stage.offsetWidth);
    switchTo(target.id);
    endTrack(track, animations);
    endHeader(ghosts, headerAnimations);
  } finally {
    animating = false;
  }
}

// Too short a drag: everything springs back.
async function snapBack(track, from, ghosts) {
  if (animating) return;
  animating = true;
  try {
    clearTrack(track);
    const headerAnimations = settleHeader(ghosts, 0);
    const animations = await settle(track, from, 0);
    endTrack(track, animations);
    endHeader(ghosts, headerAnimations);
  } finally {
    animating = false;
  }
}

const neighbour = (step) => {
  const n = state.lists.length;
  return state.lists[(currentIndex() + step + n) % n];
};

/* ---------- swiping ---------- */

const SWIPE_LOCK = 10;     // px before we decide which way the finger is going
const SWIPE_DISTANCE = 50; // px to count as a swipe
const EDGE = 24;           // iOS uses the screen edge for "back", so leave it alone

let swipe = null; // { id, x, y, time, dx, locked, track }
let justSwiped = false;

el.list.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || animating || state.lists.length < 2) return;
  if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp, dx: 0, locked: false, track: null, ghosts: null };
});

el.list.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;

  if (!swipe.locked) {
    // Mostly vertical: that's the user scrolling, not swiping. Let it go.
    if (Math.abs(dy) > SWIPE_LOCK && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < SWIPE_LOCK) return;

    swipe.locked = true;
    cancelHold();
    el.list.setPointerCapture(e.pointerId);
    // Now we know it's a swipe, put both neighbours in place.
    swipe.track = [
      { node: el.list, slot: 0 },
      { node: buildPane(neighbour(-1)), slot: -1 },
      { node: buildPane(neighbour(1)), slot: 1 },
    ];
    swipe.ghosts = { [-1]: makeGhost(neighbour(-1)), 1: makeGhost(neighbour(1)) };
  }

  const width = el.stage.offsetWidth;
  swipe.dx = Math.max(-width, Math.min(width, dx));
  placeTrack(swipe.track, swipe.dx); // everything follows the finger
  fadeHeader(swipe.ghosts, swipe.dx);
});

el.list.addEventListener('pointerup', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const { dx, locked, time, track, ghosts } = swipe;
  swipe = null;
  if (!locked) return; // just a tap, the click handler deals with it

  // The finger lifting would also fire a click on a row. Swallow it.
  justSwiped = true;
  setTimeout(() => { justSwiped = false; }, 50);

  const quick = e.timeStamp - time < 220;
  const far = Math.abs(dx) > SWIPE_DISTANCE || (quick && Math.abs(dx) > 24); // a flick counts too
  if (far) {
    const direction = dx < 0 ? 1 : -1;
    slideTo(neighbour(direction), direction, dx, track, ghosts);
  } else {
    snapBack(track, dx, ghosts);
  }
});

el.list.addEventListener('pointercancel', () => {
  if (swipe?.locked) snapBack(swipe.track, swipe.dx, swipe.ghosts);
  swipe = null;
});

el.list.addEventListener('click', (e) => {
  if (justSwiped) { e.stopPropagation(); e.preventDefault(); }
}, true); // capture phase, so it runs before the row handler

/* ---------- long-press a row to select it; slide the bar to archive the selection ---------- */

const HOLD_MS = 450;  // how long to hold before the row is selected
const HOLD_SLOP = 8;  // a finger that drifts further than this is scrolling or swiping
let hold = null;      // { id, x, y, timer, row }

function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  hold = null;
}

function updateSelBar() {
  const n = selection.size;
  if (n) closeListBar(); // one bar at a time
  el.selbar.hidden = !n;
  el.app.classList.toggle('selecting', n > 0 || !el.listbar.hidden);
  el.selHint.textContent = `${n} selected`;
  el.selKnob.setAttribute('aria-label', n === 1 ? 'Archive 1 selected item' : `Archive ${n} selected items`);
}

function toggleSelected(id, force) {
  const on = force ?? !selection.has(id);
  if (on) selection.add(id); else selection.delete(id);
  el.list.querySelector(`.row[data-id="${CSS.escape(id)}"]`)?.classList.toggle('selected', on);
  updateSelBar();
}

function clearSelection() {
  if (!selection.size) return;
  selection.clear();
  el.list.querySelectorAll('.row.selected').forEach((r) => r.classList.remove('selected'));
  updateSelBar();
}

el.list.addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.row');
  if (!row || animating || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (e.target.closest('.check')) return; // holding the tick isn't a request to select
  justSwiped = false; // a new touch: the click left over from the last one is long gone
  cancelHold();
  hold = { id: e.pointerId, x: e.clientX, y: e.clientY, row, timer: 0 };
  hold.timer = setTimeout(() => {
    if (!hold) return;
    const id = row.dataset.id;
    hold = null;
    toggleSelected(id);
    navigator.vibrate?.(12);
    // The finger lifting would fire a click on the row, which would toggle it straight back.
    justSwiped = true;
    setTimeout(() => { justSwiped = false; }, 600);
  }, HOLD_MS);
});

el.list.addEventListener('pointermove', (e) => {
  if (!hold || e.pointerId !== hold.id) return;
  if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP) cancelHold();
});
el.list.addEventListener('pointerup', cancelHold);
el.list.addEventListener('pointercancel', cancelHold);

// Holding a row would otherwise pop up the browser's own menu on some phones
el.list.addEventListener('contextmenu', (e) => { if (e.target.closest('.row')) e.preventDefault(); });

el.selX.addEventListener('click', clearSelection);

const selectedItems = () => state.items.filter((i) => selection.has(i.id));

// The slide: drag the knob across, past 85% of the way, to confirm. Used for archiving
// selected items and for archiving a whole list, so neither happens by accident.
const COMMIT_AT = 0.85;

function makeSlider(bar, onCommit, onProgress = () => {}) {
  const knob = bar.querySelector('.sel-knob');
  const fill = bar.querySelector('.sel-fill');
  const inset = knob.offsetLeft || 6;
  let slide = null; // { id, x, dragging, dx }

  const max = () => bar.clientWidth - inset * 2 - 44; // the knob shrinks to 44px while dragging

  function reset(animate) {
    if (animate) bar.classList.add('settling');
    knob.style.left = '';
    fill.style.width = '';
    onProgress(0);
    bar.classList.remove('dragging');
    if (!animate) bar.classList.remove('settling');
    else setTimeout(() => bar.classList.remove('settling'), 250);
  }

  knob.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    slide = { id: e.pointerId, x: e.clientX, dragging: false, dx: 0 };
    knob.setPointerCapture(e.pointerId);
    bar.classList.remove('settling', 'nudge');
  });

  knob.addEventListener('pointermove', (e) => {
    if (!slide || e.pointerId !== slide.id) return;
    const dx = e.clientX - slide.x;
    if (!slide.dragging) {
      if (Math.abs(dx) < 4) return;
      slide.dragging = true;
      bar.classList.add('dragging');
    }
    slide.dx = clamp(dx, 0, max());
    knob.style.left = `${inset + slide.dx}px`;
    fill.style.width = `${inset + slide.dx + 44 + inset}px`;
    onProgress(slide.dx / max());
  });

  function end(e) {
    if (!slide || e.pointerId !== slide.id) return;
    const { dragging, dx } = slide;
    slide = null;
    if (!dragging) {
      // A tap isn't enough. Show which way to go. (Keyboard users get the click handler below.)
      if (e.type === 'pointerup') {
        bar.classList.remove('nudge');
        void bar.offsetWidth;
        bar.classList.add('nudge');
      }
      return;
    }
    if (e.type === 'pointerup' && dx >= max() * COMMIT_AT) {
      navigator.vibrate?.(20);
      onCommit();
      reset(false);
    } else {
      reset(true);
    }
  }
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);

  // Keyboard or screen reader: Enter/Space on the knob confirms directly (a touch tap has detail 1).
  knob.addEventListener('click', (e) => {
    if (e.detail === 0) onCommit();
  });
}

makeSlider(el.selbar, () => archiveItems(selectedItems()), (p) => {
  // Only the picked rows fade as you slide; the rest of the list stays put.
  el.list.querySelectorAll('.row.selected').forEach((r) => { r.style.opacity = p ? String(1 - 0.85 * p) : ''; });
});

// "Archive this list" in the menu brings up the same bar, for the whole list.
function openListBar() {
  if (state.lists.length < 2) { showToast('Keep at least one list'); return; }
  clearSelection();
  el.listbarHint.textContent = currentList().name;
  el.listbar.hidden = false;
  el.list.classList.add('archiving'); // the whole list is the target, so dim it
  el.app.classList.add('selecting');
}

function closeListBar() {
  if (el.listbar.hidden) return;
  el.listbar.hidden = true;
  el.list.classList.remove('archiving');
  el.list.style.opacity = '';
  el.app.classList.toggle('selecting', selection.size > 0);
}

el.listbarX.addEventListener('click', closeListBar);
makeSlider(el.listbar, () => {
  closeListBar();
  archiveList();
}, (p) => {
  // The further you slide, the more the list fades away.
  if (!el.listbar.hidden) el.list.style.opacity = p ? String(0.5 - 0.4 * p) : '';
});

/* ---------- Search: every list at once ---------- */

// Compare without caring about capitals or accents ("cafe" finds "Café").
const fold = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Every word you type has to appear, in the title or the text. Title matches come first.
function searchItems(query) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const item of state.items) {
    const title = fold(item.title);
    const body = fold(plainText(item.body || ''));
    if (!terms.every((t) => title.includes(t) || body.includes(t))) continue;
    results.push({ item, terms, inTitle: terms.some((t) => title.includes(t)) });
  }
  const rank = (r) => (r.inTitle ? 0 : 1);
  return results.sort((a, b) => rank(a) - rank(b) || b.item.updatedAt - a.item.updatedAt);
}

// Write `text` into `node` with the matching words picked out. Folding keeps the same
// length for plain letters; if a character changes length, fall back to no highlight.
function highlight(node, text, terms) {
  const folded = fold(text);
  if (folded.length !== text.length) { node.textContent = text; return; }
  const spans = [];
  for (const t of terms) {
    for (let i = folded.indexOf(t); i !== -1; i = folded.indexOf(t, i + t.length)) spans.push([i, i + t.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const parts = [];
  let at = 0;
  for (const [from, to] of spans) {
    if (to <= at) continue;
    const start = Math.max(from, at);
    if (start > at) parts.push(text.slice(at, start));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, to);
    parts.push(mark);
    at = to;
  }
  if (at < text.length) parts.push(text.slice(at));
  node.replaceChildren(...parts);
}

// The part of the text around the first match, so you can see why it was found.
function snippet(body, terms) {
  const folded = fold(body);
  if (folded.length !== body.length) return firstLine(body);
  const hit = terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (hit === undefined) return firstLine(body);
  const from = Math.max(0, hit - 24);
  const text = body.slice(from, from + 90).replace(/\s+/g, ' ');
  return (from > 0 ? '\u2026' : '') + text;
}

function renderSearch() {
  const query = el.searchInput.value.trim();
  if (!query) {
    el.searchBody.replaceChildren();
    return;
  }
  const found = searchItems(query);
  if (!found.length) {
    const none = document.createElement('p');
    none.className = 'search-empty';
    none.textContent = `Nothing found for \u201c${query}\u201d`;
    el.searchBody.replaceChildren(none);
    return;
  }
  el.searchBody.replaceChildren(...found.map(({ item, terms }) => {
    const row = document.createElement('button');
    row.className = 'search-row';
    row.dataset.id = item.id;
    row.innerHTML = '<span class="search-title"></span><span class="search-snippet"></span><span class="search-where"></span>';
    highlight(row.querySelector('.search-title'), item.title, terms);
    const sub = row.querySelector('.search-snippet');
    const text = snippet(plainText(item.body || ''), terms);
    if (text) highlight(sub, text, terms); else sub.remove();
    const list = state.lists.find((l) => l.id === item.listId);
    row.querySelector('.search-where').textContent = list ? list.name : '';
    return row;
  }));
}

function openSearch() {
  if (selection.size) clearSelection();
  lockBackground();
  el.search.hidden = false;
  el.searchInput.value = '';
  renderSearch();
  el.searchInput.focus();
}

function closeSearch() {
  el.searchInput.blur();
  el.search.hidden = true;
  unlockBackground();
  restoreFocus();
}

el.searchBtn.addEventListener('click', openSearch);
el.searchBack.addEventListener('click', closeSearch);
el.searchInput.addEventListener('input', renderSearch);
el.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); el.searchInput.blur(); } // hides the keyboard so you can see the results
});

// Opening a result takes you to its list and opens the note.
el.searchBody.addEventListener('click', (e) => {
  const id = e.target.closest('.search-row')?.dataset.id;
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  closeSearch();
  if (item.listId !== state.currentId) switchTo(item.listId);
  openEdit(item);
});

/* ---------- Settings: theme, backup and about ---------- */

const VERSION = '0.1.3';
const THEME_KEY = 'find-notes:theme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f4f3ee' : '#171716');
}

function savedTheme() {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

applyTheme(savedTheme());

function markTheme() {
  const theme = savedTheme();
  for (const b of $('theme-seg').children) b.setAttribute('aria-checked', String(b.dataset.themeChoice === theme));
}

$('theme-seg').addEventListener('click', (e) => {
  const choice = e.target.closest('button')?.dataset.themeChoice;
  if (!choice) return;
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* storage blocked: applies for this visit only */ }
  applyTheme(choice);
  markTheme();
});

// Ask the browser not to clear our storage when the device is short of space.
let persisted = null;
navigator.storage?.persist?.().then((ok) => { persisted = ok; }, () => {});

function openSettings() {
  markTheme();
  $('version').textContent = VERSION;
  $('backup-status').textContent = '';
  const ask = navigator.storage?.persisted?.();
  (ask ?? Promise.resolve(persisted)).then((ok) => {
    $('persist-status').textContent = ok ? 'Protected' : 'Can be cleared by the browser';
  }, () => { $('persist-status').textContent = 'Unknown'; });
  lockBackground();
  el.settings.hidden = false;
  el.settingsBack.focus();
}

function closeSettings() {
  disarmImport();
  el.settings.hidden = true;
  unlockBackground();
  restoreFocus();
}
el.settingsBack.addEventListener('click', closeSettings);

const say = (text) => { $('backup-status').textContent = text; };

// A backup is one JSON file with everything, archived items included.
$('export-btn').addEventListener('click', async () => {
  try {
    const [lists, items] = [await db.getAll('lists'), await db.getAll('items')];
    const backup = { app: 'find-notes', format: 1, exportedAt: new Date().toISOString(), lists, items };
    const name = `find-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([JSON.stringify(backup, null, 2)], name, { type: 'application/json' });

    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); say(`Backup ready: ${lists.length} lists, ${items.length} items.`); return; }
      catch (err) { if (err.name === 'AbortError') return; /* otherwise fall through to a plain download */ }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    say(`Saved ${name}: ${lists.length} lists, ${items.length} items.`);
  } catch (err) {
    say(`Couldn't make a backup: ${err.message}`);
  }
});

// Restoring only adds and updates. Nothing already on the device is deleted, so a
// wrong file can't wipe your notes. Records are matched by id.
let pendingImport = null;
let importTimer = 0;

function disarmImport() {
  clearTimeout(importTimer);
  pendingImport = null;
  const b = $('import-btn');
  b.classList.remove('sure');
  b.textContent = 'Restore from a backup';
}

function readBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("that isn't a Find Notes backup"); }
  if (data?.app !== 'find-notes' || !Array.isArray(data.lists) || !Array.isArray(data.items)) {
    throw new Error("that isn't a Find Notes backup");
  }
  const listIds = new Set(data.lists.filter((l) => l && typeof l.id === 'string' && typeof l.name === 'string').map((l) => l.id));
  const lists = data.lists.filter((l) => l && listIds.has(l.id));
  // Items need a list to live in, either in the file or already here.
  const known = new Set([...listIds, ...state.lists.map((l) => l.id), ...state.archive.lists.map((l) => l.id)]);
  const items = data.items.filter((i) => i && typeof i.id === 'string' && typeof i.title === 'string' && known.has(i.listId));
  return { lists, items, skipped: data.items.length - items.length };
}

$('import-btn').addEventListener('click', () => {
  if (pendingImport) { // second tap: do it
    const { lists, items, skipped } = pendingImport;
    disarmImport();
    (async () => {
      try {
        await db.batch({ put: [...lists.map((l) => ['lists', l]), ...items.map((i) => ['items', i])] });
        await load();
        if (!state.lists.some((l) => l.id === state.currentId)) state.currentId = state.lists[0]?.id;
        render();
        say(`Restored ${lists.length} lists and ${items.length} items.` + (skipped ? ` ${skipped} items had no list and were skipped.` : ''));
      } catch (err) {
        say(`Couldn't restore: ${err.message}`);
      }
    })();
    return;
  }
  $('import-file').click();
});

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    pendingImport = readBackup(await file.text());
    const b = $('import-btn');
    b.classList.add('sure');
    b.textContent = `Restore ${pendingImport.lists.length} lists, ${pendingImport.items.length} items?`;
    say('Tap again to add them to what is here. Nothing is deleted.');
    clearTimeout(importTimer);
    importTimer = setTimeout(() => { disarmImport(); say(''); }, 8000);
  } catch (err) {
    disarmImport();
    say(`Couldn't restore: ${err.message}.`);
  }
});

/* ---------- the Back button (Android) closes what is on top instead of leaving the app ---------- */

const overlayOpen = () => !el.menu.hidden || !el.listEdit.hidden || !el.search.hidden || !el.settings.hidden
  || !el.archive.hidden || !el.allLists.hidden || selection.size > 0 || !el.listbar.hidden || !!drawer;

// One history entry stands in for "something is open". Back removes it and we close the top layer.
let marker = false;
let ignorePops = 0;
let backTimer = 0;

function syncHistory() {
  if (overlayOpen()) {
    clearTimeout(backTimer);
    if (!marker) { history.pushState({ overlay: true }, ''); marker = true; }
  } else if (marker) {
    // Wait a beat: moving from one layer to another (menu, then Settings) shouldn't churn history.
    clearTimeout(backTimer);
    backTimer = setTimeout(() => {
      if (marker && !overlayOpen()) { marker = false; ignorePops++; history.back(); }
    }, 60);
  }
}

addEventListener('popstate', () => {
  if (ignorePops) { ignorePops--; return; }
  if (!marker) return;
  marker = false;
  closeTop();
  syncHistory(); // another layer still open? put the marker back
});

if (history.state?.overlay) history.replaceState(null, ''); // a reload left one behind

const watchOverlays = new MutationObserver(syncHistory);
for (const node of [el.menu, el.listEdit, el.search, el.settings, el.archive, el.allLists, el.drawer, el.app]) {
  watchOverlays.observe(node, { attributes: true, attributeFilter: ['hidden', 'class'] });
}

/* ---------- working offline: a service worker keeps the app on the device ---------- */

// Keep this in step with VERSION in sw.js. Changing sw.js is what tells phones there is an update.
function setupOffline() {
  if (!('serviceWorker' in navigator)) return;
  const params = new URLSearchParams(location.search);

  if (params.has('nosw')) { // ?nosw clears it out, handy while testing
    navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => r.unregister()));
    caches?.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    return;
  }
  // While building on your own computer or network the worker would keep serving old files.
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
    || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (local && !params.has('sw')) return;

  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = () => showBanner('A new version of Find Notes is ready.', 'Update', () => reg.waiting?.postMessage('skip-waiting'));
    if (reg.waiting && navigator.serviceWorker.controller) offer();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer();
      });
    });
    // Coming back to the app is a good moment to look for a new version.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }, (error) => console.error('Offline support unavailable', error));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // the very first install needs no reload
    reloading = true;
    location.reload();
  });
}

/* ---------- start ---------- */

async function init() {
  try {
    await load();
    if (!state.lists.length) {
      await seed();
      await load();
    }
  } catch (error) {
    // The database won't open (private browsing, storage blocked, a damaged
    // database). Open anyway with one empty list in memory, and say so.
    console.error(error);
    memoryOnly = true;
    state.lists = [{ id: db.uid(), name: 'Home', icon: 'flame', order: 0 }];
    state.items = [];
    state.archive = { lists: [], items: [] };
    showBanner(
      "Can't store notes on this device right now. Anything you add will be lost when you close the app.",
      'Try again',
      () => location.reload(),
    );
  }

  const remembered = recallList();
  state.currentId = state.lists.some((l) => l.id === remembered)
    ? remembered
    : state.lists[0].id;
  render();
}

init();
setupOffline();
