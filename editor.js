// The description editor. What you see is formatted (headings, bold, italic, bullets,
// tick boxes) but what is saved is plain Markdown text, so search, previews and backups
// stay readable. One line of text is one block; a block is a <div class="b TYPE">.
//
//   p     plain paragraph          text
//   h     heading                  ## text
//   h3    smaller heading          ### text
//   li    bullet                   - text
//   task  tick box                 - [ ] text   /   - [x] text
//   inline: **bold**, *italic* and ==highlight==   (a literal * or \ is written as \* and \\,
//           and an = that could be read as part of == as \=)

/* ---------- Markdown <-> blocks (no DOM needed for the plain-text helpers) ---------- */

const HEADING = /^#{1,6} (.*)$/;
const HEADING3 = /^### (.*)$/;
const TASK = /^[-*+] \[([ xX])\] (.*)$/;
const BULLET = /^[-*+] (.*)$/;

export function parseLine(line) {
  let m;
  if ((m = HEADING3.exec(line))) return { type: 'h3', text: m[1] };
  if ((m = HEADING.exec(line))) return { type: 'h', text: m[1] };
  if ((m = TASK.exec(line))) return { type: 'task', done: m[1] !== ' ', text: m[2] };
  if ((m = BULLET.exec(line))) return { type: 'li', text: m[1] };
  return { type: 'p', text: line };
}

// Split text into pieces: plain text, and the bold / italic / highlight markers that really pair up.
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
    if (c === '=' && text[i + 1] === '=') { flush(); raw.push({ t: 'm' }); i++; continue; }
    buf += c;
  }
  flush();
  // A marker only counts if there is another one to close it. A lonely one is just text.
  for (const kind of ['b', 'i', 'm']) {
    const marks = raw.filter((x) => x.t === kind);
    if (marks.length % 2) { const last = marks[marks.length - 1]; last.t = 'text'; last.v = { b: '**', i: '*', m: '==' }[kind]; }
  }
  return raw;
}

// Formatted text for display elsewhere (list rows, search): no symbols at all.
export function plainLine(line) {
  const { text } = parseLine(line);
  return tokens(text).map((x) => (x.t === 'text' ? x.v : '')).join('');
}
export const plainText = (md) => (md || '').split('\n').map(plainLine).join('\n');

// An = is only escaped where it could join another = into a == marker: next to an =, or at
// either end of a piece (where a marker may sit right beside it).
const escapeText = (s) => s.replace(/[\\*]/g, '\\$&').replace(/=/g, (c, i, t) =>
  (i === 0 || i === t.length - 1 || t[i - 1] === '=' || t[i + 1] === '=' ? '\\=' : c));

/* ---------- the editor ---------- */

