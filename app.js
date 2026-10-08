import * as db from './db.js';

window.db = db; // temporary, for experimenting in the console

const $ = (id) => document.getElementById(id);
const el = {
  title: $('title'),
  titleInput: $('title-input'),
  list: $('list'),
  add: $('add'),
  scrim: $('scrim'),
  drawer: $('drawer'),
  chip: $('chip'),
  trash: $('trash'),
  itemTitle: $('item-title'),
  itemBody: $('item-body'),
  foot: $('drawer-foot'),
  hint: $('hint'),
  done: $('done'),
  toast: $('toast'),
  menuBtn: $('menu-btn'),
  menuScrim: $('menu-scrim'),
  menu: $('menu'),
  allLists: $('all-lists'),
  allRows: $('all-rows'),
  allNew: $('all-new'),
};

// Everything on screen is drawn from this object. IndexedDB is the saved copy.
const state = { lists: [], items: [], currentId: null };

// Find the list by id. An index would shift whenever a list is deleted.
const currentList = () => state.lists.find((l) => l.id === state.currentId);

const itemsOf = (listId) =>
  state.items.filter((i) => i.listId === listId).sort((a, b) => a.order - b.order);

const firstLine = (text) => text.split('\n').find((line) => line.trim()) || '';

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
  state.currentId = id;
  rememberList(id);
  render();
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
    db.put('items', item).catch(console.error); // then save it
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
  db.put('items', item).catch(console.error);
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
  drawer = { mode, item };
  hideToast();

  el.chip.textContent = currentList().name;
  el.itemTitle.value = item ? item.title : '';
  el.itemBody.value = item ? item.body : '';
  el.trash.hidden = mode !== 'edit';
  el.done.textContent = mode === 'add' ? 'Add' : 'Done';
  el.drawer.setAttribute('aria-label', mode === 'add' ? 'New item' : 'Edit item');
  setHint('');

  el.drawer.classList.add('open');
  el.scrim.classList.add('open');

  // Opening an existing item to read it shouldn't throw the keyboard up.
  if (mode === 'add') el.itemTitle.focus({ preventScroll: true });
}

const openAdd = () => showDrawer('add', null);
const openEdit = (item) => showDrawer('edit', item);

function hideDrawer() {
  clearTimeout(saveTimer);
  el.itemTitle.blur();
  el.itemBody.blur();
  el.drawer.classList.remove('open');
  el.scrim.classList.remove('open');
  drawer = null;
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
  db.put('items', drawer.item).catch(console.error);
}

const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveEdit, 300);
};

// Adding: saves if there is a title, throws it away if there isn't.
// Editing: saves whatever is in the fields.
function closeDrawer() {
  if (!drawer) return;

  if (drawer.mode === 'add') {
    const title = el.itemTitle.value.trim();
    if (title) addItem(title, el.itemBody.value.trim());
  } else {
    readEdits(drawer.item);
    db.put('items', drawer.item).catch(console.error);
    render();
  }
  hideDrawer();
}

el.add.addEventListener('click', openAdd);
el.scrim.addEventListener('click', closeDrawer);

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

// Escape closes whatever is on top: the menu, then All lists, then the drawer.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.menu.hidden) closeMenu(true);
  else if (!el.allLists.hidden) closeAll();
  else closeDrawer();
});

// A phone can kill the page the moment you switch apps, so save straight away.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveEdit();
});

/* ---------- deleting an item ---------- */

el.trash.addEventListener('click', () => {
  if (drawer?.mode !== 'edit') return;
  const item = drawer.item;
  readEdits(item); // so Undo brings back the latest text

  state.items = state.items.filter((i) => i.id !== item.id);
  db.remove('items', item.id).catch(console.error);
  hideDrawer();
  render();

  showToast('Item deleted', () => {
    state.items.push(item);
    db.put('items', item).catch(console.error);
    render();
  });
});

/* ---------- the three-dots menu ---------- */

function openMenu() {
  // You can't delete your only list, so say so by greying it out.
  el.menu.querySelector('[data-action="delete"]').disabled = state.lists.length < 2;
  el.menu.hidden = false;
  el.menuScrim.hidden = false;
  el.menuBtn.setAttribute('aria-expanded', 'true');
  el.menu.querySelector('button').focus();
}

function closeMenu(returnFocus = false) {
  el.menu.hidden = true;
  el.menuScrim.hidden = true;
  el.menuBtn.setAttribute('aria-expanded', 'false');
  if (returnFocus) el.menuBtn.focus();
}

el.menuBtn.addEventListener('click', openMenu);
el.menuScrim.addEventListener('click', () => closeMenu(true));

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
  el.allLists.hidden = false;
  el.allRows.querySelector('.current')?.focus();
}

function closeAll() {
  el.allLists.hidden = true;
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
  db.put('lists', list).catch(console.error);
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

function finishRename(save) {
  if (!renaming) return; // Enter and the blur it causes both land here
  renaming = false;

  const list = currentList();
  const name = el.titleInput.value.trim();
  if (save && name && name !== list.name) {
    list.name = name;
    db.put('lists', list).catch(console.error);
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
  db.remove('lists', list.id).catch(console.error);
  for (const item of removedItems) db.remove('items', item.id).catch(console.error);

  // Land on the list that took its place, or the new last one.
  switchTo(state.lists[Math.min(index, state.lists.length - 1)].id);

  // A whole list is a bigger loss than one item, so Undo stays a bit longer.
  showToast('List deleted', () => {
    state.lists.push(list);
    state.lists.sort((a, b) => a.order - b.order);
    state.items.push(...removedItems);
    db.put('lists', list).catch(console.error);
    for (const item of removedItems) db.put('items', item).catch(console.error);
    switchTo(list.id);
  }, 6000);
}

/* ---------- start ---------- */

async function init() {
  await load();
  if (!state.lists.length) {
    await seed();
    await load();
  }

  const remembered = recallList();
  state.currentId = state.lists.some((l) => l.id === remembered)
    ? remembered
    : state.lists[0].id;
  render();
}

init();