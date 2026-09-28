/** Toast notifications (top-right stack). */
export class Notifications {
  constructor(root) {
    this.root = root;
    this.items = [];
    /** Set by the Game so notifications can be narrated (see Settings). */
    this.onSpeak = null;
  }

  /**
   * @param {string} title
   * @param {string|null} body
   * @param {'info'|'good'|'warn'|'danger'|'scan'|'mine'|'ftl'|'system'} kind
   * @param {number} ttl ms
   * @param {boolean} speak read the notification aloud when narration is on
   */
  notify(title, body = null, kind = 'info', ttl = 6500, speak = false) {
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
    if (speak) this.onSpeak?.(`${title}. ${body ?? ''}`.trim());
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
