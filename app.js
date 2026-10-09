import * as db from './db.js';

window.db = db; // temporary, for experimenting in the console

// Temporary: show errors on screen, so a phone without a console can still tell us what broke.
// A bare "Script error." usually means the phone mixed old and new files after an update.
function showCrash(message) {
  console.error(message);
  const opaque = !message || /^script error/i.test(message);
  showBanner(
    opaque ? 'Find Notes has been updated. Reload to get the latest version.' : `Something went wrong: ${message}`,
    'Reload',
    () => location.reload(),
  );
}
addEventListener('error', (e) => showCrash(e.message));
addEventListener('unhandledrejection', (e) => showCrash(e.reason?.message ?? String(e.reason)));

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'),
  grab: $('grab'),
  title: $('title'),
  titleInput: $('title-input'),
  stage: $('stage'),
  list: $('list'),
  add: $('add'),
  scrim: $('scrim'),
  drawer: $('drawer'),
  chip: $('chip'),
  trash: $('trash'),
  itemTitle: $('item-title'),
  itemBody: $('item-body'),
  foot: $('drawer-top'),
  hint: $('hint'),
  done: $('done'),
  toast: $('toast'),
  menuBtn: $('menu-btn'),
  menuScrim: $('menu-scrim'),
  menu: $('menu'),
  allLists: $('all-lists'),
  allRows: $('all-rows'),
  allNew: $('all-new'),
  dots: $('dots'),
  header: $('header'),
  banner: $('banner'),
  bannerText: $('banner-text'),
  bannerAction: $('banner-action'),
};

// Everything on screen is drawn from this object. IndexedDB is the saved copy.
const state = { lists: [], items: [], currentId: null };

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
const LAST_LIST_KEY = 'find-notes:last-list';

function rememberList(id) {
  try { localStorage.setItem(LAST_LIST_KEY, id); } catch { /* storage blocked */ }
}

function recallList() {
  try { return localStorage.getItem(LAST_LIST_KEY); } catch { return null; }
}

function switchTo(id) {
  hideToast(); // an Undo for something on the list you just left would make no sense
  state.currentId = id;
  rememberList(id);
  render();
  el.list.scrollTop = 0; // every list opens at its top
}

/* ---------- loading ---------- */

async function load() {
  state.lists = (await db.getAll('lists')).sort((a, b) => a.order - b.order);
  state.items = await db.getAll('items');
}

// Sample data from the mockup, only used when the database is empty.
async function seed() {
  const home = { id: db.uid(), name: 'Home', order: 0 };
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

function renderRow(item) {
  const row = document.createElement('div');
  row.className = 'row' + (item.done ? ' done' : '');
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
  const preview = firstLine(item.body);
  if (preview) sub.textContent = preview;
  else sub.remove();

  return row;
}

function renderEmpty() {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Start your list. Tap the plus to add an item.';
  return p;
}

function render() {
  const list = currentList();
  el.title.textContent = list.name;

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

function addItem(title, body) {
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

/* ---------- the drawer ---------- */

// null when closed, otherwise { mode: 'add' | 'edit', item }
let drawer = null;
let saveTimer = null;

function setHint(message, isError = false) {
  el.hint.textContent = message;
  el.foot.classList.toggle('error', isError);
}

function showDrawer(mode, item) {
  // `original` is what the item looked like when it opened, so a swipe-down can put it back
  drawer = { mode, item, original: item && { title: item.title, body: item.body, updatedAt: item.updatedAt } };
  hideToast();

  el.chip.textContent = currentList().name;
  el.itemTitle.value = item ? item.title : '';
  el.itemBody.value = item ? item.body : '';
  el.trash.hidden = mode !== 'edit';
  el.done.setAttribute('aria-label', mode === 'add' ? 'Add' : 'Done');
  el.drawer.setAttribute('aria-label', mode === 'add' ? 'New item' : 'Edit item');
  setHint('');

  lockBackground();
  el.drawer.classList.remove('closing');
  el.scrim.classList.remove('closing');
  el.drawer.classList.add('open');
  el.scrim.classList.add('open');
  fitViewport();
  animateSheet(PEEK);

  // Opening an existing item to read it shouldn't throw the keyboard up, so focus
  // the Done button there instead of a text field.
  if (mode === 'add') el.itemTitle.focus({ preventScroll: true });
  else el.done.focus({ preventScroll: true });
}

const openAdd = () => showDrawer('add', null);
const openEdit = (item) => showDrawer('edit', item);

function hideDrawer() {
  clearTimeout(saveTimer);
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
  item.body = el.itemBody.value.trimEnd();
  item.updatedAt = Date.now();
}

// Edits are saved as you type, a moment after you pause.
function saveEdit() {
  clearTimeout(saveTimer);
  if (drawer?.mode !== 'edit') return;
  readEdits(drawer.item);
  save(db.put('items', drawer.item));
}

const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveEdit, 300);
};

// Done: keeps what you typed. Adding needs a title, editing saves the fields.
function closeDrawer() {
  if (!drawer) return;

  if (drawer.mode === 'add') {
    const title = el.itemTitle.value.trim();
    if (title) addItem(title, el.itemBody.value.trim());
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
  scheduleSave();
});
el.itemBody.addEventListener('input', scheduleSave);

// Enter in the title moves to the description instead of submitting.
el.itemTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    el.itemBody.focus();
  }
});

