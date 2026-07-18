/**
 * @fileoverview ai-diff.js — KI-Schnittstellen, Token-Zähler, Diff-Berechnung
 * Zuständig für: KI-API-Kommunikation (Claude, DeepSeek), Token-Limit-Prüfung,
 * Client-seitiges Diff via diff-match-patch, Diff-Ansicht, Bestätigung/Ablehnung.
 *
 * Voraussetzung: diff-match-patch via CDN geladen (window.diff_match_patch).
 * CDN: https://cdnjs.cloudflare.com/ajax/libs/diff-match-patch/20121119/diff-match-patch.js
 */

'use strict';

// ── KONFIGURATION ──────────────────────────────────────────────────────────

/** @const {number} Token-Schätzung: Zeichen pro Token */
const CHARS_PER_TOKEN = 4;

/** @const {number} Maximale Token-Anzahl für KI-Kontext */
const TOKEN_LIMIT = 80000;

// API-Schlüssel werden serverseitig in proxy.php verwaltet

// ── KONTEXT-CACHE & MUTEX ──────────────────────────────────────────────────
/** Laufender buildContext()-Promise — verhindert parallele Fetch-Batches */
let _buildContextPromise = null;
/** Letzter gebauter Kontext — sendPrompt() nutzt diesen statt neu zu fetchen */
let _cachedContext = null;

/**
 * Baut den Kontext — mit Mutex: parallele Aufrufe warten auf denselben Promise.
 */
async function buildContextOnce() {
  if (_buildContextPromise) return _buildContextPromise;
  _buildContextPromise = buildContext().then(result => {
    _cachedContext = result;
    _buildContextPromise = null;
    return result;
  }).catch(err => {
    _buildContextPromise = null;
    throw err;
  });
  return _buildContextPromise;
}

// ── DOM-REFERENZEN ─────────────────────────────────────────────────────────

const elAiModel        = document.getElementById('ai-model');
const elAiModelLabel   = document.getElementById('ai-model-label');
const elAiFileList     = document.getElementById('ai-file-list');
const elAiTokenCount   = document.getElementById('ai-token-count');
const elAiContextChanged = document.getElementById('ai-context-changed');
const elAiMessages     = document.getElementById('ai-messages');
const elAiInput        = document.getElementById('ai-input');
const elBtnAiSend      = document.getElementById('btn-ai-send');
const elDiffFilename   = document.getElementById('diff-filename');
const elDiffContent    = document.getElementById('diff-content');
const elBtnDiffAccept  = document.getElementById('btn-diff-accept');
const elBtnDiffReject  = document.getElementById('btn-diff-reject');

// ── KONTEXT-AUFBAU ─────────────────────────────────────────────────────────

/**
 * Sammelt den Dateiinhalt aller ausgewählten Dateien mit entsprechender Berechtigung.
 * @returns {Promise<{files: Array<{path:string, content:string}>, tokens: number}>}
 */
async function buildContext() {
  const paths = window.state?.checkedPaths || [];
  const files  = [];
  let   chars  = 0;
  let   loaded = 0;

  for (const path of paths) {
    if (!path || path === '') continue;
    loaded++;
    // Status direkt updaten
    const st = document.getElementById('status-text');
    const sb = document.getElementById('statusbar');
    if (st) st.textContent = `Kontext wird geladen … ${loaded}/${paths.length}`;
    if (sb) sb.className = 'info';
    console.log('[ai-diff] read:', path);
    try {
      const res  = await fetch('api.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'read', path }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.content !== undefined) {
        files.push({ path, content: json.content || '' });
        chars += (json.content || '').length;
      }
    } catch (_) { /* Datei nicht lesbar — überspringen */ }
  }

  if (paths.length > 0) showStatus(`Kontext geladen — ${loaded} Dateien`, 'ok');

  return { files, tokens: Math.ceil(chars / CHARS_PER_TOKEN) };
}

/**
 * Aktualisiert die Kontextanzeige im rechten Panel.
 * Wird auch von app.js aufgerufen (window.aiUpdateContext).
 */
