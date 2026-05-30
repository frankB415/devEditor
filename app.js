/**
 * @fileoverview app.js — Zentrale Steuerung des Editors
 * Zuständig für: Dateibaum, Editor-Textarea, Session-Persistenz,
 * Dateioperationen (lesen, speichern, anlegen, umbenennen, löschen),
 * Offline-Queue, Schreibsperre-Handling, Backup-Trigger.
 */

'use strict';

// ── KONFIGURATION ──────────────────────────────────────────────────────────

/** @const {string} Basispfad zur PHP-API */
const API = 'api.php';

/** @const {number} Maximale Dateigröße für Download in Bytes (10 MB) */
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

/** @const {number} Intervall für Auto-Save-Cache in Millisekunden */
const CACHE_INTERVAL_MS = 1000;

// ── ZUSTAND ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AppState
 * @property {string|null} openPath       - Pfad der aktuell geöffneten Datei
 * @property {string}      openContent    - Letzter vom Server geladener Inhalt
 * @property {number}      cursorPos      - Cursor-Position im Editor
 * @property {number}      scrollTop      - Scroll-Position des Editors
 * @property {string[]}    checkedPaths   - Für KI ausgewählte Pfade
 * @property {Object}      dirPerms       - KI-Berechtigungen pro Verzeichnis { path: 'read'|'write'|'none' }
 * @property {boolean}     writeLocked    - Schreibsperre aktiv (Backup läuft)
 * @property {boolean}     online         - Netzwerkstatus
 * @property {Array}       saveQueue      - Offline-Queue [ {path, content} ]
 * @property {boolean}     dirty          - Ungespeicherte Änderungen vorhanden
 * @property {string|null} cachedContent  - Lokal gecachter unsaved Inhalt
 */
const state = window.state = {
  openPath:      null,
  openContent:   '',
  cursorPos:     0,
  scrollTop:     0,
  checkedPaths:  [],
  dirPerms:      {},
  workDir:       '',   // Arbeitsverzeichnis für die KI
  diffStats:     {},   // KI-Diff-Statistiken pro Datei { path: '+x / -y' }
  writeLocked:   false,
  online:        navigator.onLine,
  saveQueue:     [],
  dirty:         false,
  fileCache:     {},   // Ungespeicherte Änderungen pro Datei { path: content }
};

// ── DOM-REFERENZEN ─────────────────────────────────────────────────────────

const elTree         = document.getElementById('file-tree');
const elEditor       = document.getElementById('editor');
const elLineNums     = document.getElementById('line-numbers');
const elFilename     = document.getElementById('editor-filename');
const elBtnSave      = document.getElementById('btn-save');
const elBtnRefresh   = document.getElementById('btn-refresh');
const elBtnBackup    = document.getElementById('btn-backup-now');
const elContextMenuFile = document.getElementById('context-menu-file');
const elContextMenuDir  = document.getElementById('context-menu-dir');
const elDiffPanel    = document.getElementById('diff-panel');
const elStatusbar    = document.getElementById('statusbar');
const elStatusText   = document.getElementById('status-text');
const elStatusClose  = document.getElementById('status-close');
const elModalOverlay = document.getElementById('modal-overlay');
const elModalMsg     = document.getElementById('modal-message');
const elModalInput   = document.getElementById('modal-input');
const elModalInputWrap = document.getElementById('modal-input-wrap');
const elModalConfirm = document.getElementById('modal-confirm');
const elModalCancel  = document.getElementById('modal-cancel');
const elModalButtons = document.getElementById('modal-buttons');

// ── STATUSLEISTE ───────────────────────────────────────────────────────────

/** @type {number|null} */
let statusTimer = null;

/**
 * Zeigt eine Meldung in der Statusleiste an.
 * @param {string} text       - Anzuzeigender Text
 * @param {'info'|'ok'|'error'} type - Anzeigetyp
 * @param {boolean} [persist=false] - true = bleibt bis Klick, false = 4 s
 */
function showStatus(text, type = 'info', persist = false) {
  clearTimeout(statusTimer);
  elStatusText.removeAttribute('data-hover');
  elStatusText.textContent = text;
  elStatusbar.className = type;
  elStatusClose.classList.toggle('hidden', !persist);
  if (!persist) {
    statusTimer = setTimeout(() => {
      elStatusText.textContent = '';
      elStatusbar.className = '';
      elStatusClose.classList.add('hidden');
    }, 4000);
  }
}

/**
 * Zeigt den vollständigen Pfad in der Statusleiste beim Hover über einen Baum-Eintrag.
 * Nur aktiv wenn kein persistenter Status sichtbar ist (kein x-Button).
 * @param {string} path
 */
function showHoverPath(path) {
  if (!elStatusClose.classList.contains('hidden')) return;
  elStatusText.setAttribute('data-hover', '1');
  elStatusText.textContent = path;
  elStatusbar.className = 'info';
}

