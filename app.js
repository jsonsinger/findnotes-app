import * as db from './db.js';

window.db = db; // temporary, for experimenting in the console

const $ = (id) => document.getElementById(id);
const el = { title: $('title'), list: $('list') };

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
  p.textContent = 'Start your list. Tap Add an item.';
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