/** Shared DOM helpers for panels and settings. */

export function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export function row(k, v, cls = '') {
  const r = h('div', 'row');
  r.appendChild(h('span', 'k', k));
  r.appendChild(h('span', `v ${cls}`.trim(), v));
  return r;
}

export function card(title, sub, text, tags = []) {
  const c = h('div', 'card');
  const t = h('div', 'card-title');
  t.appendChild(h('span', null, title));
  c.appendChild(t);
  if (sub) c.appendChild(h('div', 'card-sub', sub));
  if (text) c.appendChild(h('div', 'card-text', text));
  if (tags.length) {
    const tagRow = h('div');
    for (const tag of tags) {
      const cls = typeof tag === 'string' ? '' : tag.cls;
      tagRow.appendChild(h('span', `tag ${cls}`.trim(), typeof tag === 'string' ? tag : tag.text));
    }
    c.appendChild(tagRow);
  }
  return c;
}