/** Entfernt den Hover-Pfad — nur wenn er von uns stammt. */
function clearHoverPath() {
  if (elStatusText.getAttribute('data-hover') === '1') {
    elStatusText.removeAttribute('data-hover');
    elStatusText.textContent = '';
    elStatusbar.className = '';
  }
}

elStatusClose.addEventListener('click', () => {
  clearTimeout(statusTimer);
  elStatusText.textContent = '';
  elStatusbar.className = '';
  elStatusClose.classList.add('hidden');
});

// ── API-KOMMUNIKATION ──────────────────────────────────────────────────────

/**
 * Sendet eine Anfrage an api.php.
 * @param {string} action  - API-Aktion
 * @param {Object} [body]  - Optionale POST-Daten
 * @returns {Promise<Object>} - JSON-Antwort
 */
async function apiRequest(action, body = null) {
  const opts = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } };
  const url  = body ? API : `${API}?action=${encodeURIComponent(action)}`;
  if (body) opts.body = JSON.stringify({ action, ...body });
  const logInfo = body ? Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'content')) : {};
  console.log('[api]', { action, ...logInfo });
  const res = await fetch(url, opts);
  // console.log('[api] ←', action, res.status);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // console.log('[api] data', action, json);
  return json;
}

// ── DATEIBAUM ──────────────────────────────────────────────────────────────

/** @type {Array} Zwischengespeicherter Verzeichnisbaum */
let treeData = [];

/** Lädt den Verzeichnisbaum vom Server und rendert ihn. */
async function loadTree() {
  // console.log('[tree] laden …');
  try {
    // Geöffnete Ordner VOR dem Leeren des DOM sichern
    const savedOpenPaths = new Set();
    elTree.querySelectorAll('.tree-folder.open').forEach(el => savedOpenPaths.add(el.dataset.path));

    const data = await apiRequest('tree');
    treeData = data.tree || [];
    // console.log('[tree] Einträge:', treeData.length, treeData);
    elTree.innerHTML = '';
    elTree._savedOpenPaths = savedOpenPaths;

    // Root-Eintrag
    const rootRow = document.createElement('div');
    rootRow.className = 'tree-item tree-root';
    rootRow.dataset.path = '';
    rootRow.dataset.type = 'dir';
    rootRow.innerHTML = '<span class="item-icon">🏠</span><span class="item-name">/ (Root)</span>';
    rootRow.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showContextMenu(e.clientX, e.clientY, { path: '', name: '/', type: 'dir' }); });
    rootRow.addEventListener('mouseenter', () => showHoverPath('/'));
    rootRow.addEventListener('mouseleave', clearHoverPath);
    elTree.appendChild(rootRow);

    renderTree(treeData, elTree, 0);
  } catch (e) {
    // console.error('[tree] Fehler:', e);
    showStatus('Fehler beim Laden des Dateibaums: ' + e.message, 'error', true);
  }
}

/**
 * Rendert den Dateibaum rekursiv.
 * @param {Array}       items     - Baum-Einträge
 * @param {HTMLElement} container - Ziel-Container
 * @param {number}      depth     - Einrücktiefe
 */
function renderTree(items, container, depth) {
  // Geöffnete Ordner: bei depth=0 aus gespeichertem Set holen (DOM wurde bereits geleert)
  const openPaths = new Set();
  if (depth === 0) {
    const saved = container._savedOpenPaths;
    if (saved && saved.size > 0) {
      saved.forEach(p => openPaths.add(p));
      delete container._savedOpenPaths;
    } else {
      container.querySelectorAll('.tree-folder.open').forEach(el => {
        openPaths.add(el.dataset.path);
      });
    }
    Array.from(container.children).forEach(el => {
      if (!el.classList.contains('tree-root')) el.remove();
    });
  }
  items.forEach(item => renderTreeItem(item, container, depth, openPaths));
}

/**
 * Rendert einen einzelnen Baum-Eintrag.
 * @param {Object}      item      - Datei- oder Ordner-Objekt
 * @param {HTMLElement} container - Ziel-Container
 * @param {number}      depth     - Einrücktiefe
 */