async function updateContext() {
  elAiModelLabel.textContent = elAiModel.options[elAiModel.selectedIndex].text;

  // Arbeitsverzeichnis anzeigen
  const workDir = window.state ? window.state.workDir : '';
  const elWorkdir = document.getElementById('ai-workdir');
  if (elWorkdir) elWorkdir.textContent = '📁 ' + (workDir ? '/' + workDir : '/');

  const { files, tokens } = await buildContextOnce();

  // Dateiliste
  elAiFileList.innerHTML = '';
  files.forEach(f => {
    const inWorkDir = workDir !== '' && (f.path.startsWith(workDir + '/') || f.path === workDir);
    const perm = inWorkDir ? '(w)' : '(r)';
    const line = document.createElement('div');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = f.path;
    const permSpan = document.createElement('span');
    permSpan.textContent = ' ' + perm;
    permSpan.style.color = inWorkDir ? '#7ec8a0' : '#7aaed6';
    permSpan.style.fontSize = '0.85em';
    line.appendChild(nameSpan);
    line.appendChild(permSpan);
    elAiFileList.appendChild(line);
  });
  if (files.length === 0) elAiFileList.textContent = '(keine Dateien ausgewählt)';

  // Token-Zähler
  const overLimit = tokens > TOKEN_LIMIT;
  elAiTokenCount.textContent = `~${tokens.toLocaleString('de-DE')} Token`;
  elAiTokenCount.classList.toggle('warn', overLimit);
  elBtnAiSend.disabled = overLimit || files.length === 0;

  if (overLimit) {
    showStatus('Kontext zu groß — Auswahl reduzieren', 'error', true);
  }
}

window.aiUpdateContext = updateContext;

/** Cache invalidieren — aufzurufen wenn sich Dateiauswahl ändert */
function invalidateContextCache() { _cachedContext = null; }
window.invalidateContextCache = invalidateContextCache;

/** @type {Array<{role:string, content:string}>} Gesprächshistorie (max. 10 Nachrichten) */
const chatHistory = [];
const HISTORY_LIMIT = 10;

document.getElementById('btn-clear-chat').addEventListener('click', () => {
  elAiMessages.innerHTML = '';
  chatHistory.length = 0;
});

/** Leert die Gesprächshistorie (z.B. bei Arbeitsverzeichnis-Wechsel). */
function clearChatHistory() {
  chatHistory.length = 0;
}
window.clearChatHistory = clearChatHistory;

elAiModel.addEventListener('change', () => {
  updateContext();
  // Modellwahl in IndexedDB persistieren (über app.js persistSession)
  if (window.persistSession) window.persistSession();
  // Kontext-Änderungshinweis zurücksetzen wenn Modell gewechselt
  elAiContextChanged.classList.add('hidden');
});

// ── NACHRICHT SENDEN ───────────────────────────────────────────────────────

elBtnAiSend.addEventListener('click', sendPrompt);
elAiInput.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') sendPrompt();
});

/** Sendet den Prompt an die KI und verarbeitet die Antwort. */
async function sendPrompt() {
  const prompt = elAiInput.value.trim();
  if (!prompt) return;

  elAiInput.value = '';
  elBtnAiSend.disabled = true;
  elAiContextChanged.classList.add('hidden');

  const { files } = _cachedContext || await buildContextOnce();
  const writableFiles = files
    .filter(f => {
      const workDir = window.state ? window.state.workDir : '';
      return workDir === '' || f.path.startsWith(workDir + '/') || f.path === workDir;
    })
    .map(f => f.path);
  const systemPrompt = buildSystemPrompt(files);
  const userPrompt = writableFiles.length > 0
    ? prompt + '\n\n[WICHTIG: Änderungen NUR mit "// FILE: <pfad>" markieren, nicht mit "# FILE:"]'
    : prompt;

  appendMessage(prompt, 'user');
  chatHistory.push({ role: 'user', content: userPrompt });
  showStatus('KI arbeitet …', 'info', true);

  try {
    const response = await callAI(systemPrompt, chatHistory);

    chatHistory.push({ role: 'assistant', content: response });
    while (chatHistory.length > HISTORY_LIMIT) chatHistory.shift();

    // Bei Claude: appendMessage wurde bereits in callClaude aufgerufen (Streaming)
    // Bei OpenAI/DeepSeek: hier appenden
    const model = elAiModel.value;
    if (!model.startsWith('claude')) appendMessage(response, 'ai');
    showStatus('KI fertig', 'ok');

    // Diff-Extraktion: Suche nach Codeblöcken mit Dateipfad-Hinweisen
    processDiffs(response, files);
  } catch (e) {
    showStatus('KI-Fehler: ' + e.message, 'error', true);
    appendMessage('Fehler: ' + e.message, 'ai');
  } finally {
    elBtnAiSend.disabled = false;
  }
}