export function createEditor(root, { onChange = () => {}, onSelection = () => {}, onTick = () => {} } = {}) {
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
  const typeOf = (b) => ['h', 'h3', 'li', 'task'].find((t) => b.classList.contains(t)) || 'p';
  const setType = (b, type) => {
    b.className = `b ${type}`;
    delete b.dataset.done;
  };

  function inlineNodes(text) {
    const out = [];
    let bold = false, italic = false, mark = false;
    for (const tok of tokens(text)) {
      if (tok.t === 'b') bold = !bold;
      else if (tok.t === 'i') italic = !italic;
      else if (tok.t === 'm') mark = !mark;
      else {
        let node = document.createTextNode(tok.v);
        if (italic) { const i = document.createElement('i'); i.append(node); node = i; }
        if (bold) { const b = document.createElement('b'); b.append(node); node = b; }
        if (mark) { const m = document.createElement('mark'); m.append(node); node = m; }
        out.push(node);
      }
    }
    return out;
  }

  const tidy = (b) => {
    // Remove empty inline leftovers; an empty block keeps one <br> so it has a height and a caret.
    for (const e of [...b.querySelectorAll('b, i, strong, em, span, mark')]) {
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
    let bold = false, italic = false, mark = false;
    for (let n = node.parentNode; n && n !== root; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      if (n.classList.contains('b')) break;
      const tag = n.tagName;
      if (tag === 'B' || tag === 'STRONG' || /bold|[6-9]00/.test(n.style.fontWeight)) bold = true;
      if (tag === 'I' || tag === 'EM' || n.style.fontStyle === 'italic') italic = true;
      if (tag === 'MARK') mark = true;
    }
    return { bold, italic, mark };
  };

  function inlineText(b) {
    let out = '';
    const open = [];
    const MARKER = { b: '**', i: '*', m: '==' };
    const close = () => { while (open.length) out += MARKER[open.pop()]; };
    const walk = (n) => {
      if (n.nodeType === 3) {
        const text = n.nodeValue.replace(/[ ​]/g, (c) => (c === ' ' ? ' ' : ''));
        if (!text) return;
        const { bold, italic, mark } = fmtOf(n);
        const want = [mark && 'm', bold && 'b', italic && 'i'].filter(Boolean);
        if (want.join() !== open.join()) {
          close();
          for (const k of want) { out += MARKER[k]; open.push(k); }
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
      case 'h3': return `### ${text}`;
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
    const next = makeBlock(type === 'h' || type === 'h3' ? 'p' : type);
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
      if (!block) return;
      const before = document.createRange();
      before.selectNodeContents(block);
      before.setEnd(sel.anchorNode, sel.anchorOffset);
      if (before.toString() !== '') return;
      if (typeOf(block) !== 'p') {
        e.preventDefault();
        setType(block, 'p');
        afterEdit();
      } else if (block.previousElementSibling && hidden(block.previousElementSibling)) {
        // The line above is folded away (Hide ticked items): join the line you can see instead
        e.preventDefault();
        const to = visibleSibling(block, 'previousElementSibling');
        if (to) { joinInto(to, block); afterEdit(); }
      }
    }
    // Delete at the end of a line, with the next one folded away: same thing, the other way
    if (e.inputType === 'deleteContentForward') {
      const sel = getSelection();
      if (!sel.rangeCount || !sel.isCollapsed) return;
      const block = closestBlock(sel.anchorNode);
      if (!block || !block.nextElementSibling || !hidden(block.nextElementSibling)) return;
      const after = document.createRange();
      after.selectNodeContents(block);
      after.setStart(sel.anchorNode, sel.anchorOffset);
      if (after.toString() !== '') return;
      e.preventDefault();
      const from = visibleSibling(block, 'nextElementSibling');
      if (from) { joinInto(block, from); afterEdit(); }
    }
  });

  // A line that isn't drawn at all (a ticked item folded away by Hide ticked items)
  const hidden = (b) => !b.getClientRects().length;
  const visibleSibling = (b, way) => {
    for (let n = b[way]; n; n = n[way]) if (!hidden(n)) return n;
    return null;
  };
  // Moves the words of `from` onto the end of `to`, with the caret where they meet
  function joinInto(to, from) {
    if (isEmptyBlock(to)) to.replaceChildren();
    const join = document.createTextNode('');
    to.append(join);
    if (!isEmptyBlock(from)) to.append(...from.childNodes);
    from.remove();
    tidy(to);
    if (join.isConnected) collapseTo(join, 0); else caretToStart(to);
  }

  // Typing "- ", "* ", "# " or "[] " at the start of a line starts a bullet, heading or tick box.
  const SHORTCUTS = { '-': 'li', '*': 'li', '#': 'h', '##': 'h', '###': 'h3', '[]': 'task', '[ ]': 'task' };
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
    normalize(); // also refreshes the empty state
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
    onTick(b, !!b.dataset.done);
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
    if (document.activeElement === root) return;
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
    if (kind === 'm') toggleMark();
    else document.execCommand(kind === 'b' ? 'bold' : 'italic');
    afterEdit();
  }

  // Highlighting is done by hand: the browser's own highlight command writes inline styles,
  // which wouldn't save as ==text==. Works on a selection within one line.
  function toggleMark() {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const block = closestBlock(r.startContainer);
    if (!block || block !== closestBlock(r.endContainer)) return;
    const insideMark = (node) => {
      for (let n = node; n && n !== block; n = n.parentNode) if (n.nodeName === 'MARK') return n;
      return null;
    };
    const outer = insideMark(r.startContainer);
    if (r.collapsed) {
      // A tap inside a highlight removes that whole highlight.
      if (outer) { outer.replaceWith(...outer.childNodes); block.normalize(); }
      return;
    }
    const frag = r.extractContents();
    for (const m of [...frag.querySelectorAll('mark')]) m.replaceWith(...m.childNodes);
    let piece;
    if (outer) {
      // Unhighlight the middle of a highlight: split it, and put the plain text between.
      const tail = document.createRange();
      tail.setStart(r.startContainer, r.startOffset);
      tail.setEnd(outer, outer.childNodes.length);
      const after = document.createElement('mark');
      after.append(tail.extractContents());
      piece = document.createElement('span');
      piece.append(frag);
      outer.after(piece, after);
    } else {
      piece = document.createElement('mark');
      piece.append(frag);
      r.insertNode(piece);
    }
    const chosen = document.createRange();
    chosen.selectNodeContents(piece);
    if (piece.nodeName === 'SPAN') { const kids = [...piece.childNodes]; piece.replaceWith(...kids); if (kids.length) { chosen.setStartBefore(kids[0]); chosen.setEndAfter(kids[kids.length - 1]); } }
    sel.removeAllRanges();
    sel.addRange(chosen);
    tidy(block);
  }

  function state() {
    const blocks = selectedBlocks();
    const type = blocks.length && blocks.every((b) => typeOf(b) === typeOf(blocks[0])) ? typeOf(blocks[0]) : 'p';
    // Read bold and italic from the markup, not queryCommandState: Safari reports "bold" for
    // any text drawn heavy, so every heading lit up the B button.
    const at = getSelection().anchorNode;
    const { bold, italic, mark } = at && root.contains(at)
      ? fmtOf(at.nodeType === 3 ? at : { parentNode: at })
      : { bold: false, italic: false, mark: false };
    return { type, bold, italic, mark };
  }

  document.addEventListener('selectionchange', () => {
    if (root.contains(getSelection().anchorNode)) onSelection();
  });

  setMarkdown('');

  return {
    getMarkdown,
    setMarkdown,
    isEmpty: () => [...root.children].every(isEmptyBlock), // same answer as an empty getMarkdown(), without building it
    focus,
    caretToStart: () => { root.focus({ preventScroll: true }); const b = root.firstElementChild; if (b) caretToStart(b); },
    toggleType,
    toggleInline,
    state,
  };
}
