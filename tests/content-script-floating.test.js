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

  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.values.has(value) : !!force;
    if (shouldAdd) this.values.add(value);
    else this.values.delete(value);
    return shouldAdd;
  }
}

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  set cssText(value) {
    this.values.set('cssText', value);
  }

  get cssText() {
    return this.values.get('cssText') || '';
  }

  setProperty(name, value) {
    this.values.set(name, value);
  }
}

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.document = document;
    this.children = [];
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this.attributes = new Map();
    this.listeners = new Map();
    this.shadowRoot = null;
    this.title = '';
    this.alt = '';
    this.src = '';
    this.textContent = '';
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

  appendChild(child) {
    this.children.push(child);
    if (child.id) this.document.elementsById.set(child.id, child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  attachShadow() {
    this.shadowRoot = new FakeElement('#shadow-root', this.document);
    return this.shadowRoot;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatch(type) {
    const event = {
      type,
      button: 0,
      preventDefault() {},
      composedPath: () => [this],
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
  }

  querySelector(selector) {
    if (selector === 'iframe') return this.children.find((child) => child.tagName === 'IFRAME') || null;
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.children.find((child) => child.classList.contains(className)) || null;
    }
    return null;
  }

  replaceChildren(...children) {
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  getBoundingClientRect() {
    return { left: 700, top: 500, right: 764, bottom: 564 };
  }

  setPointerCapture() {}
  releasePointerCapture() {}
}

function createHarness() {
  const document = {
    readyState: 'complete',
    title: 'Demo page',
    elementsById: new Map(),
    listeners: new Map(),
    createElement(tagName) {
      return new FakeElement(tagName, this);
    },
    getElementById(id) {
      return this.elementsById.get(id) || null;
    },
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    querySelector() {
      return null;
    },
  };
  document.documentElement = new FakeElement('html', document);
  document.body = new FakeElement('body', document);

  const runtimeMessages = [];
  const windowObject = {
    innerWidth: 1024,
    innerHeight: 768,
    location: { href: 'https://example.test/page', hostname: 'example.test' },
    addEventListener() {},
  };
  windowObject.top = windowObject;

  const context = {
    console,
    document,
    window: windowObject,
    chrome: {
      runtime: {
        getURL(resource) {
          return `chrome-extension://openclaw/${resource}`;
        },
        onMessage: {
          addListener() {},
        },
        sendMessage(message) {
          runtimeMessages.push(message);
          return Promise.resolve({ ok: true });
        },
      },
      storage: {
        local: {
          async get() {
            return {};
          },
          async set() {},
        },
      },
    },
    setTimeout,
    clearTimeout,
  };

  return { context, document, runtimeMessages };
}

function getWidget(document) {
  const host = document.getElementById('openclaw-floating-root');
  assert.ok(host, 'floating root should be injected');
  const cat = host.shadowRoot.querySelector('.cat');
  const panel = host.shadowRoot.querySelector('.panel');
  assert.ok(cat, 'cat button should be injected');
  assert.ok(panel, 'floating panel should be injected');
  return { cat, panel };
}

test('rapid double-click keeps floating panel open and does not open sidepanel', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/content-script.js'), 'utf8');
  const { context, document, runtimeMessages } = createHarness();

  vm.runInNewContext(source, context, { filename: 'src/content-script.js' });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const { cat, panel } = getWidget(document);
  cat.dispatch('click');
  cat.dispatch('click');
  cat.dispatch('dblclick');

  assert.equal(panel.classList.contains('open'), true);
  assert.ok(panel.querySelector('iframe'), 'floating iframe should stay mounted');
  assert.equal(runtimeMessages.some((message) => message.type === 'OPEN_SIDEPANEL'), false);
});

test('hovering the floating icon opens the floating panel', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/content-script.js'), 'utf8');
  const { context, document, runtimeMessages } = createHarness();

  vm.runInNewContext(source, context, { filename: 'src/content-script.js' });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const { cat, panel } = getWidget(document);
  cat.dispatch('mouseenter');
  await new Promise((resolve) => setTimeout(resolve, 220));

  assert.equal(panel.classList.contains('open'), true);
  assert.ok(panel.querySelector('iframe'), 'floating iframe should be mounted on hover');
  assert.equal(runtimeMessages.some((message) => message.type === 'OPEN_SIDEPANEL'), false);
  assert.equal(runtimeMessages.some((message) => message.type === 'SET_FLOATING_WIDGET_STATE' && message.opened && message.source === 'hover'), true);
});