// Escape closes whatever is on top: the menu, then All lists, then the drawer
// (which discards, like swiping it down).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.menu.hidden) closeMenu();
  else if (!el.allLists.hidden) closeAll();
  else dismissDrawer();
});

// A phone can kill the page the moment you switch apps, so save straight away.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveEdit();
});

/* ---------- the sheet: dragging, snapping, keyboard ---------- */

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

  const expanded = String(h > (PEEK + full) / 2);
  if (el.grab.getAttribute('aria-expanded') !== expanded) {
    el.grab.setAttribute('aria-expanded', expanded);
    el.grab.setAttribute('aria-label', expanded === 'true' ? 'Make note smaller' : 'Expand note');
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
let wasKeyboard = false;
let settleTimer = 0;
const typingInSheet = () =>
  !!drawer && (document.activeElement === el.itemTitle || document.activeElement === el.itemBody);

function fitViewport(settled) {
  const keyboard = !!vv && innerHeight - vv.height > 120;

  // Moving from the title to the description makes the browser report "no keyboard" for a
  // moment. While a field has focus, wait and see before believing it.
  clearTimeout(settleTimer);
  if (!keyboard && wasKeyboard && settled !== true && typingInSheet()) {
    settleTimer = setTimeout(() => fitViewport(true), 300);
    return;
  }

  el.app.style.height = keyboard ? vv.height + 'px' : '';
  el.app.style.transform = keyboard && vv.offsetTop ? `translateY(${vv.offsetTop}px)` : '';
  el.drawer.classList.toggle('kb', keyboard);

  const full = fullHeight();
  if (drawer && !drag) {
    // A full-page sheet stays full-page, just above the keyboard instead of behind it.
    const wasFull = lastFull > PEEK && sheetH >= lastFull - 2;
    const target = wasFull ? full : Math.min(sheetH, full);
    if (keyboard !== wasKeyboard) animateSheet(target); // glide as the keyboard comes or goes
    else setSheet(target);
  }
  lastFull = full;
  wasKeyboard = keyboard;
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
  if (drawer && !e.target.closest('#item-body')) e.preventDefault();
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
  clearTimeout(saveTimer);
  const title = el.itemTitle.value;
  const body = el.itemBody.value;

  if (mode === 'add') {
    hideDrawer();
    if (title.trim() || body.trim()) {
      showToast('Note discarded', () => addItem(title.trim() || 'Untitled', body.trim()));
    }
    return;
  }

  const edited = { title: title.trim() || 'Untitled', body: body.trimEnd() };
  if (edited.title === original.title && edited.body === original.body) {
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

/* ---------- deleting an item ---------- */

el.trash.addEventListener('click', () => {
  if (drawer?.mode !== 'edit') return;
  const item = drawer.item;
  readEdits(item); // so Undo brings back the latest text

  state.items = state.items.filter((i) => i.id !== item.id);
  save(db.remove('items', item.id));
  hideDrawer();
  render();

  showToast('Item deleted', () => {
    state.items.push(item);
    save(db.put('items', item));
    render();
  });
});

/* ---------- the three-dots menu ---------- */

function openMenu() {
  // You can't delete your only list, so say so by greying it out.
  el.menu.querySelector('[data-action="delete"]').disabled = state.lists.length < 2;
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
  ({ all: openAll, new: newList, rename: startRename, delete: deleteList })[action]();
});

/* ---------- the All lists screen ---------- */

function renderAll() {
  const rows = state.lists.map((list) => {
    const open = itemsOf(list.id).filter((i) => !i.done).length;

    const row = document.createElement('button');
    row.className = 'all-row' + (list.id === state.currentId ? ' current' : '');
    row.dataset.id = list.id;
    if (list.id === state.currentId) row.setAttribute('aria-current', 'true');
    row.innerHTML = '<span class="all-name"></span><span class="all-count"></span>';
    row.querySelector('.all-name').textContent = list.name;
    row.querySelector('.all-count').textContent = `${open} open`;
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
  const list = { id: db.uid(), name: 'New list', order: last ? last.order + 1 : 0 };
  state.lists.push(list);
  save(db.put('lists', list));
  switchTo(list.id);
  startRename(); // a new list almost always needs a name
}

// While renaming, the title is swapped for an input of the same size.
let renaming = false;

function startRename() {
  renaming = true;
  el.titleInput.value = currentList().name;
  el.title.hidden = true;
  el.titleInput.hidden = false;
  el.titleInput.focus();
  el.titleInput.select();
}

function finishRename(keep) {
  if (!renaming) return; // Enter and the blur it causes both land here
  renaming = false;

  const list = currentList();
  const name = el.titleInput.value.trim();
  if (keep && name && name !== list.name) {
    list.name = name;
    save(db.put('lists', list));
  }
  el.titleInput.hidden = true;
  el.title.hidden = false;
  render();
}

el.titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') finishRename(true);
  if (e.key === 'Escape') finishRename(false);
});
el.titleInput.addEventListener('blur', () => finishRename(true));

function deleteList() {
  if (state.lists.length < 2) {
    showToast('Keep at least one list');
    return;
  }

  const list = currentList();
  const index = state.lists.indexOf(list);
  const removedItems = itemsOf(list.id);

  state.lists.splice(index, 1);
  state.items = state.items.filter((i) => i.listId !== list.id);
  // One transaction: the list and its items go together, or not at all.
  save(db.batch({
    remove: [['lists', list.id], ...removedItems.map((i) => ['items', i.id])],
  }));

  // Land on the list that took its place, or the new last one.
  switchTo(state.lists[Math.min(index, state.lists.length - 1)].id);

  // A whole list is a bigger loss than one item, so Undo stays a bit longer.
  showToast('List deleted', () => {
    state.lists.push(list);
    state.lists.sort((a, b) => a.order - b.order);
    state.items.push(...removedItems);
    save(db.batch({
      put: [['lists', list], ...removedItems.map((i) => ['items', i])],
    }));
    switchTo(list.id);
  }, 6000);
}

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

async function slideTo(target, direction, from = 0, track = null) {
    if (animating) return;
    animating = true;
    try {
    track ??= [{ node: el.list, slot: 0 }, { node: buildPane(target), slot: direction }];
    clearTrack(track);
    const animations = await settle(track, from, -direction * el.stage.offsetWidth);
    switchTo(target.id);
    endTrack(track, animations);
    } finally {
    animating = false;
    }
}

// Too short a drag: everything springs back.
async function snapBack(track, from) {
  if (animating) return;
  animating = true;
  try {
    clearTrack(track);
    const animations = await settle(track, from, 0);
    endTrack(track, animations);
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
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp, dx: 0, locked: false, track: null };
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
    el.list.setPointerCapture(e.pointerId);
    // Now we know it's a swipe, put both neighbours in place.
    swipe.track = [
      { node: el.list, slot: 0 },
      { node: buildPane(neighbour(-1)), slot: -1 },
      { node: buildPane(neighbour(1)), slot: 1 },
    ];
  }

  const width = el.stage.offsetWidth;
  swipe.dx = Math.max(-width, Math.min(width, dx));
  placeTrack(swipe.track, swipe.dx); // everything follows the finger
});

el.list.addEventListener('pointerup', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const { dx, locked, time, track } = swipe;
  swipe = null;
  if (!locked) return; // just a tap, the click handler deals with it

  // The finger lifting would also fire a click on a row. Swallow it.
  justSwiped = true;
  setTimeout(() => { justSwiped = false; }, 50);

  const quick = e.timeStamp - time < 220;
  const far = Math.abs(dx) > SWIPE_DISTANCE || (quick && Math.abs(dx) > 24); // a flick counts too
  if (far) {
    const direction = dx < 0 ? 1 : -1;
    slideTo(neighbour(direction), direction, dx, track);
  } else {
    snapBack(track, dx);
  }
});

el.list.addEventListener('pointercancel', () => {
  if (swipe?.locked) snapBack(swipe.track, swipe.dx);
  swipe = null;
});

el.list.addEventListener('click', (e) => {
  if (justSwiped) { e.stopPropagation(); e.preventDefault(); }
}, true); // capture phase, so it runs before the row handler

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
    state.lists = [{ id: db.uid(), name: 'Home', order: 0 }];
    state.items = [];
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