function renderTreeItem(item, container, depth, openPaths = new Set()) {
  const row = document.createElement('div');
  row.className = `tree-item tree-indent-${Math.min(depth, 4)}`;
  row.dataset.path = item.path;
  row.dataset.type = item.type;

  if (item.path === state.openPath) row.classList.add('active');

  // Checkbox
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  if (item.type === 'dir') {
    // Checkbox-Status aus Kinderdateien ableiten
    const dirFiles = [];
    function collectForCheck(items) {
      if (!items) return;
      items.forEach(i => {
        if (i.type === 'file') dirFiles.push(i.path);
        if (i.type === 'dir') collectForCheck(i.children);
      });
    }
    collectForCheck(item.children);
    const checkedCount = dirFiles.filter(p => state.checkedPaths.includes(p)).length;
    cb.checked = checkedCount > 0 && checkedCount === dirFiles.length;
    cb.indeterminate = checkedCount > 0 && checkedCount < dirFiles.length;
  } else {
    cb.checked = state.checkedPaths.includes(item.path);
  }
  cb.addEventListener('change', () => {
    const checked = cb.checked; // Wert sofort sichern vor renderTree
    if (item.type === 'dir') {
      const dirFiles = [];
      function collectDir(items) {
        if (!items) return;
        items.forEach(i => {
          if (i.type === 'file') dirFiles.push(i.path);
          if (i.type === 'dir') collectDir(i.children);
        });
      }
      function findDir(items, path) {
        for (const i of items) {
          if (i.path === path) return i;
          if (i.type === 'dir' && i.children) {
            const found = findDir(i.children, path);
            if (found) return found;
          }
        }
        return null;
      }
      const dirNode = item.path === '' ? { children: treeData } : findDir(treeData, item.path);
      collectDir(dirNode ? dirNode.children : []);
      console.log('[dir-cb]', item.path, 'files:', dirFiles.length, checked);
      dirFiles.forEach(p => toggleChecked(p, checked));
    } else {
      toggleChecked(item.path, checked);
      if (!checked && state.dirPerms[item.path] === 'write') {
        state.dirPerms[item.path] = 'read';
        persistSession();
      }
    }
    renderTree(treeData, elTree, 0);
    if (window.aiUpdateContext) window.aiUpdateContext();
  });

  // Icon
  const icon = document.createElement('span');
  icon.className = 'item-icon';

  // Name
  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = item.name;

  // Dateigröße (Dateien: direkt, Ordner: Summe aller Kinder)
  const sizeEl = document.createElement('span');
  sizeEl.className = 'item-size';
  if (item.type === 'file' && item.size !== undefined) {
    sizeEl.textContent = (item.size / 1024).toFixed(1) + ' KB';
  } else if (item.type === 'dir') {
    const total = calcDirSize(item);
    if (total > 0) sizeEl.textContent = (total / 1024).toFixed(1) + ' KB';
  }

  // Diff-Anzeige
  const diff = document.createElement('span');
  diff.className = 'item-diff';
  diff.id = `diff-stat-${item.path.replace(/[^a-z0-9]/gi, '_')}`;
  // Gespeicherten Diff-Stat wiederherstellen
  if (state.diffStats[item.path]) diff.textContent = state.diffStats[item.path];

  // Berechtigungs-Icon: 👁 wenn Checkbox an, ✏ wenn zusätzlich Schreiben erlaubt
  const permIcon = document.createElement('span');
  permIcon.className = 'item-perm';
  if (item.type === 'file') {
    const isChecked = state.checkedPaths.includes(item.path);
    if (isChecked) {
      row.classList.add(isInWorkDir(item.path) ? 'perm-write' : 'perm-read');
    }
  } else {
    // Für Ordner: Klasse setzen wenn mindestens eine Datei drin gecheckt ist
    const anyChecked = (item.children || []).some(i =>
      i.type === 'file' && state.checkedPaths.includes(i.path)
    );
    if (anyChecked) {
      row.classList.add(isInWorkDir(item.path) ? 'perm-write' : 'perm-read');
    }
  }

  // Alter der Datei
  const ageEl = document.createElement('span');
  ageEl.className = 'item-age';
  if (item.type === 'file' && item.mtime) {
    const sec = Math.floor(Date.now() / 1000) - item.mtime;
    let age;
    if      (sec < 60)           age = sec + 's';
    else if (sec < 3600)         age = Math.floor(sec / 60) + 'm';
    else if (sec < 86400)        age = Math.floor(sec / 3600) + 'h';
    else if (sec < 365 * 86400)  age = Math.floor(sec / 86400) + 'd';
    else                         age = Math.floor(sec / (365 * 86400)) + 'y';
    ageEl.textContent = age;
  }

  row.append(cb, icon, name, sizeEl, ageEl, diff, permIcon);

  // Hover — vollständigen Pfad in Statusleiste anzeigen
  row.addEventListener('mouseenter', () => showHoverPath(item.path));
  row.addEventListener('mouseleave', clearHoverPath);

  // Rechtsklick — muss vor dem frühen return für Ordner mit Kindern stehen
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, item);
  });

  // Klick: Datei öffnen
  if (item.type === 'file') {
    row.classList.add('tree-file');
    name.addEventListener('click', () => guardedOpenFile(item.path));
  }

  // Klick: Ordner auf-/zuklappen
  if (item.type === 'dir') {
    row.classList.add('tree-folder');
    name.addEventListener('click', () => {
      row.classList.toggle('open');
      const sub = row.nextElementSibling;
      if (sub && sub.classList.contains('tree-children')) {
        sub.classList.toggle('hidden');
      }
    });

    if (item.children && item.children.length) {
      const isOpen = openPaths.has(item.path);
      if (isOpen) row.classList.add('open');
      const children = document.createElement('div');
      children.className = 'tree-children' + (isOpen ? '' : ' hidden');
      item.children.forEach(child => renderTreeItem(child, children, depth + 1, openPaths));
      container.appendChild(row);
      container.appendChild(children);
      return;
    }
  }

  container.appendChild(row);
}

