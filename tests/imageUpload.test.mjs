import { mount } from './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imageFiles, pastedImages, splitFirst, uploadOne, altFromFile, pickImageFiles, trackFileDrag, markdownImage,
} from '../src/utils/imageUpload.js';

const M = {
  uploadNotConfigured: 'NOT_CONFIGURED', uploadTooLarge: 'TOO_LARGE', invalidUrl: 'INVALID_URL',
  uploadFailed: 'FAILED', uploadOneAtATime: 'ONE',
};
const file = (name = 'a.png', type = 'image/png', body = 'x') => new window.File([body], name, { type });
const dragEvent = (type, types = ['Files']) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = { types };
  return e;
};

test('imageFiles keeps image/* in order and tolerates null', () => {
  const a = file('a.png'), b = file('b.txt', 'text/plain'), c = file('c.jpg', 'image/jpeg');
  assert.deepEqual(imageFiles([a, b, c]), [a, c]);
  assert.deepEqual(imageFiles(null), []);
});

test('splitFirst returns the first file and the rest', () => {
  const [a, b, c] = [file('a'), file('b'), file('c')];
  assert.deepEqual(splitFirst([a, b, c]), { first: a, extra: [b, c] });
  assert.deepEqual(splitFirst([]), { first: null, extra: [] });
});

test('uploadOne resolves the URL a good hook returns', async () => {
  const url = await uploadOne(file(), { hook: async () => 'https://cdn.example.com/a.png', messages: M });
  assert.equal(url, 'https://cdn.example.com/a.png');
});

test('uploadOne rejects with uploadNotConfigured when there is no hook', async () => {
  await assert.rejects(uploadOne(file(), { hook: undefined, messages: M }), { message: 'NOT_CONFIGURED' });
});

test('uploadOne rejects oversize files without calling the hook', async () => {
  let called = false;
  await assert.rejects(
    uploadOne(file('a.png', 'image/png', '12345'), { hook: async () => { called = true; return 'https://e.com/a.png'; }, maxSize: 3, messages: M }),
    { message: 'TOO_LARGE' },
  );
  assert.equal(called, false);
});

test('uploadOne treats every bad hook outcome as a failure', async () => {
  const bad = [
    [() => { throw new Error('boom'); }, 'boom'],
    [async () => undefined, 'FAILED'],
    [async () => 42, 'FAILED'],
    [async () => 'javascript:alert(1)', 'INVALID_URL'],
    [async () => 'data:image/png;base64,AAAA', 'INVALID_URL'],
  ];
  for (const [hook, message] of bad) {
    await assert.rejects(uploadOne(file(), { hook, messages: M }), { message });
  }
});

test('altFromFile strips only the final extension', () => {
  assert.equal(altFromFile(file('my.photo.png')), 'my.photo');
  assert.equal(altFromFile(file('noext')), 'noext');
});

test('markdownImage escapes alt and encodes the URL', () => {
  assert.equal(markdownImage('a]b', 'https://e.com/x y(1).png'), '![a\\]b](https://e.com/x%20y%281%29.png)');
});

test('pickImageFiles creates a single-select image input and resolves its files', async () => {
  const host = mount();
  const p = pickImageFiles(host);
  const input = host.querySelector('input[type="file"]');
  assert.ok(input, 'input appended');
  assert.equal(input.hasAttribute('multiple'), false);
  assert.equal(input.accept, 'image/*');
  const f = file();
  Object.defineProperty(input, 'files', { value: [f] });
  input.dispatchEvent(new window.Event('change'));
  assert.deepEqual(await p, [f]);
  assert.equal(host.querySelector('input[type="file"]'), null, 'input removed');
});

test('trackFileDrag marks the root while files are dragged over it', () => {
  const root = mount();
  const off = trackFileDrag(root, () => true);
  root.dispatchEvent(dragEvent('dragenter'));
  assert.equal(root.getAttribute('data-bre-dragover'), 'true');
  root.dispatchEvent(dragEvent('dragleave'));
  assert.equal(root.hasAttribute('data-bre-dragover'), false);
  root.dispatchEvent(dragEvent('dragover'));
  root.dispatchEvent(dragEvent('drop'));
  assert.equal(root.hasAttribute('data-bre-dragover'), false);
  root.dispatchEvent(dragEvent('dragenter', ['text/plain']));
  assert.equal(root.hasAttribute('data-bre-dragover'), false, 'non-file drags ignored');
  off();
  root.dispatchEvent(dragEvent('dragenter'));
  assert.equal(root.hasAttribute('data-bre-dragover'), false, 'disposed');
});

test('trackFileDrag does nothing while disabled', () => {
  const root = mount();
  trackFileDrag(root, () => false);
  root.dispatchEvent(dragEvent('dragenter'));
  assert.equal(root.hasAttribute('data-bre-dragover'), false);
});

test('pastedImages returns image files only when the clipboard holds no text', () => {
  const f = file();
  const cb = (files, html = '', text = '') => ({ files, getData: (t) => (t === 'text/html' ? html : t === 'text/plain' ? text : '') });
  assert.deepEqual(pastedImages(cb([f])), [f], 'bare image');
  assert.deepEqual(pastedImages(cb([f], '<img src="https://e.com/a.png">')), [f], 'copied web image (html is only an <img>)');
  assert.deepEqual(pastedImages(cb([f], '<table><tr><td>1</td></tr></table>', '1')), [], 'Excel / Word: text wins');
  assert.deepEqual(pastedImages(cb([f], '', 'plain')), [], 'plain text wins');
  assert.deepEqual(pastedImages(cb([])), []);
  assert.deepEqual(pastedImages(null), []);
});

test('markdownImage escapes inline-Markdown characters and flattens newlines in the alt', () => {
  assert.equal(markdownImage('we`ird *x* _y_ $z$ <b>', 'https://e.com/a.png'), "![we'ird \\*x\\* \\_y\\_ \\$z\\$ \\<b>](https://e.com/a.png)");
  assert.equal(markdownImage('a\nb\r\nc', 'https://e.com/a.png'), '![a b c](https://e.com/a.png)');
});

test('uploadOne rejects a URL containing control characters or newlines', async () => {
  for (const bad of ['https://e.com/a\nb.png', 'https://e.com/a\rb.png', 'https://e.com/a\u0000b.png']) {
    await assert.rejects(uploadOne(file(), { hook: async () => bad, messages: M }), { message: 'INVALID_URL' }, JSON.stringify(bad));
  }
});

test('trackFileDrag keeps the marker when dragleave fires for a child (pointer still inside)', () => {
  const root = mount();
  root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 });
  trackFileDrag(root, () => true);
  root.dispatchEvent(dragEvent('dragenter'));
  const inside = dragEvent('dragleave'); inside.clientX = 50; inside.clientY = 50;
  root.dispatchEvent(inside);
  assert.equal(root.getAttribute('data-bre-dragover'), 'true', 'still inside the editor');
  const outside = dragEvent('dragleave'); outside.clientX = 500; outside.clientY = 50;
  root.dispatchEvent(outside);
  assert.equal(root.hasAttribute('data-bre-dragover'), false);
});