/**
 * Baut den System-Prompt mit dem aktuellen Dateikontext auf.
 * @param {Array<{path:string, content:string}>} files - Dateien im Kontext
 * @returns {string}
 */
function buildSystemPrompt(files) {
  const workDir = window.state ? window.state.workDir : '';
  const modelId = document.getElementById('ai-model')?.value || 'unbekannt';
  let sys = `Du bist ein Code-Assistent. Du wirst als Modell "${modelId}" über proxy.php angesprochen. Wenn du nach deiner Identität oder deinem Modell gefragt wirst, antworte immer mit dem exakten Modell-String: "${modelId}".\n\n`;
  sys += workDir
    ? `Dein Arbeitsverzeichnis ist "${workDir}/". Neue Dateien und Unterverzeichnisse ohne absoluten Pfad legst du dort ab. Im Arbeitsverzeichnis darfst du Dateien lesen, ändern und neu anlegen.\n\n`
    : `Kein Arbeitsverzeichnis gesetzt. Du darfst nur Dateien ändern die explizit im Kontext markiert sind.\n\n`;
  sys += 'Der Nutzer arbeitet an folgenden Dateien:\n\n';
  files.forEach(f => {
    sys += `=== ${f.path} ===\n${f.content}\n\n`;
  });
  const writableFiles = files
    .filter(f => {
      const workDir = window.state ? window.state.workDir : '';
      return workDir === '' || f.path.startsWith(workDir + '/') || f.path === workDir;
    })
    .map(f => f.path);

  sys += 'WICHTIGE REGEL: Wenn du Code änderst oder neue Dateien erstellst, MUSST du IMMER das Format "// FILE: <pfad>" direkt vor dem Code-Block verwenden. NIEMALS Code ohne diesen Marker liefern. NIEMALS nach Erlaubnis fragen — führe Änderungen direkt aus. Du darfst Dateien NUR ändern oder neu anlegen — NIEMALS löschen, umbenennen oder Verzeichnisse entfernen. NIEMALS leere Code-Blöcke liefern. Beispiel:\n\n// FILE: meinordner/datei.php\n```php\n<?php echo "hallo"; ?>\n```\n\n';

  if (writableFiles.length > 0) {
    sys += '\n\nSchreibzugriff erlaubt für: ' + writableFiles.join(', ');
    sys += '\nAlle anderen Dateien: nur lesen.';
    sys += '\nNeue Dateien und Unterverzeichnisse im Arbeitsverzeichnis darf die KI anlegen.';
  } else {
    sys += '\n\nNur Lesekontext — keine Änderungsvorschläge, nur Erklärungen.';
  }
  return sys;
}

/**
 * Ruft die KI-API auf.
 * @param {string} system    - System-Prompt
 * @param {Array}  messages  - Gesprächshistorie [{role, content}]
 * @returns {Promise<string>}
 */
async function callAI(system, messages) {
  const model = elAiModel.value;
  const provider = model.startsWith('claude') ? 'claude'
                 : model.startsWith('gpt') ? 'openai'
                 : 'deepseek';
  if (provider === 'claude') return callClaude(system, messages, model);
  if (provider === 'openai') return callOpenAI(system, messages, model);
  return callDeepSeek(system, messages, model);
}

/**
 * Claude API-Aufruf.
 * @param {string} system
 * @param {Array}  messages
 * @param {string} model
 * @returns {Promise<string>}
 */
