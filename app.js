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
  itemTitle: $('item-title'),
  itemBody: $('item-body'),
  foot: $('drawer-foot'),
  hint: $('hint'),
  done: $('done'),
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
    <div class="row-text">
      <p class="row-title"></p>
      <p class="row-sub"></p>
    </div>`;

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
//   p.textContent = 'Start your list. Tap Add an item.';
  p.textContent = 'Start your list. Tap the plus to add an item.';
  return p;
}

function render() {
  const list = state.lists[state.current];
  el.title.textContent = list.name;

  const items = itemsOf(list.id);
  el.list.replaceChildren(...(items.length ? items.map(renderRow) : [renderEmpty()]));
}

/* ---------- ticking an item ---------- */

// One listener on the container instead of one per row. Rows are rebuilt on
// every render, so per-row listeners would be thrown away each time.
el.list.addEventListener('click', (e) => {
  const check = e.target.closest('.check');
  if (!check) return;

  const item = state.items.find((i) => i.id === check.closest('.row').dataset.id);
  if (!item) return;

  item.done = !item.done;
  item.updatedAt = Date.now();
  render();                                   // update the screen first
  db.put('items', item).catch(console.error); // then save it
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

/* ---------- the drawer ---------- */

let drawerOpen = false;

function setHint(message, isError = false) {
  el.hint.textContent = message;
  el.foot.classList.toggle('error', isError);
}

function openAdd() {
  el.chip.textContent = state.lists[state.current].name;
  el.itemTitle.value = '';
  el.itemBody.value = '';
  setHint('');

  el.drawer.classList.add('open');
  el.scrim.classList.add('open');
  drawerOpen = true;
  el.itemTitle.focus({ preventScroll: true });
}

// Closing saves the item if it has a title, and throws it away if it doesn't.
function closeDrawer() {
  if (!drawerOpen) return;

  const title = el.itemTitle.value.trim();
  if (title) addItem(title, el.itemBody.value.trim());

  el.itemTitle.blur();
  el.itemBody.blur();
  el.drawer.classList.remove('open');
  el.scrim.classList.remove('open');
  drawerOpen = false;
}

el.add.addEventListener('click', openAdd);
el.scrim.addEventListener('click', closeDrawer);

el.done.addEventListener('click', () => {
  if (!el.itemTitle.value.trim()) {
    setHint('Enter a title first', true);
    el.itemTitle.focus();
    return;
  }
  closeDrawer();
});

el.itemTitle.addEventListener('input', () => setHint(''));

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