// ── DATEI ÖFFNEN ──────────────────────────────────────────────────────────

/**
 * Prüft auf ungespeicherte Änderungen bevor eine neue Datei geöffnet wird.
 * @param {string} path - Zielpfad
 */
async function guardedOpenFile(path) {
  if (path === state.openPath) return;   // Gleiche Datei — nichts tun
  if (state.dirty) {
    const choice = await showUnsavedModal();
    if (choice === 'cancel') return;
    if (choice === 'save') {
      await saveFile();
      if (state.dirty) return;   // Speichern fehlgeschlagen (z.B. offline) — abbrechen
    }
    if (choice === 'discard') {
      // Cache verwerfen
      delete state.fileCache[state.openPath];
      state.dirty = false;
      persistSession();
    }
  }
  openFile(path);
}

/**
 * Öffnet eine Datei aus dem Baum im Editor.
 * @param {string} path - Serverpfad der Datei
 */
async function openFile(path) {
  try {
    const data = await apiRequest('read', { path });
    state.openPath    = path;
    state.openContent = data.content;
    state.dirty       = false;

    // Gecachten ungespeicherten Stand laden falls vorhanden
    const cached = state.fileCache[path];
    const displayContent = cached !== undefined ? cached : data.content;
    const reallyDirty = cached !== undefined && cached !== data.content;
    if (reallyDirty) {
      state.dirty = true;
    } else {
      // Cache ist identisch mit Server-Stand — aufräumen
      if (cached !== undefined) delete state.fileCache[path];
      state.dirty = false;
    }

    elEditor.value    = displayContent;
    elEditor.disabled = false;
    elFilename.innerHTML = `<a href="/${path}" target="_blank" title="Im Browser öffnen" style="color:inherit;text-decoration:none;">${path} ↗</a>`;
    document.title = path.split('/').pop() + ' — devEditor';
    elBtnSave.disabled = !state.dirty;

    updateLineNumbers();
    restoreCursorAndScroll();
    highlightActiveFile(path);
    persistSession();

    if (state.dirty) {
      showDirtyStatus();   // Dirty-Hinweis hat Vorrang vor "Geladen"
    } else {
      showStatus('Geladen', 'ok');
    }
  } catch (e) {
    showStatus('Fehler beim Lesen: ' + e.message, 'error', true);
  }
}

// ── EDITOR-EVENTS ──────────────────────────────────────────────────────────

elEditor.addEventListener('input', () => {
  state.dirty = true;
  elBtnSave.disabled = false;
  updateLineNumbers();
  cacheUnsaved();
  showDirtyStatus();
});

elEditor.addEventListener('scroll', () => {
  elLineNums.scrollTop = elEditor.scrollTop;
  state.scrollTop = elEditor.scrollTop;
});

elEditor.addEventListener('keydown', e => {
  // Tab → 4 Leerzeichen
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = elEditor.selectionStart;
    const v = elEditor.value;
    elEditor.value = v.slice(0, s) + '    ' + v.slice(elEditor.selectionEnd);
    elEditor.selectionStart = elEditor.selectionEnd = s + 4;
    state.dirty = true;
    elBtnSave.disabled = false;
    updateLineNumbers();
    cacheUnsaved();
    showDirtyStatus();
  }
  // Ctrl+S → Speichern
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
});

elBtnSave.addEventListener('click', saveFile);

/** Aktualisiert die Zeilennummern-Anzeige synchron mit dem Editor. */
function updateLineNumbers() {
  const lines = elEditor.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= lines; i++) html += i + '\n';
  elLineNums.textContent = html;
}

/**
 * Zeigt einen persistenten Hinweis in der Statusleiste wenn ungespeicherte Änderungen vorhanden.
 * Wird automatisch durch showStatus() überschrieben (z.B. "Gespeichert") und danach
 * vom writeFile-Reset weggeräumt.
 */
function showDirtyStatus() {
  // Nur anzeigen wenn kein anderer persistenter Status aktiv
  if (elStatusClose.classList.contains('hidden')) {
    showStatus('Ungespeicherte Änderungen', 'info', true);
  }
}

// ── SPEICHERN ──────────────────────────────────────────────────────────────

/** Speichert die aktuelle Datei — mit Queue-Unterstützung bei Offline/Sperre. */
async function saveFile() {
  if (!state.openPath) return;
  const content = elEditor.value;

  if (!state.online || state.writeLocked) {
    state.saveQueue.push({ path: state.openPath, content });
    persistSession();
    const reason = state.writeLocked ? 'Backup läuft — Speichern gepuffert' : 'Offline — Änderungen werden gepuffert';
    showStatus(reason, 'info', true);
    return;
  }

  await writeFile(state.openPath, content);
}

