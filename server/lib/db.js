// Thin wrapper over Node's built-in SQLite (node:sqlite, Node 22.13+).
// No native compilation, so `npm install` works on Windows without Visual Studio / Python.
const { DatabaseSync } = require('node:sqlite');

function openDatabase(file) {
  const db = new DatabaseSync(file);
  const begin = (mode) => (fn) => (...args) => {
    db.exec(mode);
    try { const result = fn(...args); db.exec('COMMIT'); return result; }
    catch (error) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
  };
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    pragma: (text) => db.exec(`PRAGMA ${text}`),
    transaction(fn) {
      const run = begin('BEGIN')(fn);
      run.immediate = begin('BEGIN IMMEDIATE')(fn);
      return run;
    },
  };
}

module.exports = { openDatabase };
