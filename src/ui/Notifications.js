/** Toast notifications (top-right stack). */
export class Notifications {
  constructor(root) {
    this.root = root;
    this.items = [];
  }

  /**
   * @param {string} title
   * @param {string|null} body
   * @param {'info'|'good'|'warn'|'danger'|'scan'|'mine'|'ftl'|'system'} kind
   * @param {number} ttl ms
   */
  notify(title, body = null, kind = 'info', ttl = 6500) {
    const el = document.createElement('div');
    el.className = `notif ${kind}`;
    const t = document.createElement('div');
    t.className = 'n-title';
    t.textContent = title;
    el.appendChild(t);
    if (body) {
      const b = document.createElement('div');
      b.className = 'n-body';
      b.textContent = body;
      el.appendChild(b);
    }
    this.root.appendChild(el);
    this.items.push(el);
    // Keep the stack short.
    while (this.items.length > 5) {
      const old = this.items.shift();
      old.remove();
    }
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => {
        el.remove();
        this.items = this.items.filter((i) => i !== el);
      }, 520);
    }, ttl);
    return el;
  }

  clear() {
    this.items.forEach((i) => i.remove());
    this.items = [];
  }
}