/**
 * Schreibt eine Datei auf den Server.
 * @param {string} path    - Serverpfad
 * @param {string} content - Dateiinhalt
 */
async function writeFile(path, content) {
  try {
    await apiRequest('write', { path, content });
    if (path === state.openPath) {
      state.openContent = content;
      state.dirty       = false;
      delete state.fileCache[path];
      elBtnSave.disabled = true;
      // Dirty-Hinweis wegräumen
      clearTimeout(statusTimer);
      elStatusText.textContent = '';
      elStatusbar.className = '';
      elStatusClose.classList.add('hidden');
    }
    showStatus('Gespeichert', 'ok');
  } catch (e) {
    showStatus('Fehler beim Speichern: ' + e.message, 'error', true);
  }
}

// ── OFFLINE-QUEUE ──────────────────────────────────────────────────────────

/** Arbeitet die Offline-Queue chronologisch ab. */
async function flushQueue() {
  if (!state.online || state.writeLocked || state.saveQueue.length === 0) return;
  const queue = [...state.saveQueue];
  state.saveQueue = [];
  persistSession();
  for (const entry of queue) {
    await writeFile(entry.path, entry.content);
  }
  showStatus('Verbindung wiederhergestellt — Änderungen übertragen', 'ok');
}

window.addEventListener('online',  () => {
  state.online = true;
  // Offline-Meldung wegräumen
  if (elStatusText.textContent.includes('Offline')) {
    clearTimeout(statusTimer);
    elStatusText.textContent = '';
    elStatusbar.className = '';
    elStatusClose.classList.add('hidden');
  }
  flushQueue();
});
window.addEventListener('offline', () => { state.online = false; showStatus('Offline — Änderungen werden gepuffert', 'info', true); });

// Offline-Erkennung via Browser-Events (kein Polling)

// ── CRASH-SCHUTZ: AUTO-CACHE ───────────────────────────────────────────────

/** Cached den aktuellen Editorinhalt sekündlich in IndexedDB. */
function cacheUnsaved() {
  if (!state.openPath) return;
  state.fileCache[state.openPath] = elEditor.value;
  state.cursorPos = elEditor.selectionStart;
  persistSession();
}

setInterval(() => { if (state.dirty) cacheUnsaved(); }, CACHE_INTERVAL_MS);

// ── SESSION-PERSISTENZ (IndexedDB) ─────────────────────────────────────────

/** @type {IDBDatabase|null} */
let db = null;

/** Öffnet die IndexedDB-Datenbank. */
function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('editor-session', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('state');
    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror   = () => reject(req.error);
  });
}

/** Speichert den aktuellen Zustand in IndexedDB. */
function persistSession() {
  if (!db) return;
  const tx    = db.transaction('state', 'readwrite');
  const store = tx.objectStore('state');
  const aiModelEl = document.getElementById('ai-model');
  store.put({
    openPath:     state.openPath,
    cursorPos:    state.cursorPos,
    scrollTop:    state.scrollTop,
    checkedPaths: state.checkedPaths,
    dirPerms:     state.dirPerms,
    workDir:      state.workDir,
    saveQueue:    state.saveQueue,
    fileCache:    state.fileCache,
    aiModel:      aiModelEl ? aiModelEl.value : '',
  }, 'session');
}
window.persistSession = persistSession;

/** Stellt den Zustand aus IndexedDB wieder her. */
async function restoreSession() {
  if (!db) return;
  return new Promise(resolve => {
    const tx    = db.transaction('state', 'readonly');
    const store = tx.objectStore('state');
    const req   = store.get('session');
    req.onsuccess = () => {
      const s = req.result;
      if (!s) { resolve(); return; }
      state.checkedPaths  = s.checkedPaths  || [];
      state.dirPerms      = s.dirPerms      || {};
      state.workDir       = s.workDir       || '';
      state.saveQueue     = s.saveQueue     || [];
      state.fileCache     = s.fileCache     || {};
      state.cursorPos     = s.cursorPos     || 0;
      state.scrollTop     = s.scrollTop     || 0;
      if (s.aiModel) {
        const aiModelEl = document.getElementById('ai-model');
        if (aiModelEl) aiModelEl.value = s.aiModel;
      }
      if (s.openPath) {
        openFile(s.openPath);
      }
      resolve();
    };
    req.onerror = () => resolve();
  });
}

/** Stellt Cursor- und Scroll-Position nach dem Öffnen einer Datei wieder her. */
function restoreCursorAndScroll() {
  elEditor.selectionStart = elEditor.selectionEnd = state.cursorPos;
  elEditor.scrollTop = state.scrollTop;
  elLineNums.scrollTop = state.scrollTop;
}

// ── DATEIOPERATIONEN ────────────────────────────────────────────────────────

/** @type {Object|null} Zuletzt via Rechtsklick gewähltes Item */
let contextTarget = null;

/**
 * Öffnet das Kontextmenü an der Mausposition.
 * @param {number} x    - X-Koordinate
 * @param {number} y    - Y-Koordinate
 * @param {Object} item - Datei/Ordner-Objekt
 */
