// The description editor. What you see is formatted (headings, bold, italic, bullets,
// tick boxes) but what is saved is plain Markdown text, so search, previews and backups
// stay readable. One line of text is one block; a block is a <div class="b TYPE">.
//
//   p     plain paragraph          text
//   h     heading                  ## text
//   li    bullet                   - text
//   task  tick box                 - [ ] text   /   - [x] text
//   inline: **bold** and *italic*   (a literal * or \ is written as \* and \\)

/* ---------- Markdown <-> blocks (no DOM needed for the plain-text helpers) ---------- */

const HEADING = /^#{1,6} (.*)$/;
const TASK = /^[-*+] \[([ xX])\] (.*)$/;
const BULLET = /^[-*+] (.*)$/;

export function parseLine(line) {
  let m;
  if ((m = HEADING.exec(line))) return { type: 'h', text: m[1] };
  if ((m = TASK.exec(line))) return { type: 'task', done: m[1] !== ' ', text: m[2] };
  if ((m = BULLET.exec(line))) return { type: 'li', text: m[1] };
  return { type: 'p', text: line };
}

// Split text into pieces: plain text, and the bold / italic markers that really pair up.
function tokens(text) {
  const raw = [];
  let buf = '';
  const flush = () => { if (buf) { raw.push({ t: 'text', v: buf }); buf = ''; } };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) { buf += text[++i]; continue; }
    if (c === '*') {
      flush();
      if (text[i + 1] === '*') { raw.push({ t: 'b' }); i++; } else raw.push({ t: 'i' });
      continue;
    }
    buf += c;
  }
  flush();
  // A marker only counts if there is another one to close it. A lonely one is just text.
  for (const kind of ['b', 'i']) {
    const marks = raw.filter((x) => x.t === kind);
    if (marks.length % 2) { const last = marks[marks.length - 1]; last.t = 'text'; last.v = kind === 'b' ? '**' : '*'; }
  }
  return raw;
}

// Formatted text for display elsewhere (list rows, search): no symbols at all.
export function plainLine(line) {
  const { text } = parseLine(line);
  return tokens(text).map((x) => (x.t === 'text' ? x.v : '')).join('');
}
export const plainText = (md) => (md || '').split('\n').map(plainLine).join('\n');

const escapeText = (s) => s.replace(/[\\*]/g, '\\$&');

/* ---------- the editor ---------- */

