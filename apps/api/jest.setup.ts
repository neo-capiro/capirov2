import { TransformStream } from 'node:stream/web';
import { webcrypto } from 'node:crypto';

if (!(globalThis as any).TransformStream) {
  (globalThis as any).TransformStream = TransformStream;
}
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}

// @clerk/backend references the global fetch family as bare identifiers at
// import time (`fetch.bind(...)`, `Request`, ...), which the AppModule DI
// smoke test triggers; jest 29's node environment does not forward Node's
// fetch globals into the sandbox. Binding-compatible stubs are enough — unit
// tests never perform real HTTP.
if (!(globalThis as any).fetch) {
  (globalThis as any).fetch = () =>
    Promise.reject(new Error('global fetch is not available in the jest sandbox'));
}
for (const name of ['Request', 'Response', 'Headers', 'FormData']) {
  if (!(globalThis as any)[name]) {
    (globalThis as any)[name] = class {
      static stubbedForJest = true;
    };
  }
}