function showContextMenu(x, y, item) {
  contextTarget = item;

  // Beide Menüs zuerst verstecken
  elContextMenuFile.classList.add('hidden');
  elContextMenuDir.classList.add('hidden');

  const menu = item.type === 'file' ? elContextMenuFile : elContextMenuDir;

  // KI-Schreiben nur anzeigen wenn Checkbox aktiv (nur bei Dateien)
  if (item.type === 'file') {
    const writeItem = menu.querySelector('[data-action="perm-toggle"]');
    if (writeItem) writeItem.style.display = state.checkedPaths.includes(item.path) ? '' : 'none';
    // Umbenennen/Löschen für Root ausblenden
    menu.querySelectorAll('[data-action="rename"],[data-action="delete"]').forEach(el => el.style.display = '');
  } else {
    // Root hat kein Umbenennen/Löschen
    const isRoot = item.path === '';
    menu.querySelectorAll('[data-action="rename"],[data-action="delete"]').forEach(el => {
      el.style.display = isRoot ? 'none' : '';
    });
  }

  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  menu.classList.remove('hidden');
}

document.addEventListener('click', () => {
  elContextMenuFile.classList.add('hidden');
  elContextMenuDir.classList.add('hidden');
});

/** Handler für beide Kontextmenüs */
function handleContextMenuClick(e) {
  const action = e.target.dataset.action;
  if (!action || !contextTarget) return;
  elContextMenuFile.classList.add('hidden');
  elContextMenuDir.classList.add('hidden');

  switch (action) {
    case 'set-workdir':
      // Alte Arbeitsverzeichnis-Dateien aus Kontext entfernen
      if (state.workDir !== '' && state.workDir !== contextTarget.path) {
        state.checkedPaths = state.checkedPaths.filter(p =>
          !p.startsWith(state.workDir + '/') && p !== state.workDir
        );
      }
      state.workDir = contextTarget.path;
      persistSession();
      autoCheckWorkDir();
      if (window.aiUpdateContext) window.aiUpdateContext();
      // Chat-History leeren damit die KI nicht mehr im alten Verzeichnis arbeitet
      if (window.clearChatHistory) window.clearChatHistory();
      showStatus('Arbeitsverzeichnis: ' + (state.workDir || '/'), 'ok');
      break;
    case 'new-file':   actionNewFile(contextTarget);   break;
    case 'new-folder': actionNewFolder(contextTarget); break;
    case 'rename':     actionRename(contextTarget);    break;
    case 'delete':     actionDelete(contextTarget);    break;
    case 'download':   actionDownload(contextTarget);  break;
  }
}

elContextMenuFile.addEventListener('click', handleContextMenuClick);
elContextMenuDir.addEventListener('click',  handleContextMenuClick);

elBtnRefresh.addEventListener('click', () => loadTree());
/**
 * Neue Datei im Verzeichnis des Kontext-Eintrags anlegen.
 * @param {Object} target - Ordner oder Root-Eintrag
 */
async function actionNewFile(target) {
  const name = await showModal('Neuer Dateiname:', '', true);
  if (!name) return;
  const dir  = target.type === 'dir' ? target.path : target.path.split('/').slice(0, -1).join('/');
  const path = (dir ? dir + '/' : '') + name;
  try {
    await apiRequest('write', { path, content: '' });
    notifyAiFileChanged();
    await loadTree();
    openFile(path);
  } catch (e) {
    showStatus('Fehler beim Anlegen: ' + e.message, 'error', true);
  }
}

/**
 * Neuen Ordner im Verzeichnis des Kontext-Eintrags anlegen.
 * @param {Object} target - Ordner oder Root-Eintrag
 */
async function actionNewFolder(target) {
  const name = await showModal('Neuer Ordnername:', '', true);
  if (!name) return;
  const dir  = target.type === 'dir' ? target.path : target.path.split('/').slice(0, -1).join('/');
  const path = (dir ? dir + '/' : '') + name;
  try {
    await apiRequest('mkdir', { path });
    await loadTree();
  } catch (e) {
    showStatus('Fehler beim Anlegen: ' + e.message, 'error', true);
  }
}

/**
 * Umbenennen-Aktion für eine Datei oder einen Ordner.
 * @param {Object} item - Baum-Eintrag
 */
async function actionRename(item) {
  const newName = await showModal('Neuer Name:', item.name, true);
  if (!newName || newName === item.name) return;
  const dir     = item.path.split('/').slice(0, -1).join('/');
  const newPath = (dir ? dir + '/' : '') + newName;
  try {
    await apiRequest('rename', { from: item.path, to: newPath });
    if (state.openPath === item.path) {
      state.openPath = newPath;
      elFilename.textContent = newPath;
    }
    notifyAiFileChanged();
    await loadTree();
  } catch (e) {
    showStatus('Fehler beim Umbenennen: ' + e.message, 'error', true);
  }
}