async function callClaude(system, messages, model) {
  const res = await fetch('proxy.php', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:   'claude-stream',
      payload: { model, max_tokens: 4096, system, messages },
    }),
  });
  if (!res.ok) throw new Error(`Claude API: HTTP ${res.status}`);

  // SSE-Stream lesen und token-by-token in den Chat schreiben
  const msgEl = appendMessage('', 'ai');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // letztes unvollständiges Element zurückhalten
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') break;
      const json = JSON.parse(payload);
      if (json.error) throw new Error(json.error);
      if (json.t) {
        fullText += json.t;
        msgEl.textContent = fullText;
        elAiMessages.scrollTop = elAiMessages.scrollHeight;
      }
    }
  }
  return fullText;
}

/**
 * OpenAI API-Aufruf.
 * @param {string} system
 * @param {Array}  messages
 * @param {string} model
 * @returns {Promise<string>}
 */
async function callOpenAI(system, messages, model) {
  const res = await fetch('proxy.php', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:   'openai',
      payload: {
        model,
        messages: [{ role: 'system', content: system }, ...messages],
      },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API: HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * DeepSeek API-Aufruf.
 * @param {string} system
 * @param {Array}  messages
 * @param {string} model
 * @returns {Promise<string>}
 */
async function callDeepSeek(system, messages, model) {
  const res = await fetch('proxy.php', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:   'deepseek',         // Provider-Kennung für proxy.php
      payload: {
        model,
        messages: [{ role: 'system', content: system }, ...messages],
      },
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek API: HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── DIFF-VERARBEITUNG ──────────────────────────────────────────────────────

/** @type {{path:string, original:string, proposed:string}|null} Aktueller Diff */
let pendingDiff = null;

/** @type {Array<{path:string, original:string|null, proposed:string}>} Diff-Queue */
const diffQueue = [];

/**
 * Sucht in der KI-Antwort nach Codeblöcken und sammelt alle Diffs in der Queue.
 * @param {string} response - KI-Antwort
 * @param {Array}  files    - Dateien im Kontext
 */
function processDiffs(response, files) {
  const pattern = /(?:\/\/|#) FILE: ([^\n]+)\n```(?:\w+)?\n([\s\S]*?)```/g;
  let match;

  while ((match = pattern.exec(response)) !== null) {
    const proposedPath    = match[1].trim();
    const proposedContent = match[2];
    const original        = files.find(f => f.path === proposedPath);

    if (!proposedContent || proposedContent.trim() === '') continue;

    const isNew     = !original;
    const workDir   = window.state ? window.state.workDir : '';
    const inWorkDir = workDir !== '' && (proposedPath.startsWith(workDir + '/') || proposedPath === workDir);
    const isChecked = window.state ? window.state.checkedPaths.includes(proposedPath) : false;
    console.log('[diff]', proposedPath, { isNew, inWorkDir, isChecked, workDir });

    if (!isNew && !inWorkDir && !isChecked) continue;

    diffQueue.push({ path: proposedPath, original: original ? original.content : null, proposed: proposedContent });
  }

  showNextDiff();
}

/** Zeigt den nächsten Diff aus der Queue. */
function showNextDiff() {
  if (diffQueue.length === 0) return;
  const diff = diffQueue[0];
  showDiff(diff.path, diff.original, diff.proposed);
}

/**
 * Zeigt die Diff-Ansicht für einen KI-Vorschlag.
 * @param {string}      path            - Dateipfad
 * @param {string|null} originalContent - Ursprünglicher Inhalt (null = neue Datei)
 * @param {string}      proposedContent - Vorgeschlagener Inhalt
 */
function showDiff(path, originalContent, proposedContent) {
  pendingDiff = { path, original: originalContent || '', proposed: proposedContent };

  const remaining = diffQueue.length;
  elDiffFilename.textContent = (originalContent === null ? `Neue Datei: ${path}` : `Vorschlag: ${path}`)
    + (remaining > 1 ? ` (${remaining} ausstehend)` : '');

  elDiffContent.innerHTML = '';
  const stats = computeLineDiff(originalContent || '', proposedContent, elDiffContent);

  const statId = `diff-stat-${path.replace(/[^a-z0-9]/gi, '_')}`;
  const statEl = document.getElementById(statId);
  const statText = `+${stats.added} / -${stats.removed}`;
  if (statEl) statEl.textContent = statText;
  // Persistent im State speichern
  if (window.state) window.state.diffStats[path] = statText;

  elDiffPanel.classList.remove('hidden');
}

/**
 * Berechnet einen zeilenbasierten Diff und rendert ihn in den Container.
 * @param {string}      original  - Ursprünglicher Text
 * @param {string}      proposed  - Vorgeschlagener Text
 * @param {HTMLElement} container - Ziel-Container
 * @returns {{added:number, removed:number}}
 */
function computeLineDiff(original, proposed, container) {
  const DMP = window.diff_match_patch || window.DiffMatchPatch;
  const dmp    = new DMP();
  const diffs  = dmp.diff_main(original, proposed);
  dmp.diff_cleanupSemantic(diffs);

  let added = 0, removed = 0, lineNum = 1;

  // Zeilenweisen Diff aufbauen
  const lines = splitDiffToLines(diffs);

  lines.forEach(({ type, text }) => {
    const row = document.createElement('div');
    row.className = 'diff-line ' + (type === 1 ? 'diff-add' : type === -1 ? 'diff-del' : 'diff-ctx');

    const num  = document.createElement('span');
    num.className = 'diff-line-num';
    if (type !== -1) { num.textContent = lineNum++; }

    const code = document.createElement('span');
    code.className  = 'diff-line-code';
    code.textContent = (type === 1 ? '+ ' : type === -1 ? '- ' : '  ') + text;

    row.append(num, code);
    container.appendChild(row);

    if (type ===  1) added++;
    if (type === -1) removed++;
  });

  return { added, removed };
}

/**
 * Wandelt diff-match-patch-Diffs in zeilenweise Einträge um.
 * @param {Array} diffs - Roh-Diffs von diff-match-patch
 * @returns {Array<{type:number, text:string}>}
 */
function splitDiffToLines(diffs) {
  const result = [];
  if (!diffs || !Array.isArray(diffs)) return result;
  diffs.forEach(diff => {
    const type = diff[0];
    const text = diff[1];
    if (typeof text !== 'string') return;
    text.split('\n').forEach((line, i, arr) => {
      if (i < arr.length - 1 || line !== '') {
        result.push({ type, text: line });
      }
    });
  });
  return result;
}

// ── DIFF BESTÄTIGEN / ABLEHNEN ─────────────────────────────────────────────

elBtnDiffAccept.addEventListener('click', async () => {
  if (!pendingDiff) return;
  try {
    console.log('[ai-diff] write:', pendingDiff.path);
    await fetch('api.php', {      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'write', path: pendingDiff.path, content: pendingDiff.proposed }),
    });

    // Editor aktualisieren falls die Datei gerade offen ist
    if (window.state && window.state.openPath === pendingDiff.path) {
      const editor = document.getElementById('editor');
      editor.value = pendingDiff.proposed;
      window.state.openContent = pendingDiff.proposed;
      window.state.dirty = false;
      delete window.state.fileCache[pendingDiff.path];
      document.getElementById('btn-save').disabled = true;
      if (window.updateLineNumbers) window.updateLineNumbers();
    }

    // Neue Datei oder gecachten Stand aktualisieren
    if (pendingDiff.original === '') {
      if (window.loadTree) await window.loadTree();
      if (typeof notifyAiFileChanged === 'function') notifyAiFileChanged();
    }

    showStatus(`Gespeichert: ${pendingDiff.path}`, 'ok');
    // Diff-Stat im Baum löschen
    if (window.state) delete window.state.diffStats[pendingDiff.path];
    const statEl2 = document.getElementById(`diff-stat-${pendingDiff.path.replace(/[^a-z0-9]/gi, '_')}`);
    if (statEl2) statEl2.textContent = '';
  } catch (e) {
    showStatus('Fehler beim Speichern: ' + e.message, 'error', true);
  }
  closeDiff();
});

elBtnDiffReject.addEventListener('click', () => {
  // Diff-Stat im Baum löschen
  if (pendingDiff) {
    if (window.state) delete window.state.diffStats[pendingDiff.path];
    const statEl = document.getElementById(`diff-stat-${pendingDiff.path.replace(/[^a-z0-9]/gi, '_')}`);
    if (statEl) statEl.textContent = '';
  }
  closeDiff();
  showStatus('Vorschlag verworfen', 'info');
});

/** Schließt den aktuellen Diff, entfernt ihn aus der Queue und zeigt den nächsten. */
function closeDiff() {
  pendingDiff = null;
  diffQueue.shift(); // Aktuellen Eintrag entfernen
  elDiffContent.innerHTML = '';

  if (diffQueue.length > 0) {
    // Nächsten Diff anzeigen
    showNextDiff();
  } else {
    elDiffPanel.classList.add('hidden');
  }
}

// ── NACHRICHTEN ────────────────────────────────────────────────────────────

/**
 * Fügt eine Nachricht in den KI-Chat ein.
 * @param {string} text         - Nachrichtentext
 * @param {'user'|'ai'} sender  - Absender
 */
function appendMessage(text, sender) {
  const msg = document.createElement('div');
  msg.className = `ai-msg ai-msg-${sender}`;
  msg.textContent = text;
  elAiMessages.appendChild(msg);
  elAiMessages.scrollTop = elAiMessages.scrollHeight;
  return msg;
}

// ── INIT ───────────────────────────────────────────────────────────────────
// updateContext wird von app.js nach init() aufgerufen via window.aiUpdateContext

// ── API-GUTHABEN ───────────────────────────────────────────────────────────

const elAiBalance = document.getElementById('ai-balance');

/** Gecachte Balance-Daten — kein erneuter API-Call beim Modellwechsel */
let balanceCache = null;

/**
 * Gibt den Provider des aktuell gewählten Modells zurück.
 * @returns {'claude'|'deepseek'|'openai'}
 */
function currentProvider() {
  const m = elAiModel.value;
  if (m.startsWith('deepseek')) return 'deepseek';
  if (m.startsWith('gpt'))      return 'openai';
  return 'claude';
}

/**
 * Rendert die Balance-Anzeige aus dem Cache.
 * Das zum aktiven Modell passende Guthaben wird hervorgehoben, die anderen gedimmt.
 */
function renderBalance() {
  if (!elAiBalance) return;
  if (!balanceCache) { elAiBalance.textContent = '…'; elAiBalance.className = ''; return; }
  const provider = currentProvider();
  const data = balanceCache;
  const parts = [];

  // Nur Provider mit echtem Guthaben anzeigen
  if (provider === 'deepseek') {
    if (data.deepseek?.ok) {
      const usd = parseFloat(data.deepseek.usd);
      elAiBalance.textContent = '$' + usd.toFixed(2);
      elAiBalance.className = usd <= 0 ? 'error' : usd < 1 ? 'warn' : 'ok';
    } else {
      elAiBalance.textContent = 'DS –';
      elAiBalance.className = 'error';
    }
    elAiBalance.title = 'DeepSeek-Guthaben — Klick zum Aktualisieren';
  } else {
    // Claude und OpenAI: kein Balance-Endpunkt — nichts anzeigen
    elAiBalance.textContent = '';
    elAiBalance.className = '';
    elAiBalance.title = '';
  }
}

/**
 * Lädt das API-Guthaben und rendert die Anzeige.
 */
async function loadBalance() {
  if (!elAiBalance) return;
  elAiBalance.textContent = '…';
  elAiBalance.className = '';

  try {
    const res = await fetch('proxy.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: 'balance' }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    balanceCache = await res.json();
    renderBalance();
  } catch (e) {
    elAiBalance.textContent = '?';
    elAiBalance.className   = 'error';
    elAiBalance.title       = 'Guthaben nicht abrufbar: ' + e.message;
  }
}

// Beim Laden und per Klick aktualisieren
loadBalance();
elAiBalance.addEventListener('click', loadBalance);

// Beim Modellwechsel: aus Cache rendern, sonst nachladen
elAiModel.addEventListener('change', () => balanceCache ? renderBalance() : loadBalance());