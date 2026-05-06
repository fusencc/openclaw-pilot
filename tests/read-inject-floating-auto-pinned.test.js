const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.document = document;
    this.children = [];
    this.classList = new FakeClassList();
    this.style = {};
    this.attributes = new Map();
    this.title = '';
    this.textContent = '';
    this.innerHTML = '';
  }

  set id(value) {
    this._id = value;
    if (value) this.document.elementsById.set(value, this);
  }

  get id() {
    return this._id;
  }

  set className(value) {
    this._className = value;
    value
      .split(/\s+/)
      .filter(Boolean)
      .forEach((item) => this.classList.add(item));
  }

  get className() {
    return this._className || '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  addEventListener() {}

  insertBefore(child, before) {
    const index = before ? this.children.indexOf(before) : -1;
    if (index >= 0) this.children.splice(index, 0, child);
    else this.children.unshift(child);
    if (child.id) this.document.elementsById.set(child.id, child);
    return child;
  }

  appendChild(child) {
    this.children.push(child);
    if (child.id) this.document.elementsById.set(child.id, child);
    return child;
  }
}

function createHarness() {
  const document = {
    readyState: 'complete',
    elementsById: new Map(),
    documentElement: { dataset: { openclawFloating: 'true' } },
    addEventListener() {},
    createElement(tagName) {
      return new FakeElement(tagName, this);
    },
    getElementById(id) {
      return this.elementsById.get(id) || null;
    },
    querySelector(selector) {
      if (selector === '.topbar-status') return this.topbarStatus;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  document.head = new FakeElement('head', document);
  document.body = new FakeElement('body', document);
  document.topbarStatus = new FakeElement('div', document);

  const sendMessageCalls = [];
  const context = {
    console,
    document,
    window: {
      location: { search: '?floating=1' },
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sendMessageCalls.push(message);
          process.nextTick(() => {
            callback({
              title: 'Pinned Article',
              url: 'https://example.test/article',
              siteName: 'example.test',
              content: 'x'.repeat(80),
            });
          });
        },
      },
    },
    MutationObserver: class {
      observe() {}
    },
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    setTimeout,
    clearTimeout,
  };

  return { context, document, sendMessageCalls };
}

test('floating panel auto-enters pinned Smart Read mode after injection', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/read-inject.js'), 'utf8');
  const { context, document, sendMessageCalls } = createHarness();

  vm.runInNewContext(source, context, { filename: 'src/read-inject.js' });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const button = document.getElementById('openclaw-smart-read-btn');
  assert.ok(button, 'Smart Read button should be injected');
  assert.equal(sendMessageCalls.length, 1);
  assert.equal(sendMessageCalls[0].type, 'GET_PAGE_CONTENT_FOR_SIDEPANEL');
  assert.equal(button.classList.contains('smart-read-pinned'), true);
  assert.equal(button.getAttribute('aria-label'), '智能读取网页（常驻）');
});
