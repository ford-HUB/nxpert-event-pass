// Single place to point the SPA at the API.
//
// Local dev:  http://localhost:5088
// Phone/ngrok: replace with the https ngrok URL for the API tunnel, e.g.
//   export const API_BASE = 'https://xxxx-xx-xx.ngrok-free.app';
export const API_BASE = 'https://nxpert-events.n-pax.com:9000';

// Face recognition engine (facerog-engine) used by the face TV (scanner/:eventId/tv). It must be
// reachable from the TV's browser, and HTTPS when the app is served over HTTPS. Compiled into
// the bundle like API_BASE, so rebuild after changing it.
export const FACE_ENGINE_BASE = 'http://localhost:83';