/**
 * Löschen-Aktion für eine Datei oder einen Ordner.
 * @param {Object} item - Baum-Eintrag
 */
async function actionDelete(item) {
  const confirmed = await showModal(`"${item.name}" wirklich löschen?`, '', false);
  if (!confirmed) return;
  try {
    await apiRequest('delete', { path: item.path });
    if (state.openPath === item.path) {
      state.openPath = null;
      elEditor.value = '';
      elEditor.disabled = true;
      elFilename.textContent = '— keine Datei geöffnet —';
      elBtnSave.disabled = true;
      updateLineNumbers();
    }
    notifyAiFileChanged();
    await loadTree();
    showStatus('Gelöscht', 'ok');
  } catch (e) {
    showStatus('Fehler beim Löschen: ' + e.message, 'error', true);
  }
}

/**
 * Download-Aktion: Datei direkt, Ordner als ZIP via download.php.
 * @param {Object} item - Baum-Eintrag
 */
function actionDownload(item) {
  if (item.type === 'file' && item.size > MAX_DOWNLOAD_BYTES) {
    showStatus('Datei zu groß für Download (max. 10 MB)', 'error', true);
    return;
  }
  const url = `download.php?path=${encodeURIComponent(item.path)}&type=${item.type}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = item.name + (item.type === 'dir' ? '.zip' : '');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── KI-BERECHTIGUNGEN ──────────────────────────────────────────────────────

/**
 * Lädt alle Dateien im Arbeitsverzeichnis automatisch in den KI-Kontext.
 */
function autoCheckWorkDir() {
  if (!treeData.length) return;
  const workDir = state.workDir;
  if (workDir === '') return;

  function collectFiles(items) {
    items.forEach(item => {
      if (item.type === 'file') {
        const inWorkDir = item.path === workDir || item.path.startsWith(workDir + '/');
        if (inWorkDir && !state.checkedPaths.includes(item.path)) {
          state.checkedPaths.push(item.path);
        }
      }
      if (item.type === 'dir' && item.children) collectFiles(item.children);
    });
  }
  collectFiles(treeData);
  persistSession();
  renderTree(treeData, elTree, 0); // Baum neu rendern damit Icons stimmen
}

/**
 * Berechnet die Gesamtgröße aller Dateien in einem Verzeichnis rekursiv.
 * @param {Object} item - Verzeichnis-Eintrag
 * @returns {number} Gesamtgröße in Bytes
 */
function calcDirSize(item) {
  if (item.type === 'file') return item.size || 0;
  if (!item.children) return 0;
  return item.children.reduce((sum, child) => sum + calcDirSize(child), 0);
}

/**
 * Gibt zurück ob ein Pfad im Arbeitsverzeichnis liegt.
 * @param {string} path
 * @returns {boolean}
 */
function isInWorkDir(path) {
  if (state.workDir === '') return false; // Kein Arbeitsverzeichnis = kein auto Schreibrecht
  return path === state.workDir || path.startsWith(state.workDir + '/');
}

function setDirPerm(path, perm) {
  state.dirPerms[path] = perm;
  persistSession();
  loadTree();
  if (window.aiUpdateContext) window.aiUpdateContext();
}

/**
 * Gibt die KI-Berechtigung für einen Pfad zurück (Vererbung).
 * @param {string} path - Datei- oder Verzeichnispfad
 * @returns {'read'|'write'|'none'|null}
 */
function getDirPerm(path) {
  window.getDirPerm = getDirPerm;
  const parts = path.split('/');
  for (let i = parts.length; i > 0; i--) {
    const dir = parts.slice(0, i).join('/');
    if (state.dirPerms[dir]) return state.dirPerms[dir];
  }
  return null;
}

// ── CHECKBOX-AUSWAHL ───────────────────────────────────────────────────────

/**
 * Schaltet einen Pfad in der KI-Auswahl ein oder aus.
 * @param {string}  path    - Pfad
 * @param {boolean} checked - Ausgewählt?
 */
function toggleChecked(path, checked) {
  if (!path || path === '') return; // Leere Pfade und Root ignorieren
  if (checked) {
    if (!state.checkedPaths.includes(path)) state.checkedPaths.push(path);
  } else {
    state.checkedPaths = state.checkedPaths.filter(p => p !== path);
  }
  persistSession();
}

// ── AKTIVE DATEI HERVORHEBEN ───────────────────────────────────────────────

/**
 * Markiert die aktive Datei im Dateibaum.
 * @param {string} path - Pfad der aktiven Datei
 */
function highlightActiveFile(path) {
  document.querySelectorAll('.tree-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path === path);
  });
}

// ── BACKUP ─────────────────────────────────────────────────────────────────

elBtnBackup.addEventListener('click', async () => {
  showStatus('Backup läuft — Speichern gepuffert', 'info', true);
  try {
    const data = await apiRequest('backup');
    if (data.ok) {
      showStatus(`Backup OK — ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`, 'ok');
    } else {
      showStatus('Backup fehlgeschlagen: ' + (data.error || 'Unbekannt'), 'error', true);
    }
  } catch (e) {
    showStatus('Backup fehlgeschlagen: ' + e.message, 'error', true);
  }
});

/**
 * Wird vom Service Worker aufgerufen wenn eine Backup-Schreibsperre aktiv ist.
 * @param {boolean} locked - Gesperrt?
 */
window.setWriteLock = function(locked) {
  state.writeLocked = locked;
  if (locked) {
    showStatus('Backup läuft — Speichern gepuffert', 'info', true);
  } else {
    flushQueue();
  }
};

// ── KI-KONTEXT-ÄNDERUNGS-HINWEIS ──────────────────────────────────────────

/** Zeigt dem Nutzer im KI-Panel an, dass sich der Dateibestand geändert hat. */
function notifyAiFileChanged() {
  const el = document.getElementById('ai-context-changed');
  if (el) el.classList.remove('hidden');
}

// ── MODAL ──────────────────────────────────────────────────────────────────

/**
 * Zeigt einen Modal-Dialog an.
 * @param {string}  message    - Anzuzeigende Nachricht
 * @param {string}  [defVal]   - Standardwert für Texteingabe
 * @param {boolean} [hasInput] - Mit Texteingabefeld?
 * @returns {Promise<string|boolean>} - Eingabe oder true/false
 */
function showModal(message, defVal = '', hasInput = false) {
  return new Promise(resolve => {
    elModalMsg.textContent = message;
    elModalInputWrap.classList.toggle('hidden', !hasInput);
    if (hasInput) {
      elModalInput.value = defVal;
      setTimeout(() => elModalInput.focus(), 50);
    }
    elModalOverlay.classList.remove('hidden');

    const cleanup = () => elModalOverlay.classList.add('hidden');

    elModalConfirm.onclick = () => {
      cleanup();
      resolve(hasInput ? elModalInput.value.trim() : true);
    };
    elModalCancel.onclick = () => {
      cleanup();
      resolve(hasInput ? '' : false);
    };
    elModalInput.onkeydown = e => {
      if (e.key === 'Enter') elModalConfirm.click();
      if (e.key === 'Escape') elModalCancel.click();
    };
  });
}

/**
 * Zeigt den „Ungespeicherte Änderungen"-Dialog mit drei Optionen.
 * @returns {Promise<'save'|'discard'|'cancel'>}
 */
function showUnsavedModal() {
  return new Promise(resolve => {
    elModalMsg.textContent = `„${state.openPath}" hat ungespeicherte Änderungen.`;
    elModalInputWrap.classList.add('hidden');

    // Buttons temporär ersetzen
    elModalButtons.innerHTML = '';
    const btnSave    = document.createElement('button');
    const btnDiscard = document.createElement('button');
    const btnCancel  = document.createElement('button');

    btnSave.textContent    = 'Speichern';
    btnDiscard.textContent = 'Verwerfen';
    btnCancel.textContent  = 'Abbrechen';

    btnDiscard.style.background   = 'var(--red)';
    btnDiscard.style.borderColor  = 'transparent';
    btnDiscard.style.color        = '#fff';

    elModalButtons.append(btnSave, btnDiscard, btnCancel);
    elModalOverlay.classList.remove('hidden');

    const cleanup = () => {
      elModalOverlay.classList.add('hidden');
      // Buttons wiederherstellen
      elModalButtons.innerHTML = '';
      elModalButtons.appendChild(elModalConfirm);
      elModalButtons.appendChild(elModalCancel);
    };

    btnSave.onclick    = () => { cleanup(); resolve('save');    };
    btnDiscard.onclick = () => { cleanup(); resolve('discard'); };
    btnCancel.onclick  = () => { cleanup(); resolve('cancel');  };
  });
}

// ── INIT ───────────────────────────────────────────────────────────────────

/** Initialisiert die Anwendung. */
async function init() {
  // console.log('[init] Start');
  await initDB();
  // console.log('[init] DB bereit');
  await loadTree();
  // console.log('[init] Baum geladen');
  await restoreSession();
  autoCheckWorkDir();  // Nach Baum-Render und Session-Restore

  // Arbeitsverzeichnis im Baum aufklappen
  if (state.workDir) {
    const parts = state.workDir.split('/').filter(Boolean);
    const toOpen = new Set();
    let cur = '';
    for (const p of parts) {
      cur = cur ? cur + '/' + p : p;
      toOpen.add(cur);
    }
    elTree._savedOpenPaths = toOpen;
    renderTree(treeData, elTree, 0);
  }

  // console.log('[init] Session wiederhergestellt');
  if (window.aiUpdateContext) window.aiUpdateContext();
  // console.log('[init] Fertig');
}

init();

// ── UNGESPEICHERTE ÄNDERUNGEN BEIM SCHLIESSEN ──────────────────────────────

window.addEventListener('beforeunload', e => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';   // Pflicht für Chrome/Chromium
  }
});