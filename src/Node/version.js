/**
 * Node/version.js
 *
 * Build stamp for the headless Node client. Bumped on every runtime change so
 * the startup line / debug log confirm which build is actually loaded (a rebuild
 * that didn't take, or a stale run, is caught immediately). Printed at boot and
 * echoed into the debug trace.
 */
export const BUILD = 'a4';