export function createEditor(root, { onChange = () => {}, onSelection = () => {} } = {}) {
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.spellcheck = true;

  /* -- building blocks -- */

  const makeBlock = (type = 'p', done = false) => {
    const b = document.createElement('div');
    b.className = `b ${type}`;
    if (type === 'task' && done) b.dataset.done = '1';
    return b;
  };
  const typeOf = (b) => ['h', 'li', 'task'].find((t) => b.classList.contains(t)) || 'p';
  const setType = (b, type) => {
    b.className = `b ${type}`;
    if (type === 'task') delete b.dataset.done; else delete b.dataset.done;
  };

  function inlineNodes(text) {
    const out = [];
    let bold = false, italic = false;
    for (const tok of tokens(text)) {
      if (tok.t === 'b') bold = !bold;
      else if (tok.t === 'i') italic = !italic;
      else {
        let node = document.createTextNode(tok.v);
        if (italic) { const i = document.createElement('i'); i.append(node); node = i; }
        if (bold) { const b = document.createElement('b'); b.append(node); node = b; }
        out.push(node);
      }
    }
    return out;
  }

  const tidy = (b) => {
    // Remove empty inline leftovers; an empty block keeps one <br> so it has a height and a caret.
    for (const e of [...b.querySelectorAll('b, i, strong, em, span')]) {
      if (!e.textContent && !e.querySelector('br')) e.remove();
    }
    for (const br of [...b.querySelectorAll('br')]) if (b.textContent || b.childNodes.length > 1) br.remove();
    if (!b.childNodes.length) b.append(document.createElement('br'));
  };

  function buildBlock(line) {
    const { type, done, text } = parseLine(line);
    const b = makeBlock(type, done);
    b.append(...inlineNodes(text));
    tidy(b);
    return b;
  }

  function setMarkdown(md) {
    const lines = (md || '').split('\n');
    root.replaceChildren(...lines.map(buildBlock));
    refreshEmpty();
  }

  /* -- reading it back -- */

  const fmtOf = (node) => {
    let bold = false, italic = false;
    for (let n = node.parentNode; n && n !== root; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      if (n.classList.contains('b')) break;
      const tag = n.tagName;
      if (tag === 'B' || tag === 'STRONG' || /bold|[6-9]00/.test(n.style.fontWeight)) bold = true;
      if (tag === 'I' || tag === 'EM' || n.style.fontStyle === 'italic') italic = true;
    }
    return { bold, italic };
  };

  function inlineText(b) {
    let out = '';
    const open = [];
    const close = () => { while (open.length) out += open.pop() === 'b' ? '**' : '*'; };
    const walk = (n) => {
      if (n.nodeType === 3) {
        const text = n.nodeValue.replace(/[ ​]/g, (c) => (c === ' ' ? ' ' : ''));
        if (!text) return;
        const { bold, italic } = fmtOf(n);
        const want = [bold && 'b', italic && 'i'].filter(Boolean);
        if (want.join() !== open.join()) {
          close();
          for (const k of want) { out += k === 'b' ? '**' : '*'; open.push(k); }
        }
        out += escapeText(text);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') {
        n.childNodes.forEach(walk);
      }
    };
    b.childNodes.forEach(walk);
    close();
    return out;
  }

  function blockLine(b) {
    const text = inlineText(b);
    switch (typeOf(b)) {
      case 'h': return `## ${text}`;
      case 'li': return `- ${text}`;
      case 'task': return `- [${b.dataset.done ? 'x' : ' '}] ${text}`;
      default: return /^(#{1,6} |[-+] )/.test(text) ? `\\${text}` : text;
    }
  }

  const isEmptyBlock = (b) => !b.textContent.replace(/[ ​]/g, '').trim();

  function getMarkdown() {
    const blocks = [...root.children].filter((n) => n.nodeType === 1);
    while (blocks.length && isEmptyBlock(blocks[blocks.length - 1])) blocks.pop();
    return blocks.map(blockLine).join('\n');
  }

  /* -- keeping the structure tidy after the browser has had its say -- */

  const refreshEmpty = () => {
    const empty = root.children.length === 1 && isEmptyBlock(root.firstElementChild) && typeOf(root.firstElementChild) === 'p';
    root.classList.toggle('is-empty', empty);
  };

  const closestBlock = (node) => {
    for (let n = node; n && n !== root; n = n.parentNode) {
      if (n.parentNode === root && n.nodeType === 1) return n;
    }
    return null;
  };

  function caretOffset() {
    const sel = getSelection();
    if (!sel.rangeCount || !root.contains(sel.anchorNode)) return null;
    const r = document.createRange();
    r.selectNodeContents(root);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    return r.toString().length;
  }

  function placeCaretAt(offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let left = offset;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (left <= n.nodeValue.length) { collapseTo(n, left); return; }
      left -= n.nodeValue.length;
    }
    collapseTo(root, root.childNodes.length);
  }

  function collapseTo(node, offset) {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function caretToStart(b) {
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    if (first) collapseTo(first, 0); else collapseTo(b, 0);
  }

  // Anything the browser put outside a block gets a block of its own.
  function normalize() {
    let dirty = !root.children.length;
    for (const n of root.childNodes) {
      if (n.nodeType !== 1 || n.tagName !== 'DIV' || !n.classList.contains('b')) { dirty = true; break; }
    }
    if (!dirty) { for (const b of root.children) if (b.querySelector('div, p')) { dirty = true; break; } }
    if (!dirty) { refreshEmpty(); return; }

    const at = caretOffset();
    const kids = [...root.childNodes];
    const next = [];
    let run = null;
    for (const n of kids) {
      if (n.nodeType === 1 && n.tagName === 'DIV') {
        run = null;
        if (!n.classList.contains('b')) n.className = 'b p';
        // flatten a block that holds other blocks
        const inner = [...n.children].filter((c) => /^(DIV|P)$/.test(c.tagName));
        if (inner.length) {
          const type = typeOf(n);
          for (const c of inner) { const b = makeBlock(type); b.append(...c.childNodes); tidy(b); next.push(b); }
        } else next.push(n);
      } else if (n.nodeType === 1 && n.tagName === 'P') {
        run = null; const b = makeBlock('p'); b.append(...n.childNodes); next.push(b);
      } else {
        if (!run) { run = makeBlock('p'); next.push(run); }
        run.append(n);
      }
    }
    if (!next.length) next.push(makeBlock('p'));
    next.forEach(tidy);
    root.replaceChildren(...next);
    if (at !== null) placeCaretAt(at);
    refreshEmpty();
  }

  /* -- splitting and joining lines, done by hand so it behaves the same everywhere -- */

  function ensureVisible(b) {
    const r = b.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    if (r.bottom > box.bottom - 8) root.scrollTop += r.bottom - box.bottom + 8;
    else if (r.top < box.top) root.scrollTop -= box.top - r.top;
  }

  function splitAtCaret() {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    const block = closestBlock(r.startContainer);
    if (!block) return;
    const type = typeOf(block);

    if ((type === 'li' || type === 'task') && isEmptyBlock(block)) { // Enter on an empty bullet ends the list
      setType(block, 'p');
      tidy(block);
      caretToStart(block);
      return;
    }
    const tail = document.createRange();
    tail.setStart(r.startContainer, r.startOffset);
    tail.setEnd(block, block.childNodes.length);
    const rest = tail.extractContents();
    const next = makeBlock(type === 'h' ? 'p' : type);
    next.append(rest);
    tidy(block);
    tidy(next);
    block.after(next);
    caretToStart(next);
    ensureVisible(next);
  }

  root.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      e.preventDefault();
      splitAtCaret();
      afterEdit();
      return;
    }
    // Backspace at the very start of a heading or bullet turns it back into plain text first.
    if (e.inputType === 'deleteContentBackward') {
      const sel = getSelection();
      if (!sel.rangeCount || !sel.isCollapsed) return;
      const block = closestBlock(sel.anchorNode);
      if (!block || typeOf(block) === 'p') return;
      const before = document.createRange();
      before.selectNodeContents(block);
      before.setEnd(sel.anchorNode, sel.anchorOffset);
      if (before.toString() === '') {
        e.preventDefault();
        setType(block, 'p');
        afterEdit();
      }
    }
  });

  // Typing "- ", "* ", "# " or "[] " at the start of a line starts a bullet, heading or tick box.
  const SHORTCUTS = { '-': 'li', '*': 'li', '#': 'h', '##': 'h', '###': 'h', '[]': 'task', '[ ]': 'task' };
  function shortcut() {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const block = closestBlock(sel.anchorNode);
    if (!block || typeOf(block) !== 'p') return;
    const text = block.textContent.replace(/ /g, ' ');
    if (!text.endsWith(' ')) return;
    const type = SHORTCUTS[text.slice(0, -1)];
    if (!type) return;
    setType(block, type);
    block.replaceChildren(document.createElement('br'));
    caretToStart(block);
  }

  function afterEdit() {
    normalize();
    refreshEmpty();
    onChange();
    onSelection();
  }

  root.addEventListener('input', (e) => {
    if (e.inputType === 'insertText' && e.data === ' ') shortcut();
    afterEdit();
  });

  /* -- pasting and dropping: text only, so nothing odd ever gets in -- */

  root.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    if (!text) return;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) splitAtCaret();
      if (line) document.execCommand('insertText', false, line);
    });
    afterEdit();
  });
  root.addEventListener('drop', (e) => e.preventDefault());

  /* -- tick boxes: tap the box to tick, even while you are only reading -- */

  let boxTap = null;
  const inBox = (e) => {
    const b = closestBlock(e.target);
    if (!b || typeOf(b) !== 'task') return null;
    return e.clientX - b.getBoundingClientRect().left < 34 ? b : null;
  };
  root.addEventListener('pointerdown', (e) => {
    const b = inBox(e);
    boxTap = b ? { id: e.pointerId, b, x: e.clientX, y: e.clientY } : null;
  });
  root.addEventListener('mousedown', (e) => { if (inBox(e)) e.preventDefault(); }); // don't move the caret or raise the keyboard
  root.addEventListener('pointerup', (e) => {
    if (!boxTap || e.pointerId !== boxTap.id) return;
    const { b, x, y } = boxTap;
    boxTap = null;
    if (Math.hypot(e.clientX - x, e.clientY - y) > 8) return;
    if (b.dataset.done) delete b.dataset.done; else b.dataset.done = '1';
    onChange();
    onSelection();
  });
  root.addEventListener('pointercancel', () => { boxTap = null; });
  root.addEventListener('click', (e) => { if (inBox(e)) e.preventDefault(); });

  /* -- the toolbar's commands -- */

  const selectedBlocks = () => {
    const sel = getSelection();
    if (!sel.rangeCount || !root.contains(sel.anchorNode)) return [];
    const r = sel.getRangeAt(0);
    return [...root.children].filter((b) => r.intersectsNode(b));
  };

  function focus() {
    if (root.contains(document.activeElement) && document.activeElement === root) return;
    root.focus({ preventScroll: true });
    const sel = getSelection();
    if (!sel.rangeCount || !root.contains(sel.anchorNode)) {
      const last = root.lastElementChild;
      if (last) { const r = document.createRange(); r.selectNodeContents(last); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    }
  }

  function toggleType(type) {
    focus();
    const blocks = selectedBlocks();
    if (!blocks.length) return;
    const all = blocks.every((b) => typeOf(b) === type);
    for (const b of blocks) {
      const keepDone = type === 'task' && b.dataset.done;
      setType(b, all ? 'p' : type);
      if (keepDone && !all) b.dataset.done = '1';
    }
    afterEdit();
  }

  function toggleInline(kind) {
    focus();
    document.execCommand(kind === 'b' ? 'bold' : 'italic');
    afterEdit();
  }

  function state() {
    const blocks = selectedBlocks();
    const type = blocks.length && blocks.every((b) => typeOf(b) === typeOf(blocks[0])) ? typeOf(blocks[0]) : 'p';
    let bold = false, italic = false;
    try { bold = document.queryCommandState('bold'); italic = document.queryCommandState('italic'); } catch { /* not focused */ }
    return { type, bold, italic };
  }

  document.addEventListener('selectionchange', () => {
    if (root.contains(getSelection().anchorNode)) onSelection();
  });

  setMarkdown('');

  return {
    getMarkdown,
    setMarkdown,
    isEmpty: () => !getMarkdown().trim(),
    focus,
    caretToStart: () => { root.focus({ preventScroll: true }); const b = root.firstElementChild; if (b) caretToStart(b); },
    toggleType,
    toggleInline,
    state,
  };
}
