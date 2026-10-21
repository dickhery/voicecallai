import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderLiveAudioPage } from './live-audio-page.js';

function browser() {
  const callbacks = {}, connections = [], sources = [], contexts = [], timers = new Map();
  let sequence = 0;
  const button = { textContent: '', disabled: false, addEventListener: (name, fn) => { callbacks[name] = fn; } };
  const status = { textContent: '', style: {} };
  class FakeSocket {
    constructor(url) { this.url = url; this.handlers = {}; connections.push(this); }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    close() { this.handlers.close?.(); }
    event(name, value) { this.handlers[name]?.(value); }
    message(value) { this.event('message', { data: JSON.stringify(value) }); }
  }
  function node() { return { connect() {}, disconnect() {}, frequency: {}, gain: {} }; }
  class FakeAudioContext {
    constructor() { this.currentTime = 1; this.state = 'running'; contexts.push(this); }
    createBiquadFilter() { return node(); }
    createDynamicsCompressor() { return node(); }
    createGain() { return node(); }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createBuffer(_channels, count, rate) {
      return { duration: count / rate, getChannelData: () => new Float32Array(count) };
    }
    createBufferSource() {
      const source = { ...node(), start(at) { this.at = at; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    }
  }
  const page = renderLiveAudioPage('call-1');
  const context = vm.createContext({
    document: { getElementById: id => id === 'listen' ? button : status },
    window: { location: { href: 'https://voice.example/live/call-1#private-token', hash: '#private-token' },
      atob: value => Buffer.from(value, 'base64').toString('binary'),
      AudioContext: FakeAudioContext, addEventListener() {} },
    WebSocket: FakeSocket, URL,
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  async function click() { callbacks.click(); await Promise.resolve(); await Promise.resolve(); }
  return { button, status, connections, sources, contexts, timers, click };
}

test('live page requires a user gesture and keeps caller and assistant playback simultaneous', async () => {
  const b = browser(); assert.equal(b.connections.length, 0);
  await b.click();
  const socket = b.connections[0]; socket.event('open');
  assert.equal(new URL(socket.url).searchParams.get('token'), 'private-token');
  const payload = Buffer.alloc(8000, 255).toString('base64');
  socket.message({ type: 'audio', channel: 'caller', payload });
  socket.message({ type: 'audio', channel: 'assistant', payload });
  assert.equal(b.sources[0].at, b.sources[1].at);
  assert.match(b.status.textContent, /listening live/i);
});

test('a cancelled assistant turn stops only its scheduled listener audio', async () => {
  const b = browser(); await b.click(); const socket = b.connections[0]; socket.event('open');
  const payload = Buffer.alloc(8000, 255).toString('base64');
  socket.message({ type: 'audio', channel: 'caller', payload });
  socket.message({ type: 'audio', channel: 'assistant', payload });
  socket.message({ type: 'clear', channel: 'assistant' });
  assert.equal(b.sources[0].stopped, undefined);
  assert.equal(b.sources[1].stopped, true);
  socket.message({ type: 'audio', channel: 'assistant', payload });
  assert.equal(b.sources[2].at, b.sources[0].at);
});

test('a dropped live connection can be reopened without reloading or leaking audio contexts', async () => {
  const b = browser(); await b.click(); const first = b.connections[0]; first.event('open'); first.event('close');
  assert.equal(b.button.disabled, false); assert.match(b.button.textContent, /reconnect/i);
  assert.equal(b.contexts[0].state, 'closed');
  await b.click(); b.connections[1].event('open');
  first.event('close');
  assert.equal(b.contexts[1].state, 'running');
  assert.match(b.status.textContent, /connected/i);
});

test('an ended call releases scheduled playback and gives an honest terminal status', async () => {
  const b = browser(); await b.click(); const socket = b.connections[0]; socket.event('open');
  socket.message({ type: 'audio', payload: Buffer.alloc(8000, 255).toString('base64') });
  socket.message({ type: 'ended' });
  assert.equal(b.sources[0].stopped, true); assert.equal(b.contexts[0].state, 'closed');
  assert.equal(b.timers.size, 0); assert.equal(b.status.textContent, 'The call has ended.');
});

test('a blocked websocket and a connected silent line both offer a clear retry action', async () => {
  const blocked = browser(); await blocked.click(); blocked.timers.values().next().value();
  assert.match(blocked.status.textContent, /timed out/i); assert.equal(blocked.button.disabled, false);
  const silent = browser(); await silent.click(); silent.connections[0].event('open');
  silent.timers.values().next().value();
  assert.match(silent.status.textContent, /no phone audio/i); assert.equal(silent.button.disabled, false);
});

test('session identifiers cannot escape the inline script', () => {
  const html = renderLiveAudioPage('</script><script>alert(1)</script>');
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.match(html, /\\u003c\/script>/);
});
