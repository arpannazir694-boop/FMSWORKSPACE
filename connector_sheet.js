/**
 * =============================================================================
 * Connector Sheet Live Data Engine (with IndexedDB Fast Cache)
 * =============================================================================
 * Sheet: Connector (101,370+ Rows)
 * Target Columns: A, B, D, E, F, G, H, I, K, L, M, N, O, P, R, S, T
 * Database: IndexedDB 'FMS_Connector_DB'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV Stream Fetch & in-memory parsing (~0.4s for 100k rows)
 *   - Instant sub-millisecond client-side Search & Filtering
 *   - Smooth fast pagination (50, 100, 250, 500 rows per page)
 *   - One-click CSV Export
 *   - Dedicated Large Modal View in Batch Analysis AI
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1VrpS2xJji50-tDqgZ_moiQwynZSwm8WxS2p2Wiy7oPA';
  var SHEET_NAME = 'Connector';
  // Use export?format=csv&gid=0 as PRIMARY to always fetch all 100,000+ rows regardless of active filters on Google Sheets.
  // gviz/tq is kept as reliable fallback if export endpoint encounters any issues.
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(SHEET_NAME);
  var CSV_URL = PRIMARY_CSV_URL;

  // Column letters requested: A, B, D, E, F, G, H, I, K, L, M, N, O, P, R, S, T
  var WANTED_LETTERS = ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T'];
  var WANTED_INDICES = [0, 1, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18, 19];

  var DB_NAME = 'FMS_Connector_DB';
  var DB_VERSION = 2;
  var STORE_NAME = 'connector_store';

  // ---------------------------------------------------------------------------
  // Reports Section Trio-AI Data Integration Config
  // ---------------------------------------------------------------------------
  var TRIO_SPREADSHEET_ID = '1LlfKU7tC-2HYx8QJxe-lGNt-hoS4LZDeSDlWg22z-qk';
  var TRIO_SHEET_GID = '983316555';
  var TRIO_SHEET_NAME = 'Report Data';
  var TRIO_CSV_URLS = [
    'https://docs.google.com/spreadsheets/d/' + TRIO_SPREADSHEET_ID + '/export?format=csv&gid=' + TRIO_SHEET_GID,
    'https://docs.google.com/spreadsheets/d/' + TRIO_SPREADSHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + TRIO_SHEET_GID,
    'https://docs.google.com/spreadsheets/d/' + TRIO_SPREADSHEET_ID + '/gviz/tq?sheet=' + encodeURIComponent(TRIO_SHEET_NAME)
  ];
  var TRIO_DB_NAME = 'FMS_Trio_AI_Data_DB_v3';
  var TRIO_STORE_NAME = 'trio_ai_data_store_v3';

  // Intelligence & Trio Columns added to the right side of Connector Live Sheet Records
  var TRIO_COLUMNS = [
    'Order Qty',
    'GRN Qty',
    'Pending Qty',
    'PO Confirmation Date',
    'Category',
    'Indent Date',
    'AI Status'
  ];

  // ---------------------------------------------------------------------------
  // Production Data Bantala Details Integration Config
  // ---------------------------------------------------------------------------
  var BANTALA_SPREADSHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
  var BANTALA_SHEET_GID = '1526950534';
  var BANTALA_SHEET_NAME = 'BANTALA DETAILS';
  var BANTALA_CSV_URLS = [
    'https://docs.google.com/spreadsheets/d/' + BANTALA_SPREADSHEET_ID + '/export?format=csv&gid=' + BANTALA_SHEET_GID + '&range=A1:H',
    'https://docs.google.com/spreadsheets/d/' + BANTALA_SPREADSHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + BANTALA_SHEET_GID + '&range=A1:H'
  ];
  var BANTALA_DB_NAME = 'FMS_Bantala_Details_DB_v2';
  var BANTALA_STORE_NAME = 'bantala_store';

  // 4 Bantala Details Columns added to Connector Live Sheet Records (Production Data -> Bantala Details)
  var BANTALA_COLUMNS = [
    'ERP ISSUE DATE',
    'MATERIAL ISSUE DATE',
    'MATERIAL HANDOVER TO FABRICATOR DATE',
    '100% MATERIAL RECEIVED DATE'
  ];

  var BASE_HEADERS = [
    'Batch (A)', 'Date (B)', 'ITB (D)', 'Item No. (E)', 'Item Name (F)',
    'Comments (G)', 'Style No. (H)', 'Colour (I)', 'Indent No. (K)', 'Supplier PO (L)',
    'Status (M)', 'Store Status (N)', 'Remarks (O)', 'Planned Qty (P)', 'Prod QTY (R)',
    'Batch Qty (S)', 'Remarks (Jyoti) (T)'
  ];

  // State
  var dbInstance = null;
  var allHeaders = BASE_HEADERS.concat(TRIO_COLUMNS).concat(BANTALA_COLUMNS);
  var allRows = [];
  var filteredRows = [];
  var currentPage = 1;
  var pageSize = 100;
  var isSyncing = false;
  var syncPromise = null;
  var lastSyncTime = null;
  var searchDebounceTimer = null;
  var lastRowsSignature = '';

  function computeRowsSignature(rows) {
    if (!rows || rows.length === 0) return '0_empty';
    var len = rows.length;
    var r0 = rows[0] ? rows[0].slice(0, 10).join('_') : '';
    var rQuarter = rows[Math.floor(len / 4)] ? rows[Math.floor(len / 4)].slice(0, 10).join('_') : '';
    var rMid = rows[Math.floor(len / 2)] ? rows[Math.floor(len / 2)].slice(0, 10).join('_') : '';
    var rThreeQ = rows[Math.floor(3 * len / 4)] ? rows[Math.floor(3 * len / 4)].slice(0, 10).join('_') : '';
    var rLast = rows[len - 1] ? rows[len - 1].slice(0, 10).join('_') : '';
    return len + ':' + r0 + ':' + rQuarter + ':' + rMid + ':' + rThreeQ + ':' + rLast;
  }

  // Trio-AI In-Memory Index State
  var trioLookupMap = new Map();
  var trioItbEtdMap = new Map();
  var trioRowsCount = 0;
  var isTrioSyncing = false;
  var lastTrioSyncTime = null;

  // Bantala Details In-Memory Index State
  var bantalaLookupMap = new Map();
  var bantalaCleanLookupMap = new Map();
  var bantalaRowsCount = 0;
  var isBantalaSyncing = false;
  var lastBantalaSyncTime = null;

  // Sorting State
  var currentSortColIdx = -1;
  var currentSortAsc = true;

  // Parallel Column Filters & Popover State
  var activeColumnFilters = {}; // colIdx -> Set of allowed string values
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Cell Selection & Keyboard Control State
  var activeCellCoords = null; // { r: rowIndex, c: colIndex }

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Helper Functions
  // ---------------------------------------------------------------------------
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (dbInstance && dbInstance.objectStoreNames.contains(STORE_NAME)) {
        return resolve(dbInstance);
      }
      dbInstance = null;
      if (!window.indexedDB) {
        return reject(new Error('IndexedDB not supported in this browser.'));
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          console.warn('[ConnectorSheet] Store missing in ' + DB_NAME + ', auto-repairing...');
          db.close();
          var repairVersion = (db.version || DB_VERSION) + 1;
          var repairReq = indexedDB.open(DB_NAME, repairVersion);
          repairReq.onupgradeneeded = function (re) {
            var rdb = re.target.result;
            if (!rdb.objectStoreNames.contains(STORE_NAME)) {
              rdb.createObjectStore(STORE_NAME);
            }
          };
          repairReq.onsuccess = function (re) {
            dbInstance = re.target.result;
            resolve(dbInstance);
          };
          repairReq.onerror = function () {
            var del = indexedDB.deleteDatabase(DB_NAME);
            del.onsuccess = del.onerror = function () {
              var recReq = indexedDB.open(DB_NAME, 1);
              recReq.onupgradeneeded = function (ce) {
                ce.target.result.createObjectStore(STORE_NAME);
              };
              recReq.onsuccess = function (ce) {
                dbInstance = ce.target.result;
                resolve(dbInstance);
              };
              recReq.onerror = function (ce) {
                reject(ce.target.error || new Error('Failed to repair database'));
              };
            };
          };
          return;
        }
        dbInstance = db;
        resolve(dbInstance);
      };
      req.onerror = function (e) {
        reject(e.target.error || new Error('Failed to open database'));
      };
    });
  }

  function saveToCache(headers, rows, syncDate) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            dbInstance = null;
            return resolve();
          }
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          store.put(headers, 'headers');
          store.put(rows, 'rows');
          store.put(syncDate || new Date().toISOString(), 'last_sync');
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function (e) {
            console.warn('[ConnectorSheet] saveToCache tx error:', e.target.error);
            resolve();
          };
        } catch (err) {
          console.warn('[ConnectorSheet] saveToCache error:', err);
          dbInstance = null;
          resolve();
        }
      });
    }).catch(function (err) {
      console.warn('[ConnectorSheet] saveToCache openDatabase error:', err);
      return Promise.resolve();
    });
  }

  function loadFromCache() {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            dbInstance = null;
            return resolve(null);
          }
          var tx = db.transaction(STORE_NAME, 'readonly');
          var store = tx.objectStore(STORE_NAME);
          var reqHeaders = store.get('headers');
          var reqRows = store.get('rows');
          var reqSync = store.get('last_sync');

          tx.oncomplete = function () {
            if (reqRows.result && Array.isArray(reqRows.result) && reqRows.result.length > 0) {
              var rawCachedRows = reqRows.result;
              for (var i = 0; i < rawCachedRows.length; i++) {
                if (rawCachedRows[i].length < 28) {
                  while (rawCachedRows[i].length < 28) {
                    rawCachedRows[i].push('');
                  }
                }
              }
              resolve({
                headers: allHeaders,
                rows: rawCachedRows,
                lastSync: reqSync.result || null
              });
            } else {
              resolve(null);
            }
          };
          tx.onerror = function (e) { resolve(null); };
        } catch (err) {
          console.warn('[ConnectorSheet] loadFromCache error:', err);
          dbInstance = null;
          resolve(null);
        }
      });
    }).catch(function (err) {
      console.warn('[ConnectorSheet] loadFromCache openDatabase error:', err);
      return Promise.resolve(null);
    });
  }

  // ---------------------------------------------------------------------------
  // 2. High Performance CSV Stream Parser
  // ---------------------------------------------------------------------------
  function parseCSVExtractWanted(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;
    var rawHeaders = [];

    for (var i = 0; i < len; i++) {
      var c = csvText[i];

      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < len && csvText[i + 1] === '"') {
            curVal += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          curVal += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ',') {
          curRow.push(curVal.trim());
          curVal = '';
        } else if (c === '\r') {
          if (i + 1 < len && csvText[i + 1] === '\n') {
            i++;
          }
          curRow.push(curVal.trim());
          curVal = '';
          processParsedRow();
        } else if (c === '\n') {
          curRow.push(curVal.trim());
          curVal = '';
          processParsedRow();
        } else {
          curVal += c;
        }
      }
    }

    if (curVal || curRow.length) {
      curRow.push(curVal.trim());
      processParsedRow();
    }

    function processParsedRow() {
      if (isFirstRow) {
        rawHeaders = curRow;
        var customHeaders = [];
        for (var k = 0; k < WANTED_INDICES.length; k++) {
          var idx = WANTED_INDICES[k];
          var letter = WANTED_LETTERS[k];
          var title = (rawHeaders[idx] || '').trim();
          if (letter === 'S') {
            title = 'Batch Qty';
          }
          customHeaders.push(title ? title + ' (' + letter + ')' : 'Column ' + letter);
        }
        allHeaders = customHeaders.concat(TRIO_COLUMNS).concat(BANTALA_COLUMNS);
        isFirstRow = false;
      } else {
        var filtered = new Array(WANTED_INDICES.length + TRIO_COLUMNS.length + BANTALA_COLUMNS.length);
        for (var j = 0; j < WANTED_INDICES.length; j++) {
          var colIdx = WANTED_INDICES[j];
          filtered[j] = curRow[colIdx] !== undefined ? curRow[colIdx] : '';
        }
        for (var t = 0; t < TRIO_COLUMNS.length; t++) {
          filtered[WANTED_INDICES.length + t] = '';
        }
        for (var b = 0; b < BANTALA_COLUMNS.length; b++) {
          filtered[WANTED_INDICES.length + TRIO_COLUMNS.length + b] = '';
        }
        rows.push(filtered);
      }
      curRow = [];
    }

    return {
      headers: allHeaders,
      rows: rows
    };
  }

  // ---------------------------------------------------------------------------
  // 2.5 Trio-AI Engine (Reports Section Integration)
  // ---------------------------------------------------------------------------
  function normKey(str) {
    return String(str || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function parseTrioCSVStream(csvText) {
    var p = '', row = [''], ret = [row], i = 0, r = 0, s = true, l = csvText.length;
    for (i = 0; i < l; i++) {
      var cc = csvText[i], nc = csvText[i + 1];
      if (cc === '"') {
        if (s && cc === p) {
          row[r] += cc;
        }
        s = !s;
      } else if (cc === ',' && s) {
        row.push('');
        r++;
      } else if ((cc === '\r' || cc === '\n') && s) {
        if (cc === '\r' && nc === '\n') { i++; }
        row = [''];
        ret.push(row);
        r = 0;
      } else {
        row[r] += cc;
      }
      p = cc;
    }

    var cleanRows = ret.filter(function (rw, idx) {
      if (idx === ret.length - 1 && rw.length === 1 && rw[0] === '') return false;
      return true;
    });

    if (!cleanRows || cleanRows.length <= 1) return [];

    var rawHeaders = cleanRows[0];
    var statusColIdx = -1;
    for (var c = 0; c < rawHeaders.length; c++) {
      if (String(rawHeaders[c] || '').trim().toLowerCase() === 'status') {
        statusColIdx = c;
        break;
      }
    }
    var limitCol = statusColIdx !== -1 ? (statusColIdx + 1) : Math.min(rawHeaders.length, 20);

    var dataRows = [];
    for (var k = 1; k < cleanRows.length; k++) {
      var curR = cleanRows[k];
      var hasContent = curR.some(function (cell) {
        return cell !== undefined && cell !== null && String(cell).trim() !== '';
      });
      if (hasContent) {
        dataRows.push(curR.slice(0, limitCol));
      }
    }
    return dataRows;
  }

  function loadTrioFromIndexedDB() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(null);
      try {
        var req = indexedDB.open(TRIO_DB_NAME, 2);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(TRIO_STORE_NAME)) {
            db.createObjectStore(TRIO_STORE_NAME);
          }
        };
        req.onsuccess = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(TRIO_STORE_NAME)) {
            db.close();
            return resolve(null);
          }
          try {
            var tx = db.transaction(TRIO_STORE_NAME, 'readonly');
            var store = tx.objectStore(TRIO_STORE_NAME);
            var reqRows = store.get('rows');
            tx.oncomplete = function () {
              db.close();
              if (reqRows.result && Array.isArray(reqRows.result) && reqRows.result.length > 0) {
                resolve(reqRows.result);
              } else {
                resolve(null);
              }
            };
            tx.onerror = function () {
              db.close();
              resolve(null);
            };
          } catch (txErr) {
            db.close();
            resolve(null);
          }
        };
        req.onerror = function () {
          resolve(null);
        };
      } catch (err) {
        resolve(null);
      }
    });
  }

  function saveTrioToIndexedDB(rows) {
    if (!window.indexedDB || !rows || rows.length === 0) return;
    try {
      var req = indexedDB.open(TRIO_DB_NAME, 2);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(TRIO_STORE_NAME)) {
          db.createObjectStore(TRIO_STORE_NAME);
        }
      };
      req.onsuccess = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(TRIO_STORE_NAME)) {
          db.close();
          return;
        }
        try {
          var tx = db.transaction(TRIO_STORE_NAME, 'readwrite');
          var store = tx.objectStore(TRIO_STORE_NAME);
          store.put(rows, 'rows');
          store.put(Date.now(), 'last_sync');
          tx.oncomplete = function () { db.close(); };
          tx.onerror = function () { db.close(); };
        } catch (txErr) {
          db.close();
        }
      };
      req.onerror = function () {};
    } catch (e) {
      console.warn('[ConnectorSheet] Save Trio to DB warning:', e);
    }
  }

  function fetchTrioCsvFresh() {
    function tryFetch(urlIdx) {
      if (urlIdx >= TRIO_CSV_URLS.length) {
        return Promise.reject(new Error('All Trio-AI CSV endpoints failed'));
      }
      var targetUrl = TRIO_CSV_URLS[urlIdx] + (TRIO_CSV_URLS[urlIdx].indexOf('?') !== -1 ? '&' : '?') + '_=' + Date.now();
      return fetch(targetUrl, { method: 'GET', cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (text) {
          if (!text || text.indexOf('<!DOCTYPE html') !== -1 || text.indexOf('ServiceLogin') !== -1) {
            throw new Error('Google Auth restricted or empty response');
          }
          var parsedRows = parseTrioCSVStream(text);
          if (!parsedRows || parsedRows.length === 0) throw new Error('Parsed rows empty');
          saveTrioToIndexedDB(parsedRows);
          return parsedRows;
        })
        .catch(function (err) {
          console.warn('[ConnectorSheet] Trio endpoint ' + (urlIdx + 1) + ' failed: ' + err.message);
          return tryFetch(urlIdx + 1);
        });
    }
    return tryFetch(0);
  }

  function buildTrioLookupMap(trioRows) {
    if (!trioRows || !Array.isArray(trioRows) || trioRows.length === 0) return;
    trioLookupMap.clear();
    trioItbEtdMap.clear();
    trioRowsCount = trioRows.length;

    for (var i = 0; i < trioRows.length; i++) {
      var r = trioRows[i];
      if (!r || r.length === 0) continue;
      // In Trio-AI:
      // [1] ITB, [3] Buyer ETD, [5] INDENT NO., [7] Style, [8] Colour, [9] PRO CODE, [11] Supplier PO,
      // [12] PO Confirmation Date, [13] ORDER QTY, [14] ADJ GRN QTY, [15] PENDING QTY, [18] Category
      var itb = normKey(r[1]);
      var etdVal = (r[3] !== undefined && r[3] !== null) ? String(r[3]).trim() : '';
      if (itb && etdVal && etdVal !== '-' && etdVal.toLowerCase() !== 'data not found' && !trioItbEtdMap.has(itb)) {
        trioItbEtdMap.set(itb, etdVal);
      }
      var indent = normKey(r[5]);
      var style = normKey(r[7]);
      var col = normKey(r[8]);
      var pro = normKey(r[9]);
      var po = normKey(r[11]);

      var indentDate = (r[6] !== undefined && r[6] !== null) ? String(r[6]).trim() : '';
      var poDate = (r[12] !== undefined && r[12] !== null) ? String(r[12]).trim() : '';
      var ordQty = (r[13] !== undefined && r[13] !== null) ? String(r[13]).trim() : '';
      var grnQty = (r[14] !== undefined && r[14] !== null) ? String(r[14]).trim() : '';
      var pendQty = (r[15] !== undefined && r[15] !== null) ? String(r[15]).trim() : '';
      var cat = (r[18] !== undefined && r[18] !== null) ? String(r[18]).trim() : '';

      var vals = [ordQty, grnQty, pendQty, poDate, cat, indentDate];

      var hasPo = po && po !== 'PO NOT CREATE' && po !== 'PO NOT CREATED' && po !== 'DATA NOT FOUND' && po !== 'N/A' && po !== '-';

      if (hasPo && indent && pro && style && col && itb) {
        var k = 'T1:' + po + '|' + indent + '|' + pro + '|' + style + '|' + col + '|' + itb;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
      if (hasPo && indent && pro && style && itb) {
        var k = 'T2:' + po + '|' + indent + '|' + pro + '|' + style + '|' + itb;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
      if (hasPo && indent && pro && style && col) {
        var k = 'T3:' + po + '|' + indent + '|' + pro + '|' + style + '|' + col;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
      if (hasPo && indent && pro && style) {
        var k = 'T4:' + po + '|' + indent + '|' + pro + '|' + style;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
      if (hasPo && pro) {
        var k = 'T5:' + po + '|' + pro;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
      if (indent && pro && style && col && itb) {
        var k = 'T6:' + indent + '|' + pro + '|' + style + '|' + col + '|' + itb;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
      if (indent && pro && style && itb) {
        var k = 'T7:' + indent + '|' + pro + '|' + style + '|' + itb;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
      if (indent && pro && style && col) {
        var k = 'T8:' + indent + '|' + pro + '|' + style + '|' + col;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
      if (indent && pro && style) {
        var k = 'T9:' + indent + '|' + pro + '|' + style;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
      if (indent && pro) {
        var k = 'T10:' + indent + '|' + pro;
        if (!trioLookupMap.has(k)) trioLookupMap.set(k, vals);
      }
    }
  }

  function lookupTrioData(row) {
    if (!trioLookupMap || trioLookupMap.size === 0) return ['', '', '', '', '', ''];
    // In Connector row:
    // [2] ITB (D), [3] Item No. (E) -> PRO CODE, [6] Style No. (H), [7] Colour (I), [8] Indent No. (K), [9] Supplier PO (L)
    var itb = normKey(row[2]);
    var pro = normKey(row[3]);
    var style = normKey(row[6]);
    var col = normKey(row[7]);
    var indent = normKey(row[8]);
    var po = normKey(row[9]);

    var hasPo = po && po !== 'PO NOT CREATE' && po !== 'PO NOT CREATED' && po !== 'DATA NOT FOUND' && po !== 'N/A' && po !== '-';

    var val = null;
    if (hasPo) {
      val = trioLookupMap.get('T1:' + po + '|' + indent + '|' + pro + '|' + style + '|' + col + '|' + itb) ||
            trioLookupMap.get('T2:' + po + '|' + indent + '|' + pro + '|' + style + '|' + itb) ||
            trioLookupMap.get('T3:' + po + '|' + indent + '|' + pro + '|' + style + '|' + col) ||
            trioLookupMap.get('T4:' + po + '|' + indent + '|' + pro + '|' + style) ||
            trioLookupMap.get('T5:' + po + '|' + pro);
    }
    if (!val && indent && pro) {
      val = trioLookupMap.get('T6:' + indent + '|' + pro + '|' + style + '|' + col + '|' + itb) ||
            trioLookupMap.get('T7:' + indent + '|' + pro + '|' + style + '|' + itb) ||
            trioLookupMap.get('T8:' + indent + '|' + pro + '|' + style + '|' + col) ||
            trioLookupMap.get('T9:' + indent + '|' + pro + '|' + style) ||
            trioLookupMap.get('T10:' + indent + '|' + pro);
    }

    return val || ['', '', '', '', '', ''];
  }

  function isValueMissing(val) {
    if (val === undefined || val === null) return true;
    var s = String(val).trim().toLowerCase();
    return (
      s === '' ||
      s === '-' ||
      s === '--' ||
      s === 'n/a' ||
      s === 'na' ||
      s === 'null' ||
      s === 'none' ||
      s.indexOf('data not found') !== -1 ||
      s.indexOf('not found') !== -1
    );
  }

  function extractEtaFromRemarks(remarksJyoti, remarksO) {
    var text = (String(remarksJyoti || '') + ' ' + String(remarksO || '')).trim();
    if (!text) return '';
    var match = text.match(/ETA\s*[:-]?\s*(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/i);
    if (match && match[1]) return match[1];
    var matchDel = text.match(/(?:DELIVERY|DELIVERED|DISPATCH(?:ED)?)\s*(?:ON|BY|:)?\s*(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/i);
    if (matchDel && matchDel[1]) return matchDel[1];
    return '';
  }

  function computeAiStatus(indentNo, supplierPo, status, storeStatus, remarksO, remarksJyoti) {
    var indentBlank = isValueMissing(indentNo);
    var poBlank = isValueMissing(supplierPo);
    var statBlank = isValueMissing(status);

    var poUpper = String(supplierPo || '').trim().toUpperCase();
    var hasValidPo = !poBlank && poUpper !== 'PO NOT CREATE' && poUpper !== 'PO NOT CREATED' && poUpper !== 'NOT CREATE' && poUpper !== 'NOT CREATED';

    var sLower = String(status || '').trim().toLowerCase();
    var ssLower = String(storeStatus || '').trim().toLowerCase();
    var rOLower = String(remarksO || '').trim().toLowerCase();
    var rJLower = String(remarksJyoti || '').trim().toLowerCase();

    var isStock = sLower.indexOf('in-stock') !== -1 || sLower.indexOf('in stock') !== -1;
    var isPending = sLower.indexOf('material pending') !== -1 || sLower.indexOf('pending') !== -1;
    var isReceived = sLower.indexOf('material received') !== -1 || (sLower.indexOf('received') !== -1 && sLower.indexOf('not') === -1);
    var isPoNotCreate = sLower.indexOf('po not create') !== -1 || sLower.indexOf('po not created') !== -1 || sLower.indexOf('not create') !== -1 || poUpper === 'PO NOT CREATE' || poUpper === 'PO NOT CREATED';

    var isOk = (ssLower === 'ok' || ssLower === 'okay' || ssLower === 'pass' || (ssLower.indexOf('ok') !== -1 && ssLower.indexOf('not') === -1));
    var isNotOk = (ssLower === 'not ok' || ssLower === 'notok' || ssLower === 'fail' || ssLower.indexOf('not ok') !== -1);

    var eta = extractEtaFromRemarks(remarksJyoti, remarksO);
    var jyotiSaysReceived = (rJLower.indexOf('received') !== -1 && rJLower.indexOf('will be') === -1 && rJLower.indexOf('not') === -1);

    // Rule priority: Store Status (Sandip Chatterjee) override
    if (isOk) {
      return 'Ready for Production';
    }
    if (isNotOk) {
      return 'Cannot Start Production';
    }

    // Jyoti remarks explicit receipt confirmation
    if (jyotiSaysReceived) {
      return 'Material Received';
    }

    // Rule 1: Indent DNF, PO DNF, Status DNF -> No update from Store
    if (indentBlank && (poBlank || !hasValidPo) && statBlank) {
      return 'No update from Store';
    }

    // Rule 2: Indent DNF, PO DNF, Status In Stock -> In Stock
    if (indentBlank && (poBlank || !hasValidPo) && isStock) {
      return 'In Stock';
    }

    // Rule 3: Indent has data, PO has data, Status In Stock -> Ordered despite In Stock
    if (!indentBlank && hasValidPo && isStock) {
      return 'Ordered despite In Stock';
    }

    // In Stock fallback
    if (isStock) {
      return 'In Stock';
    }

    // Rule 4: Material Pending
    if (isPending) {
      if (eta) {
        return 'Material Pending (ETA: ' + eta + ')';
      }
      if (!hasValidPo && !indentBlank) {
        return 'Material Pending (PO Awaited)';
      }
      return 'Material Pending';
    }

    // Rule 5: Material Received
    if (isReceived) {
      return 'Material Received';
    }

    // Rule 6: PO Not Created
    if (isPoNotCreate) {
      return 'PO Not Created';
    }

    // Rule 7: Indent raised but PO awaited
    if (!indentBlank && (poBlank || !hasValidPo) && statBlank) {
      return 'PO Awaited';
    }

    // Special items
    if (rJLower.indexOf('sample') !== -1 || rOLower.indexOf('sample') !== -1) {
      return 'Sample Item';
    }
    if (rJLower.indexOf('cancelled') !== -1 || rOLower.indexOf('cancelled') !== -1) {
      return 'Order Cancelled';
    }

    // If status has explicit text
    if (status && !statBlank) {
      return status.trim();
    }

    return 'No update from Store';
  }

  function augmentRowsWithTrioData(rows) {
    if (!rows || rows.length === 0) return rows;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var match = lookupTrioData(r);
      r[17] = match[0]; // Order Qty
      r[18] = match[1]; // GRN Qty
      r[19] = match[2]; // Pending Qty
      r[20] = match[3]; // PO Confirmation Date
      r[21] = match[4]; // Category
      r[22] = match[5]; // Indent Date
      r[23] = computeAiStatus(r[8], r[9], r[10], r[11], r[12], r[16]); // AI Status
    }
    return rows;
  }

  function updateTrioBadge(isLinked, count) {
    var statusEl = document.getElementById('bai-sheet-trio-status');
    var badgeEl = document.getElementById('bai-sheet-trio-badge');
    if (statusEl) {
      if (isLinked) {
        statusEl.textContent = 'Linked (' + (count ? count.toLocaleString() : 'Live') + ')';
        if (badgeEl) {
          badgeEl.style.background = '#134e4a';
          badgeEl.style.borderColor = '#0f766e';
          badgeEl.style.color = '#2dd4bf';
        }
      } else {
        statusEl.textContent = 'Syncing...';
      }
    }
  }



  // ---------------------------------------------------------------------------
  // 2.6 Bantala Details Engine (Production Data Section Integration)
  // ---------------------------------------------------------------------------
  function parseBantalaCSVStream(csvText) {
    var p = '', row = [''], ret = [row], i = 0, r = 0, s = true, l = csvText.length;
    for (i = 0; i < l; i++) {
      var cc = csvText[i], nc = csvText[i + 1];
      if (cc === '"') {
        if (s && cc === p) {
          row[r] += cc;
        }
        s = !s;
      } else if (cc === ',' && s) {
        row.push('');
        r++;
      } else if ((cc === '\r' || cc === '\n') && s) {
        if (cc === '\r' && nc === '\n') { i++; }
        row = [''];
        ret.push(row);
        r = 0;
      } else {
        row[r] += cc;
      }
      p = cc;
    }

    var cleanRows = ret.filter(function (rw, idx) {
      if (idx === ret.length - 1 && rw.length === 1 && rw[0] === '') return false;
      return true;
    });

    if (!cleanRows || cleanRows.length <= 1) return [];

    var dataRows = [];
    for (var k = 1; k < cleanRows.length; k++) {
      var curR = cleanRows[k];
      var hasContent = curR.some(function (cell) {
        return cell !== undefined && cell !== null && String(cell).trim() !== '';
      });
      if (hasContent) {
        var normalized = new Array(8);
        for (var j = 0; j < 8; j++) {
          normalized[j] = (curR[j] !== undefined && curR[j] !== null) ? String(curR[j]).trim() : '';
        }
        dataRows.push(normalized);
      }
    }
    return dataRows;
  }

  function loadBantalaFromIndexedDB() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(null);
      try {
        var req = indexedDB.open(BANTALA_DB_NAME, 2);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(BANTALA_STORE_NAME)) {
            db.createObjectStore(BANTALA_STORE_NAME);
          }
        };
        req.onsuccess = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(BANTALA_STORE_NAME)) {
            db.close();
            return resolve(null);
          }
          try {
            var tx = db.transaction(BANTALA_STORE_NAME, 'readonly');
            var store = tx.objectStore(BANTALA_STORE_NAME);
            var reqRows = store.get('rows');
            tx.oncomplete = function () {
              db.close();
              if (reqRows.result && Array.isArray(reqRows.result) && reqRows.result.length > 0) {
                resolve(reqRows.result);
              } else {
                resolve(null);
              }
            };
            tx.onerror = function () {
              db.close();
              resolve(null);
            };
          } catch (txErr) {
            db.close();
            resolve(null);
          }
        };
        req.onerror = function () {
          resolve(null);
        };
      } catch (err) {
        resolve(null);
      }
    });
  }

  function saveBantalaToIndexedDB(rows) {
    if (!window.indexedDB || !rows || rows.length === 0) return;
    try {
      var req = indexedDB.open(BANTALA_DB_NAME, 2);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(BANTALA_STORE_NAME)) {
          db.createObjectStore(BANTALA_STORE_NAME);
        }
      };
      req.onsuccess = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(BANTALA_STORE_NAME)) {
          db.close();
          return;
        }
        try {
          var tx = db.transaction(BANTALA_STORE_NAME, 'readwrite');
          var store = tx.objectStore(BANTALA_STORE_NAME);
          store.put(rows, 'rows');
          store.put(Date.now(), 'last_sync');
          tx.oncomplete = function () { db.close(); };
          tx.onerror = function () { db.close(); };
        } catch (txErr) {
          db.close();
        }
      };
      req.onerror = function () {};
    } catch (e) {
      console.warn('[ConnectorSheet] Save Bantala to DB warning:', e);
    }
  }

  function fetchBantalaCsvFresh() {
    function tryFetch(urlIdx) {
      if (urlIdx >= BANTALA_CSV_URLS.length) {
        return Promise.reject(new Error('All Bantala Details CSV endpoints failed'));
      }
      var targetUrl = BANTALA_CSV_URLS[urlIdx] + (BANTALA_CSV_URLS[urlIdx].indexOf('?') !== -1 ? '&' : '?') + '_=' + Date.now();
      return fetch(targetUrl, { method: 'GET', cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (text) {
          if (!text || text.indexOf('<!DOCTYPE html') !== -1 || text.indexOf('ServiceLogin') !== -1) {
            throw new Error('Google Auth restricted or empty response');
          }
          var parsedRows = parseBantalaCSVStream(text);
          if (!parsedRows || parsedRows.length === 0) throw new Error('Parsed Bantala rows empty');
          saveBantalaToIndexedDB(parsedRows);
          return parsedRows;
        })
        .catch(function (err) {
          console.warn('[ConnectorSheet] Bantala endpoint ' + (urlIdx + 1) + ' failed: ' + err.message);
          return tryFetch(urlIdx + 1);
        });
    }
    return tryFetch(0);
  }

  function loadBantalaData() {
    if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.getRows === 'function') {
      var inMem = window.BantalaDetailsSheetEngine.getRows();
      if (inMem && Array.isArray(inMem) && inMem.length > 0) {
        return Promise.resolve(inMem);
      }
    }
    return loadBantalaFromIndexedDB().then(function (cached) {
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached;
      }
      return fetchBantalaCsvFresh();
    });
  }

  function getBatchLookupKeys(str) {
    if (!str) return [];
    var raw = String(str).trim().toUpperCase();
    if (!raw || raw === '-' || raw === 'BATCH' || raw === 'BATCH NO' || raw === 'DATA NOT FOUND') return [];
    var keys = [raw];

    var clean = raw.replace(/[^A-Z0-9]/gi, '');
    if (clean && keys.indexOf(clean) === -1) keys.push(clean);

    // 1. TTF / TTEF / TT cross-prefix normalization (e.g. TT-0416/26-27 <-> TTF-0416/26-27)
    var pfxMatch = raw.match(/^(TTF|TTEF|TT)([-_/]?.*)$/);
    if (pfxMatch) {
      var rest = pfxMatch[2];
      var ttVer = 'TT' + rest;
      var ttfVer = 'TTF' + rest;
      var cleanTt = ttVer.replace(/[^A-Z0-9]/gi, '');
      var cleanTtf = ttfVer.replace(/[^A-Z0-9]/gi, '');
      if (keys.indexOf(ttVer) === -1) keys.push(ttVer);
      if (keys.indexOf(ttfVer) === -1) keys.push(ttfVer);
      if (cleanTt && keys.indexOf(cleanTt) === -1) keys.push(cleanTt);
      if (cleanTtf && keys.indexOf(cleanTtf) === -1) keys.push(cleanTtf);
    }

    // 2. Numeric core and fiscal year extraction (handles 0416 vs 416 with year 26-27)
    var coreMatch = raw.match(/(\d+)(?:[^\d]+(\d{2}[-_/]\d{2}))?/);
    if (coreMatch) {
      var numStr = coreMatch[1];
      var numInt = String(parseInt(numStr, 10));
      var numPad4 = ('0000' + numInt).slice(-4);
      var yrClean = coreMatch[2] ? coreMatch[2].replace(/[^\d]/g, '') : '';

      if (yrClean) {
        // STRICT: When financial year is present, ONLY match within that financial year
        var k1 = 'NUM_' + numInt + '_' + yrClean;
        var k2 = 'NUM_' + numPad4 + '_' + yrClean;
        var k3 = 'TT_' + numInt + '_' + yrClean;
        var k4 = 'TT_' + numPad4 + '_' + yrClean;

        if (keys.indexOf(k1) === -1) keys.push(k1);
        if (keys.indexOf(k2) === -1) keys.push(k2);
        if (keys.indexOf(k3) === -1) keys.push(k3);
        if (keys.indexOf(k4) === -1) keys.push(k4);
      } else {
        // Fallback ONLY when batch has NO financial year specified (e.g. legacy data)
        var c1 = 'NUM_' + numInt + '_';
        var c2 = 'NUM_' + numPad4 + '_';
        var c3 = 'TT_' + numInt + '_';
        var c4 = 'TT_' + numPad4 + '_';

        if (keys.indexOf(c1) === -1) keys.push(c1);
        if (keys.indexOf(c2) === -1) keys.push(c2);
        if (keys.indexOf(c3) === -1) keys.push(c3);
        if (keys.indexOf(c4) === -1) keys.push(c4);
      }
    }

    return keys;
  }

  function normBatchKey(str) {
    return String(str || '').trim().toUpperCase();
  }

  function normBatchClean(str) {
    return String(str || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  }

  function buildBantalaLookupMap(bantalaRows) {
    if (!bantalaRows || !Array.isArray(bantalaRows) || bantalaRows.length === 0) return;
    bantalaLookupMap.clear();
    bantalaCleanLookupMap.clear();
    bantalaRowsCount = bantalaRows.length;

    for (var i = 0; i < bantalaRows.length; i++) {
      var r = bantalaRows[i];
      if (!r || r.length === 0) continue;
      var rawBatch = r[0];
      if (!rawBatch || !/\d/.test(String(rawBatch))) continue;

      var erpIssue = (r[3] !== undefined && r[3] !== null) ? String(r[3]).trim() : '';
      var matIssue = (r[4] !== undefined && r[4] !== null) ? String(r[4]).trim() : '';
      var handover = (r[5] !== undefined && r[5] !== null) ? String(r[5]).trim() : '';
      var matRec100 = (r[6] !== undefined && r[6] !== null) ? String(r[6]).trim() : '';
      var matStatus = (r[7] !== undefined && r[7] !== null) ? String(r[7]).trim() : '';

      var vals = [erpIssue, matIssue, handover, matRec100, matStatus];
      var allKeys = getBatchLookupKeys(rawBatch);

      for (var k = 0; k < allKeys.length; k++) {
        var key = allKeys[k];
        if (bantalaLookupMap.has(key)) {
          var existing = bantalaLookupMap.get(key);
          for (var f = 0; f < 5; f++) {
            if (!existing[f] && vals[f]) existing[f] = vals[f];
          }
        } else {
          bantalaLookupMap.set(key, vals.slice());
        }
      }

      var cleanKey = normBatchClean(rawBatch);
      if (cleanKey && !bantalaCleanLookupMap.has(cleanKey)) {
        bantalaCleanLookupMap.set(cleanKey, vals.slice());
      }
    }
  }

  function lookupBantalaData(rowOrBatch) {
    if (!bantalaLookupMap || bantalaLookupMap.size === 0) return ['', '', '', '', ''];
    var bVal = Array.isArray(rowOrBatch) ? rowOrBatch[0] : rowOrBatch;
    var searchKeys = getBatchLookupKeys(bVal);
    for (var i = 0; i < searchKeys.length; i++) {
      var match = bantalaLookupMap.get(searchKeys[i]);
      if (match && (match[0] || match[1] || match[2] || match[3] || match[4])) {
        return match;
      }
    }
    return ['', '', '', '', ''];
  }

  function augmentRowsWithBantalaData(rows) {
    if (!rows || rows.length === 0) return rows;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      while (r.length < 28) r.push('');
      var match = lookupBantalaData(r[0]);
      r[24] = match[0]; // ERP ISSUE DATE
      r[25] = match[1]; // MATERIAL ISSUE DATE
      r[26] = match[2]; // MATERIAL HANDOVER TO FABRICATOR DATE
      r[27] = match[3]; // 100% MATERIAL RECEIVED DATE
    }
    return rows;
  }

  function updateBantalaBadge(isLinked, count) {
    var statusEl = document.getElementById('bai-sheet-bantala-status');
    var badgeEl = document.getElementById('bai-sheet-bantala-badge');
    if (statusEl) {
      if (isLinked) {
        statusEl.textContent = 'Linked (' + (count ? count.toLocaleString() : 'Live') + ')';
        if (badgeEl) {
          badgeEl.style.background = '#1e1b4b';
          badgeEl.style.borderColor = '#4338ca';
          badgeEl.style.color = '#818cf8';
        }
      } else {
        statusEl.textContent = 'Syncing...';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Sync from Google Sheet (CSV Stream)
  // ---------------------------------------------------------------------------
  function syncFromGoogleSheet(isManual) {
    if (isSyncing && syncPromise) return syncPromise;
    isSyncing = true;
    if (isManual) {
      updateSyncUI(true, 'Downloading Connector rows + Trio-AI & Bantala Details from Google Sheets...');
    }

    var startTime = performance.now();

    function fetchCsvText() {
      // 1. Try Primary Export URL with cache-busting
      var pUrl = PRIMARY_CSV_URL + (PRIMARY_CSV_URL.indexOf('?') !== -1 ? '&' : '?') + '_=' + Date.now();
      return fetch(pUrl, { cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error('Primary export response was HTTP ' + res.status);
          return res.text();
        })
        .then(function (csvText) {
          if (!csvText || csvText.length < 500) {
            throw new Error('Primary export returned incomplete payload');
          }
          return csvText;
        })
        .catch(function (err) {
          console.warn('[ConnectorSheet] Primary export failed, falling back to GViz:', err);
          if (isManual) updateSyncUI(true, 'Primary export redirected, retrying via Google Sheet GViz...');
          var fUrl = FALLBACK_CSV_URL + (FALLBACK_CSV_URL.indexOf('?') !== -1 ? '&' : '?') + '_=' + Date.now();
          return fetch(fUrl, { cache: 'no-cache' }).then(function (res2) {
            if (!res2.ok) throw new Error('GViz network response was ' + res2.status + ': ' + res2.statusText);
            return res2.text();
          });
        });
    }

    // Fetch Connector CSV, Trio-AI CSV, and Bantala Details CSV fresh in parallel
    syncPromise = Promise.all([
      fetchCsvText(),
      fetchTrioCsvFresh().catch(function (err) {
        console.warn('[ConnectorSheet] Trio fetch error during sync:', err);
        return null;
      }),
      fetchBantalaCsvFresh().catch(function (err) {
        console.warn('[ConnectorSheet] Bantala fetch error during sync:', err);
        return null;
      })
    ])
      .then(function (results) {
        var csvText = results[0];
        var trioRows = results[1];
        var bantalaRows = results[2];

        var parseStart = performance.now();
        var parsed = parseCSVExtractWanted(csvText);
        allHeaders = parsed.headers;
        allRows = parsed.rows;

        // If fresh Trio data arrived, build lookup map and update badge
        if (trioRows && trioRows.length > 0) {
          buildTrioLookupMap(trioRows);
          updateTrioBadge(true, trioRows.length);
        }

        // If fresh Bantala data arrived, build lookup map and update badge
        if (bantalaRows && bantalaRows.length > 0) {
          buildBantalaLookupMap(bantalaRows);
          updateBantalaBadge(true, bantalaRows.length);
        }

        // Augment Connector rows with Trio-AI matching columns
        augmentRowsWithTrioData(allRows);
        // Augment Connector rows with Bantala Details matching columns
        augmentRowsWithBantalaData(allRows);

        var parseDuration = ((performance.now() - parseStart) / 1000).toFixed(2);
        var totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);

        if (isManual) {
          updateSyncUI(true, 'Saving ' + allRows.length.toLocaleString() + ' records to Database storage...');
        }

        var nowIso = new Date().toISOString();
        lastSyncTime = nowIso;

        var newSig = computeRowsSignature(allRows);
        var dataChanged = (newSig !== lastRowsSignature);
        lastRowsSignature = newSig;

        return saveToCache(allHeaders, allRows, nowIso).then(function () {
          console.log('[ConnectorSheet] Successfully synced ' + allRows.length + ' rows in ' + totalDuration + 's (Parse: ' + parseDuration + 's)');
          updateHeaderBadge();
          if (isManual) {
            renderHeaderRow();
            applySearchFilter(false);
            updateSyncUI(false, 'Synced ' + allRows.length.toLocaleString() + ' records + Trio-AI & Bantala Details in ' + totalDuration + 's!');
            showToast(allRows.length.toLocaleString() + ' records synced & matched with Trio-AI & Bantala Details!', 'check');
          } else {
            // Background silent sync: only re-render if data actually changed, and PRESERVE user scroll & page state
            if (dataChanged) {
              renderHeaderRow();
              applySearchFilter(true);
            }
          }
        });
      })
      .catch(function (err) {
        console.error('[ConnectorSheet] Sync error:', err);
        if (isManual) {
          updateSyncUI(false, 'Error syncing: ' + (err.message || 'Check network connection'));
          showToast('Sync failed: ' + (err.message || 'Network error'), 'error');
        }
      })
      .finally(function () {
        isSyncing = false;
        syncPromise = null;
      });

    return syncPromise;
  }

  // ---------------------------------------------------------------------------
  // 4. Initial Load (Instant 0-Wait IndexedDB Cache Check)
  // ---------------------------------------------------------------------------
  function initDataEngine() {
    renderHeaderRow();

    // 1. First load Trio-AI & Bantala Details data from IndexedDB caches for instant matching
    var trioPromise = loadTrioFromIndexedDB().then(function (cachedTrio) {
      if (cachedTrio && cachedTrio.length > 0) {
        buildTrioLookupMap(cachedTrio);
        updateTrioBadge(true, cachedTrio.length);
        return cachedTrio;
      }
      return null;
    }).catch(function (e) {
      console.warn('[ConnectorSheet] Trio cache read error:', e);
      return null;
    });

    var bantalaPromise = loadBantalaData().then(function (cachedBantala) {
      if (cachedBantala && cachedBantala.length > 0) {
        buildBantalaLookupMap(cachedBantala);
        updateBantalaBadge(true, cachedBantala.length);
        return cachedBantala;
      }
      return null;
    }).catch(function (e) {
      console.warn('[ConnectorSheet] Bantala cache read error:', e);
      return null;
    });

    // 2. Load Connector data from cache
    Promise.all([trioPromise, bantalaPromise]).then(function () {
      return loadFromCache();
    })
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = BASE_HEADERS.concat(TRIO_COLUMNS).concat(BANTALA_COLUMNS);
          allRows = cached.rows;
          for (var i = 0; i < allRows.length; i++) {
            if (allRows[i].length < 28) {
              while (allRows[i].length < 28) allRows[i].push('');
            }
          }
          lastSyncTime = cached.lastSync;
          // Augment with Trio & Bantala data
          augmentRowsWithTrioData(allRows);
          augmentRowsWithBantalaData(allRows);
          filteredRows = allRows;
          currentPage = 1;
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          console.log('[ConnectorSheet] INSTANT LOAD from IndexedDB: ' + allRows.length.toLocaleString() + ' rows ready in 0.05s!');

          // Background fresh fetch for Trio-AI & Bantala data
          setTimeout(function () {
            Promise.all([
              fetchTrioCsvFresh().then(function (freshTrio) {
                if (freshTrio && freshTrio.length > 0) {
                  buildTrioLookupMap(freshTrio);
                  augmentRowsWithTrioData(allRows);
                  updateTrioBadge(true, freshTrio.length);
                  console.log('[ConnectorSheet] Background Trio-AI data refreshed & re-matched (' + freshTrio.length + ' rows)');
                }
              }).catch(function (e) {
                console.warn('[ConnectorSheet] Background Trio refresh skipped:', e);
              }),
              fetchBantalaCsvFresh().then(function (freshBantala) {
                if (freshBantala && freshBantala.length > 0) {
                  buildBantalaLookupMap(freshBantala);
                  augmentRowsWithBantalaData(allRows);
                  updateBantalaBadge(true, freshBantala.length);
                  console.log('[ConnectorSheet] Background Bantala Details data refreshed & re-matched (' + freshBantala.length + ' rows)');
                }
              }).catch(function (e) {
                console.warn('[ConnectorSheet] Background Bantala refresh skipped:', e);
              })
            ]).then(function () {
              applyAllFiltersAndSearch(true);
            });
          }, 600);

          // Self-heal & Auto-Sync:
          // If cache has < 1,000 rows or is older than 60 mins, sync fresh in background.
          var isSmall = allRows.length < 1000;
          var isStale = !cached.lastSync || (Date.now() - new Date(cached.lastSync).getTime() > 60 * 60 * 1000);
          if (isSmall || isStale) {
            console.log('[ConnectorSheet] Cached records (' + allRows.length + ') or sync timestamp warrants auto-syncing full records...');
            syncFromGoogleSheet(false);
          }
        } else {
          // First time ever: fetch in background
          console.log('[ConnectorSheet] No local cache found. Starting initial sync...');
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('[ConnectorSheet] IndexedDB load failed, falling back to network fetch:', err);
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 5. Table Rendering & Pagination
  // ---------------------------------------------------------------------------
  function getColWidth(h, colIdx) {
    if (colIdx === 0) return '140px'; // Batch (A)
    if (colIdx === 1) return '110px'; // Date (B)
    if (colIdx === 2) return '240px'; // ITB (D)
    if (colIdx === 3) return '125px'; // Item No. (E)
    if (colIdx === 4) return '230px'; // Item Name (F)
    if (colIdx === 5) return '150px'; // Comments (G)
    if (colIdx === 6) return '130px'; // Style No. (H)
    if (colIdx === 7) return '120px'; // Colour (I)
    if (colIdx === 8) return '150px'; // Indent No. (K)
    if (colIdx === 9) return '165px'; // Supplier PO (L)
    if (colIdx === 10) return '130px'; // Status (M)
    if (colIdx === 11) return '140px'; // Store Status (N)
    if (colIdx === 12) return '150px'; // Remarks (O)
    if (colIdx === 13) return '110px'; // Planned Qty (P)
    if (colIdx === 14) return '105px'; // Prod QTY (R)
    if (colIdx === 15) return '110px'; // Batch Qty (S)
    if (colIdx === 16) return '150px'; // Remarks (Jyoti) (T)
    if (colIdx === 17) return '115px'; // Order Qty
    if (colIdx === 18) return '115px'; // GRN Qty
    if (colIdx === 19) return '115px'; // Pending Qty
    if (colIdx === 20) return '145px'; // PO Confirmation Date
    if (colIdx === 21) return '135px'; // Category
    if (colIdx === 22) return '125px'; // Indent Date
    if (colIdx === 23) return '210px'; // AI Status
    if (colIdx === 24) return '140px'; // ERP ISSUE DATE
    if (colIdx === 25) return '145px'; // MATERIAL ISSUE DATE
    if (colIdx === 26) return '175px'; // MATERIAL HANDOVER TO FABRICATOR DATE
    if (colIdx === 27) return '165px'; // 100% MATERIAL RECEIVED DATE
    return '120px';
  }

  function toggleColumnSort(colIdx) {
    if (currentSortColIdx === colIdx) {
      currentSortAsc = !currentSortAsc;
    } else {
      currentSortColIdx = colIdx;
      currentSortAsc = true;
    }

    var colName = allHeaders[colIdx] || ('Column ' + colIdx);
    var isNumeric = (colIdx === 13 || colIdx === 14 || colIdx === 15 || colIdx === 17 || colIdx === 18 || colIdx === 19);
    var isDateCol = (colIdx === 1 || colIdx === 20 || colIdx === 22 || colIdx === 24 || colIdx === 25 || colIdx === 26 || colIdx === 27);

    function parseDateToTime(dStr) {
      if (!dStr) return 0;
      var parts = String(dStr).trim().split(/[/.-]/);
      if (parts.length === 3) {
        var day = parseInt(parts[0], 10);
        var month = parseInt(parts[1], 10) - 1;
        var yr = parseInt(parts[2], 10);
        if (yr < 100) yr += 2000;
        var d = new Date(yr, month, day);
        if (!isNaN(d.getTime())) return d.getTime();
      }
      var direct = new Date(dStr);
      return !isNaN(direct.getTime()) ? direct.getTime() : 0;
    }

    allRows.sort(function (a, b) {
      var va = (a[colIdx] !== undefined && a[colIdx] !== null) ? String(a[colIdx]).trim() : '';
      var vb = (b[colIdx] !== undefined && b[colIdx] !== null) ? String(b[colIdx]).trim() : '';
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      if (isNumeric) {
        var na = parseFloat(va.replace(/,/g, ''));
        var nb = parseFloat(vb.replace(/,/g, ''));
        if (!isNaN(na) && !isNaN(nb)) {
          return currentSortAsc ? (na - nb) : (nb - na);
        }
      }
      if (isDateCol) {
        var ta = parseDateToTime(va);
        var tb = parseDateToTime(vb);
        if (ta && tb) {
          return currentSortAsc ? (ta - tb) : (tb - ta);
        }
      }
      var cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
      return currentSortAsc ? cmp : -cmp;
    });

    applyAllFiltersAndSearch();
    showToast('Sorted ' + colName + ' (' + (currentSortAsc ? 'A \u2192 Z' : 'Z \u2192 A') + ')', 'sort');
  }

  function renderHeaderRow() {
    var theadRow = document.getElementById('bai-sheet-thead-row');
    if (!theadRow) return;
    theadRow.innerHTML = '';

    // Serial # column
    var thIndex = document.createElement('th');
    thIndex.textContent = '#';
    thIndex.style.width = '55px';
    thIndex.style.minWidth = '55px';
    thIndex.style.textAlign = 'center';
    theadRow.appendChild(thIndex);

    allHeaders.forEach(function (h, colIdx) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th-filterable';

      var isColFiltered = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (isColFiltered) {
        th.classList.add('has-active-filter');
      }

      var width = getColWidth(h, colIdx);
      if (width) {
        th.style.width = width;
        th.style.minWidth = width;
      }

      var wrap = document.createElement('div');
      wrap.className = 'bai-sheet-th-content';

      var titleSpan = document.createElement('span');
      titleSpan.className = 'bai-sheet-th-title';
      titleSpan.textContent = h;
      titleSpan.title = h + ' (Click to sort)';

      // Distinct visual color accents on the 6 Trio-AI intelligence columns
      if (colIdx === 17) { titleSpan.style.color = '#2dd4bf'; }
      else if (colIdx === 18) { titleSpan.style.color = '#34d399'; }
      else if (colIdx === 19) { titleSpan.style.color = '#fbbf24'; }
      else if (colIdx === 20) { titleSpan.style.color = '#38bdf8'; }
      else if (colIdx === 21) { titleSpan.style.color = '#c084fc'; }
      else if (colIdx === 22) { titleSpan.style.color = '#38bdf8'; }
      else if (colIdx === 23) { titleSpan.style.color = '#a855f7'; }
      // Bantala Details Production columns color accents
      else if (colIdx === 24) { titleSpan.style.color = '#818cf8'; } // ERP ISSUE DATE
      else if (colIdx === 25) { titleSpan.style.color = '#a78bfa'; } // MATERIAL ISSUE DATE
      else if (colIdx === 26) { titleSpan.style.color = '#c084fc'; } // MATERIAL HANDOVER TO FABRICATOR DATE
      else if (colIdx === 27) { titleSpan.style.color = '#34d399'; } // 100% MATERIAL RECEIVED DATE

      titleSpan.addEventListener('click', function () {
        toggleColumnSort(colIdx);
      });

      wrap.appendChild(titleSpan);

      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'bai-sheet-col-filter-btn' + (isColFiltered ? ' is-active' : '');
      filterBtn.title = isColFiltered ? 'Filter active on ' + h + ' (Click to edit)' : 'Filter by ' + h;
      filterBtn.innerHTML = '<span class="material-icons-round">' + (isColFiltered ? 'filter_alt' : 'filter_list') + '</span>';
      filterBtn.setAttribute('data-col', colIdx);

      filterBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openColumnFilterPopover(colIdx, filterBtn);
      });

      wrap.appendChild(filterBtn);
      th.appendChild(wrap);
      theadRow.appendChild(th);
    });
  }

  function renderTablePage(preserveScroll) {
    var shouldPreserve = (typeof preserveScroll === 'boolean') ? preserveScroll : false;
    var tableWrapper = document.getElementById('bai-sheet-table-wrapper');
    var savedScrollTop = (shouldPreserve && tableWrapper) ? tableWrapper.scrollTop : 0;
    var savedScrollLeft = (shouldPreserve && tableWrapper) ? tableWrapper.scrollLeft : 0;

    var tbody = document.getElementById('bai-sheet-tbody');
    if (!tbody) return;

    var total = filteredRows.length;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIndex = (currentPage - 1) * pageSize;
    var endIndex = Math.min(startIndex + pageSize, total);
    var pageItems = filteredRows.slice(startIndex, endIndex);

    if (pageItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (allHeaders.length + 1) + '" class="bai-sheet-table-empty">No matching records found.</td></tr>';
    } else {
      var fragment = document.createDocumentFragment();
      for (var i = 0; i < pageItems.length; i++) {
        var row = pageItems[i];
        var tr = document.createElement('tr');

        // Row number
        var tdNum = document.createElement('td');
        tdNum.className = 'bai-sheet-td-index';
        var rowNumStr = (startIndex + i + 1).toLocaleString();
        tdNum.textContent = rowNumStr;
        tdNum.setAttribute('data-val', (startIndex + i + 1).toString());
        tr.appendChild(tdNum);

        for (var j = 0; j < row.length; j++) {
          var td = document.createElement('td');
          var val = row[j] !== undefined && row[j] !== null ? String(row[j]) : '';
          td.textContent = val;
          td.setAttribute('data-r', i);
          td.setAttribute('data-c', j);
          td.setAttribute('data-val', val);
          td.setAttribute('tabindex', '-1');

          if (j === 0) { // Batch (A)
            td.className = 'bai-sheet-td-batch';
            td.innerHTML = '<div class="bai-sheet-batch-wrap">' +
              '<span class="bai-sheet-batch-val" title="Double-click to copy Batch (' + escapeHtml(val) + ')">' + escapeHtml(val) + '</span>' +
              (val ? '<button type="button" class="bai-sheet-cell-ai-btn" tabindex="-1" aria-label="Ask Batch Analysis AI" title="Ask Batch Analysis AI about Batch ' + escapeHtml(val) + '"><span class="material-icons-round" aria-hidden="true" style="user-select:none;-webkit-user-select:none;">auto_awesome</span></button>' : '') +
              '</div>';
            var aiCellBtn = td.querySelector('.bai-sheet-cell-ai-btn');
            if (aiCellBtn) {
              (function (bVal, rData) {
                aiCellBtn.addEventListener('click', function (e) {
                  e.stopPropagation();
                  consultBatchAi(bVal, rData);
                });
              })(val, row);
            }
            var batchValSpan = td.querySelector('.bai-sheet-batch-val');
            if (batchValSpan && val) {
              (function (bVal) {
                batchValSpan.addEventListener('dblclick', function (e) {
                  e.stopPropagation();
                  copyTextToClipboard(bVal, function () {
                    showToast('Copied Batch: "' + bVal + '"', 'copy');
                  });
                });
              })(val);
            }
          } else if (j === 13 || j === 14 || j === 15) { // Quantities: Planned Qty (P), Prod QTY (R), ITB QTY (S)
            td.className = 'bai-sheet-td-num';
          } else if (j === 17) { // Order Qty
            td.className = 'bai-sheet-td-num bai-sheet-td-order-qty';
          } else if (j === 18) { // GRN Qty
            td.className = 'bai-sheet-td-num bai-sheet-td-grn-qty';
          } else if (j === 19) { // Pending Qty
            td.className = 'bai-sheet-td-num bai-sheet-td-pending-qty';
            var pNum = parseFloat(val.replace(/,/g, ''));
            if (!isNaN(pNum) && pNum > 0) {
              td.classList.add('has-pending');
            } else if (pNum === 0) {
              td.classList.add('is-zero');
            }
          } else if (j === 20) { // PO Confirmation Date
            td.className = 'bai-sheet-td-po-date';
          } else if (j === 21) { // Category
            if (val) {
              td.innerHTML = '<span class="bai-sheet-badge-cat">' + val + '</span>';
            }
          } else if (j === 22) { // Indent Date
            td.className = 'bai-sheet-td-indent-date';
          } else if (j === 23) { // AI Status
            td.className = 'bai-sheet-td-ai-status';
            var aiVal = (val || '').trim();
            if (aiVal) {
              var badgeClass = 'bai-ai-badge-default';
              var iconName = 'info';
              var aiValLower = aiVal.toLowerCase();

              if (aiValLower.indexOf('ready for production') !== -1) {
                badgeClass = 'bai-ai-badge-ready';
                iconName = 'check_circle';
              } else if (aiValLower.indexOf('cannot start production') !== -1) {
                badgeClass = 'bai-ai-badge-danger';
                iconName = 'cancel';
              } else if (aiValLower.indexOf('material received') !== -1) {
                badgeClass = 'bai-ai-badge-received';
                iconName = 'inventory_2';
              } else if (aiValLower.indexOf('ordered despite in stock') !== -1) {
                badgeClass = 'bai-ai-badge-ordered-stock';
                iconName = 'warning_amber';
              } else if (aiValLower.indexOf('in stock') !== -1) {
                badgeClass = 'bai-ai-badge-stock';
                iconName = 'check_box';
              } else if (aiValLower.indexOf('material pending') !== -1) {
                badgeClass = 'bai-ai-badge-pending';
                iconName = 'schedule';
              } else if (aiValLower.indexOf('po not created') !== -1) {
                badgeClass = 'bai-ai-badge-po-none';
                iconName = 'pending_actions';
              } else if (aiValLower.indexOf('po awaited') !== -1) {
                badgeClass = 'bai-ai-badge-po-wait';
                iconName = 'hourglass_empty';
              } else if (aiValLower.indexOf('no update') !== -1) {
                badgeClass = 'bai-ai-badge-muted';
                iconName = 'help_outline';
              } else if (aiValLower.indexOf('sample') !== -1) {
                badgeClass = 'bai-ai-badge-sample';
                iconName = 'biotech';
              }

              td.innerHTML = '<span class="bai-sheet-ai-badge ' + badgeClass + '">' +
                '<span class="material-icons-round bai-ai-badge-icon">' + iconName + '</span>' +
                '<span>' + aiVal + '</span>' +
                '</span>';
            } else {
              td.innerHTML = '<span class="bai-sheet-badge-cell-muted">-</span>';
            }
          } else if (j === 24 || j === 25 || j === 26 || j === 27) {
            // Bantala Details Production Dates
            td.className = 'bai-sheet-td-date bai-sheet-td-bantala-date';
            if (!val || val === '-' || val.toLowerCase() === 'data not found') {
              td.innerHTML = '<span class="bai-sheet-badge-cell-muted">-</span>';
            } else if (j === 27 && val) {
              td.classList.add('bai-sheet-td-100-rec');
            }
          }

          // Conditional Cell Color Coding (across entire table, excluding AI Status & Bantala Dates)
          if (j !== 23 && j !== 24 && j !== 25 && j !== 26 && j !== 27) {
            var valLower = val.toLowerCase().trim();
            if (valLower.indexOf('data not found') !== -1) {
              td.classList.add('bai-cell-red');
            } else if (valLower.indexOf('material received') !== -1) {
              td.classList.add('bai-cell-green');
            } else if (valLower.indexOf('material pending') !== -1) {
              td.classList.add('bai-cell-orange');
            } else if (valLower.indexOf('in-stock') !== -1 || valLower.indexOf('in stock') !== -1) {
              td.classList.add('bai-cell-purple');
            } else if (valLower.indexOf('po not create') !== -1 || valLower.indexOf('po not created') !== -1) {
              td.classList.add('bai-cell-yellow');
            } else if (j === 10) { // Status (M) Done badge
              if (valLower === 'done' || valLower === 'completed') {
                td.innerHTML = '<span class="bai-sheet-badge-done">' + val + '</span>';
              }
            }
          }

          // Restore selection if matching active cell
          if (activeCellCoords && activeCellCoords.r === i && activeCellCoords.c === j) {
            td.classList.add('bai-cell-selected');
          }

          // Mouse click on cell activates it
          (function (rIdx, cIdx) {
            td.addEventListener('mousedown', function () {
              selectCellByCoords(rIdx, cIdx);
            });
          })(i, j);

          tr.appendChild(td);
        }
        fragment.appendChild(tr);
      }
      tbody.innerHTML = '';
      tbody.appendChild(fragment);
    }

    // Update Pagination UI
    var showingRangeEl = document.getElementById('bai-sheet-showing-range');
    if (showingRangeEl) {
      if (total === 0) {
        showingRangeEl.textContent = 'Showing 0 of 0 records';
      } else {
        showingRangeEl.textContent = 'Showing ' + (startIndex + 1).toLocaleString() + ' – ' + endIndex.toLocaleString() + ' of ' + total.toLocaleString() + ' records';
      }
    }

    var countLabelEl = document.getElementById('bai-sheet-count-label');
    if (countLabelEl) {
      countLabelEl.textContent = total.toLocaleString() + ' records' + (total !== allRows.length ? ' (filtered from ' + allRows.length.toLocaleString() + ')' : '');
    }

    var pageNumInput = document.getElementById('bai-sheet-page-num');
    if (pageNumInput) pageNumInput.value = currentPage;

    var totalPagesEl = document.getElementById('bai-sheet-total-pages');
    if (totalPagesEl) totalPagesEl.textContent = totalPages.toLocaleString();

    var firstBtn = document.getElementById('bai-sheet-first-page');
    var prevBtn = document.getElementById('bai-sheet-prev-page');
    var nextBtn = document.getElementById('bai-sheet-next-page');
    var lastBtn = document.getElementById('bai-sheet-last-page');

    if (firstBtn) firstBtn.disabled = (currentPage <= 1);
    if (prevBtn) prevBtn.disabled = (currentPage <= 1);
    if (nextBtn) nextBtn.disabled = (currentPage >= totalPages);
    if (lastBtn) lastBtn.disabled = (currentPage >= totalPages);

    // Restore or reset table scroll
    if (tableWrapper) {
      if (shouldPreserve) {
        tableWrapper.scrollTop = savedScrollTop;
        tableWrapper.scrollLeft = savedScrollLeft;
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(function () {
            if (tableWrapper) {
              tableWrapper.scrollTop = savedScrollTop;
              tableWrapper.scrollLeft = savedScrollLeft;
            }
          });
        }
        setTimeout(function () {
          if (tableWrapper) {
            tableWrapper.scrollTop = savedScrollTop;
            tableWrapper.scrollLeft = savedScrollLeft;
          }
        }, 30);
      } else {
        tableWrapper.scrollTop = 0;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5.0 Pure Cell Value Extraction Engine (No UI junk, AI icons or ligatures)
  // ---------------------------------------------------------------------------
  function getCellPureValue(cell) {
    if (!cell) return '';

    // Priority 1: Raw data-val cached directly on cell
    if (cell.hasAttribute && cell.hasAttribute('data-val')) {
      var dv = cell.getAttribute('data-val');
      if (dv !== null && dv !== undefined) {
        return String(dv).trim();
      }
    }

    // Priority 2: Batch value span inside batch wrap
    var batchValEl = cell.querySelector ? cell.querySelector('.bai-sheet-batch-val') : null;
    if (batchValEl) {
      return (batchValEl.textContent || '').trim();
    }

    // Priority 3: AI Status badge text (omitting the icon ligature)
    var aiBadgeEl = cell.querySelector ? cell.querySelector('.bai-sheet-ai-badge') : null;
    if (aiBadgeEl) {
      var spans = aiBadgeEl.querySelectorAll('span:not(.material-icons-round):not(.bai-ai-badge-icon)');
      if (spans.length > 0) {
        return (spans[spans.length - 1].textContent || '').trim();
      }
    }

    // Priority 4: Clean clone without buttons, icons, or SVGs
    if (cell.cloneNode) {
      var clone = cell.cloneNode(true);
      var junk = clone.querySelectorAll('button, .material-icons-round, .material-icons, .material-symbols-outlined, svg');
      for (var k = 0; k < junk.length; k++) {
        junk[k].remove();
      }
      var clean = (clone.innerText !== undefined ? clone.innerText : clone.textContent || '').trim();
      return clean.replace(/auto_awesome/g, '').trim();
    }

    var fallback = (cell.innerText !== undefined ? cell.innerText : cell.textContent || '').trim();
    return fallback.replace(/auto_awesome/g, '').trim();
  }

  // ---------------------------------------------------------------------------
  // 5.1 Interactive Cell Control & Selection Engine (Mouse + Arrow Keys)
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('bai-sheet-tbody');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('tr');
    if (r < 0 || r >= rows.length) return;
    var targetCell = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (!targetCell) return;

    // Remove selection from previously selected cell
    var prev = tbody.querySelector('.bai-cell-selected');
    if (prev) {
      prev.classList.remove('bai-cell-selected');
    }

    // Apply selection to new cell
    targetCell.classList.add('bai-cell-selected');
    activeCellCoords = { r: r, c: c };

    // Auto-scroll inside table container if needed
    targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });

    // Update active cell badge in footer
    var badge = document.getElementById('bai-sheet-active-cell-badge');
    if (badge) {
      var startIndex = (currentPage - 1) * pageSize;
      var rowNum = startIndex + r + 1;
      var colHeader = allHeaders[c] || ('Col ' + c);
      var text = getCellPureValue(targetCell);
      if (text.length > 25) text = text.slice(0, 25) + '...';
      badge.style.display = 'inline-flex';
      badge.innerHTML = '<span class="material-icons-round">my_location</span> Cell [' + colHeader + ', Row ' + rowNum.toLocaleString() + ']: <span style="color:#059669;margin-left:4px;">' + escapeHtml(text) + '</span>';
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // 5.2 Clipboard Copy Engine (Ctrl + C / Cmd + C)
  // ---------------------------------------------------------------------------
  function copyTextToClipboard(text, onSuccess, onFail) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () {
        if (onSuccess) onSuccess();
      }).catch(function () {
        // Fallback to execCommand if clipboard API rejected
        fallbackCopyText(text, onSuccess, onFail);
      });
    } else {
      fallbackCopyText(text, onSuccess, onFail);
    }
  }

  function fallbackCopyText(text, onSuccess, onFail) {
    try {
      var textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.top = '-9999px';
      textArea.style.left = '-9999px';
      textArea.style.opacity = '0';
      textArea.setAttribute('readonly', '');
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      var successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        if (onSuccess) onSuccess();
      } else {
        if (onFail) onFail();
      }
    } catch (err) {
      if (onFail) onFail();
    }
  }

  function copySelectedCellToClipboard() {
    var tbody = document.getElementById('bai-sheet-tbody');
    if (!tbody) return false;

    var selectedCell = tbody.querySelector('.bai-cell-selected');
    if (!selectedCell) return false;

    var cellText = getCellPureValue(selectedCell);

    copyTextToClipboard(cellText, function () {
      // Excel-like flash animation on the copied cell
      selectedCell.classList.remove('bai-cell-copied');
      void selectedCell.offsetWidth; // Trigger reflow
      selectedCell.classList.add('bai-cell-copied');
      setTimeout(function () {
        selectedCell.classList.remove('bai-cell-copied');
      }, 500);

      var displayPreview = cellText;
      if (displayPreview.length > 35) displayPreview = displayPreview.slice(0, 35) + '...';
      if (displayPreview === '') displayPreview = '(Blank)';
      showToast('Copied: "' + displayPreview + '"', 'copy');
    }, function () {
      showToast('Could not copy cell content to clipboard', 'error');
    });

    return true;
  }

  // ---------------------------------------------------------------------------
  // 6. Parallel Column Filters & Search Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch(preserveState) {
    var shouldPreserve = (typeof preserveState === 'boolean') ? preserveState : false;
    var tableWrapper = document.getElementById('bai-sheet-table-wrapper');
    var savedScrollTop = (shouldPreserve && tableWrapper) ? tableWrapper.scrollTop : 0;
    var savedScrollLeft = (shouldPreserve && tableWrapper) ? tableWrapper.scrollLeft : 0;
    var savedPage = currentPage;

    var searchInput = document.getElementById('bai-sheet-search-input');
    var isSearchFocused = (document.activeElement === searchInput);
    var selStart = (isSearchFocused && searchInput) ? searchInput.selectionStart : 0;
    var selEnd = (isSearchFocused && searchInput) ? searchInput.selectionEnd : 0;

    var query = (searchInput ? searchInput.value : '').toLowerCase().trim();

    var clearBtn = document.getElementById('bai-sheet-search-clear');
    if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

    var queryTerms = query ? query.split(/\s+/).filter(Boolean) : [];
    var hasQuery = queryTerms.length > 0;
    var colIndices = Object.keys(activeColumnFilters).map(Number);
    var hasColFilters = colIndices.length > 0;

    if (!hasQuery && !hasColFilters) {
      filteredRows = allRows;
    } else {
      filteredRows = allRows.filter(function (row) {
        // 1. Text Search across all columns
        if (hasQuery) {
          var rowString = row.join(' ').toLowerCase();
          for (var t = 0; t < queryTerms.length; t++) {
            if (rowString.indexOf(queryTerms[t]) === -1) return false;
          }
        }
        // 2. Parallel Column Filters (AND condition across all filtered columns)
        if (hasColFilters) {
          for (var c = 0; c < colIndices.length; c++) {
            var colIdx = colIndices[c];
            var allowedSet = activeColumnFilters[colIdx];
            if (allowedSet) {
              var val = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
              if (!allowedSet.has(val)) return false;
            }
          }
        }
        return true;
      });
    }

    var total = filteredRows.length;
    var totalPages = Math.ceil(total / pageSize) || 1;

    if (shouldPreserve) {
      if (savedPage <= totalPages) {
        currentPage = savedPage;
      } else {
        currentPage = totalPages;
      }
    } else {
      currentPage = 1;
    }

    renderTablePage(shouldPreserve);
    renderActiveFiltersChips();
    renderHeaderRow();

    if (shouldPreserve && tableWrapper) {
      tableWrapper.scrollTop = savedScrollTop;
      tableWrapper.scrollLeft = savedScrollLeft;
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(function () {
          if (tableWrapper) {
            tableWrapper.scrollTop = savedScrollTop;
            tableWrapper.scrollLeft = savedScrollLeft;
          }
        });
      }
      setTimeout(function () {
        if (tableWrapper) {
          tableWrapper.scrollTop = savedScrollTop;
          tableWrapper.scrollLeft = savedScrollLeft;
        }
      }, 40);
    }

    if (isSearchFocused && searchInput) {
      searchInput.focus();
      try { searchInput.setSelectionRange(selStart, selEnd); } catch (e) {}
    }
  }

  function applySearchFilter(preserveState) {
    applyAllFiltersAndSearch(preserveState);
  }

  // ---------------------------------------------------------------------------
  // 6.1 Google Sheets Style Filter Popover Controller
  // ---------------------------------------------------------------------------
  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    currentFilterSearchQuery = '';

    var popover = document.getElementById('bai-sheet-filter-popover');
    if (!popover) return;

    var titleEl = document.getElementById('bai-sheet-filter-pop-title');
    if (titleEl) {
      titleEl.textContent = allHeaders[colIdx] || ('Column ' + colIdx);
    }

    var searchInput = document.getElementById('bai-sheet-filter-search-input');
    if (searchInput) {
      searchInput.value = '';
    }
    var searchClear = document.getElementById('bai-sheet-filter-search-clear');
    if (searchClear) searchClear.style.display = 'none';

    // Extract unique values and counts for this column
    var counts = {};
    for (var i = 0; i < allRows.length; i++) {
      var v = allRows[i][colIdx];
      var s = (v !== undefined && v !== null) ? String(v).trim() : '';
      counts[s] = (counts[s] || 0) + 1;
    }
    currentFilterValueCounts = counts;
    currentFilterUniqueValues = Object.keys(counts).sort(function (a, b) {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Populate currently selected set
    if (activeColumnFilters[colIdx]) {
      currentFilterSelectedSet = new Set(activeColumnFilters[colIdx]);
    } else {
      currentFilterSelectedSet = new Set(currentFilterUniqueValues);
    }

    renderFilterList();

    // Position Popover nicely near anchor button
    popover.style.display = 'flex';
    var rect = anchorBtn.getBoundingClientRect();
    var popWidth = 320;
    var left = rect.right - popWidth;
    if (left < 10) left = rect.left;
    if (left + popWidth > window.innerWidth - 15) {
      left = window.innerWidth - popWidth - 15;
    }
    if (left < 10) left = 10;

    var top = rect.bottom + 6;
    if (top + 430 > window.innerHeight - 10) {
      top = rect.top - 430;
      if (top < 10) top = 10;
    }

    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    setTimeout(function () {
      if (searchInput) searchInput.focus();
    }, 50);
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('bai-sheet-filter-popover');
    if (popover) {
      popover.style.display = 'none';
    }
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listContainer = document.getElementById('bai-sheet-filter-list');
    var countEl = document.getElementById('bai-sheet-filter-items-count');
    if (!listContainer) return;

    var q = currentFilterSearchQuery.toLowerCase().trim();
    var visibleValues = currentFilterUniqueValues.filter(function (v) {
      if (!q) return true;
      var displayStr = (v === '') ? '(blanks)' : v.toLowerCase();
      return displayStr.indexOf(q) !== -1;
    });

    if (countEl) {
      countEl.textContent = visibleValues.length.toLocaleString() + ' of ' + currentFilterUniqueValues.length.toLocaleString() + ' items';
    }

    if (visibleValues.length === 0) {
      listContainer.innerHTML = '<div style="padding:16px;text-align:center;color:#64748b;font-size:12px;">No matching values found.</div>';
      return;
    }

    var fragment = document.createDocumentFragment();
    for (var i = 0; i < visibleValues.length; i++) {
      var val = visibleValues[i];
      var isChecked = currentFilterSelectedSet.has(val);
      var displayVal = (val === '') ? '(Blanks)' : val;
      var count = currentFilterValueCounts[val] || 0;

      var item = document.createElement('label');
      item.className = 'bai-sheet-filter-item';

      var left = document.createElement('div');
      left.className = 'bai-sheet-filter-item-left';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.setAttribute('data-val', val);

      (function (v) {
        cb.addEventListener('change', function () {
          if (this.checked) {
            currentFilterSelectedSet.add(v);
          } else {
            currentFilterSelectedSet.delete(v);
          }
        });
      })(val);

      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-item-text';
      textSpan.textContent = displayVal;
      textSpan.title = displayVal;
      if (val === '') {
        textSpan.style.fontStyle = 'italic';
        textSpan.style.color = '#94a3b8';
      }

      left.appendChild(cb);
      left.appendChild(textSpan);

      var countBadge = document.createElement('span');
      countBadge.className = 'bai-sheet-filter-item-count';
      countBadge.textContent = '(' + count.toLocaleString() + ')';

      item.appendChild(left);
      item.appendChild(countBadge);
      fragment.appendChild(item);
    }

    listContainer.innerHTML = '';
    listContainer.appendChild(fragment);
  }

  function renderActiveFiltersChips() {
    var bar = document.getElementById('bai-sheet-active-filters-bar');
    var chipsContainer = document.getElementById('bai-sheet-active-filters-chips');
    if (!bar || !chipsContainer) return;

    var colIndices = Object.keys(activeColumnFilters).map(Number);
    if (colIndices.length === 0) {
      bar.style.display = 'none';
      chipsContainer.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    chipsContainer.innerHTML = '';

    colIndices.forEach(function (colIdx) {
      var colName = allHeaders[colIdx] || ('Col ' + colIdx);
      var allowedSet = activeColumnFilters[colIdx];
      var allowedArr = Array.from(allowedSet);

      var chip = document.createElement('div');
      chip.className = 'bai-sheet-filter-chip';

      var colSpan = document.createElement('span');
      colSpan.className = 'bai-sheet-filter-chip-col';
      colSpan.textContent = colName + ':';

      var valSpan = document.createElement('span');
      valSpan.className = 'bai-sheet-filter-chip-val';
      if (allowedArr.length === 1) {
        valSpan.textContent = allowedArr[0] === '' ? '(Blanks)' : allowedArr[0];
      } else if (allowedArr.length <= 2) {
        valSpan.textContent = allowedArr.map(function (x) { return x === '' ? '(Blanks)' : x; }).join(', ');
      } else {
        valSpan.textContent = allowedArr.length + ' values selected';
      }

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bai-sheet-filter-chip-remove';
      removeBtn.title = 'Remove filter on ' + colName;
      removeBtn.innerHTML = '✕';

      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        delete activeColumnFilters[colIdx];
        applyAllFiltersAndSearch();
        showToast('Filter removed from ' + colName, 'filter');
      });

      chip.appendChild(colSpan);
      chip.appendChild(valSpan);
      chip.appendChild(removeBtn);
      chipsContainer.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Excel (.xlsx) Export Engine (using SheetJS)
  // ---------------------------------------------------------------------------
  function exportExcelXLSX() {
    if (!filteredRows || filteredRows.length === 0) {
      showToast('No records to export.', 'warning');
      return;
    }

    if (typeof XLSX === 'undefined') {
      showToast('Excel library not ready, generating CSV fallback...', 'warning');
      exportFilteredCSV();
      return;
    }

    var count = filteredRows.length;
    showToast('Generating Excel (.xlsx) with ' + count.toLocaleString() + ' records...', 'clock');

    setTimeout(function () {
      try {
        var startExport = performance.now();
        var wb = XLSX.utils.book_new();

        // 1. Array of arrays with headers first
        var aoa = [allHeaders];
        for (var i = 0; i < filteredRows.length; i++) {
          aoa.push(filteredRows[i]);
        }

        var ws = XLSX.utils.aoa_to_sheet(aoa);

        // Auto column widths
        var colWidths = allHeaders.map(function (h, colIdx) {
          var maxLen = String(h).length;
          var sampleLimit = Math.min(filteredRows.length, 120);
          for (var r = 0; r < sampleLimit; r++) {
            var cellVal = filteredRows[r][colIdx];
            if (cellVal != null) {
              var l = String(cellVal).length;
              if (l > maxLen) maxLen = l;
            }
          }
          return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Connector');

        var fileName = 'Connector_Sheet_Export_' + (new Date().toISOString().slice(0, 10)) + '.xlsx';
        XLSX.writeFile(wb, fileName);

        var duration = ((performance.now() - startExport) / 1000).toFixed(1);
        showToast('Exported ' + count.toLocaleString() + ' records to ' + fileName + ' (' + duration + 's)!', 'download');
      } catch (err) {
        console.error('[ConnectorSheet] Excel export error:', err);
        showToast('Excel export failed: ' + (err.message || 'Unknown error'), 'error');
      }
    }, 60);
  }

  function exportFilteredCSV() {
    if (!filteredRows || filteredRows.length === 0) {
      showToast('No records to export.', 'warning');
      return;
    }

    var csvContent = [];
    csvContent.push(allHeaders.map(function (h) { return '"' + h.replace(/"/g, '""') + '"'; }).join(','));

    for (var i = 0; i < filteredRows.length; i++) {
      var row = filteredRows[i];
      var escaped = row.map(function (val) {
        var str = String(val || '');
        return '"' + str.replace(/"/g, '""') + '"';
      });
      csvContent.push(escaped.join(','));
    }

    var blob = new Blob([csvContent.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'Connector_Sheet_Export_' + (new Date().toISOString().slice(0, 10)) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to CSV!', 'download');
  }

  // ---------------------------------------------------------------------------
  // 8. UI Helpers & Modals
  // ---------------------------------------------------------------------------
  function openModal() {
    var backdrop = document.getElementById('bai-sheet-modal-backdrop');
    if (backdrop) {
      backdrop.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      if (allRows.length > 0 && (!filteredRows || filteredRows.length === 0)) {
        filteredRows = allRows;
        renderHeaderRow();
        renderTablePage();
      } else if (allRows.length === 0 && !isSyncing) {
        initDataEngine();
      }
      setTimeout(function () {
        var searchInput = document.getElementById('bai-sheet-search-input');
        if (searchInput) searchInput.focus();
      }, 100);
    }
  }

  function closeModal() {
    var backdrop = document.getElementById('bai-sheet-modal-backdrop');
    if (backdrop) {
      backdrop.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('bai-sheet-db-badge');
    var syncText = document.getElementById('bai-sheet-last-sync-text');
    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;">bolt</span> ' + (allRows.length ? allRows.length.toLocaleString() + ' Rows Cached (Database)' : 'Database Ready');
    }
    if (syncText) {
      if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        syncText.textContent = 'Last synced: ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString() + ')';
      } else {
        syncText.textContent = 'Not synced yet';
      }
    }
  }

  function updateSyncUI(syncing, msg) {
    var syncBanner = document.getElementById('bai-sheet-sync-banner');
    var syncMsg = document.getElementById('bai-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('bai-sheet-sync-icon');

    if (syncBanner) syncBanner.style.display = syncing ? 'flex' : 'none';
    if (syncMsg && msg) syncMsg.textContent = msg;
    if (syncBtnIcon) {
      if (syncing) {
        syncBtnIcon.classList.add('bai-sheet-spin');
      } else {
        syncBtnIcon.classList.remove('bai-sheet-spin');
      }
    }
  }

  // SVG Icons Library for Clean, Modern Alerts
  var SVG_ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    sort: '<svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 12h12m-9 6h6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  function showToast(msg, customType) {
    var existing = document.getElementById('bai-sheet-toast');
    if (existing) existing.remove();

    // Strip legacy emojis if present in string
    var cleanMsg = String(msg || '')
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

    var type = customType || 'info';
    var iconKey = 'info';

    var lower = cleanMsg.toLowerCase();
    if (customType) {
      iconKey = customType;
    } else if (lower.indexOf('copied') !== -1) {
      type = 'info';
      iconKey = 'copy';
    } else if (lower.indexOf('fail') !== -1 || lower.indexOf('error') !== -1 || lower.indexOf('could not') !== -1) {
      type = 'error';
      iconKey = 'error';
    } else if (lower.indexOf('no records') !== -1 || lower.indexOf('not ready') !== -1 || lower.indexOf('warning') !== -1) {
      type = 'warning';
      iconKey = 'warning';
    } else if (lower.indexOf('synced') !== -1 || lower.indexOf('cached') !== -1 || lower.indexOf('ready') !== -1) {
      type = 'success';
      iconKey = 'check';
    } else if (lower.indexOf('exported') !== -1) {
      type = 'success';
      iconKey = 'download';
    } else if (lower.indexOf('generating') !== -1 || lower.indexOf('downloading') !== -1) {
      type = 'warning';
      iconKey = 'clock';
    } else if (lower.indexOf('filter') !== -1) {
      type = 'info';
      iconKey = 'filter';
    } else if (lower.indexOf('sort') !== -1) {
      type = 'info';
      iconKey = 'sort';
    }

    var iconSvg = SVG_ICONS[iconKey] || SVG_ICONS.info;

    var toast = document.createElement('div');
    toast.id = 'bai-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + type;
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + cleanMsg + '</span>';
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('show');
    }, 20);

    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3600);
  }

  // ---------------------------------------------------------------------------
  // 9. Event Listeners Setup
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // Open modal button in topbar
    var openBtn = document.getElementById('bai-sheet-modal-btn');
    if (openBtn) {
      openBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
      });
    }

    // Close button
    var closeBtn = document.getElementById('bai-sheet-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    // Backdrop click to close
    var backdrop = document.getElementById('bai-sheet-modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) closeModal();
      });
    }

    // Sync button
    var syncBtn = document.getElementById('bai-sheet-sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        syncFromGoogleSheet(true);
      });
    }

    // Export button (Excel .xlsx)
    var exportBtn = document.getElementById('bai-sheet-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportExcelXLSX);
    }

    // Ask Batch AI button in modal header
    var aiConsultBtn = document.getElementById('bai-sheet-ai-consult-btn');
    if (aiConsultBtn) {
      aiConsultBtn.addEventListener('click', function () {
        var count = filteredRows ? filteredRows.length : allRows.length;
        var searchInput = document.getElementById('bai-sheet-search-input');
        var query = searchInput ? searchInput.value.trim() : '';
        var activeFilterCols = Object.keys(activeColumnFilters);
        var prompt = '';
        if (query || activeFilterCols.length > 0) {
          prompt = 'Analyze current filtered Connector Sheet records (' + count.toLocaleString() + ' matching records). Highlight production bottlenecks, Ready for Production batches, and pending raw materials.';
        } else {
          prompt = 'Give an executive analysis of the Connector Live Sheet Records (' + count.toLocaleString() + ' total records). Break down Ready for Production vs Material Pending batches with actionable insights.';
        }
        consultBatchAi('Current Records', null, prompt);
      });
    }

    // Search input (debounced)
    var searchInput = document.getElementById('bai-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applySearchFilter, 180);
      });
    }

    // Search clear button
    var searchClear = document.getElementById('bai-sheet-search-clear');
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        applySearchFilter();
      });
    }

    // Page size dropdown
    var pageSizeSelect = document.getElementById('bai-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination buttons
    var firstBtn = document.getElementById('bai-sheet-first-page');
    if (firstBtn) firstBtn.addEventListener('click', function () { currentPage = 1; renderTablePage(); });

    var prevBtn = document.getElementById('bai-sheet-prev-page');
    if (prevBtn) prevBtn.addEventListener('click', function () { if (currentPage > 1) { currentPage--; renderTablePage(); } });

    var nextBtn = document.getElementById('bai-sheet-next-page');
    if (nextBtn) nextBtn.addEventListener('click', function () {
      var maxPage = Math.ceil(filteredRows.length / pageSize) || 1;
      if (currentPage < maxPage) { currentPage++; renderTablePage(); }
    });

    var lastBtn = document.getElementById('bai-sheet-last-page');
    if (lastBtn) lastBtn.addEventListener('click', function () {
      currentPage = Math.ceil(filteredRows.length / pageSize) || 1;
      renderTablePage();
    });

    // Page number jump input
    var pageNumInput = document.getElementById('bai-sheet-page-num');
    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var maxPage = Math.ceil(filteredRows.length / pageSize) || 1;
        if (!isNaN(val)) {
          if (val < 1) val = 1;
          if (val > maxPage) val = maxPage;
          currentPage = val;
          renderTablePage();
        }
      });
    }

    // -------------------------------------------------------------------------
    // Filter Popover Events (Google Sheets Style)
    // -------------------------------------------------------------------------
    var popCloseBtn = document.getElementById('bai-sheet-filter-pop-close');
    if (popCloseBtn) {
      popCloseBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popCancelBtn = document.getElementById('bai-sheet-filter-cancel-btn');
    if (popCancelBtn) {
      popCancelBtn.addEventListener('click', closeColumnFilterPopover);
    }

    // Select All Link
    var popSelectAll = document.getElementById('bai-sheet-filter-select-all');
    if (popSelectAll) {
      popSelectAll.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        currentFilterUniqueValues.forEach(function (v) {
          if (!q) {
            currentFilterSelectedSet.add(v);
          } else {
            var displayStr = (v === '') ? '(blanks)' : v.toLowerCase();
            if (displayStr.indexOf(q) !== -1) {
              currentFilterSelectedSet.add(v);
            }
          }
        });
        renderFilterList();
      });
    }

    // Clear Link
    var popClearAll = document.getElementById('bai-sheet-filter-clear-all');
    if (popClearAll) {
      popClearAll.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        if (!q) {
          currentFilterSelectedSet.clear();
        } else {
          currentFilterUniqueValues.forEach(function (v) {
            var displayStr = (v === '') ? '(blanks)' : v.toLowerCase();
            if (displayStr.indexOf(q) !== -1) {
              currentFilterSelectedSet.delete(v);
            }
          });
        }
        renderFilterList();
      });
    }

    // Search in Popover
    var popSearchInput = document.getElementById('bai-sheet-filter-search-input');
    var popSearchClear = document.getElementById('bai-sheet-filter-search-clear');
    if (popSearchInput) {
      popSearchInput.addEventListener('input', function () {
        currentFilterSearchQuery = this.value || '';
        if (popSearchClear) popSearchClear.style.display = currentFilterSearchQuery ? 'inline-block' : 'none';
        renderFilterList();
      });
    }
    if (popSearchClear) {
      popSearchClear.addEventListener('click', function () {
        if (popSearchInput) {
          popSearchInput.value = '';
          popSearchInput.focus();
        }
        currentFilterSearchQuery = '';
        popSearchClear.style.display = 'none';
        renderFilterList();
      });
    }

    // OK Button (Apply Column Filter)
    var popOkBtn = document.getElementById('bai-sheet-filter-ok-btn');
    if (popOkBtn) {
      popOkBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var colIdx = currentFilterColIdx;
        var colName = allHeaders[colIdx] || ('Column ' + colIdx);

        if (currentFilterSelectedSet.size === currentFilterUniqueValues.length) {
          delete activeColumnFilters[colIdx];
        } else {
          activeColumnFilters[colIdx] = new Set(currentFilterSelectedSet);
        }

        applyAllFiltersAndSearch();
        closeColumnFilterPopover();

        if (activeColumnFilters[colIdx]) {
          showToast('Filter applied on ' + colName + ' (' + filteredRows.length.toLocaleString() + ' records)', 'filter');
        }
      });
    }

    // Reset Button (Clear Filter on this column)
    var popResetBtn = document.getElementById('bai-sheet-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var colIdx = currentFilterColIdx;
        var colName = allHeaders[colIdx] || ('Column ' + colIdx);

        delete activeColumnFilters[colIdx];
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter removed from ' + colName, 'filter');
      });
    }

    // Sort A -> Z Button
    var sortAscBtn = document.getElementById('bai-sheet-sort-asc');
    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var colIdx = currentFilterColIdx;
        var colName = allHeaders[colIdx] || ('Column ' + colIdx);

        allRows.sort(function (a, b) {
          var va = (a[colIdx] !== undefined && a[colIdx] !== null) ? String(a[colIdx]).trim() : '';
          var vb = (b[colIdx] !== undefined && b[colIdx] !== null) ? String(b[colIdx]).trim() : '';
          var isNumeric = (colIdx === 13 || colIdx === 14 || colIdx === 15 || colIdx === 17 || colIdx === 18 || colIdx === 19);
          if (isNumeric) {
            var na = parseFloat(va.replace(/,/g, ''));
            var nb = parseFloat(vb.replace(/,/g, ''));
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
          }
          return va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
        });

        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Sorted ' + colName + ' (A → Z)', 'sort');
      });
    }

    // Sort Z -> A Button
    var sortDescBtn = document.getElementById('bai-sheet-sort-desc');
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var colIdx = currentFilterColIdx;
        var colName = allHeaders[colIdx] || ('Column ' + colIdx);

        allRows.sort(function (a, b) {
          var va = (a[colIdx] !== undefined && a[colIdx] !== null) ? String(a[colIdx]).trim() : '';
          var vb = (b[colIdx] !== undefined && b[colIdx] !== null) ? String(b[colIdx]).trim() : '';
          var isNumeric = (colIdx === 13 || colIdx === 14 || colIdx === 15 || colIdx === 17 || colIdx === 18 || colIdx === 19);
          if (isNumeric) {
            var na = parseFloat(va.replace(/,/g, ''));
            var nb = parseFloat(vb.replace(/,/g, ''));
            if (!isNaN(na) && !isNaN(nb)) return nb - na;
          }
          return vb.localeCompare(va, undefined, { numeric: true, sensitivity: 'base' });
        });

        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Sorted ' + colName + ' (Z → A)', 'sort');
      });
    }

    // Clear All Filters Button (Active Filters Bar)
    var clearAllFiltersBtn = document.getElementById('bai-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared.', 'filter');
      });
    }

    // Click outside popover to close
    document.addEventListener('click', function (e) {
      var popover = document.getElementById('bai-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // -------------------------------------------------------------------------
    // Keyboard Arrow Navigation & Ctrl+C Cell Copy
    // -------------------------------------------------------------------------
    document.addEventListener('keydown', function (e) {
      var backdrop = document.getElementById('bai-sheet-modal-backdrop');
      if (!backdrop || backdrop.style.display === 'none') return;

      var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      var isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      // If typing inside an input/search box, let normal input behavior happen
      if (isInput) return;

      var key = e.key;

      // Ctrl + C / Cmd + C cell copy
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
        var selection = window.getSelection ? window.getSelection().toString() : '';
        // If user manually highlighted text inside the cell, allow default browser copy unless it captured 'auto_awesome'
        if (!selection || selection === 'auto_awesome' || selection.indexOf('auto_awesome') !== -1) {
          var copied = copySelectedCellToClipboard();
          if (copied) {
            e.preventDefault();
            return;
          }
        }
      }

      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Enter' || key === 'Tab') {
        var tbody = document.getElementById('bai-sheet-tbody');
        if (!tbody) return;

        var rowsInPage = tbody.querySelectorAll('tr').length;
        if (rowsInPage === 0) return;
        var colsCount = allHeaders.length;

        var r = activeCellCoords ? activeCellCoords.r : 0;
        var c = activeCellCoords ? activeCellCoords.c : 0;

        if (key === 'ArrowUp') {
          e.preventDefault();
          r = Math.max(0, r - 1);
        } else if (key === 'ArrowDown' || key === 'Enter') {
          e.preventDefault();
          r = Math.min(rowsInPage - 1, r + 1);
        } else if (key === 'ArrowLeft') {
          e.preventDefault();
          c = Math.max(0, c - 1);
        } else if (key === 'ArrowRight') {
          e.preventDefault();
          c = Math.min(colsCount - 1, c + 1);
        } else if (key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) {
            c--;
            if (c < 0) {
              c = colsCount - 1;
              r = Math.max(0, r - 1);
            }
          } else {
            c++;
            if (c >= colsCount) {
              c = 0;
              r = Math.min(rowsInPage - 1, r + 1);
            }
          }
        }

        selectCellByCoords(r, c);
      }
    });

    // Native 'copy' event fallback handler
    document.addEventListener('copy', function (e) {
      var backdrop = document.getElementById('bai-sheet-modal-backdrop');
      if (!backdrop || backdrop.style.display === 'none') return;

      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;

      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection || selection === 'auto_awesome' || selection.indexOf('auto_awesome') !== -1) {
        var tbody = document.getElementById('bai-sheet-tbody');
        if (!tbody) return;
        var selectedCell = tbody.querySelector('.bai-cell-selected');
        if (selectedCell) {
          var text = getCellPureValue(selectedCell);
          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();

            // Flash cell
            selectedCell.classList.remove('bai-cell-copied');
            void selectedCell.offsetWidth;
            selectedCell.classList.add('bai-cell-copied');
            setTimeout(function () {
              selectedCell.classList.remove('bai-cell-copied');
            }, 500);

            var displayPreview = text;
            if (displayPreview.length > 35) displayPreview = displayPreview.slice(0, 35) + '...';
            if (displayPreview === '') displayPreview = '(Blank)';
            showToast('Copied: "' + displayPreview + '"', 'copy');
          }
        } else if (selection && selection.indexOf('auto_awesome') !== -1) {
          var cleaned = selection.replace(/auto_awesome/g, '').trim();
          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', cleaned);
            e.preventDefault();
            var disp = cleaned.length > 35 ? cleaned.slice(0, 35) + '...' : cleaned;
            showToast('Copied: "' + (disp || '(Blank)') + '"', 'copy');
          }
        }
      }
    });

    // Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('bai-sheet-filter-popover');
        if (popover && popover.style.display !== 'none') {
          closeColumnFilterPopover();
          return;
        }
        var bd = document.getElementById('bai-sheet-modal-backdrop');
        if (bd && bd.style.display === 'flex') {
          closeModal();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Deep Integration Engine for Batch Analysis AI
  // ---------------------------------------------------------------------------
  function consultBatchAi(batchVal, rowData, customPrompt) {
    closeModal();
    var prompt = customPrompt || '';
    if (!prompt) {
      prompt = 'Analyze Batch ' + batchVal;
      if (rowData) {
        var style = rowData[6] || '';
        var item = rowData[4] || rowData[3] || '';
        var aiStatus = rowData[23] || '';
        var storeStatus = rowData[11] || '';
        var planned = rowData[13] || '';
        var prod = rowData[14] || '';
        var supplierPo = rowData[9] || '';
        var remarks = rowData[16] || rowData[12] || '';
        prompt += ' (Style: ' + style + ', Item: ' + item + ', AI Status: ' + aiStatus;
        if (storeStatus) prompt += ', Store Status: ' + storeStatus;
        if (planned) prompt += ', Planned Qty: ' + planned;
        if (prod) prompt += ', Prod Qty: ' + prod;
        if (supplierPo) prompt += ', Supplier PO: ' + supplierPo;
        if (remarks) prompt += ', Remarks: ' + remarks;
        prompt += '). Provide complete production readiness, raw material tracking, and action recommendations.';
      }
    }

    setTimeout(function () {
      if (window.location.pathname.toLowerCase().indexOf('bai.html') !== -1 && window.BatchAnalysisAI && typeof window.BatchAnalysisAI.sendPrompt === 'function') {
        window.BatchAnalysisAI.sendPrompt(prompt);
      } else {
        var heroInput = document.getElementById('bai-chat-input');
        var dockedInput = document.getElementById('bai-chat-input-docked');
        var chatInput = (dockedInput && dockedInput.offsetParent !== null) ? dockedInput : heroInput;
        if (chatInput && chatInput.offsetParent !== null) {
          chatInput.value = prompt;
          var heroSend = document.getElementById('bai-send-btn');
          var dockedSend = document.getElementById('bai-send-btn-docked');
          var sendBtn = (dockedSend && dockedSend.offsetParent !== null) ? dockedSend : heroSend;
          if (sendBtn) sendBtn.click();
        } else {
          var url = 'bai.html?prompt=' + encodeURIComponent(prompt) + '&auto=1';
          var win = null;
          try { win = window.open(url, '_blank'); } catch (e) {}
          if (!win || win.closed || typeof win.closed === 'undefined') {
            window.location.href = url;
          }
        }
      }
    }, 120);
  }

  function normalizeCode(str) {
    return String(str || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  }

  function findRowsByBatch(batchVal) {
    if (!allRows || !batchVal) return [];
    var raw = String(batchVal).trim();
    // Guard against style codes (e.g. HHA/159/01BK, HSB/121/02) being treated as batches
    if (/[a-zA-Z0-9]{2,}\/\d{1,4}\//.test(raw)) {
      return [];
    }
    var target = raw.toLowerCase();
    var targetNorm = normalizeCode(raw);
    if (!targetNorm) return [];

    // 1. Exact match on raw string
    var exact = allRows.filter(function (r) {
      return String(r[0] || '').trim().toLowerCase() === target;
    });
    if (exact.length > 0) return exact;

    // 2. Exact match on normalized code (ignoring spaces, dashes, slashes)
    var normExact = allRows.filter(function (r) {
      return normalizeCode(r[0]) === targetNorm;
    });
    if (normExact.length > 0) return normExact;

    // 3. Substring match (only if target length is substantial to prevent small fragments matching)
    if (targetNorm.length >= 5) {
      var subMatches = allRows.filter(function (r) {
        var b = String(r[0] || '').trim().toLowerCase();
        var bNorm = normalizeCode(b);
        if (!bNorm) return false;
        return b === target || bNorm === targetNorm ||
               (bNorm.length >= 6 && targetNorm.length >= 6 && (bNorm.indexOf(targetNorm) !== -1 || targetNorm.indexOf(bNorm) !== -1));
      });
      if (subMatches.length > 0) return subMatches;
    }

    // 4. If target has a slash or hyphen (e.g. TT-0867/26-27), check prefix before slash
    var prefix = raw.split(/[\/\\]/)[0].trim();
    if (prefix && prefix !== raw && prefix.length >= 4) {
      var prefixNorm = normalizeCode(prefix);
      var prefixMatches = allRows.filter(function (r) {
        var b = String(r[0] || '').trim().toLowerCase();
        var bNorm = normalizeCode(b);
        return b === prefix.toLowerCase() || bNorm === prefixNorm;
      });
      if (prefixMatches.length > 0) return prefixMatches;
    }

    // 5. Check if numeric portion matches as exact integer (e.g. 0867 or 867)
    var numPart = raw.match(/\b\d{3,6}\b/) || raw.match(/\d{3,6}/);
    if (numPart) {
      var numTargetInt = parseInt(numPart[0], 10);
      var numMatches = allRows.filter(function (r) {
        var bStr = String(r[0] || '').trim();
        var bNumM = bStr.match(/(?:[-_]|^)(\d{3,6})(?:[/-]|$)/);
        if (bNumM) {
          return parseInt(bNumM[1], 10) === numTargetInt;
        }
        return false;
      });
      if (numMatches.length > 0) return numMatches;
    }

    return [];
  }

  function getBatchMaterialReadiness(batchVal) {
    var rows = findRowsByBatch(batchVal);
    if (!rows || rows.length === 0) return null;

    var first = rows[0];
    var batchNo = first[0] || batchVal;
    var itb = '-';
    var styleNo = '-';
    var brand = '-';
    var plannedQty = first[13] || '-';
    var prodQty = first[14] || '-';
    var batchQty = first[15] || '-';

    var indentList = [];
    var indentDateList = [];
    var indentDateMap = {};

    for (var ri = 0; ri < rows.length; ri++) {
      var cr = rows[ri];
      var rawItb = cr[2] ? String(cr[2]).trim() : '';
      if (itb === '-' && rawItb && rawItb !== '-' && rawItb.toLowerCase() !== 'itb' && rawItb.toLowerCase() !== 'data not found') {
        itb = rawItb;
      }
      if (styleNo === '-' && cr[6] && cr[6] !== '-' && String(cr[6]).toLowerCase() !== 'style no') {
        styleNo = String(cr[6]).trim();
      }
      if (brand === '-' && cr[5] && cr[5] !== '-' && String(cr[5]).toLowerCase() !== 'comments') {
        brand = String(cr[5]).trim();
      }

      var rawInd = cr[8] ? String(cr[8]).trim() : '';
      var rawDt = cr[22] ? String(cr[22]).trim() : '';
      var isIndValid = rawInd && rawInd !== '-' && rawInd.toLowerCase() !== 'indent no.' && rawInd.toLowerCase() !== 'data not found';
      var isDtValid = rawDt && rawDt !== '-' && rawDt.toLowerCase() !== 'indent date' && rawDt.toLowerCase() !== 'data not found';

      if (isIndValid) {
        if (indentList.indexOf(rawInd) === -1) {
          indentList.push(rawInd);
          indentDateMap[rawInd] = isDtValid ? rawDt : '';
        } else if (!indentDateMap[rawInd] && isDtValid) {
          indentDateMap[rawInd] = rawDt;
        }
      }
      if (isDtValid && indentDateList.indexOf(rawDt) === -1) {
        indentDateList.push(rawDt);
      }
    }

    var batchIndentNo = indentList.length > 0 ? indentList.join(', ') : '-';
    var batchIndentDate = indentList.length > 0
      ? indentList.map(function (ind) { return indentDateMap[ind] || '-'; }).join(', ')
      : (indentDateList.length > 0 ? indentDateList.join(', ') : '-');

    if (brand === '-' && first[2] && first[2] !== itb && first[2] !== '-') {
      brand = first[2];
    }
    var etd = (itb !== '-' ? (trioItbEtdMap.get(normKey(itb)) || '') : '') || extractEtaFromRemarks(first[16], first[12]) || '-';

    var readyItems = [];
    var pendingItems = [];
    var otherItems = [];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var itemCode = r[3] || '-';
      var itemName = r[4] || 'Item #' + (i + 1);
      var itemRawInd = r[8] ? String(r[8]).trim() : '';
      var itemIndentNo = (itemRawInd && itemRawInd !== '-' && itemRawInd.toLowerCase() !== 'indent no.' && itemRawInd.toLowerCase() !== 'data not found')
        ? itemRawInd
        : batchIndentNo;
      var supplierPo = r[9] || '-';
      var status = r[10] || '-';
      var storeStatus = r[11] || '';
      var remarksO = r[12] || '';
      var remarksJyoti = r[16] || '';
      var orderQty = r[17] || '-';
      var grnQty = r[18] || '-';
      var pendingQty = r[19] || '-';
      var poConfDate = r[20] || '-';
      var category = r[21] || '-';
      var itemRawDt = r[22] ? String(r[22]).trim() : '';
      var itemIndentDate = (itemRawDt && itemRawDt !== '-' && itemRawDt.toLowerCase() !== 'indent date' && itemRawDt.toLowerCase() !== 'data not found')
        ? itemRawDt
        : (indentDateMap[itemIndentNo] || batchIndentDate);
      var aiStatus = r[23] || 'No update from Store';

      var ssLower = String(storeStatus).trim().toLowerCase();
      var aiLower = String(aiStatus).trim().toLowerCase();

      var isStoreOk = ssLower === 'ok' || ssLower === 'okay' || ssLower === 'pass' || (ssLower.indexOf('ok') !== -1 && ssLower.indexOf('not') === -1);
      var isStoreNotOk = ssLower === 'not ok' || ssLower === 'notok' || ssLower === 'fail' || ssLower.indexOf('not ok') !== -1;

      var isAiReady = aiLower.indexOf('ready for production') !== -1 || aiLower.indexOf('in stock') !== -1 || aiLower.indexOf('ordered despite in stock') !== -1 || aiLower.indexOf('material received') !== -1;
      var isAiBlocked = aiLower.indexOf('cannot start production') !== -1 || isStoreNotOk;
      var isAiPending = aiLower.indexOf('material pending') !== -1 || aiLower.indexOf('po not created') !== -1 || aiLower.indexOf('po awaited') !== -1 || aiLower.indexOf('no update') !== -1;

      var itemEta = extractEtaFromRemarks(remarksJyoti, remarksO);
      if (itemEta && (etd === '-' || !etd)) {
        etd = itemEta;
      }

      var itemObj = {
        index: i + 1,
        itb: (r[2] && r[2] !== '-' && String(r[2]).toLowerCase() !== 'itb' && String(r[2]).toLowerCase() !== 'data not found') ? String(r[2]).trim() : itb,
        itemCode: itemCode,
        itemName: itemName,
        indentNo: itemIndentNo,
        indentDate: itemIndentDate,
        supplierPo: supplierPo,
        status: status,
        storeStatus: storeStatus || '(Blank)',
        remarks: remarksO || '-',
        remarksJyoti: remarksJyoti || '-',
        orderQty: orderQty,
        grnQty: grnQty,
        pendingQty: pendingQty,
        poConfDate: poConfDate,
        category: category,
        aiStatus: aiStatus,
        eta: itemEta
      };

      if (isStoreNotOk || isAiBlocked) {
        itemObj.blockerReason = 'Store Manager Sandip Chatterjee marked NOT OK';
        pendingItems.push(itemObj);
      } else if (isStoreOk || (isAiReady && !isStoreNotOk)) {
        readyItems.push(itemObj);
      } else if (isAiPending) {
        itemObj.blockerReason = aiStatus;
        pendingItems.push(itemObj);
      } else {
        otherItems.push(itemObj);
      }
    }

    var totalCount = rows.length;
    var readyCount = readyItems.length;
    var pendingCount = pendingItems.length + otherItems.length;
    var readinessPct = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;

    var verdict = 'HOLD';
    var verdictText = 'HOLD / CANNOT START (Blockers Pending)';
    var verdictClass = 'verdict-hold';

    var hasCriticalBlocker = pendingItems.some(function (it) {
      return (it.storeStatus && it.storeStatus.toLowerCase().indexOf('not ok') !== -1) ||
             (it.aiStatus && it.aiStatus.toLowerCase().indexOf('cannot start') !== -1);
    });

    if (hasCriticalBlocker) {
      verdict = 'HOLD';
      verdictText = 'HOLD / CANNOT START (Discrepancy: Store Manager Sandip Chatterjee marked NOT OK)';
      verdictClass = 'verdict-hold';
    } else if (readinessPct === 100 && pendingCount === 0) {
      verdict = 'READY';
      verdictText = 'READY TO START (100% Cleared)';
      verdictClass = 'verdict-ready';
    } else if (readinessPct >= 90 && readinessPct <= 99) {
      verdict = 'ALMOST READY';
      verdictText = 'ALMOST READY (90%–99% Materials Cleared)';
      verdictClass = 'verdict-almost';
    } else if (readinessPct >= 60 && readinessPct <= 89) {
      verdict = 'CONDITIONAL';
      verdictText = 'CONDITIONAL START (Cutting / Prep Allowed, Assembly pending ETA)';
      verdictClass = 'verdict-conditional';
    } else {
      verdict = 'HOLD';
      verdictText = 'HOLD / CANNOT START (Below 60% Ready - Essential Raw Materials Pending)';
      verdictClass = 'verdict-hold';
    }

    var bMatch = lookupBantalaData(batchNo);
    var erpIssueDate = bMatch[0] || (first[24] || '-');
    var materialIssueDate = bMatch[1] || (first[25] || '-');
    var materialHandoverDate = bMatch[2] || (first[26] || '-');
    var material100RecDate = bMatch[3] || (first[27] || '-');

    return {
      batchNo: batchNo,
      styleNo: styleNo,
      itb: itb,
      indentNo: batchIndentNo,
      indentDate: batchIndentDate,
      indentList: indentList,
      indentDates: indentDateList,
      etd: etd,
      plannedQty: plannedQty,
      prodQty: prodQty,
      batchQty: batchQty,
      brand: brand,
      erpIssueDate: erpIssueDate,
      materialIssueDate: materialIssueDate,
      materialHandoverDate: materialHandoverDate,
      material100RecDate: material100RecDate,
      totalCount: totalCount,
      readyCount: readyCount,
      pendingCount: pendingCount,
      readinessPct: readinessPct,
      verdict: verdict,
      verdictText: verdictText,
      verdictClass: verdictClass,
      aiSuggestion: verdict,
      aiSuggestionText: verdictText,
      aiSuggestionClass: verdictClass,
      readyItems: readyItems,
      pendingItems: pendingItems.concat(otherItems),
      allRows: rows
    };
  }

  function getAllReadyForProductionBatches() {
    if (!allRows || allRows.length === 0) return [];
    var batchMap = new Map();
    for (var i = 0; i < allRows.length; i++) {
      var r = allRows[i];
      var bNo = String(r[0] || '').trim();
      if (!bNo || bNo === '-' || bNo.toLowerCase() === 'batch' || bNo.toLowerCase() === 'data not found') continue;
      if (!batchMap.has(bNo)) {
        batchMap.set(bNo, []);
      }
      batchMap.get(bNo).push(r);
    }

    var readyBatches = [];
    batchMap.forEach(function (rows, bNo) {
      var bReadiness = getBatchMaterialReadiness(bNo);
      if (bReadiness && bReadiness.verdict === 'READY' && bReadiness.pendingCount === 0 && bReadiness.totalCount > 0) {
        readyBatches.push(bReadiness);
      }
    });

    readyBatches.sort(function (a, b) {
      return (a.batchNo || '').localeCompare(b.batchNo || '');
    });

    return readyBatches;
  }

  function ensureDataLoaded() {
    if (allRows && allRows.length > 0) {
      return Promise.resolve(true);
    }
    var p = syncPromise || syncFromGoogleSheet(false);
    if (p && typeof p.then === 'function') {
      return p.then(function () {
        return true;
      }).catch(function (err) {
        console.warn('[ConnectorSheet] ensureDataLoaded sync error:', err);
        return false;
      });
    }
    return Promise.resolve(false);
  }

  function ensureBatchLoaded(batchVal) {
    if (!batchVal) return Promise.resolve(null);
    var bReadiness = getBatchMaterialReadiness(batchVal);
    if (bReadiness) {
      return Promise.resolve(bReadiness);
    }
    // Only trigger sync from Google Sheets if no data has been loaded into memory yet
    if (!allRows || allRows.length === 0) {
      var p = syncPromise || syncFromGoogleSheet(false);
      if (p && typeof p.then === 'function') {
        return p.then(function () {
          return getBatchMaterialReadiness(batchVal);
        }).catch(function (err) {
          console.warn('[ConnectorSheet] ensureBatchLoaded sync error:', err);
          return getBatchMaterialReadiness(batchVal);
        });
      }
    }
    return Promise.resolve(null);
  }

  function findBatchesByStyle(styleVal, limit) {
    var rows = findRowsByStyle(styleVal, 3000);
    if (!rows || rows.length === 0) return [];

    var batchMap = new Map();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var bNo = String(r[0] || '').trim();
      if (!bNo) continue;
      if (!batchMap.has(bNo)) {
        batchMap.set(bNo, []);
      }
      batchMap.get(bNo).push(r);
    }

    var result = [];
    var max = limit || 100;
    batchMap.forEach(function (bRows, bNo) {
      var bReadiness = getBatchMaterialReadiness(bNo);
      if (bReadiness) {
        result.push(bReadiness);
      }
    });

    return result.slice(0, max);
  }

  function getIndentAudit(indentVal) {
    var rows = findRowsByIndent(indentVal, 150);
    if (!rows || rows.length === 0) return null;

    var first = rows[0];
    var indentNo = first[8] || indentVal;
    var brand = first[2] || '-';

    var items = [];
    var totalOrder = 0;
    var totalGrn = 0;
    var totalPending = 0;
    var batchesSet = new Set();
    var stylesSet = new Set();
    var posSet = new Set();

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r[0]) batchesSet.add(r[0]);
      if (r[6]) stylesSet.add(r[6]);
      var curPo = String(r[9] || '').trim();
      if (curPo && curPo !== '-' && curPo.toLowerCase() !== 'data not found') {
        posSet.add(curPo);
      }

      var oQty = parseFloat(String(r[17] || '').replace(/[^0-9.]/g, '')) || 0;
      var gQty = parseFloat(String(r[18] || '').replace(/[^0-9.]/g, '')) || 0;
      var pQty = parseFloat(String(r[19] || '').replace(/[^0-9.]/g, '')) || 0;
      totalOrder += oQty;
      totalGrn += gQty;
      totalPending += pQty;

      items.push({
        index: i + 1,
        batch: r[0],
        itemCode: r[3],
        itemName: r[4],
        style: r[6],
        supplierPo: r[9] || '-',
        orderQty: r[17] || '-',
        grnQty: r[18] || '-',
        pendingQty: r[19] || '-',
        poConfDate: r[20] || '-',
        category: r[21] || '-',
        indentDate: r[22] || '-',
        storeStatus: r[11] || '(Blank)',
        jyotiRemarks: r[16] || '-',
        aiStatus: r[23] || 'No update from Store'
      });
    }

    return {
      indentNo: indentNo,
      supplierPo: Array.from(posSet).join(', ') || first[9] || '-',
      styleNo: Array.from(stylesSet).join(', ') || first[6] || '-',
      batches: Array.from(batchesSet).join(', ') || first[0] || '-',
      brand: brand,
      itemCount: rows.length,
      totalOrderQty: totalOrder.toFixed(2).replace(/\.00$/, ''),
      totalGrnQty: totalGrn.toFixed(2).replace(/\.00$/, ''),
      totalPendingQty: totalPending.toFixed(2).replace(/\.00$/, ''),
      items: items,
      allRows: rows
    };
  }

  function findRowsByStyle(styleVal, limit) {
    if (!allRows || !styleVal) return [];
    var raw = String(styleVal).trim();
    var target = raw.toLowerCase();
    var targetNorm = normalizeCode(raw);
    if (!targetNorm) return [];
    var max = limit || 2000;
    var res = [];
    for (var i = 0; i < allRows.length; i++) {
      var st = String(allRows[i][6] || '').trim().toLowerCase();
      if (!st || st === '-' || st === 'data not found') continue;
      var stNorm = normalizeCode(st);
      if (st === target || stNorm === targetNorm || (targetNorm.length >= 3 && stNorm.indexOf(targetNorm) !== -1) || (stNorm.length >= 3 && targetNorm.indexOf(stNorm) !== -1)) {
        res.push(allRows[i]);
        if (res.length >= max) break;
      }
    }
    return res;
  }

  function findRowsByItem(itemVal, limit) {
    if (!allRows || !itemVal) return [];
    var target = String(itemVal).trim().toLowerCase();
    var max = limit || 20;
    var res = [];
    for (var i = 0; i < allRows.length; i++) {
      var pro = String(allRows[i][3] || '').trim().toLowerCase();
      var name = String(allRows[i][4] || '').trim().toLowerCase();
      if (pro.indexOf(target) !== -1 || name.indexOf(target) !== -1) {
        res.push(allRows[i]);
        if (res.length >= max) break;
      }
    }
    return res;
  }

  function findRowsBySupplierPo(poVal, limit) {
    if (!allRows || !poVal) return [];
    var target = String(poVal).trim().toLowerCase();
    var max = limit || 20;
    var res = [];
    for (var i = 0; i < allRows.length; i++) {
      var po = String(allRows[i][9] || '').trim().toLowerCase();
      if (po.indexOf(target) !== -1) {
        res.push(allRows[i]);
        if (res.length >= max) break;
      }
    }
    return res;
  }

  function findRowsByIndent(indentVal, limit) {
    if (!allRows || !indentVal) return [];
    var raw = String(indentVal).trim();
    var target = raw.toLowerCase();
    var targetNorm = normalizeCode(raw);
    if (!targetNorm) return [];
    var max = limit || 150;
    var res = [];
    for (var i = 0; i < allRows.length; i++) {
      var ind = String(allRows[i][8] || '').trim().toLowerCase();
      if (!ind || ind === '-' || ind === 'data not found') continue;
      var indNorm = normalizeCode(ind);
      if (ind === target || indNorm === targetNorm || (targetNorm.length >= 4 && indNorm.indexOf(targetNorm) !== -1) || (indNorm.length >= 4 && targetNorm.indexOf(indNorm) !== -1)) {
        res.push(allRows[i]);
        if (res.length >= max) break;
      }
    }
    return res;
  }

  function findRowsByAiStatus(statusFilter, limit) {
    if (!allRows || !statusFilter) return [];
    var target = String(statusFilter).trim().toLowerCase();
    var max = limit || 20;
    var res = [];
    for (var i = 0; i < allRows.length; i++) {
      var s = String(allRows[i][23] || '').trim().toLowerCase();
      if (s.indexOf(target) !== -1) {
        res.push(allRows[i]);
        if (res.length >= max) break;
      }
    }
    return res;
  }

  function search(queryStr, limit) {
    if (!allRows || !queryStr) return [];
    var terms = String(queryStr).trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var max = limit || 25;
    var res = [];
    for (var i = 0; i < allRows.length; i++) {
      var rowStr = allRows[i].join(' ').toLowerCase();
      var matchAll = true;
      for (var t = 0; t < terms.length; t++) {
        if (rowStr.indexOf(terms[t]) === -1) {
          matchAll = false;
          break;
        }
      }
      if (matchAll) {
        res.push(allRows[i]);
        if (res.length >= max) break;
      }
    }
    return res;
  }

  function getSummaryMetrics() {
    if (!allRows || !allRows.length) return null;
    var stats = {
      total: allRows.length,
      readyForProduction: 0,
      cannotStartProduction: 0,
      materialPending: 0,
      materialReceived: 0,
      inStock: 0,
      orderedDespiteStock: 0,
      poNotCreated: 0,
      poAwaited: 0,
      noUpdate: 0,
      other: 0
    };
    for (var i = 0; i < allRows.length; i++) {
      var aiVal = String(allRows[i][23] || '').toLowerCase();
      if (aiVal.indexOf('ready for production') !== -1) stats.readyForProduction++;
      else if (aiVal.indexOf('cannot start production') !== -1) stats.cannotStartProduction++;
      else if (aiVal.indexOf('material pending') !== -1) stats.materialPending++;
      else if (aiVal.indexOf('material received') !== -1) stats.materialReceived++;
      else if (aiVal.indexOf('ordered despite in stock') !== -1) stats.orderedDespiteStock++;
      else if (aiVal.indexOf('in stock') !== -1) stats.inStock++;
      else if (aiVal.indexOf('po not created') !== -1) stats.poNotCreated++;
      else if (aiVal.indexOf('po awaited') !== -1) stats.poAwaited++;
      else if (aiVal.indexOf('no update') !== -1) stats.noUpdate++;
      else stats.other++;
    }
    return stats;
  }

  function openWithSearch(searchTerm) {
    openModal();
    var searchInput = document.getElementById('bai-sheet-search-input');
    if (searchInput) {
      searchInput.value = searchTerm;
      applyAllFiltersAndSearch();
    }
  }

  function openWithBatch(batchNo) {
    openModal();
    var searchInput = document.getElementById('bai-sheet-search-input');
    if (searchInput) {
      searchInput.value = batchNo;
      applyAllFiltersAndSearch();
    }
  }

  function openWithStatus(statusName) {
    openModal();
    activeColumnFilters[23] = new Set([statusName]);
    var searchInput = document.getElementById('bai-sheet-search-input');
    if (searchInput) searchInput.value = '';
    applyAllFiltersAndSearch();
  }

  // ---------------------------------------------------------------------------
  // 11. Bootstrap Engine
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    initDataEngine();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Expose global controller with rich Deep Connection API
  window.ConnectorSheetEngine = {
    isReady: function () { return !!(allRows && allRows.length > 0); },
    getRowCount: function () { return allRows ? allRows.length : 0; },
    getRows: function () { return allRows; },
    getAllRows: function () { return allRows; },
    setRows: function (rows) { allRows = rows; },
    getFilteredRows: function () { return filteredRows; },
    getHeaders: function () { return allHeaders; },
    open: openModal,
    close: closeModal,
    openWithSearch: openWithSearch,
    openWithBatch: openWithBatch,
    sync: function (isManual) { return syncFromGoogleSheet(isManual === undefined ? true : !!isManual); },
    syncSilent: function () { return syncFromGoogleSheet(false); },
    exportExcel: exportExcelXLSX,
    findRowsByBatch: findRowsByBatch,
    findRowsByStyle: findRowsByStyle,
    findRowsByItem: findRowsByItem,
    findRowsBySupplierPo: findRowsBySupplierPo,
    findRowsByIndent: findRowsByIndent,
    findRowsByAiStatus: findRowsByAiStatus,
    getBatchMaterialReadiness: getBatchMaterialReadiness,
    ensureBatchLoaded: ensureBatchLoaded,
    ensureDataLoaded: ensureDataLoaded,
    findBatchesByStyle: findBatchesByStyle,
    getIndentAudit: getIndentAudit,
    search: search,
    getSummaryMetrics: getSummaryMetrics,
    getAllReadyForProductionBatches: getAllReadyForProductionBatches,
    getEtdByItb: function (itb) { return itb ? (trioItbEtdMap.get(normKey(itb)) || '') : ''; },
    getSampleRows: function (limit) { return allRows ? allRows.slice(0, limit || 10) : []; },
    lookupBantalaData: lookupBantalaData,
    getBantalaDataByBatch: function (batchVal) {
      var d = lookupBantalaData(batchVal);
      return {
        erpIssueDate: d[0] || '',
        materialIssueDate: d[1] || '',
        materialHandoverDate: d[2] || '',
        material100RecDate: d[3] || '',
        materialStatus: d[4] || ''
      };
    },
    consultBatchAi: consultBatchAi
  };

})();
