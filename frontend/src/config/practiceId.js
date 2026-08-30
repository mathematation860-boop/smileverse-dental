/**
 * Which practice this frontend build talks to. The backend is
 * multi-tenant-ready (see backend/config/practiceRepository.js) — this is
 * the one line a future second deployment of this same frontend would
 * change (via REACT_APP_PRACTICE_ID) to serve a different clinic against
 * the same backend.
 */
export const PRACTICE_ID = process.env.REACT_APP_PRACTICE_ID || 'smileverse-dental';

export default PRACTICE_ID;
