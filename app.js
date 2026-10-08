import * as db from './db.js';

window.db = db; // temporary, for experimenting in the console

const $ = (id) => document.getElementById(id);
const el = {
  title: $('title'),
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
};

// Everything on screen is drawn from this object. IndexedDB is the saved copy.
const state = { lists: [], items: [], current: 0 };

const itemsOf = (listId) =>
  state.items.filter((i) => i.listId === listId).sort((a, b) => a.order - b.order);

const firstLine = (text) => text.split('\n').find((line) => line.trim()) || '';

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
  const list = state.lists[state.current];
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
  const list = state.lists[state.current];
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

function showToast(message, onUndo) {
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
  toastTimer = setTimeout(hideToast, 4000);
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

  el.chip.textContent = state.lists[state.current].name;
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
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

/* ---------- start ---------- */

async function init() {
  await load();
  if (!state.lists.length) {
    await seed();
    await load();
  }
  render();
}

init();