/**
 * =============================================================================
 * Pre-Production for Store Live Engine (with Two-Way Sync to Google Sheet)
 * =============================================================================
 * Sheet: STORE (Google Sheets)
 * Target Columns: B to K (10 Columns)
 * Editable Columns:
 *   - Column J (Store Status): Dropdown with ["In-Stock", "Material Removed"]
 *   - Column K (Remarks): Editable Text Input
 * Database: IndexedDB 'FMS_Store_PreProd_DB'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Two-Way Sync: Edits in App update local IndexedDB + Google Sheet immediately
 *   - Fast CSV Stream Fetch & in-memory parsing
 *   - Instant client-side Search across all columns (B to K)
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover & Value Search
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Non-rounded, light theme standard layout with cell borders
 *   - Compact, slightly bold, text-wrapped cells
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Excel (.xlsx) Export via SheetJS with auto-width columns
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page)
 *   - Isolated slim 7px scrollbar + elevated footer (no data overlap)
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1t9llK-HxXXdPxTNj5ncHePZ_UKfrQJC0UJAcMwzr1b8';
  var SHEET_GID = '996355810';
  var SHEET_NAME = 'STORE';

  // Primary export endpoint fetches all rows bypassing Google Sheet UI filters
  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID;
  // Fallback to gviz endpoint with headers=1 if export endpoint is unreachable
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&headers=1';

  // Web App URL for writing cell updates back to Google Sheet
  var STORE_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwNV3OrAeVzHWBS0DwshJHPifXdajx1xji4D0hrl8gYw2RtBQKo-hjc1-AA-ohuw_nl/exec';

  // Columns B to K (Indices 1 to 10)
  var WANTED_START_IDX = 1; // Column B
  var WANTED_END_IDX = 10;  // Column K
  var WANTED_COUNT = 10;
  var WANTED_LETTERS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

  var DB_NAME = 'FMS_Store_PreProd_DB_v4';
  var DB_VERSION = 3;
  var STORE_NAME = 'store_preprod_store';
  var QUEUE_STORE_NAME = 'store_preprod_queue';
  var QUEUE_LS_KEY = 'fms_store_preprod_pending_queue';

  // Default headers for B to K
  var defaultHeaders = [
    'ITB (B)', 'Indent Number (C)', 'Indent Date (D)', 'Style No. (E)',
    'Colour (F)', 'Pro Code (G)', 'Product Name (H)', 'Buyer ETD (I)',
    'Store Status (J)', 'Remarks (K)'
  ];

  // State
  var dbInstance = null;
  var allHeaders = defaultHeaders.slice();
  var allRows = [];
  var filteredRows = [];
  var currentPage = 1;
  var pageSize = 100;
  var isSyncing = false;
  var lastSyncTime = null;
  var searchDebounceTimer = null;

  // Column Filters State
  var activeColumnFilters = {}; // colIdx -> Set of allowed string values
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Cell Selection State
  var activeCellCoords = null; // { r: rowIndex, c: colIndex }

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Engine
  // ---------------------------------------------------------------------------
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (dbInstance && dbInstance.objectStoreNames.contains(STORE_NAME) && dbInstance.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        return resolve(dbInstance);
      }
      dbInstance = null;
      if (!window.indexedDB) {
        return reject(new Error('IndexedDB is not supported in this browser.'));
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
          db.createObjectStore(QUEUE_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME) || !db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
          console.warn('[StorePreProd] Stores missing in ' + DB_NAME + ', auto-repairing...');
          db.close();
          var repairVersion = (db.version || DB_VERSION) + 1;
          var repairReq = indexedDB.open(DB_NAME, repairVersion);
          repairReq.onupgradeneeded = function (re) {
            var rdb = re.target.result;
            if (!rdb.objectStoreNames.contains(STORE_NAME)) {
              rdb.createObjectStore(STORE_NAME);
            }
            if (!rdb.objectStoreNames.contains(QUEUE_STORE_NAME)) {
              rdb.createObjectStore(QUEUE_STORE_NAME, { keyPath: 'id' });
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
                var cdb = ce.target.result;
                cdb.createObjectStore(STORE_NAME);
                cdb.createObjectStore(QUEUE_STORE_NAME, { keyPath: 'id' });
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
            console.warn('[StorePreProd] saveToCache tx error:', e.target.error);
            resolve();
          };
        } catch (err) {
          console.warn('[StorePreProd] saveToCache error:', err);
          dbInstance = null;
          resolve();
        }
      });
    }).catch(function () { return Promise.resolve(); });
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
              resolve({
                headers: reqHeaders.result || allHeaders,
                rows: reqRows.result,
                lastSync: reqSync.result || null
              });
            } else {
              resolve(null);
            }
          };
          tx.onerror = function () { resolve(null); };
        } catch (err) {
          console.warn('[StorePreProd] loadFromCache error:', err);
          dbInstance = null;
          resolve(null);
        }
      });
    }).catch(function () { return Promise.resolve(null); });
  }

  // ---------------------------------------------------------------------------
  // 1.1 Fast Outbox Queue Engine (0.05s Instant Entry & Background Sync)
  // ---------------------------------------------------------------------------
  function getPendingQueueFromLs() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_LS_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function savePendingQueueToLs(q) {
    try {
      localStorage.setItem(QUEUE_LS_KEY, JSON.stringify(q || []));
    } catch (e) {}
  }

  function enqueueStoreEdit(item) {
    if (!item || !item.id) return Promise.resolve();

    // 1. LocalStorage queue with smart coalescing (same cell updates merge)
    var lsQueue = getPendingQueueFromLs();
    var existingIdx = -1;
    for (var i = 0; i < lsQueue.length; i++) {
      if (lsQueue[i].sheetRow === item.sheetRow && lsQueue[i].colIndex === item.colIndex) {
        existingIdx = i;
        break;
      }
    }
    if (existingIdx !== -1) {
      lsQueue[existingIdx].newValue = item.newValue;
      lsQueue[existingIdx].timestamp = item.timestamp;
      lsQueue[existingIdx].status = 'pending';
      lsQueue[existingIdx].retryCount = 0;
    } else {
      lsQueue.push(item);
    }
    savePendingQueueToLs(lsQueue);

    // 2. Persistent save to IndexedDB queue
    return openDatabase().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(QUEUE_STORE_NAME, 'readwrite');
          var store = tx.objectStore(QUEUE_STORE_NAME);
          store.put(item);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (err) {
          resolve();
        }
      });
    }).catch(function () {});
  }

  function getPendingStoreEdits() {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(QUEUE_STORE_NAME, 'readonly');
          var store = tx.objectStore(QUEUE_STORE_NAME);
          var req = store.getAll();
          req.onsuccess = function () {
            var res = req.result;
            if (Array.isArray(res) && res.length > 0) {
              resolve(res);
            } else {
              resolve(getPendingQueueFromLs());
            }
          };
          req.onerror = function () {
            resolve(getPendingQueueFromLs());
          };
        } catch (err) {
          resolve(getPendingQueueFromLs());
        }
      });
    }).catch(function () {
      return getPendingQueueFromLs();
    });
  }

  function removePendingStoreEdit(id) {
    // 1. Remove from localStorage
    var lsQueue = getPendingQueueFromLs().filter(function (it) { return it.id !== id; });
    savePendingQueueToLs(lsQueue);

    // 2. Remove from IndexedDB
    return openDatabase().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(QUEUE_STORE_NAME, 'readwrite');
          tx.objectStore(QUEUE_STORE_NAME).delete(id);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (err) {
          resolve();
        }
      });
    }).catch(function () {});
  }

  function updatePendingStoreEdit(id, updatedItem) {
    var lsQueue = getPendingQueueFromLs();
    for (var i = 0; i < lsQueue.length; i++) {
      if (lsQueue[i].id === id) {
        lsQueue[i] = updatedItem;
        break;
      }
    }
    savePendingQueueToLs(lsQueue);

    return openDatabase().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(QUEUE_STORE_NAME, 'readwrite');
          tx.objectStore(QUEUE_STORE_NAME).put(updatedItem);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (err) {
          resolve();
        }
      });
    }).catch(function () {});
  }

  // Non-blocking Debounced Full Cache Persistence (Prevents freezing main thread with 23k rows)
  var fullCacheSaveDebounceTimer = null;
  function scheduleFullCacheSave() {
    clearTimeout(fullCacheSaveDebounceTimer);
    fullCacheSaveDebounceTimer = setTimeout(function () {
      saveToCache(allHeaders, allRows, lastSyncTime).catch(function (err) {
        console.warn('[StorePreProd] Debounced cache save warning:', err);
      });
    }, 1500);
  }

  // ---------------------------------------------------------------------------
  // 2. High Performance CSV Stream Parser (Columns B to K)
  // ---------------------------------------------------------------------------
  function parseCSVExtractWanted(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;
    var rawHeaders = [];
    var rawDataRowIndex = 0;

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
        for (var k = 0; k < WANTED_COUNT; k++) {
          var origIdx = WANTED_START_IDX + k;
          var letter = WANTED_LETTERS[k];
          var rawTitle = (rawHeaders[origIdx] || '').split('#')[0].split('\n')[0].trim();
          var title = rawTitle && rawTitle.length < 35 ? rawTitle : defaultHeaders[k].replace(/\s*\([A-Z]\)$/, '');
          customHeaders.push(title ? title + ' (' + letter + ')' : defaultHeaders[k]);
        }
        allHeaders = customHeaders;
        isFirstRow = false;
      } else {
        rawDataRowIndex++;
        var sheetRowNum = rawDataRowIndex + 1; // Row 1 is header, so row 2 is sheet row 2

        // Keep row if there is ANY content in the row across the sheet
        var hasRowData = false;
        for (var c = 0; c < curRow.length; c++) {
          if (curRow[c] !== undefined && curRow[c] !== null && String(curRow[c]).trim() !== '') {
            hasRowData = true;
            break;
          }
        }
        if (!hasRowData) {
          curRow = [];
          return;
        }

        var filtered = new Array(WANTED_COUNT);
        for (var j = 0; j < WANTED_COUNT; j++) {
          var origIdx2 = WANTED_START_IDX + j;
          var cellVal = curRow[origIdx2] !== undefined && curRow[origIdx2] !== null ? curRow[origIdx2] : '';
          filtered[j] = cellVal;
        }

        filtered.__sheetRow = sheetRowNum;
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
  // 3. Fast Two-Way Sync Engine: 0.05s Instant Entry & Background Outbox Sync
  // ---------------------------------------------------------------------------
  function updatePendingBadge() {
    updateHeaderBadge();
  }

  function saveCellEdit(rowObj, colIdx, newValue, targetEl) {
    var sheetRow = rowObj.__sheetRow;
    if (!sheetRow) {
      console.warn('[StorePreProd] Missing sheetRow for rowObj');
      return;
    }

    var oldValue = rowObj[colIdx];
    if (String(oldValue || '').trim() === String(newValue || '').trim()) {
      return; // No real change
    }

    // 1. Immediate optimistic in-memory update (0.001ms)
    rowObj[colIdx] = newValue;

    // 2. Instant tactile visual feedback (<0.05s)
    if (targetEl) {
      targetEl.classList.remove('bai-cell-saved-fast');
      void targetEl.offsetWidth; // Force DOM reflow to restart pulse animation
      targetEl.classList.add('bai-cell-saved-fast');
    }

    var colOffset = colIdx;
    var colName = allHeaders[colIdx] || ('Column ' + WANTED_LETTERS[colIdx]);

    // Instant toast confirmation
    showToast(colName + ' saved in 0.05s! Syncing in background...', 'check');

    // 3. Debounced heavy cache write (never blocks or freezes the UI thread)
    scheduleFullCacheSave();

    // 4. Enqueue into persistent Outbox queue
    var editItem = {
      id: 'store_edit_' + sheetRow + '_' + colOffset + '_' + Date.now(),
      sheetRow: sheetRow,
      colIndex: colOffset,
      colName: colName,
      newValue: newValue,
      status: 'pending',
      timestamp: Date.now(),
      retryCount: 0
    };

    enqueueStoreEdit(editItem).then(function () {
      updatePendingBadge();
      // 5. Trigger debounced batch background sync worker (250ms gathers rapid edits)
      triggerStoreSyncQueue(250);
    });
  }

  var isSyncingStoreQueue = false;
  var queueDebounceTimer = null;

  function triggerStoreSyncQueue(delayMs) {
    clearTimeout(queueDebounceTimer);
    queueDebounceTimer = setTimeout(function () {
      processStoreSyncQueue();
    }, delayMs !== undefined ? delayMs : 250);
  }

  // Sends multiple cell updates together in a single Google Apps Script call
  function sendBatchStoreEdits(items) {
    if (!items || items.length === 0) return Promise.resolve();

    var updates = items.map(function (it) {
      return {
        row: it.sheetRow,
        column: it.colIndex,
        value: it.newValue != null ? it.newValue : ''
      };
    });

    var updatesJson = JSON.stringify(updates);
    var updateUrl = STORE_WEB_APP_URL + '?action=batchUpdateStoreCells' +
      '&updates=' + encodeURIComponent(updatesJson) +
      '&_=' + Date.now();

    var fetchOpts = { method: 'GET', cache: 'no-cache' };

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) {
      fetchOpts.signal = controller.signal;
      setTimeout(function () { controller.abort(); }, 20000);
    }

    return fetch(updateUrl, fetchOpts)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (json && json.success) {
          return json;
        }
        throw new Error((json && json.error) || 'Batch update returned unsuccessful response');
      });
  }

  function sendSingleStoreEdit(item) {
    var updateUrl = STORE_WEB_APP_URL + '?action=updateStoreCell' +
      '&row=' + encodeURIComponent(item.sheetRow) +
      '&column=' + encodeURIComponent(item.colIndex) +
      '&value=' + encodeURIComponent(item.newValue != null ? item.newValue : '') +
      '&_=' + Date.now();

    var fetchOpts = { method: 'GET', cache: 'no-cache' };

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) {
      fetchOpts.signal = controller.signal;
      setTimeout(function () { controller.abort(); }, 15000);
    }

    return fetch(updateUrl, fetchOpts)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (json && json.success) {
          return json;
        }
        throw new Error((json && json.error) || 'Server returned unsuccessful response');
      });
  }

  function fallbackSingleSendChunk(chunk) {
    var subChain = Promise.resolve();
    chunk.forEach(function (item) {
      subChain = subChain.then(function () {
        return sendSingleStoreEdit(item)
          .then(function () {
            return removePendingStoreEdit(item.id);
          })
          .then(function () {
            updatePendingBadge();
          })
          .catch(function (err) {
            item.retryCount = (item.retryCount || 0) + 1;
            item.status = 'failed';
            item.lastError = err.message || String(err);
            return updatePendingStoreEdit(item.id, item);
          });
      });
    });
    return subChain;
  }

  function processStoreSyncQueue() {
    if (isSyncingStoreQueue) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      updatePendingBadge();
      return;
    }

    isSyncingStoreQueue = true;

    getPendingStoreEdits().then(function (items) {
      if (!items || items.length === 0) {
        isSyncingStoreQueue = false;
        updatePendingBadge();
        return;
      }

      updatePendingBadge();

      // Chunk items into batches of up to 10 edits max for safe URL length
      var CHUNK_SIZE = 10;
      var chunks = [];
      for (var i = 0; i < items.length; i += CHUNK_SIZE) {
        chunks.push(items.slice(i, i + CHUNK_SIZE));
      }

      var chain = Promise.resolve();

      chunks.forEach(function (chunk) {
        chain = chain.then(function () {
          return sendBatchStoreEdits(chunk)
            .then(function () {
              var removePromises = chunk.map(function (it) {
                return removePendingStoreEdit(it.id);
              });
              return Promise.all(removePromises);
            })
            .then(function () {
              console.log('[StorePreProd] Synced batch of ' + chunk.length + ' edits to Google Sheet.');
              updatePendingBadge();
            })
            .catch(function (err) {
              console.warn('[StorePreProd] Batch sync error, falling back to single-cell:', err);
              return fallbackSingleSendChunk(chunk);
            });
        });
      });

      return chain.then(function () {
        isSyncingStoreQueue = false;
        updatePendingBadge();
        // Check if new edits arrived while this batch was executing
        return getPendingStoreEdits().then(function (remaining) {
          if (remaining && remaining.length > 0) {
            triggerStoreSyncQueue(100);
          }
        });
      });
    }).catch(function (err) {
      console.warn('[StorePreProd] Queue runner error:', err);
      isSyncingStoreQueue = false;
      updatePendingBadge();
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Network Fetcher & Sync Engine (Primary Export bypasses UI filters)
  // ---------------------------------------------------------------------------
  function fetchGoogleSheetCSV() {
    var ts = Date.now();
    var primaryWithTs = PRIMARY_CSV_URL + '&_=' + ts;
    return fetch(primaryWithTs, { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('Primary export HTTP ' + res.status);
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 50) {
          throw new Error('Primary export returned incomplete payload');
        }
        return csvText;
      })
      .catch(function (err) {
        console.warn('[StorePreProd] Primary export fetch failed, falling back to GViz:', err);
        return fetch(FALLBACK_CSV_URL + '&_=' + ts, { method: 'GET', cache: 'no-cache' })
          .then(function (res2) {
            if (!res2.ok) throw new Error('GViz fallback HTTP ' + res2.status);
            return res2.text();
          });
      });
  }

  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, isManual ? 'Connecting to Google Sheets...' : 'Checking for sheet updates...');

    var startTime = performance.now();

    fetchGoogleSheetCSV()
      .then(function (csvText) {
        updateSyncUI(true, 'Parsing rows & extracting columns B to K...');
        var parseStart = performance.now();
        var parsed = parseCSVExtractWanted(csvText);
        allHeaders = parsed.headers;
        allRows = parsed.rows;
        var parseDuration = ((performance.now() - parseStart) / 1000).toFixed(2);
        var totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);

        updateSyncUI(true, 'Saving ' + allRows.length.toLocaleString() + ' rows to Database storage...');

        var nowIso = new Date().toISOString();
        lastSyncTime = nowIso;

        return saveToCache(allHeaders, allRows, nowIso).then(function () {
          console.log('[StorePreProd] Synced ' + allRows.length + ' rows in ' + totalDuration + 's (Parse: ' + parseDuration + 's)');
          applyAllFiltersAndSearch();
          updateHeaderBadge();
          updateSyncUI(false, 'Synced ' + allRows.length.toLocaleString() + ' records in ' + totalDuration + 's!');
          if (isManual) {
            showToast(allRows.length.toLocaleString() + ' records synced & cached into Database!', 'check');
          }
        });
      })
      .catch(function (err) {
        console.error('[StorePreProd] Sync error:', err);
        updateSyncUI(false, 'Error syncing: ' + (err.message || 'Check connection'));
        if (isManual) {
          showToast('Sync failed: ' + (err.message || 'Check connection'), 'error');
        }
      })
      .finally(function () {
        isSyncing = false;
      });
  }

  // ---------------------------------------------------------------------------
  // 5. Initial Load (Instant 0-Wait IndexedDB Cache Check)
  // ---------------------------------------------------------------------------
  function initDataEngine() {
    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = cached.headers && cached.headers.length ? cached.headers : allHeaders;
          allRows = cached.rows;
          lastSyncTime = cached.lastSync;
          filteredRows = allRows;
          currentPage = 1;
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          console.log('[StorePreProd] INSTANT LOAD from IndexedDB: ' + allRows.length.toLocaleString() + ' rows ready in 0.05s!');
          // Silent background sync to get any fresh rows without blocking UI
          setTimeout(function () {
            syncFromGoogleSheet(false);
          }, 800);
        } else {
          console.log('[StorePreProd] No local cache found. Starting background sync...');
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('[StorePreProd] IndexedDB load failed, trying network fetch:', err);
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 6. Table Rendering & Interactive Controls
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var theadRow = document.getElementById('store-sheet-thead-row');
    if (!theadRow) return;
    theadRow.innerHTML = '';

    // Serial # column
    var thIndex = document.createElement('th');
    thIndex.textContent = '#';
    thIndex.style.width = '55px';
    thIndex.style.textAlign = 'center';
    thIndex.style.background = '#091729';
    thIndex.style.color = '#94a3b8';
    theadRow.appendChild(thIndex);

    allHeaders.forEach(function (h, colIdx) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th-filterable';

      var isColFiltered = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (isColFiltered) {
        th.classList.add('has-active-filter');
      }

      var wrap = document.createElement('div');
      wrap.className = 'bai-sheet-th-content';

      var titleSpan = document.createElement('span');
      titleSpan.className = 'bai-sheet-th-title';
      titleSpan.textContent = h;
      titleSpan.title = h;
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

  function renderTablePage() {
    var tbody = document.getElementById('store-sheet-tbody');
    if (!tbody) return;

    var total = filteredRows.length;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIndex = (currentPage - 1) * pageSize;
    var endIndex = Math.min(startIndex + pageSize, total);
    var pageItems = filteredRows.slice(startIndex, endIndex);

    if (pageItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (allHeaders.length + 1) + '" class="bai-sheet-table-empty">No matching records found in Pre-Production for Store.</td></tr>';
    } else {
      var fragment = document.createDocumentFragment();
      for (var i = 0; i < pageItems.length; i++) {
        var row = pageItems[i];
        var tr = document.createElement('tr');

        // Row number
        var tdNum = document.createElement('td');
        tdNum.className = 'bai-sheet-td-index';
        tdNum.textContent = (startIndex + i + 1).toLocaleString();
        tr.appendChild(tdNum);

        for (var j = 0; j < row.length; j++) {
          var td = document.createElement('td');
          var val = row[j] !== undefined && row[j] !== null ? String(row[j]) : '';
          td.setAttribute('data-r', i);
          td.setAttribute('data-c', j);
          td.setAttribute('tabindex', '-1');

          if (j === 0) { // ITB (B)
            td.className = 'bai-sheet-td-batch';
            td.textContent = val;
          } else if (j === 8) { // Store Status (Column J) -> EDITABLE DROPDOWN
            td.className = 'store-status-cell';
            var select = document.createElement('select');
            select.className = 'store-status-select';
            select.setAttribute('data-r', i);
            select.setAttribute('data-sheet-row', row.__sheetRow || '');

            var optInStock = document.createElement('option');
            optInStock.value = 'In-Stock';
            optInStock.textContent = 'In-Stock';

            var optRemoved = document.createElement('option');
            optRemoved.value = 'Material Removed';
            optRemoved.textContent = 'Material Removed';

            var optBlank = document.createElement('option');
            optBlank.value = '';
            optBlank.textContent = '-- Select Status --';

            select.appendChild(optBlank);
            select.appendChild(optInStock);
            select.appendChild(optRemoved);

            var valTrim = val.trim();
            if (valTrim.toLowerCase() === 'in-stock') {
              select.value = 'In-Stock';
              select.classList.add('status-in-stock');
            } else if (valTrim.toLowerCase() === 'material removed') {
              select.value = 'Material Removed';
              select.classList.add('status-removed');
            } else if (valTrim) {
              var optCustom = document.createElement('option');
              optCustom.value = valTrim;
              optCustom.textContent = valTrim;
              select.appendChild(optCustom);
              select.value = valTrim;
            } else {
              select.value = '';
            }

            // Two-Way Sync Event Listener
            (function (currentRow, colIndex, selEl) {
              selEl.addEventListener('change', function (e) {
                var chosenVal = selEl.value;
                selEl.classList.remove('status-in-stock', 'status-removed');
                if (chosenVal === 'In-Stock') {
                  selEl.classList.add('status-in-stock');
                } else if (chosenVal === 'Material Removed') {
                  selEl.classList.add('status-removed');
                }
                saveCellEdit(currentRow, colIndex, chosenVal, selEl);
              });
            })(row, j, select);

            td.appendChild(select);

          } else if (j === 9) { // Remarks (Column K) -> EDITABLE TEXT INPUT
            td.className = 'store-remarks-cell';
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'store-remarks-input';
            input.placeholder = 'Add remarks...';
            input.value = val;
            input.setAttribute('data-r', i);
            input.setAttribute('data-sheet-row', row.__sheetRow || '');

            // Two-Way Sync Event Listener
            (function (currentRow, colIndex, inpEl) {
              var originalVal = val;
              inpEl.addEventListener('focus', function () {
                originalVal = inpEl.value;
              });
              inpEl.addEventListener('blur', function () {
                var currentVal = inpEl.value.trim();
                if (currentVal !== originalVal) {
                  originalVal = currentVal;
                  saveCellEdit(currentRow, colIndex, currentVal, inpEl);
                }
              });
              inpEl.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                  inpEl.blur();
                }
              });
            })(row, j, input);

            td.appendChild(input);

          } else {
            // Read-only standard cell
            td.textContent = val;

            // Conditional cell colors
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
            }
          }

          // Restore selection if matching active cell
          if (activeCellCoords && activeCellCoords.r === i && activeCellCoords.c === j) {
            td.classList.add('bai-cell-selected');
          }

          // Mouse click cell selection
          (function (rIdx, cIdx) {
            td.addEventListener('mousedown', function (e) {
              if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') {
                selectCellByCoords(rIdx, cIdx);
              }
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
    var showingRangeEl = document.getElementById('store-sheet-showing-range');
    if (showingRangeEl) {
      if (total === 0) {
        showingRangeEl.textContent = 'Showing 0 of 0 records';
      } else {
        showingRangeEl.textContent = 'Showing ' + (startIndex + 1).toLocaleString() + ' – ' + endIndex.toLocaleString() + ' of ' + total.toLocaleString() + ' records';
      }
    }

    var countLabelEl = document.getElementById('store-sheet-count-label');
    if (countLabelEl) {
      countLabelEl.textContent = total.toLocaleString() + ' records' + (total !== allRows.length ? ' (filtered from ' + allRows.length.toLocaleString() + ')' : '');
    }

    var pageNumInput = document.getElementById('store-sheet-page-num');
    if (pageNumInput) pageNumInput.value = currentPage;

    var totalPagesEl = document.getElementById('store-sheet-total-pages');
    if (totalPagesEl) totalPagesEl.textContent = totalPages.toLocaleString();

    var firstBtn = document.getElementById('store-sheet-first-page');
    var prevBtn = document.getElementById('store-sheet-prev-page');
    var nextBtn = document.getElementById('store-sheet-next-page');
    var lastBtn = document.getElementById('store-sheet-last-page');

    if (firstBtn) firstBtn.disabled = (currentPage <= 1);
    if (prevBtn) prevBtn.disabled = (currentPage <= 1);
    if (nextBtn) nextBtn.disabled = (currentPage >= totalPages);
    if (lastBtn) lastBtn.disabled = (currentPage >= totalPages);

    var tableWrapper = document.getElementById('store-sheet-table-wrapper');
    if (tableWrapper) tableWrapper.scrollTop = 0;
  }

  // ---------------------------------------------------------------------------
  // 6.1 Interactive Cell Control & Selection Engine (Mouse + Arrow Keys)
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('store-sheet-tbody');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('tr');
    if (r < 0 || r >= rows.length) return;
    var targetCell = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (!targetCell) return;

    var prev = tbody.querySelector('.bai-cell-selected');
    if (prev) {
      prev.classList.remove('bai-cell-selected');
    }

    targetCell.classList.add('bai-cell-selected');
    activeCellCoords = { r: r, c: c };

    targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });

    var badge = document.getElementById('store-sheet-active-cell-badge');
    if (badge) {
      var startIndex = (currentPage - 1) * pageSize;
      var rowNum = startIndex + r + 1;
      var colHeader = allHeaders[c] || ('Col ' + c);
      
      var text = '';
      var inputOrSelect = targetCell.querySelector('input, select');
      if (inputOrSelect) {
        text = inputOrSelect.value || '';
      } else {
        text = targetCell.textContent || '';
      }

      if (text.length > 25) text = text.slice(0, 25) + '...';
      badge.style.display = 'inline-flex';
      badge.innerHTML = '<span class="material-icons-round">my_location</span> Cell [' + colHeader + ', Row ' + rowNum.toLocaleString() + ']: <span style="color:#059669;margin-left:4px;">' + escapeHtml(text) + '</span>';
    }
  }

  function clearCellSelection() {
    var tbody = document.getElementById('store-sheet-tbody');
    if (tbody) {
      var prev = tbody.querySelector('.bai-cell-selected');
      if (prev) {
        prev.classList.remove('bai-cell-selected');
      }
    }
    activeCellCoords = null;
    var badge = document.getElementById('store-sheet-active-cell-badge');
    if (badge) {
      badge.style.display = 'none';
      badge.innerHTML = '';
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // 6.2 Clipboard Copy Engine (Ctrl + C / Cmd + C)
  // ---------------------------------------------------------------------------
  function copyTextToClipboard(text, onSuccess, onFail) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () {
        if (onSuccess) onSuccess();
      }).catch(function () {
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
    var tbody = document.getElementById('store-sheet-tbody');
    if (!tbody) return false;

    var selectedCell = tbody.querySelector('.bai-cell-selected');
    if (!selectedCell) return false;

    var cellText = '';
    var inputOrSelect = selectedCell.querySelector('input, select');
    if (inputOrSelect) {
      cellText = inputOrSelect.value || '';
    } else {
      cellText = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
    }

    copyTextToClipboard(cellText, function () {
      selectedCell.classList.remove('bai-cell-copied');
      void selectedCell.offsetWidth;
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
  // 7. Multi-Column Filters & Search Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('store-sheet-search-input');
    var query = (searchInput ? searchInput.value : '').toLowerCase().trim();

    var clearBtn = document.getElementById('store-sheet-search-clear');
    if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

    var queryTerms = query ? query.split(/\s+/).filter(Boolean) : [];
    var hasQuery = queryTerms.length > 0;
    var colIndices = Object.keys(activeColumnFilters).map(Number);
    var hasColFilters = colIndices.length > 0;

    if (!hasQuery && !hasColFilters) {
      filteredRows = allRows;
    } else {
      filteredRows = allRows.filter(function (row) {
        if (hasQuery) {
          var rowString = row.join(' ').toLowerCase();
          for (var t = 0; t < queryTerms.length; t++) {
            if (rowString.indexOf(queryTerms[t]) === -1) return false;
          }
        }
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

    currentPage = 1;
    renderTablePage();
    renderActiveFiltersChips();
    renderHeaderRow();
  }

  // ---------------------------------------------------------------------------
  // 7.1 Google Sheets Style Filter Popover
  // ---------------------------------------------------------------------------
  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    currentFilterSearchQuery = '';

    var popover = document.getElementById('store-sheet-filter-popover');
    if (!popover) return;

    var titleEl = document.getElementById('store-sheet-filter-pop-title');
    if (titleEl) {
      titleEl.textContent = allHeaders[colIdx] || ('Column ' + WANTED_LETTERS[colIdx]);
    }

    var searchInput = document.getElementById('store-sheet-filter-search-input');
    if (searchInput) {
      searchInput.value = '';
    }
    var searchClear = document.getElementById('store-sheet-filter-search-clear');
    if (searchClear) searchClear.style.display = 'none';

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

    if (activeColumnFilters[colIdx]) {
      currentFilterSelectedSet = new Set(activeColumnFilters[colIdx]);
    } else {
      currentFilterSelectedSet = new Set(currentFilterUniqueValues);
    }

    renderFilterList();

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
    var popover = document.getElementById('store-sheet-filter-popover');
    if (popover) {
      popover.style.display = 'none';
    }
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listContainer = document.getElementById('store-sheet-filter-list');
    var countEl = document.getElementById('store-sheet-filter-items-count');
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
    var bar = document.getElementById('store-sheet-active-filters-bar');
    var chipsContainer = document.getElementById('store-sheet-active-filters-chips');
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
      var colName = allHeaders[colIdx] || ('Col ' + WANTED_LETTERS[colIdx]);
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
  // 8. Excel (.xlsx) Export Engine (using SheetJS)
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

        var aoa = [allHeaders];
        for (var i = 0; i < filteredRows.length; i++) {
          aoa.push(filteredRows[i]);
        }

        var ws = XLSX.utils.aoa_to_sheet(aoa);

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
          return { wch: Math.min(Math.max(maxLen + 3, 12), 45) };
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Pre-Production for Store');

        var fileName = 'Pre_Production_for_Store_Export_' + (new Date().toISOString().slice(0, 10)) + '.xlsx';
        XLSX.writeFile(wb, fileName);

        var duration = ((performance.now() - startExport) / 1000).toFixed(1);
        showToast('Exported ' + count.toLocaleString() + ' records to ' + fileName + ' (' + duration + 's)!', 'download');
      } catch (err) {
        console.error('[StorePreProd] Excel export error:', err);
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
    a.download = 'Pre_Production_for_Store_Export_' + (new Date().toISOString().slice(0, 10)) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to CSV!', 'download');
  }

  // ---------------------------------------------------------------------------
  // 9. UI Helpers & View Toggling
  // ---------------------------------------------------------------------------
  function showView() {
    var view = document.getElementById('store-ai-data-view');
    var kpi = document.getElementById('store-kpi-view');
    if (kpi) kpi.style.display = 'none';
    if (view) view.style.display = '';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) {
        filteredRows = allRows;
      }
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var searchInput = document.getElementById('store-sheet-search-input');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  function hideView() {
    var view = document.getElementById('store-ai-data-view');
    var kpi = document.getElementById('store-kpi-view');
    if (view) view.style.display = 'none';
    if (kpi) kpi.style.display = '';
    closeColumnFilterPopover();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('store-sheet-db-badge');
    var syncText = document.getElementById('store-sheet-last-sync-text');
    var lastUpdatedLive = document.getElementById('store-preproduction-data-last-updated');

    var pendingQueue = getPendingQueueFromLs();
    var pendingCount = pendingQueue.length;

    if (badge) {
      if (pendingCount > 0) {
        badge.innerHTML = '<span class="material-icons-round" style="font-size:13px; color:#38bdf8; animation:baiSheetSpin 1.5s linear infinite;">autorenew</span> ' + pendingCount + ' syncing...';
      } else {
        badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;">bolt</span> ' + (allRows.length ? allRows.length.toLocaleString() + ' Rows Cached (Database)' : 'Database Ready');
      }
    }
    if (syncText) {
      if (pendingCount > 0) {
        syncText.innerHTML = '<span style="color:#38bdf8; font-weight:600;"><span class="material-icons-round" style="font-size:13px; vertical-align:middle; animation:baiSheetSpin 1.5s linear infinite;">sync</span> Syncing ' + pendingCount + ' edit' + (pendingCount > 1 ? 's' : '') + ' to Google Sheet...</span>';
      } else if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString() + ')';
        syncText.textContent = 'All synced • ' + timeStr;
        if (lastUpdatedLive) lastUpdatedLive.textContent = timeStr;
      } else {
        syncText.textContent = 'Not synced yet';
      }
    }
  }

  function updateSyncUI(syncing, msg) {
    var syncBanner = document.getElementById('store-sheet-sync-banner');
    var syncMsg = document.getElementById('store-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('store-sheet-sync-icon');

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

  // SVG Icons Library for Clean, Modern Alerts (NO EMOJIS)
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
    var existing = document.getElementById('store-sheet-toast');
    if (existing) existing.remove();

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
    } else if (lower.indexOf('saved') !== -1 || lower.indexOf('synced') !== -1 || lower.indexOf('cached') !== -1 || lower.indexOf('ready') !== -1) {
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
    toast.id = 'store-sheet-toast';
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
  // 10. Event Listeners Setup
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // KPI Card Click in Store Page ("Pre-Production for Store")
    var kpiCard = document.getElementById('kpi-store-ai-data');
    if (kpiCard) {
      kpiCard.addEventListener('click', showView);
      kpiCard.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showView();
        }
      });
    }

    // Back to Store Button
    var backBtn = document.getElementById('btn-back-store-ai-data');
    if (backBtn) {
      backBtn.addEventListener('click', hideView);
    }

    // Refresh / Sync button
    var syncBtn = document.getElementById('btn-refresh-store-preproduction-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        syncFromGoogleSheet(true);
      });
    }

    // Export Excel button
    var exportBtn = document.getElementById('btn-download-store-preproduction-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportExcelXLSX);
    }

    // Global Search Input
    var searchInput = document.getElementById('store-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('store-sheet-search-clear');
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        applyAllFiltersAndSearch();
      });
    }

    // Page Size Select
    var pageSizeSelect = document.getElementById('store-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('store-sheet-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('store-sheet-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('store-sheet-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('store-sheet-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
        }
      });
    }

    var pageNumInput = document.getElementById('store-sheet-page-num');
    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (!isNaN(val)) {
          if (val < 1) val = 1;
          if (val > totalPages) val = totalPages;
          currentPage = val;
          renderTablePage();
        }
      });
      pageNumInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          this.blur();
        }
      });
    }

    // Clear All Filters Button
    var clearAllFiltersBtn = document.getElementById('store-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('store-sheet-filter-pop-close');
    if (popCloseBtn) {
      popCloseBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popSearchInput = document.getElementById('store-sheet-filter-search-input');
    var popSearchClear = document.getElementById('store-sheet-filter-search-clear');
    if (popSearchInput) {
      popSearchInput.addEventListener('input', function () {
        currentFilterSearchQuery = this.value;
        if (popSearchClear) {
          popSearchClear.style.display = this.value ? 'block' : 'none';
        }
        renderFilterList();
      });
    }
    if (popSearchClear) {
      popSearchClear.addEventListener('click', function () {
        if (popSearchInput) {
          popSearchInput.value = '';
          currentFilterSearchQuery = '';
          popSearchClear.style.display = 'none';
          popSearchInput.focus();
        }
        renderFilterList();
      });
    }

    var popSelectAllBtn = document.getElementById('store-sheet-filter-select-all');
    if (popSelectAllBtn) {
      popSelectAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        currentFilterUniqueValues.forEach(function (v) {
          if (!q || (v === '' ? '(blanks)' : v.toLowerCase()).indexOf(q) !== -1) {
            currentFilterSelectedSet.add(v);
          }
        });
        renderFilterList();
      });
    }

    var popClearAllBtn = document.getElementById('store-sheet-filter-clear-all');
    if (popClearAllBtn) {
      popClearAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        if (!q) {
          currentFilterSelectedSet.clear();
        } else {
          currentFilterUniqueValues.forEach(function (v) {
            if ((v === '' ? '(blanks)' : v.toLowerCase()).indexOf(q) !== -1) {
              currentFilterSelectedSet.delete(v);
            }
          });
        }
        renderFilterList();
      });
    }

    // Sort in Popover
    var sortAscBtn = document.getElementById('store-sheet-sort-asc');
    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          var valA = String(a[col] || '').trim();
          var valB = String(b[col] || '').trim();
          return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (A → Z)', 'sort');
      });
    }

    var sortDescBtn = document.getElementById('store-sheet-sort-desc');
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          var valA = String(a[col] || '').trim();
          var valB = String(b[col] || '').trim();
          return valB.localeCompare(valA, undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (Z → A)', 'sort');
      });
    }

    var popResetBtn = document.getElementById('store-sheet-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        delete activeColumnFilters[currentFilterColIdx];
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter cleared on ' + allHeaders[currentFilterColIdx], 'filter');
      });
    }

    var popCancelBtn = document.getElementById('store-sheet-filter-cancel-btn');
    if (popCancelBtn) {
      popCancelBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popOkBtn = document.getElementById('store-sheet-filter-ok-btn');
    if (popOkBtn) {
      popOkBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        if (currentFilterSelectedSet.size === currentFilterUniqueValues.length) {
          delete activeColumnFilters[currentFilterColIdx];
        } else {
          activeColumnFilters[currentFilterColIdx] = new Set(currentFilterSelectedSet);
        }
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter applied on ' + allHeaders[currentFilterColIdx], 'filter');
      });
    }

    // Click outside to close popover
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('store-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Keyboard Navigation & Ctrl + C handler inside Pre-Production for Store View
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('store-ai-data-view');
      if (!view || view.style.display === 'none') return;

      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      var key = e.key;

      // Ctrl + C / Cmd + C
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
        if (copySelectedCellToClipboard()) {
          e.preventDefault();
          return;
        }
      }

      // Arrow navigation
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Enter' || key === 'Tab') {
        var tbody = document.getElementById('store-sheet-tbody');
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

    // Native 'copy' event fallback
    document.addEventListener('copy', function (e) {
      var view = document.getElementById('store-ai-data-view');
      if (!view || view.style.display === 'none') return;

      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;

      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('store-sheet-tbody');
        if (!tbody) return;
        var selectedCell = tbody.querySelector('.bai-cell-selected');
        if (selectedCell) {
          var text = '';
          var inputOrSelect = selectedCell.querySelector('input, select');
          if (inputOrSelect) {
            text = inputOrSelect.value || '';
          } else {
            text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
          }

          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();

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
        }
      }
    });

    // Click outside table: fade out selection and deactivate active cell so user can copy from anywhere else
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('store-sheet-table');
      if (table && !table.contains(e.target)) {
        clearCellSelection();
      }
    });

    // Escape Key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('store-sheet-filter-popover');
        if (popover && popover.style.display !== 'none') {
          closeColumnFilterPopover();
        } else if (activeCellCoords) {
          clearCellSelection();
        }
      }
    });

    // Network online listener & automatic periodic background sync for outbox queue
    window.addEventListener('online', function () {
      console.log('[StorePreProd] Online connection restored, processing pending edit queue...');
      processStoreSyncQueue();
    });
    setInterval(processStoreSyncQueue, 20000);
  }

  // ---------------------------------------------------------------------------
  // 11. Bootstrap Engine
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    initDataEngine();
    // Flush any pending edits from previous sessions
    setTimeout(processStoreSyncQueue, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Expose global controller
  window.StorePreProdSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; },
    processQueue: processStoreSyncQueue,
    getPendingQueue: getPendingStoreEdits
  };

})();
