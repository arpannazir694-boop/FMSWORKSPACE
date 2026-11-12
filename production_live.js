/**
 * =============================================================================
 * Production Live - Live Broadcast & Shopfloor News Bulletin Engine
 * =============================================================================
 * Subview in Production Data: "Production Live"
 * News-style live feed for batches pending ERP Issue Date in Connector Sheet.
 * Displays:
 *   - Batch No
 *   - ITB
 *   - Indent No & Indent Date
 *   - Style No
 *   - Batch Qty
 *   - Ready components count (koto gulo item ready ache)
 *   - Pending components count (koto gulo ready nai)
 *   - Readiness % gauge & progress bar
 *   - Live Bottleneck Alert
 *   - Breaking News Ticker & Hero KPIs
 * =============================================================================
 */

(function () {
  'use strict';

  var DB_CONNECTOR_NAME = 'FMS_Connector_DB';
  var DB_CONNECTOR_STORE = 'connector_store';
  var DB_BANTALA_NAME = 'FMS_Bantala_Details_DB_v2';
  var DB_BANTALA_STORE = 'bantala_store';
  var DB_BATCH_CUTTING_NAME = 'FMS_Batch_Cutting_DB_v2';
  var DB_BATCH_CUTTING_STORE = 'batch_cutting_store';
  var DB_CUTTING_DETAILS_NAME = 'FMS_Cutting_Details_DB_v2';
  var DB_CUTTING_META_STORE = 'cutting_meta';

  var BATCH_CUTTING_CSV_URL = 'https://docs.google.com/spreadsheets/d/1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E/export?format=csv&gid=1625638521&range=A1:N';

  // State
  var allBatches = [];
  var filteredBatches = [];
  var currentFilterChannel = 'all'; // 'all', 'ready', 'cond', 'hold'
  var currentSearchQuery = '';
  var currentSortMode = 'readiness_desc'; // 'readiness_desc', 'readiness_asc', 'qty_desc', 'batch_asc', 'date_desc'
  var currentViewMode = 'news'; // 'news', 'grid', 'table'
  var selectedCategories = new Set(['HB', 'SLG']);
  var isLoading = false;
  var searchDebounceTimer = null;
  var tickerRotateTimer = null;

  // Cached Maps for O(1) Instant Lookups
  var cachedBantalaMap = new Map();
  var cachedCuttingCategoryMap = new Map();

  // ---------------------------------------------------------------------------
  // 1. Data Retrieval Engine (Connector + Bantala Details)
  // ---------------------------------------------------------------------------
  function loadConnectorRowsFromDB() {
    if (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.getAllRows === 'function') {
      var inMem = window.ConnectorSheetEngine.getAllRows();
      if (inMem && Array.isArray(inMem) && inMem.length > 0) {
        return Promise.resolve(inMem);
      }
    }

    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve([]);
      try {
        var req = indexedDB.open(DB_CONNECTOR_NAME, 2);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(DB_CONNECTOR_STORE)) {
            db.createObjectStore(DB_CONNECTOR_STORE);
          }
        };
        req.onsuccess = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(DB_CONNECTOR_STORE)) {
            db.close();
            return resolve([]);
          }
          try {
            var tx = db.transaction(DB_CONNECTOR_STORE, 'readonly');
            var store = tx.objectStore(DB_CONNECTOR_STORE);
            var reqRows = store.get('rows');
            tx.oncomplete = function () {
              db.close();
              resolve(reqRows.result || []);
            };
            tx.onerror = function () {
              db.close();
              resolve([]);
            };
          } catch (txErr) {
            db.close();
            resolve([]);
          }
        };
        req.onerror = function () { resolve([]); };
      } catch (err) {
        resolve([]);
      }
    });
  }

  var BANTALA_CSV_URL = 'https://docs.google.com/spreadsheets/d/1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E/export?format=csv&gid=1526950534&range=A1:H';

  function parseSimpleCSV(text) {
    if (!text) return [];
    var lines = text.split(/\r?\n/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || !line.trim()) continue;
      var row = [];
      var inQuotes = false;
      var current = '';
      for (var c = 0; c < line.length; c++) {
        var ch = line[c];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          row.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      row.push(current.trim());
      rows.push(row);
    }
    return rows;
  }

  function fetchBantalaCsvDirect() {
    return fetch(BANTALA_CSV_URL + '&_=' + Date.now(), { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        if (!text || text.indexOf('<!DOCTYPE html') !== -1) return [];
        var rows = parseSimpleCSV(text);
        if (rows && rows.length > 1) {
          try {
            if (window.indexedDB) {
              var req = indexedDB.open(DB_BANTALA_NAME, 2);
              req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(DB_BANTALA_STORE)) {
                  db.createObjectStore(DB_BANTALA_STORE);
                }
              };
              req.onsuccess = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(DB_BANTALA_STORE)) {
                  db.close();
                  return;
                }
                try {
                  var tx = db.transaction(DB_BANTALA_STORE, 'readwrite');
                  tx.objectStore(DB_BANTALA_STORE).put(rows, 'rows');
                  tx.oncomplete = function () { db.close(); };
                  tx.onerror = function () { db.close(); };
                } catch (txErr) {
                  db.close();
                }
              };
            }
          } catch (e) {}
          return rows;
        }
        return [];
      })
      .catch(function () { return []; });
  }

  function loadBantalaRowsFromDB() {
    if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.getRows === 'function') {
      var inMem = window.BantalaDetailsSheetEngine.getRows();
      if (inMem && Array.isArray(inMem) && inMem.length > 0) {
        return Promise.resolve(inMem);
      }
    }

    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve([]);
      try {
        var req = indexedDB.open(DB_BANTALA_NAME, 2);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(DB_BANTALA_STORE)) {
            db.createObjectStore(DB_BANTALA_STORE);
          }
        };
        req.onsuccess = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(DB_BANTALA_STORE)) {
            db.close();
            return resolve([]);
          }
          try {
            var tx = db.transaction(DB_BANTALA_STORE, 'readonly');
            var store = tx.objectStore(DB_BANTALA_STORE);
            var reqRows = store.get('rows');
            tx.oncomplete = function () {
              db.close();
              resolve(reqRows.result || []);
            };
            tx.onerror = function () {
              db.close();
              resolve([]);
            };
          } catch (txErr) {
            db.close();
            resolve([]);
          }
        };
        req.onerror = function () { resolve([]); };
      } catch (err) {
        resolve([]);
      }
    }).then(function (cached) {
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached;
      }
      return fetchBantalaCsvDirect();
    });
  }

  function fetchCuttingCsvDirect() {
    return fetch(BATCH_CUTTING_CSV_URL + '&_=' + Date.now(), { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        if (!text || text.indexOf('<!DOCTYPE html') !== -1) return [];
        var rows = parseSimpleCSV(text);
        if (rows && rows.length > 1) {
          var dataRows = rows.slice(1);
          try {
            if (window.indexedDB) {
              var req = indexedDB.open(DB_BATCH_CUTTING_NAME, 1);
              req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(DB_BATCH_CUTTING_STORE)) {
                  db.createObjectStore(DB_BATCH_CUTTING_STORE);
                }
              };
              req.onsuccess = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(DB_BATCH_CUTTING_STORE)) {
                  db.close();
                  return;
                }
                try {
                  var tx = db.transaction(DB_BATCH_CUTTING_STORE, 'readwrite');
                  tx.objectStore(DB_BATCH_CUTTING_STORE).put(dataRows, 'rows');
                  tx.oncomplete = function () { db.close(); };
                  tx.onerror = function () { db.close(); };
                } catch (txErr) {
                  db.close();
                }
              };
            }
          } catch (e) {}
          return dataRows;
        }
        return [];
      })
      .catch(function () { return []; });
  }

  function loadCuttingRowsFromDB() {
    // 1. In-memory BatchCuttingSheetEngine
    if (window.BatchCuttingSheetEngine && typeof window.BatchCuttingSheetEngine.getRows === 'function') {
      var inMem = window.BatchCuttingSheetEngine.getRows();
      if (inMem && Array.isArray(inMem) && inMem.length > 0) {
        return Promise.resolve(inMem);
      }
    }
    // 2. In-memory CuttingDetailsEngine
    if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.getRows === 'function') {
      var inMem2 = window.CuttingDetailsEngine.getRows();
      if (inMem2 && Array.isArray(inMem2) && inMem2.length > 0) {
        return Promise.resolve(inMem2);
      }
    }

    // 3. IndexedDB 'FMS_Batch_Cutting_DB_v2' -> 'batch_cutting_store'
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve([]);
      try {
        var req = indexedDB.open(DB_BATCH_CUTTING_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(DB_BATCH_CUTTING_STORE)) {
            db.createObjectStore(DB_BATCH_CUTTING_STORE);
          }
        };
        req.onsuccess = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(DB_BATCH_CUTTING_STORE)) {
            db.close();
            return resolve([]);
          }
          try {
            var tx = db.transaction(DB_BATCH_CUTTING_STORE, 'readonly');
            var store = tx.objectStore(DB_BATCH_CUTTING_STORE);
            var reqRows = store.get('rows');
            tx.oncomplete = function () {
              db.close();
              resolve(reqRows.result || []);
            };
            tx.onerror = function () {
              db.close();
              resolve([]);
            };
          } catch (txErr) {
            db.close();
            resolve([]);
          }
        };
        req.onerror = function () { resolve([]); };
      } catch (err) {
        resolve([]);
      }
    }).then(function (cached) {
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached;
      }
      // 4. Fallback to IndexedDB 'FMS_Cutting_Details_DB_v2' -> 'cutting_meta'
      return new Promise(function (resolve) {
        if (!window.indexedDB) return resolve([]);
        try {
          var req2 = indexedDB.open(DB_CUTTING_DETAILS_NAME, 2);
          req2.onsuccess = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(DB_CUTTING_META_STORE)) {
              db.close();
              return resolve([]);
            }
            try {
              var tx = db.transaction(DB_CUTTING_META_STORE, 'readonly');
              var store = tx.objectStore(DB_CUTTING_META_STORE);
              var reqRows = store.get('rows');
              tx.oncomplete = function () {
                db.close();
                resolve(reqRows.result || []);
              };
              tx.onerror = function () {
                db.close();
                resolve([]);
              };
            } catch (txErr) {
              db.close();
              resolve([]);
            }
          };
          req2.onerror = function () { resolve([]); };
        } catch (e) {
          resolve([]);
        }
      });
    }).then(function (cached2) {
      if (cached2 && Array.isArray(cached2) && cached2.length > 0) {
        return cached2;
      }
      return fetchCuttingCsvDirect();
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

  function normBatch(str) {
    return String(str || '').trim().toUpperCase();
  }

  function normBatchClean(str) {
    return String(str || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  }

  function buildBantalaMap(bantalaRows) {
    var bMap = new Map();
    if (!bantalaRows || !Array.isArray(bantalaRows)) return bMap;
    for (var b = 0; b < bantalaRows.length; b++) {
      var br = bantalaRows[b];
      if (!br || br.length === 0) continue;
      var rawB = br[0];
      if (!rawB || rawB === '-' || rawB.toLowerCase() === 'batch' || rawB.toLowerCase() === 'batch no' || rawB.toLowerCase() === 'batch no.' || !/\d/.test(String(rawB))) continue;

      var erp = (br[3] !== undefined && br[3] !== null) ? String(br[3]).trim() : '';
      var erpClean = (erp && erp !== '-' && erp !== '--' && erp.toLowerCase() !== 'data not found' && erp.toLowerCase() !== 'n/a' && erp.toLowerCase() !== 'null') ? erp : '';
      var matStatus = (br[7] !== undefined && br[7] !== null) ? String(br[7]).trim() : '';
      var isSample = matStatus ? (matStatus.toUpperCase().indexOf('SAMPLE') !== -1) : false;

      var bKeys = getBatchLookupKeys(rawB);
      for (var k = 0; k < bKeys.length; k++) {
        var key = bKeys[k];
        if (!bMap.has(key)) {
          bMap.set(key, {
            erpDate: erpClean,
            materialStatus: matStatus,
            isSample: isSample
          });
        } else {
          var exist = bMap.get(key);
          if (exist && typeof exist === 'object') {
            if (!exist.erpDate && erpClean) exist.erpDate = erpClean;
            if (!exist.materialStatus && matStatus) exist.materialStatus = matStatus;
            if (isSample) exist.isSample = true;
          }
        }
      }
    }
    return bMap;
  }

  function lookupBantalaStatus(bNo, optBantalaMap) {
    if (!bNo) return '';
    var map = (optBantalaMap && optBantalaMap.size > 0) ? optBantalaMap : cachedBantalaMap;
    if (map && map.size > 0) {
      var keys = getBatchLookupKeys(bNo);
      for (var k = 0; k < keys.length; k++) {
        if (map.has(keys[k])) {
          var entry = map.get(keys[k]);
          if (entry && typeof entry === 'object' && entry.materialStatus) {
            return entry.materialStatus;
          }
        }
      }
    }

    // Fallback 1: window.ConnectorSheetEngine lookupBantalaData
    if (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.lookupBantalaData === 'function') {
      var bData = window.ConnectorSheetEngine.lookupBantalaData(bNo);
      if (bData && bData[4]) {
        return String(bData[4]).trim();
      }
    }

    // Fallback 2: window.BantalaDetailsSheetEngine in-memory rows
    if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.getRows === 'function') {
      var bRows = window.BantalaDetailsSheetEngine.getRows();
      if (bRows && bRows.length > 0 && (!cachedBantalaMap || cachedBantalaMap.size === 0)) {
        cachedBantalaMap = buildBantalaMap(bRows);
        return lookupBantalaStatus(bNo, cachedBantalaMap);
      }
    }

    return '';
  }

  function isBantalaSampleBatch(bNo, optBantalaMap) {
    if (!bNo) return false;
    var map = (optBantalaMap && optBantalaMap.size > 0) ? optBantalaMap : cachedBantalaMap;
    if (map && map.size > 0) {
      var keys = getBatchLookupKeys(bNo);
      for (var k = 0; k < keys.length; k++) {
        if (map.has(keys[k])) {
          var entry = map.get(keys[k]);
          if (entry && typeof entry === 'object') {
            if (entry.isSample) return true;
            if (entry.materialStatus && entry.materialStatus.toUpperCase().indexOf('SAMPLE') !== -1) return true;
          }
        }
      }
    }

    var st = lookupBantalaStatus(bNo, optBantalaMap);
    if (st && st.toUpperCase().indexOf('SAMPLE') !== -1) {
      return true;
    }
    return false;
  }

  function buildCuttingCategoryMap(rows) {
    var map = new Map();
    if (!rows || !Array.isArray(rows)) return map;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.length === 0) continue;
      // In CUTTING DETAILS (14 columns A-N):
      // Col 9 (index 8): BATCH NO. (e.g. TT-0689)
      // Col 12 (index 11): CATEGORY (e.g. HB or SLG)
      // Col 13 (index 12): BATCH (e.g. TT-0689/26-27)
      var cat = (r[11] !== undefined && r[11] !== null) ? String(r[11]).trim().toUpperCase() : '';
      if (!cat) continue;

      var bNo = (r[8] !== undefined && r[8] !== null) ? String(r[8]).trim() : '';
      var bBatch = (r[12] !== undefined && r[12] !== null) ? String(r[12]).trim() : '';

      if (bNo && bNo !== '-' && bNo.toLowerCase() !== 'batch no.') {
        var k1 = getBatchLookupKeys(bNo);
        for (var j = 0; j < k1.length; j++) {
          map.set(k1[j], cat);
        }
      }

      if (bBatch && bBatch !== '-' && bBatch.toLowerCase() !== 'batch') {
        var k2 = getBatchLookupKeys(bBatch);
        for (var m = 0; m < k2.length; m++) {
          map.set(k2[m], cat);
        }
      }
    }
    return map;
  }

  function lookupBatchCategory(bNo, optCuttingMap) {
    if (!bNo) return '';
    var map = (optCuttingMap && optCuttingMap.size > 0) ? optCuttingMap : cachedCuttingCategoryMap;
    if (map && map.size > 0) {
      var keys = getBatchLookupKeys(bNo);
      for (var k = 0; k < keys.length; k++) {
        if (map.has(keys[k])) {
          var c = map.get(keys[k]);
          if (c) return c;
        }
      }
    }

    // Fallback: window.CuttingDetailsEngine
    if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.lookupBatchSync === 'function') {
      var obj = window.CuttingDetailsEngine.lookupBatchSync(bNo);
      if (obj && obj.category) {
        var cVal = String(obj.category).trim().toUpperCase();
        if (cVal) return cVal;
      }
    }

    // Fallback: window.BatchCuttingSheetEngine
    if (window.BatchCuttingSheetEngine && typeof window.BatchCuttingSheetEngine.getRows === 'function') {
      var bRows = window.BatchCuttingSheetEngine.getRows();
      if (bRows && bRows.length > 0 && (!cachedCuttingCategoryMap || cachedCuttingCategoryMap.size === 0)) {
        cachedCuttingCategoryMap = buildCuttingCategoryMap(bRows);
        return lookupBatchCategory(bNo, cachedCuttingCategoryMap);
      }
    }

    return '';
  }

  // ---------------------------------------------------------------------------
  // 2. High-Performance Batch Readiness & Exclusion Engine
  // ---------------------------------------------------------------------------
  var FAST_CACHE_KEY = 'FMS_PROD_LIVE_CACHE_V7';
  var SILENT_REFRESH_INTERVAL_MS = 10000;
  var silentRefreshTimer = null;
  var isSilentRefreshing = false;

  function saveFastCache(batches) {
    if (!batches || !batches.length) return;
    try {
      var leanList = batches.map(function (b) {
        return {
          batchNo: b.batchNo,
          category: b.category || 'HB',
          styleNo: b.styleNo,
          itb: b.itb,
          indentNo: b.indentNo,
          indentDate: b.indentDate,
          batchQty: b.batchQty,
          plannedQty: b.plannedQty,
          prodQty: b.prodQty,
          totalCount: b.totalCount,
          readyCount: b.readyCount,
          pendingCount: b.pendingCount,
          readinessPct: b.readinessPct,
          verdict: b.verdict,
          verdictText: b.verdictText,
          readyItems: b.readyItems,
          pendingItems: b.pendingItems
        };
      });
      localStorage.setItem(FAST_CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        count: leanList.length,
        data: leanList
      }));
    } catch (e) {
      console.warn('[ProductionLive] Fast cache save warning:', e);
    }
  }

  function loadFromFastCache() {
    try {
      var raw = localStorage.getItem(FAST_CACHE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
        // Filter out any Bantala SAMPLE batches
        allBatches = parsed.data.filter(function (b) {
          if (isBantalaSampleBatch(b.batchNo)) return false;
          return true;
        });
        updateKpiCardCount();
        updateCategoryFilterUI();
        return true;
      }
    } catch (e) {
      console.warn('[ProductionLive] Fast cache read warning:', e);
    }
    return false;
  }

  function updateKpiCardCount() {
    var kpiCard = document.getElementById('kpi-production-live');
    if (!kpiCard) return;
    var count = allBatches ? allBatches.length : 0;
    var badge = kpiCard.querySelector('.prod-live-badge-live');
    if (badge) {
      badge.textContent = 'LIVE';
      badge.title = count > 0 ? (count + ' Live Batches') : 'Live Broadcast Active';
    }
  }

  function flashSyncPulse(active) {
    var badge = document.getElementById('prod-live-sync-indicator');
    var badgeText = document.getElementById('prod-live-sync-badge-text');
    if (!badge) return;

    if (active) {
      badge.classList.add('prod-live-heartbeat-active');
      if (badgeText) badgeText.textContent = 'Syncing Live (10s)...';
    } else {
      badge.classList.remove('prod-live-heartbeat-active');
      var now = new Date();
      var hh = String(now.getHours()).padStart(2, '0');
      var mm = String(now.getMinutes()).padStart(2, '0');
      var ss = String(now.getSeconds()).padStart(2, '0');
      if (badgeText) {
        badgeText.innerHTML = 'Live Broadcast &bull; 10s Auto-Sync <span style="opacity:0.8; font-size:10px; font-weight:600; margin-left:4px;">(' + hh + ':' + mm + ':' + ss + ')</span>';
      }
    }
  }

  function startSilentRefresh() {
    stopSilentRefresh();
    silentRefreshTimer = setInterval(function () {
      var liveView = document.getElementById('batch-list-production-live-view');
      // If liveView is not open or hidden, skip this tick without destroying interval
      if (liveView && liveView.style.display === 'none') {
        return;
      }
      silentBackgroundRefresh();
    }, SILENT_REFRESH_INTERVAL_MS);
  }

  function stopSilentRefresh() {
    if (silentRefreshTimer) {
      clearInterval(silentRefreshTimer);
      silentRefreshTimer = null;
    }
  }

  function silentBackgroundRefresh() {
    if (isSilentRefreshing) return;
    isSilentRefreshing = true;
    flashSyncPulse(true);

    // 1. Call ConnectorSheetEngine.syncSilent() to pull latest rows from Google Sheets
    var connSync = null;
    if (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.syncSilent === 'function') {
      connSync = window.ConnectorSheetEngine.syncSilent();
    } else if (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.sync === 'function') {
      connSync = window.ConnectorSheetEngine.sync(false);
    }

    // 2. Call BatchCuttingSheetEngine.syncSilent() to pull latest Category updates from Google Sheets
    var cuttingSync = null;
    if (window.BatchCuttingSheetEngine && typeof window.BatchCuttingSheetEngine.syncSilent === 'function') {
      cuttingSync = window.BatchCuttingSheetEngine.syncSilent();
    } else {
      cuttingSync = fetchCuttingCsvDirect().then(function (cRows) {
        if (cRows && cRows.length > 0) {
          cachedCuttingCategoryMap = buildCuttingCategoryMap(cRows);
        }
      });
    }

    // 3. Call BantalaDetailsSheetEngine.syncSilent() to pull latest Bantala updates from Google Sheets
    var bantalaSync = null;
    if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.syncSilent === 'function') {
      bantalaSync = window.BantalaDetailsSheetEngine.syncSilent();
    } else if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.sync === 'function') {
      bantalaSync = window.BantalaDetailsSheetEngine.sync();
    } else {
      bantalaSync = fetchBantalaCsvDirect().then(function (bRows) {
        if (bRows && bRows.length > 0) {
          cachedBantalaMap = buildBantalaMap(bRows);
        }
      });
    }

    Promise.all([Promise.resolve(connSync), Promise.resolve(cuttingSync), Promise.resolve(bantalaSync)]).then(function () {
      var banRows = window.BantalaDetailsSheetEngine ? window.BantalaDetailsSheetEngine.getRows() : null;
      if (banRows && banRows.length > 0) {
        cachedBantalaMap = buildBantalaMap(banRows);
      }
      var cutRows = window.BatchCuttingSheetEngine ? window.BatchCuttingSheetEngine.getRows() : null;
      if (cutRows && cutRows.length > 0) {
        cachedCuttingCategoryMap = buildCuttingCategoryMap(cutRows);
      }
      var freshRows = window.ConnectorSheetEngine ? window.ConnectorSheetEngine.getAllRows() : null;
      if (freshRows && freshRows.length > 0) {
        processRowsIntoLiveBatches(freshRows, cachedBantalaMap, cachedCuttingCategoryMap);
      } else {
        loadConnectorRowsFromDB().then(function (dbRows) {
          if (dbRows && dbRows.length > 0) {
            processRowsIntoLiveBatches(dbRows, cachedBantalaMap, cachedCuttingCategoryMap);
          }
        });
      }
    }).catch(function (err) {
      console.warn('[ProductionLive] Silent sync warning:', err);
    }).finally(function () {
      flashSyncPulse(false);
      isSilentRefreshing = false;
    });
  }

  /**
   * Ultra-fast direct readiness computation for a grouped batch in microseconds.
   * Completely bypasses slow 100k-row filtering.
   * STRICT: If ERP Issue Date exists, returns null (batch completely excluded).
   */
  function computeBatchReadinessDirect(bNo, bRows, optBantalaMap, optCuttingMap) {
    if (!bRows || bRows.length === 0) return null;

    // 1. ERP ISSUE DATE check
    var erpDate = '';

    // 1a. Check column 24 if already augmented in Connector rows
    if (bRows[0] && bRows[0][24]) {
      var c24 = String(bRows[0][24]).trim();
      if (c24 && c24 !== '-' && c24 !== '--' && c24.toLowerCase() !== 'data not found' && c24.toLowerCase() !== 'n/a' && c24.toLowerCase() !== 'null') {
        erpDate = c24;
      }
    }

    // 1b. Check ConnectorSheetEngine lookupBantalaData directly (O(1) Map lookup)
    if (!erpDate && window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.lookupBantalaData === 'function') {
      var bData = window.ConnectorSheetEngine.lookupBantalaData(bNo);
      if (bData && bData[0]) {
        var d0 = String(bData[0]).trim();
        if (d0 && d0 !== '-' && d0 !== '--' && d0.toLowerCase() !== 'data not found' && d0.toLowerCase() !== 'n/a' && d0.toLowerCase() !== 'null') {
          erpDate = d0;
        }
      }
    }

    // 1c. Check optBantalaMap multi-key lookup
    if (!erpDate && optBantalaMap && optBantalaMap.size > 0) {
      var lookupKeys = getBatchLookupKeys(bNo);
      for (var k = 0; k < lookupKeys.length; k++) {
        if (optBantalaMap.has(lookupKeys[k])) {
          var entry = optBantalaMap.get(lookupKeys[k]);
          var val = (entry && typeof entry === 'object') ? entry.erpDate : entry;
          if (val && val !== '-' && val !== '--' && val.toLowerCase() !== 'data not found' && val.toLowerCase() !== 'n/a' && val.toLowerCase() !== 'null') {
            erpDate = val;
            break;
          }
        }
      }
    }

    // STRICT USER REQUIREMENT:
    // "ERP ISSUE date thakle sei data anbe na"
    // If ERP Issue Date exists, DO NOT INCLUDE! Skip batch completely!
    if (erpDate && erpDate !== '-' && erpDate !== '--' && erpDate.toLowerCase() !== 'data not found' && erpDate.toLowerCase() !== 'n/a' && erpDate.toLowerCase() !== 'null') {
      return null;
    }

    // 2. Batch Category Lookup (HB / SLG / etc.)
    var batchCategory = lookupBatchCategory(bNo, optCuttingMap);

    // 3. BANTALA DETAILS - MATERIAL DUE OR OK STATUS "SAMPLE" EXCLUSION CHECK
    // STRICT USER REQUIREMENT:
    // "Bantala Details e giye sekhane batch gulo ke filter korbe, dekhbe Material Due or OK Status column e sei batch er against e SAMPLE lekha ache ki na, jodi lekha thake tahole sei batch gulo ekhane show korbe na"
    if (isBantalaSampleBatch(bNo, optBantalaMap)) {
      return null;
    }

    // 3. Batch Metadata Extraction
    var first = bRows[0];
    var itb = '-';
    var styleNo = '-';
    var plannedQty = first[13] || '-';
    var prodQty = first[14] || '-';
    var batchQty = first[15] || first[13] || '-';

    var indentList = [];
    var indentDateList = [];
    var indentDateMap = {};

    for (var rIdx = 0; rIdx < bRows.length; rIdx++) {
      var cr = bRows[rIdx];
      var rawItb = cr[2] ? String(cr[2]).trim() : '';
      if (itb === '-' && rawItb && rawItb !== '-' && rawItb.toLowerCase() !== 'itb' && rawItb.toLowerCase() !== 'data not found') {
        itb = rawItb;
      }

      var rawStyle = cr[6] ? String(cr[6]).trim() : '';
      if (styleNo === '-' && rawStyle && rawStyle !== '-' && rawStyle.toLowerCase() !== 'style no') {
        styleNo = rawStyle;
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

    var batchIndentNo = indentList.length > 0 ? indentList.join(', ') : (first[8] || '-');
    var batchIndentDate = indentList.length > 0
      ? indentList.map(function (ind) { return indentDateMap[ind] || '-'; }).filter(function (d) { return d !== '-'; }).join(', ')
      : (indentDateList.length > 0 ? indentDateList.join(', ') : (first[22] || '-'));
    if (!batchIndentDate || batchIndentDate === '') batchIndentDate = first[22] || '-';

    // 3. Component Items Analysis
    var readyItems = [];
    var pendingItems = [];
    var totalCount = bRows.length;

    for (var i = 0; i < bRows.length; i++) {
      var row = bRows[i];
      var itemCode = row[3] || '-';
      var itemName = row[4] || 'Item #' + (i + 1);
      var supplierPo = row[9] || '-';
      var status = row[10] || '-';
      var storeStatus = row[11] || '';
      var remarksO = row[12] || '';
      var remarksJyoti = row[16] || '';
      var aiStatus = row[23] || 'No update from Store';

      var ssLower = String(storeStatus).trim().toLowerCase();
      var aiLower = String(aiStatus).trim().toLowerCase();

      var isStoreOk = ssLower === 'ok' || ssLower === 'okay' || ssLower === 'pass' || (ssLower.indexOf('ok') !== -1 && ssLower.indexOf('not') === -1);
      var isStoreNotOk = ssLower === 'not ok' || ssLower === 'notok' || ssLower === 'fail' || ssLower.indexOf('not ok') !== -1;

      var isAiReady = aiLower.indexOf('ready for production') !== -1 || aiLower.indexOf('in stock') !== -1 || aiLower.indexOf('ordered despite in stock') !== -1 || aiLower.indexOf('material received') !== -1;
      var isAiBlocked = aiLower.indexOf('cannot start production') !== -1 || isStoreNotOk;
      var isAiPending = aiLower.indexOf('material pending') !== -1 || aiLower.indexOf('po not created') !== -1 || aiLower.indexOf('po awaited') !== -1 || aiLower.indexOf('no update') !== -1;

      var itemObj = {
        index: i + 1,
        itb: (row[2] && row[2] !== '-' && String(row[2]).toLowerCase() !== 'itb' && String(row[2]).toLowerCase() !== 'data not found') ? String(row[2]).trim() : itb,
        itemCode: itemCode,
        itemName: itemName,
        indentNo: (row[8] && row[8] !== '-' && String(row[8]).toLowerCase() !== 'indent no.') ? String(row[8]).trim() : batchIndentNo,
        indentDate: (row[22] && row[22] !== '-') ? String(row[22]).trim() : batchIndentDate,
        supplierPo: supplierPo,
        status: status,
        storeStatus: storeStatus || '(Blank)',
        remarks: remarksO || '-',
        remarksJyoti: remarksJyoti || '-',
        aiStatus: aiStatus
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
        itemObj.blockerReason = 'Material Pending';
        pendingItems.push(itemObj);
      }
    }

    var readyCount = readyItems.length;
    var pendingCount = pendingItems.length;
    var readinessPct = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;

    var verdict = 'HOLD';
    var verdictText = 'HOLD / CANNOT START (Blockers Pending)';

    var hasCriticalBlocker = pendingItems.some(function (it) {
      return (it.storeStatus && it.storeStatus.toLowerCase().indexOf('not ok') !== -1) ||
             (it.aiStatus && it.aiStatus.toLowerCase().indexOf('cannot start') !== -1);
    });

    if (hasCriticalBlocker) {
      verdict = 'HOLD';
      verdictText = 'HOLD / CANNOT START (Discrepancy: Store Manager Sandip Chatterjee marked NOT OK)';
    } else if (readinessPct === 100 && pendingCount === 0) {
      verdict = 'READY';
      verdictText = 'READY TO START (100% Cleared)';
    } else if (readinessPct >= 90 && readinessPct <= 99) {
      verdict = 'ALMOST READY';
      verdictText = 'ALMOST READY (90%–99% Materials In-Stock, Critical Stage)';
    } else if (readinessPct >= 60 && readinessPct <= 89) {
      verdict = 'CONDITIONAL';
      verdictText = 'CONDITIONAL START (60%–89% Ready - Cutting/Prep Allowed)';
    } else {
      verdict = 'HOLD';
      verdictText = 'HOLD / CANNOT START (Below 60% Ready - Essential Raw Materials Pending)';
    }

    return {
      batchNo: bNo,
      category: batchCategory || 'HB',
      styleNo: styleNo,
      itb: itb,
      indentNo: batchIndentNo,
      indentDate: batchIndentDate,
      batchQty: batchQty,
      plannedQty: plannedQty,
      prodQty: prodQty,
      totalCount: totalCount,
      readyCount: readyCount,
      pendingCount: pendingCount,
      readinessPct: readinessPct,
      verdict: verdict,
      verdictText: verdictText,
      aiSuggestion: verdict,
      aiSuggestionText: verdictText,
      readyItems: readyItems,
      pendingItems: pendingItems,
      rawRows: bRows
    };
  }

  function fetchLiveBatches(isSilent) {
    if (isLoading) return Promise.resolve(allBatches);
    isLoading = true;
    if (!isSilent) updateLoadingUI(true);

    // 1. Try in-memory engines if ready
    if (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.getAllRows === 'function') {
      var rows = window.ConnectorSheetEngine.getAllRows();
      if (rows && rows.length > 0) {
        if (cachedBantalaMap.size === 0 && window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.getRows === 'function') {
          var inMemB = window.BantalaDetailsSheetEngine.getRows();
          if (inMemB && inMemB.length > 0) {
            cachedBantalaMap = buildBantalaMap(inMemB);
          }
        }
        if (cachedCuttingCategoryMap.size === 0 && window.BatchCuttingSheetEngine && typeof window.BatchCuttingSheetEngine.getRows === 'function') {
          var inMemC = window.BatchCuttingSheetEngine.getRows();
          if (inMemC && inMemC.length > 0) {
            cachedCuttingCategoryMap = buildCuttingCategoryMap(inMemC);
          }
        }
        processRowsIntoLiveBatches(rows, cachedBantalaMap, cachedCuttingCategoryMap);
        isLoading = false;
        if (!isSilent) updateLoadingUI(false);
        return Promise.resolve(allBatches);
      }
    }

    // 2. Load from IndexedDB / Network (Connector, Bantala, Cutting in parallel)
    return Promise.all([
      loadConnectorRowsFromDB(),
      loadBantalaRowsFromDB(),
      loadCuttingRowsFromDB()
    ]).then(function (results) {
      var connRows = results[0];
      var bantalaRows = results[1];
      var cuttingRows = results[2];

      if (bantalaRows && bantalaRows.length > 0) {
        cachedBantalaMap = buildBantalaMap(bantalaRows);
      }
      if (cuttingRows && cuttingRows.length > 0) {
        cachedCuttingCategoryMap = buildCuttingCategoryMap(cuttingRows);
      }

      if (!connRows || connRows.length === 0) {
        // If local cache empty, attempt ensureDataLoaded from ConnectorSheetEngine
        if (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.ensureDataLoaded === 'function') {
          return window.ConnectorSheetEngine.ensureDataLoaded().then(function () {
            var freshRows = window.ConnectorSheetEngine.getAllRows();
            processRowsIntoLiveBatches(freshRows || [], cachedBantalaMap, cachedCuttingCategoryMap);
            isLoading = false;
            if (!isSilent) updateLoadingUI(false);
            return allBatches;
          });
        }
      }

      processRowsIntoLiveBatches(connRows, cachedBantalaMap, cachedCuttingCategoryMap);
      isLoading = false;
      if (!isSilent) updateLoadingUI(false);
      return allBatches;
    }).catch(function (err) {
      console.warn('[ProductionLive] Error loading data:', err);
      isLoading = false;
      if (!isSilent) updateLoadingUI(false);
      return allBatches;
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Core Filtering Logic: Batches Pending ERP Issue Date
  // ---------------------------------------------------------------------------
  var lastLiveBatchesSignature = '';

  function computeBatchesSignature(batches) {
    if (!batches || batches.length === 0) return 'empty';
    var sig = [batches.length];
    for (var i = 0; i < batches.length; i++) {
      var b = batches[i];
      sig.push(b.batchNo + ':' + (b.category || '') + ':' + b.readyCount + '/' + b.totalCount + ':' + b.readinessPct + ':' + b.verdict);
    }
    return sig.join('|');
  }

  function processRowsIntoLiveBatches(rows, optBantalaMap, optCuttingMap, forceRender) {
    if (!rows || rows.length === 0) {
      allBatches = [];
      filteredBatches = [];
      renderAll(true);
      return;
    }

    var bMap = (optBantalaMap && optBantalaMap.size > 0) ? optBantalaMap : cachedBantalaMap;
    var cMap = (optCuttingMap && optCuttingMap.size > 0) ? optCuttingMap : cachedCuttingCategoryMap;

    // If bMap is still empty, attempt instant recovery from BantalaDetailsSheetEngine
    if ((!bMap || bMap.size === 0) && window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.getRows === 'function') {
      var inMemBantala = window.BantalaDetailsSheetEngine.getRows();
      if (inMemBantala && inMemBantala.length > 0) {
        cachedBantalaMap = buildBantalaMap(inMemBantala);
        bMap = cachedBantalaMap;
      }
    }

    // If cMap is still empty, attempt instant recovery from BatchCuttingSheetEngine
    if ((!cMap || cMap.size === 0) && window.BatchCuttingSheetEngine && typeof window.BatchCuttingSheetEngine.getRows === 'function') {
      var inMemCutting = window.BatchCuttingSheetEngine.getRows();
      if (inMemCutting && inMemCutting.length > 0) {
        cachedCuttingCategoryMap = buildCuttingCategoryMap(inMemCutting);
        cMap = cachedCuttingCategoryMap;
      }
    }

    var batchMap = new Map();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.length === 0) continue;
      var bNo = String(r[0] || '').trim();
      if (!bNo || bNo === '-' || bNo.toLowerCase() === 'batch' || bNo.toLowerCase() === 'data not found') continue;

      if (!batchMap.has(bNo)) {
        batchMap.set(bNo, []);
      }
      batchMap.get(bNo).push(r);
    }

    var yetToBeIssuedBatches = [];

    batchMap.forEach(function (bRows, bNo) {
      // Filter out invalid batch rows without any digits
      if (!/\d/.test(bNo)) return;

      var bObj = computeBatchReadinessDirect(bNo, bRows, bMap, cMap);
      if (bObj) {
        yetToBeIssuedBatches.push(bObj);
      }
    });

    var newSig = computeBatchesSignature(yetToBeIssuedBatches);
    var dataChanged = (newSig !== lastLiveBatchesSignature);
    lastLiveBatchesSignature = newSig;

    allBatches = yetToBeIssuedBatches;
    saveFastCache(allBatches);
    updateKpiCardCount();

    // If data didn't change and this is a background silent refresh, do not recreate DOM
    if (!dataChanged && !forceRender) {
      renderScoreboard();
      renderCountBadges();
      return;
    }

    applyFiltersAndSort(true);
  }

  // ---------------------------------------------------------------------------
  // 3. Filtering & Sorting Controller
  // ---------------------------------------------------------------------------
  function getScopedBatches() {
    var query = currentSearchQuery.toLowerCase().trim();
    return allBatches.filter(function (b) {
      // 1. Category Filter (HB / SLG multi-select)
      var bCat = String(b.category || 'HB').trim().toUpperCase();
      if (selectedCategories.size > 0 && selectedCategories.size < 2) {
        if (!selectedCategories.has(bCat)) return false;
      } else if (selectedCategories.size === 0) {
        return false;
      }

      // 2. Search Query
      if (query) {
        var str = (
          b.batchNo + ' ' +
          (b.category || '') + ' ' +
          b.styleNo + ' ' +
          b.itb + ' ' +
          b.indentNo + ' ' +
          b.indentDate + ' ' +
          b.verdictText + ' ' +
          b.pendingItems.map(function (it) { return it.itemName + ' ' + it.itemCode; }).join(' ')
        ).toLowerCase();

        var terms = query.split(/\s+/).filter(Boolean);
        for (var t = 0; t < terms.length; t++) {
          if (str.indexOf(terms[t]) === -1) return false;
        }
      }

      return true;
    });
  }

  function applyFiltersAndSort(preserveScroll) {
    var shouldPreserve = (typeof preserveScroll === 'boolean') ? preserveScroll : true;
    var channel = currentFilterChannel;
    var scoped = getScopedBatches();

    filteredBatches = scoped.filter(function (b) {
      // Channel Filter (6 Readiness % brackets)
      var pct = typeof b.readinessPct === 'number' ? b.readinessPct : 0;
      if (channel === 'r91_100' && (pct < 91 || pct > 100)) return false;
      if (channel === 'r81_90' && (pct < 81 || pct > 90)) return false;
      if (channel === 'r71_80' && (pct < 71 || pct > 80)) return false;
      if (channel === 'r61_70' && (pct < 61 || pct > 70)) return false;
      if (channel === 'r0_60' && pct > 60) return false;

      // Legacy fallback support
      if (channel === 'ready' && b.verdict !== 'READY') return false;
      if (channel === 'cond' && b.verdict !== 'CONDITIONAL') return false;
      if (channel === 'hold' && b.verdict !== 'HOLD') return false;

      return true;
    });

    // 3. Sorting
    filteredBatches.sort(function (a, b) {
      if (currentSortMode === 'readiness_desc') {
        return b.readinessPct - a.readinessPct;
      } else if (currentSortMode === 'readiness_asc') {
        return a.readinessPct - b.readinessPct;
      } else if (currentSortMode === 'qty_desc') {
        var qa = parseFloat(String(a.batchQty || 0).replace(/,/g, '')) || 0;
        var qb = parseFloat(String(b.batchQty || 0).replace(/,/g, '')) || 0;
        return qb - qa;
      } else if (currentSortMode === 'batch_asc') {
        return a.batchNo.localeCompare(b.batchNo, undefined, { numeric: true, sensitivity: 'base' });
      } else if (currentSortMode === 'date_desc') {
        var da = parseDate(a.indentDate);
        var db = parseDate(b.indentDate);
        return db - da;
      }
      return 0;
    });

    renderAll(shouldPreserve);
  }

  function parseDate(dStr) {
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
    return 0;
  }

  // ---------------------------------------------------------------------------
  // 4. Rendering Engine (State Preserving)
  // ---------------------------------------------------------------------------
  function renderAll(preserveScroll) {
    var shouldPreserve = (typeof preserveScroll === 'boolean') ? preserveScroll : true;
    renderPreservingState(shouldPreserve);
  }

  function renderPreservingState(shouldPreserveScroll) {
    if (typeof shouldPreserveScroll === 'undefined') {
      shouldPreserveScroll = true;
    }

    // 1. Capture scroll positions from real scrolling containers
    var container = document.getElementById('prod-live-content-area');
    var savedFeedScrollTop = (shouldPreserveScroll && container) ? container.scrollTop : 0;
    var savedFeedScrollLeft = (shouldPreserveScroll && container) ? container.scrollLeft : 0;

    var tableWrap = (shouldPreserveScroll && container) ? (container.querySelector('.prod-live-table-wrapper') || document.getElementById('prod-live-table-wrapper')) : null;
    var savedTableScrollTop = tableWrap ? tableWrap.scrollTop : 0;
    var savedTableScrollLeft = tableWrap ? tableWrap.scrollLeft : 0;

    var contentArea = document.querySelector('.content-area');
    var savedContentAreaScrollTop = (shouldPreserveScroll && contentArea) ? contentArea.scrollTop : 0;
    var savedWindowScrollY = shouldPreserveScroll ? (window.scrollY || 0) : 0;

    // 2. Capture open accordion drawers (keyed by batchNo -> inner scrollTop)
    var openDrawers = new Map();
    document.querySelectorAll('.prod-live-drawer-content').forEach(function (drawer) {
      if (drawer.style.display === 'block') {
        var bNo = drawer.getAttribute('data-drawer-batch');
        if (bNo) openDrawers.set(bNo, drawer.scrollTop || 0);
      }
    });

    // 3. Capture search focus & selection
    var searchInput = document.getElementById('prod-live-search-input');
    var isSearchFocused = (document.activeElement === searchInput);
    var selStart = (isSearchFocused && searchInput) ? searchInput.selectionStart : 0;
    var selEnd = (isSearchFocused && searchInput) ? searchInput.selectionEnd : 0;

    // 4. Render active layout
    renderScoreboard();
    renderTicker();
    renderCountBadges();

    if (currentViewMode === 'news') {
      renderNewsFeed();
    } else if (currentViewMode === 'grid') {
      renderGridView();
    } else {
      renderTableView();
    }

    // 5. Restore open drawers
    if (openDrawers.size > 0) {
      openDrawers.forEach(function (innerScroll, bNo) {
        var drawers = document.querySelectorAll('.prod-live-drawer-content[data-drawer-batch="' + bNo + '"]');
        drawers.forEach(function (d) {
          d.style.display = 'block';
          if (innerScroll > 0) d.scrollTop = innerScroll;
          var toggle = document.querySelector('.prod-live-drawer-toggle[data-target="' + d.id + '"]');
          if (toggle) {
            var chevron = toggle.querySelector('.prod-live-drawer-chevron');
            if (chevron) chevron.textContent = 'expand_less';
          }
        });
      });
    }

    // 6. Restore scroll positions across all containers
    function restoreAllScrollPositions() {
      if (container) {
        if (savedFeedScrollTop > 0) container.scrollTop = savedFeedScrollTop;
        if (savedFeedScrollLeft > 0) container.scrollLeft = savedFeedScrollLeft;
      }
      var newTableWrap = container ? (container.querySelector('.prod-live-table-wrapper') || document.getElementById('prod-live-table-wrapper')) : null;
      if (newTableWrap) {
        if (savedTableScrollTop > 0) newTableWrap.scrollTop = savedTableScrollTop;
        if (savedTableScrollLeft > 0) newTableWrap.scrollLeft = savedTableScrollLeft;
      }
      if (contentArea && savedContentAreaScrollTop > 0) {
        contentArea.scrollTop = savedContentAreaScrollTop;
      }
      if (savedWindowScrollY > 0) {
        window.scrollTo({ top: savedWindowScrollY, behavior: 'instant' });
      }
    }

    if (shouldPreserveScroll) {
      // Immediate synchronous restore
      restoreAllScrollPositions();
      // Next animation frame restore
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(restoreAllScrollPositions);
      }
      // Safety timers for dynamic reflows
      setTimeout(restoreAllScrollPositions, 30);
      setTimeout(restoreAllScrollPositions, 100);
    } else {
      if (container) {
        container.scrollTop = 0;
        container.scrollLeft = 0;
      }
      var freshTableWrap = container ? (container.querySelector('.prod-live-table-wrapper') || document.getElementById('prod-live-table-wrapper')) : null;
      if (freshTableWrap) {
        freshTableWrap.scrollTop = 0;
        freshTableWrap.scrollLeft = 0;
      }
      if (contentArea) contentArea.scrollTop = 0;
    }

    // 7. Restore search input focus if active
    if (isSearchFocused && searchInput) {
      searchInput.focus();
      try {
        searchInput.setSelectionRange(selStart, selEnd);
      } catch (e) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Category Multi-Select Filter Helpers & Badge Renderer
  // ---------------------------------------------------------------------------
  function getCategoryBadgeHtml(cat, extraStyle) {
    var c = String(cat || 'HB').trim().toUpperCase();
    var isSlg = (c === 'SLG');
    var bg = isSlg ? '#f5f3ff' : '#e0f2fe';
    var color = isSlg ? '#6d28d9' : '#0369a1';
    var border = isSlg ? '#ddd6fe' : '#bae6fd';
    var st = 'font-size:11px; font-weight:800; padding:2px 6px; background:' + bg + '; color:' + color + '; border:1px solid ' + border + '; border-radius:0; ' + (extraStyle || '');
    return '<span style="' + st + '">' + escapeHtml(c) + '</span>';
  }

  function updateCategoryFilterUI() {
    var countHB = 0;
    var countSLG = 0;
    for (var i = 0; i < allBatches.length; i++) {
      var c = String(allBatches[i].category || 'HB').trim().toUpperCase();
      if (c === 'SLG') countSLG++;
      else countHB++;
    }

    setElemText('prod-live-count-hb', countHB.toLocaleString());
    setElemText('prod-live-count-slg', countSLG.toLocaleString());

    var btnLabel = document.getElementById('prod-live-cat-btn-label');
    var btnCount = document.getElementById('prod-live-cat-btn-count');
    var catBtn = document.getElementById('prod-live-cat-btn');

    if (selectedCategories.size === 2) {
      if (btnLabel) btnLabel.textContent = 'Category: All';
      if (btnCount) btnCount.textContent = allBatches.length.toLocaleString();
      if (catBtn) catBtn.classList.remove('is-active-filter');
    } else if (selectedCategories.size === 0) {
      if (btnLabel) btnLabel.textContent = 'Category: None';
      if (btnCount) btnCount.textContent = '0';
      if (catBtn) catBtn.classList.add('is-active-filter');
    } else if (selectedCategories.has('HB')) {
      if (btnLabel) btnLabel.textContent = 'Category: HB';
      if (btnCount) btnCount.textContent = countHB.toLocaleString();
      if (catBtn) catBtn.classList.add('is-active-filter');
    } else if (selectedCategories.has('SLG')) {
      if (btnLabel) btnLabel.textContent = 'Category: SLG';
      if (btnCount) btnCount.textContent = countSLG.toLocaleString();
      if (catBtn) catBtn.classList.add('is-active-filter');
    }

    var checkHB = document.getElementById('prod-live-check-hb');
    var checkSLG = document.getElementById('prod-live-check-slg');
    if (checkHB) checkHB.checked = selectedCategories.has('HB');
    if (checkSLG) checkSLG.checked = selectedCategories.has('SLG');
  }

  function renderScoreboard() {
    var scoped = getScopedBatches();
    var totalCount = scoped.length;
    var count91_100 = 0;
    var count81_90 = 0;
    var count71_80 = 0;
    var count61_70 = 0;
    var count0_60 = 0;
    var totalUnits = 0;

    for (var i = 0; i < scoped.length; i++) {
      var b = scoped[i];
      var pct = typeof b.readinessPct === 'number' ? b.readinessPct : 0;

      if (pct >= 91) count91_100++;
      else if (pct >= 81) count81_90++;
      else if (pct >= 71) count71_80++;
      else if (pct >= 61) count61_70++;
      else count0_60++;

      var q = parseFloat(String(b.batchQty || 0).replace(/,/g, ''));
      if (!isNaN(q)) totalUnits += q;
    }

    setElemText('prod-live-kpi-total-batches', totalCount.toLocaleString());
    setElemText('prod-live-kpi-r91-100', count91_100.toLocaleString());
    setElemText('prod-live-kpi-r81-90', count81_90.toLocaleString());
    setElemText('prod-live-kpi-r71-80', count71_80.toLocaleString());
    setElemText('prod-live-kpi-r61-70', count61_70.toLocaleString());
    setElemText('prod-live-kpi-r0-60', count0_60.toLocaleString());

    // Fallbacks for legacy IDs
    setElemText('prod-live-kpi-ready-batches', count91_100.toLocaleString());
    setElemText('prod-live-kpi-cond-batches', (count81_90 + count71_80 + count61_70).toLocaleString());
    setElemText('prod-live-kpi-hold-batches', count0_60.toLocaleString());
    setElemText('prod-live-kpi-total-units', Math.round(totalUnits).toLocaleString());
  }

  function renderCountBadges() {
    var scoped = getScopedBatches();
    var totalUnits = 0;
    for (var i = 0; i < scoped.length; i++) {
      var q = parseFloat(String(scoped[i].batchQty || 0).replace(/,/g, ''));
      if (!isNaN(q)) totalUnits += q;
    }

    var topText = filteredBatches.length.toLocaleString() + ' Live Batches';
    if (totalUnits > 0) {
      topText += ' (' + Math.round(totalUnits).toLocaleString() + ' Queued Units)';
    }
    setElemText('prod-live-top-count', topText);
    setElemText('prod-live-tab-all-count', scoped.length.toLocaleString());

    var c91_100 = 0, c81_90 = 0, c71_80 = 0, c61_70 = 0, c0_60 = 0;
    for (var j = 0; j < scoped.length; j++) {
      var p = typeof scoped[j].readinessPct === 'number' ? scoped[j].readinessPct : 0;
      if (p >= 91) c91_100++;
      else if (p >= 81) c81_90++;
      else if (p >= 71) c71_80++;
      else if (p >= 61) c61_70++;
      else c0_60++;
    }

    setElemText('prod-live-tab-91-100-count', c91_100.toLocaleString());
    setElemText('prod-live-tab-81-90-count', c81_90.toLocaleString());
    setElemText('prod-live-tab-71-80-count', c71_80.toLocaleString());
    setElemText('prod-live-tab-61-70-count', c61_70.toLocaleString());
    setElemText('prod-live-tab-0-60-count', c0_60.toLocaleString());

    // Legacy fallbacks
    setElemText('prod-live-tab-ready-count', c91_100.toLocaleString());
    setElemText('prod-live-tab-cond-count', (c81_90 + c71_80 + c61_70).toLocaleString());
    setElemText('prod-live-tab-hold-count', c0_60.toLocaleString());

    updateCategoryFilterUI();
  }

  function renderTicker() {
    var tickerEl = document.getElementById('prod-live-ticker-text');
    if (!tickerEl) return;

    var scoped = getScopedBatches();
    if (scoped.length === 0) {
      tickerEl.textContent = 'No live batches matching current category/search criteria.';
      return;
    }

    var readyOnes = scoped.filter(function (b) { return b.verdict === 'READY'; });
    var holdOnes = scoped.filter(function (b) { return b.verdict === 'HOLD'; });

    var messages = [];
    messages.push('LIVE BULLETIN: ' + scoped.length.toLocaleString() + ' Batches pending ERP Issue Date in Connector Sheet.');

    if (readyOnes.length > 0) {
      var sampleReady = readyOnes.slice(0, 3).map(function (b) { return b.batchNo; }).join(', ');
      messages.push('BREAKING: ' + readyOnes.length + ' Batches have 100% components ready for production start (' + sampleReady + '). Awaiting ERP Issue Date to release to cutting floor!');
    }

    if (holdOnes.length > 0) {
      var sampleHold = holdOnes.slice(0, 3).map(function (b) { return b.batchNo; }).join(', ');
      messages.push('BOTTLENECK ALERT: ' + holdOnes.length + ' Batches have pending raw materials or store manager blockers (' + sampleHold + ').');
    }

    tickerEl.textContent = messages.join('   •   ') + '   •   ' + messages.join('   •   ');
  }

  // ---------------------------------------------------------------------------
  // 4.1 News Feed View (The Core requested layout)
  // ---------------------------------------------------------------------------
  function renderNewsFeed() {
    var container = document.getElementById('prod-live-content-area');
    if (!container) return;

    if (filteredBatches.length === 0) {
      container.innerHTML = getEmptyStateHtml();
      return;
    }

    var html = '<div class="prod-live-news-feed">';

    for (var i = 0; i < filteredBatches.length; i++) {
      var b = filteredBatches[i];
      var cardClass = b.verdict === 'READY' ? 'prod-live-card--ready' : (b.verdict === 'CONDITIONAL' ? 'prod-live-card--cond' : 'prod-live-card--hold');
      var ribbonClass = b.verdict === 'READY' ? 'prod-live-ribbon--ready' : (b.verdict === 'CONDITIONAL' ? 'prod-live-ribbon--cond' : 'prod-live-ribbon--hold');
      var ribbonText = b.verdict === 'READY' ? 'BREAKING NEWS • 100% READY' : (b.verdict === 'CONDITIONAL' ? 'PRODUCTION ALERT • CONDITIONAL' : 'BOTTLENECK • RAW MATERIAL PENDING');
      var gaugeClass = b.verdict === 'READY' ? 'prod-live-gauge-num--ready' : (b.verdict === 'CONDITIONAL' ? 'prod-live-gauge-num--cond' : 'prod-live-gauge-num--hold');
      var barClass = b.verdict === 'READY' ? 'prod-live-bar-fill--ready' : (b.verdict === 'CONDITIONAL' ? 'prod-live-bar-fill--cond' : 'prod-live-bar-fill--hold');

      // Bottleneck callout message
      var calloutHtml = '';
      if (b.verdict === 'READY') {
        calloutHtml = '<div class="prod-live-bottleneck-box prod-live-bottleneck-box--success">' +
          '<span class="material-icons-round prod-live-bottleneck-icon">check_circle</span>' +
          '<div>' +
            '<div class="prod-live-bottleneck-title">100% Raw Materials Cleared &amp; In-Stock</div>' +
            '<div class="prod-live-bottleneck-desc">All component materials have arrived in factory and are verified. Cutting floor can start immediately once ERP Issue Date is recorded.</div>' +
          '</div>' +
        '</div>';
      } else {
        var topBlockers = b.pendingItems.slice(0, 3).map(function (it) {
          var details = [];
          if (it.supplierPo && it.supplierPo !== '-') details.push('PO: ' + it.supplierPo);
          if (it.storeStatus) details.push('Store: ' + it.storeStatus);
          if (it.aiStatus && it.aiStatus !== it.storeStatus) details.push(it.aiStatus);
          var detailStr = details.length ? ' (' + details.join(' • ') + ')' : '';
          return '<strong>' + escapeHtml(it.itemName) + '</strong>' + detailStr;
        }).join('<br>');

        calloutHtml = '<div class="prod-live-bottleneck-box prod-live-bottleneck-box--alert">' +
          '<span class="material-icons-round prod-live-bottleneck-icon">warning_amber</span>' +
          '<div>' +
            '<div class="prod-live-bottleneck-title">Pending Bottleneck Materials (' + b.pendingCount + ' of ' + b.totalCount + ' Missing)</div>' +
            '<div class="prod-live-bottleneck-desc">' + topBlockers + (b.pendingItems.length > 3 ? '<br><em>+ ' + (b.pendingItems.length - 3) + ' more pending components</em>' : '') + '</div>' +
          '</div>' +
        '</div>';
      }

      // Drawer component table
      var compRowsHtml = '';
      var allItems = (b.pendingItems || []).concat(b.readyItems || []);
      for (var k = 0; k < allItems.length; k++) {
        var it = allItems[k];
        var isItReady = (k >= b.pendingItems.length);
        var statusBadge = isItReady
          ? '<span style="color:#15803d; font-weight:700;">Ready / Received</span>'
          : '<span style="color:#b91c1c; font-weight:700;">' + escapeHtml(it.blockerReason || it.aiStatus || 'Pending') + '</span>';

        compRowsHtml += '<tr>' +
          '<td>' + (k + 1) + '</td>' +
          '<td><strong>' + escapeHtml(it.itemName) + '</strong></td>' +
          '<td>' + escapeHtml(it.itemCode || '-') + '</td>' +
          '<td>' + escapeHtml(it.supplierPo || '-') + '</td>' +
          '<td>' + escapeHtml(it.storeStatus || '-') + '</td>' +
          '<td>' + statusBadge + '</td>' +
        '</tr>';
      }

      var safeBatchId = String(b.batchNo).replace(/[^A-Za-z0-9_-]/g, '_');
      var drawerId = 'prod-live-drawer-' + safeBatchId + '-' + i;

      html += '<div class="prod-live-card ' + cardClass + '">' +
        // Wire Header
        '<div class="prod-live-card-wire">' +
          '<span class="prod-live-ribbon ' + ribbonClass + '">' +
            '<span class="material-icons-round" style="font-size:14px;">campaign</span>' +
            ribbonText +
          '</span>' +
          '<div class="prod-live-wire-meta">' +
            '<span class="prod-live-tag-erp">ERP ISSUE: PENDING</span>' +
            (b.category ? getCategoryBadgeHtml(b.category, 'margin-left:4px;') : '') +
            (b.indentDate && b.indentDate !== '-' ? '<span><span class="material-icons-round" style="font-size:13px; vertical-align:middle;">calendar_today</span> Indent: <strong>' + escapeHtml(b.indentDate) + '</strong></span>' : '') +
          '</div>' +
        '</div>' +

        // Main Headline Body
        '<div class="prod-live-card-main">' +
          '<div class="prod-live-headline-row">' +
            '<div class="prod-live-headline">' +
              '<span class="material-icons-round" style="color:#ef4444; font-size:22px;">newspaper</span>' +
              '<span>Batch: ' + escapeHtml(b.batchNo) + '</span>' +
              '<button type="button" class="prod-live-btn-copy-batch" data-batch="' + escapeHtml(b.batchNo) + '" title="Copy Batch No">' +
                '<span class="material-icons-round" style="font-size:13px;">content_copy</span> Copy' +
              '</button>' +
            '</div>' +
          '</div>' +

          // Metadata Chips Grid
          '<div class="prod-live-meta-grid">' +
            '<div class="prod-live-chip"><span class="material-icons-round" style="font-size:15px; color:#6366f1;">checkroom</span> Style: <strong>' + escapeHtml(b.styleNo) + '</strong></div>' +
            '<div class="prod-live-chip"><span class="material-icons-round" style="font-size:15px; color:#0284c7;">tag</span> ITB: <strong>' + escapeHtml(b.itb) + '</strong></div>' +
            '<div class="prod-live-chip"><span class="material-icons-round" style="font-size:15px; color:#8b5cf6;">receipt_long</span> Indent No: <strong>' + escapeHtml(b.indentNo) + '</strong></div>' +
            '<div class="prod-live-chip prod-live-chip--qty"><span class="material-icons-round" style="font-size:15px; color:#1d4ed8;">inventory_2</span> Batch Qty: <strong>' + escapeHtml(b.batchQty) + ' Pcs</strong></div>' +
          '</div>' +

          // Readiness Meter & Progress Bar
          '<div class="prod-live-readiness-row">' +
            '<div class="prod-live-gauge-box">' +
              '<span class="prod-live-gauge-num ' + gaugeClass + '">' + b.readinessPct + '</span>' +
              '<span class="prod-live-gauge-unit">% Readiness</span>' +
            '</div>' +
            '<div class="prod-live-meter-col">' +
              '<div class="prod-live-bar-track">' +
                '<div class="prod-live-bar-fill ' + barClass + '" style="width:' + b.readinessPct + '%;"></div>' +
              '</div>' +
              '<div class="prod-live-counts-chips">' +
                '<span class="prod-live-stat-badge prod-live-stat-badge--ready"><span class="material-icons-round" style="font-size:14px;">check</span> Ready: ' + b.readyCount + ' Components</span>' +
                '<span class="prod-live-stat-badge prod-live-stat-badge--pending"><span class="material-icons-round" style="font-size:14px;">schedule</span> Pending: ' + b.pendingCount + ' Components</span>' +
                '<span class="prod-live-stat-badge prod-live-stat-badge--total"><span class="material-icons-round" style="font-size:14px;">layers</span> Total: ' + b.totalCount + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Bottleneck Alert Box
          calloutHtml +

          // Expandable Component Drawer Toggle
          '<button type="button" class="prod-live-drawer-toggle" data-target="' + drawerId + '">' +
            '<span><span class="material-icons-round" style="font-size:15px; vertical-align:middle;">table_rows</span> View All ' + b.totalCount + ' Components Breakdown (' + b.readyCount + ' Ready, ' + b.pendingCount + ' Pending)</span>' +
            '<span class="material-icons-round prod-live-drawer-chevron">expand_more</span>' +
          '</button>' +
          '<div class="prod-live-drawer-content" id="' + drawerId + '" data-drawer-batch="' + escapeHtml(b.batchNo) + '" style="display:none;">' +
            '<table class="prod-live-table-comp">' +
              '<thead>' +
                '<tr><th>#</th><th>Material Name</th><th>Pro Code</th><th>Supplier PO</th><th>Store Status</th><th>Readiness Status</th></tr>' +
              '</thead>' +
              '<tbody>' + compRowsHtml + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +

        // Card Actions Footer
        '<div class="prod-live-card-actions">' +
          '<button type="button" class="prod-live-btn-wire prod-live-btn-wire--ai" data-ai-batch="' + escapeHtml(b.batchNo) + '" title="Ask Batch Analysis AI">' +
            '<span class="material-icons-round" style="font-size:15px;">auto_awesome</span> Ask Batch AI' +
          '</button>' +
          '<button type="button" class="prod-live-btn-wire" data-open-connector="' + escapeHtml(b.batchNo) + '" title="Open in Connector Live Sheet">' +
            '<span class="material-icons-round" style="font-size:15px;">table_view</span> Open in Connector' +
          '</button>' +
          '<button type="button" class="prod-live-btn-wire" data-copy-summary="' + i + '" title="Copy Full Bulletin">' +
            '<span class="material-icons-round" style="font-size:15px;">copy_all</span> Copy Bulletin' +
          '</button>' +
        '</div>' +
      '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
    bindCardEvents(container);
  }

  // ---------------------------------------------------------------------------
  // 4.2 Compact Grid View
  // ---------------------------------------------------------------------------
  function renderGridView() {
    var container = document.getElementById('prod-live-content-area');
    if (!container) return;

    if (filteredBatches.length === 0) {
      container.innerHTML = getEmptyStateHtml();
      return;
    }

    var html = '<div class="prod-live-grid-mode">';
    for (var i = 0; i < filteredBatches.length; i++) {
      var b = filteredBatches[i];
      var cardClass = b.verdict === 'READY' ? 'prod-live-card--ready' : (b.verdict === 'CONDITIONAL' ? 'prod-live-card--cond' : 'prod-live-card--hold');
      var gaugeClass = b.verdict === 'READY' ? 'prod-live-gauge-num--ready' : (b.verdict === 'CONDITIONAL' ? 'prod-live-gauge-num--cond' : 'prod-live-gauge-num--hold');

      html += '<div class="prod-live-card ' + cardClass + '">' +
        '<div class="prod-live-card-wire">' +
          '<span style="font-weight:800; font-size:13px; color:#0f172a;">' + escapeHtml(b.batchNo) + '</span>' +
          '<div style="display:flex; gap:4px; align-items:center;">' +
            (b.category ? getCategoryBadgeHtml(b.category, 'font-size:10px; padding:1px 5px;') : '') +
            '<span class="prod-live-tag-erp">ERP: PENDING</span>' +
          '</div>' +
        '</div>' +
        '<div style="padding:12px 16px;">' +
          '<div style="font-size:12px; color:#475569; display:flex; flex-direction:column; gap:4px;">' +
            '<div>Style: <strong>' + escapeHtml(b.styleNo) + '</strong> | ITB: <strong>' + escapeHtml(b.itb) + '</strong></div>' +
            '<div>Indent: <strong>' + escapeHtml(b.indentNo) + '</strong> | Qty: <strong>' + escapeHtml(b.batchQty) + ' Pcs</strong></div>' +
          '</div>' +
          '<div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px; padding:8px 10px; background:#f8fafc; border-radius:0; border:1px solid #cbd5e1;">' +
            '<span class="prod-live-gauge-num ' + gaugeClass + '" style="font-size:22px;">' + b.readinessPct + '%</span>' +
            '<div style="font-size:11px; text-align:right;">' +
              '<div style="color:#15803d; font-weight:700;">Ready: ' + b.readyCount + '</div>' +
              '<div style="color:#b91c1c; font-weight:700;">Pending: ' + b.pendingCount + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="prod-live-card-actions">' +
          '<button type="button" class="prod-live-btn-wire prod-live-btn-wire--ai" data-ai-batch="' + escapeHtml(b.batchNo) + '">' +
            '<span class="material-icons-round" style="font-size:13px;">auto_awesome</span> AI' +
          '</button>' +
          '<button type="button" class="prod-live-btn-wire" data-open-connector="' + escapeHtml(b.batchNo) + '">' +
            '<span class="material-icons-round" style="font-size:13px;">table_view</span> Connector' +
          '</button>' +
        '</div>' +
      '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
    bindCardEvents(container);
  }

  // ---------------------------------------------------------------------------
  // 4.3 Table View Mode
  // ---------------------------------------------------------------------------
  function renderTableView() {
    var container = document.getElementById('prod-live-content-area');
    if (!container) return;

    if (filteredBatches.length === 0) {
      container.innerHTML = getEmptyStateHtml();
      return;
    }

    var html = '<div class="prod-live-table-wrapper" id="prod-live-table-wrapper">' +
      '<table class="prod-live-main-table">' +
        '<thead>' +
          '<tr>' +
            '<th>#</th>' +
            '<th>Batch No</th>' +
            '<th>Category</th>' +
            '<th>Style No</th>' +
            '<th>ITB</th>' +
            '<th>Indent No</th>' +
            '<th>Indent Date</th>' +
            '<th>Batch Qty</th>' +
            '<th>Ready Items</th>' +
            '<th>Pending Items</th>' +
            '<th>Readiness %</th>' +
            '<th>ERP Issue</th>' +
            '<th>Verdict</th>' +
            '<th>Actions</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>';

    for (var i = 0; i < filteredBatches.length; i++) {
      var b = filteredBatches[i];
      var pctColor = b.verdict === 'READY' ? '#10b981' : (b.verdict === 'CONDITIONAL' ? '#f59e0b' : '#ef4444');

      html += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><strong>' + escapeHtml(b.batchNo) + '</strong></td>' +
        '<td>' + getCategoryBadgeHtml(b.category || 'HB') + '</td>' +
        '<td>' + escapeHtml(b.styleNo) + '</td>' +
        '<td>' + escapeHtml(b.itb) + '</td>' +
        '<td>' + escapeHtml(b.indentNo) + '</td>' +
        '<td>' + escapeHtml(b.indentDate) + '</td>' +
        '<td><strong>' + escapeHtml(b.batchQty) + '</strong></td>' +
        '<td style="color:#15803d; font-weight:700;">' + b.readyCount + '</td>' +
        '<td style="color:#b91c1c; font-weight:700;">' + b.pendingCount + '</td>' +
        '<td style="color:' + pctColor + '; font-weight:800;">' + b.readinessPct + '%</td>' +
        '<td><span class="prod-live-tag-erp">Pending</span></td>' +
        '<td>' + escapeHtml(b.verdict) + '</td>' +
        '<td>' +
          '<div style="display:flex; gap:6px;">' +
            '<button type="button" class="prod-live-btn-wire prod-live-btn-wire--ai" data-ai-batch="' + escapeHtml(b.batchNo) + '" title="Ask AI" style="padding:3px 7px;">' +
              '<span class="material-icons-round" style="font-size:13px;">auto_awesome</span>' +
            '</button>' +
            '<button type="button" class="prod-live-btn-wire" data-open-connector="' + escapeHtml(b.batchNo) + '" title="Open Connector" style="padding:3px 7px;">' +
              '<span class="material-icons-round" style="font-size:13px;">table_view</span>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
    bindCardEvents(container);
  }

  function getEmptyStateHtml() {
    return '<div class="prod-live-empty">' +
      '<span class="material-icons-round prod-live-empty-icon">task_alt</span>' +
      '<div class="prod-live-empty-title">No Yet to be Issued Batches Found</div>' +
      '<p style="margin-top:6px; font-size:13px;">All matching batches have assigned ERP Issue Dates or no records match current filter.</p>' +
    '</div>';
  }

  // ---------------------------------------------------------------------------
  // 5. Interactive Event Handlers
  // ---------------------------------------------------------------------------
  function bindCardEvents(container) {
    if (!container) return;

    // 1. Drawer toggles
    container.querySelectorAll('.prod-live-drawer-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var targetId = btn.getAttribute('data-target');
        var drawer = document.getElementById(targetId);
        var chevron = btn.querySelector('.prod-live-drawer-chevron');
        if (drawer) {
          var isHidden = drawer.style.display === 'none';
          drawer.style.display = isHidden ? 'block' : 'none';
          if (chevron) {
            chevron.textContent = isHidden ? 'expand_less' : 'expand_more';
          }
        }
      });
    });

    // 2. Ask Batch AI buttons
    container.querySelectorAll('[data-ai-batch]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var bNo = btn.getAttribute('data-ai-batch');
        if (!bNo) return;
        consultBatchAi(bNo);
      });
    });

    // 3. Open in Connector Sheet buttons
    container.querySelectorAll('[data-open-connector]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var bNo = btn.getAttribute('data-open-connector');
        if (!bNo) return;
        openInConnectorSheet(bNo);
      });
    });

    // 4. Copy batch number
    container.querySelectorAll('[data-batch]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var bNo = btn.getAttribute('data-batch');
        if (bNo) {
          copyToClipboard(bNo, 'Copied Batch: ' + bNo);
        }
      });
    });

    // 5. Copy full bulletin summary
    container.querySelectorAll('[data-copy-summary]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(btn.getAttribute('data-copy-summary'), 10);
        var b = filteredBatches[idx];
        if (!b) return;

        var text = '🚨 [PRODUCTION LIVE BULLETIN - ERP ISSUE PENDING]\n' +
          'Batch No: ' + b.batchNo + '\n' +
          'Style No: ' + b.styleNo + ' | ITB: ' + b.itb + '\n' +
          'Indent No: ' + b.indentNo + ' | Indent Date: ' + b.indentDate + '\n' +
          'Batch Qty: ' + b.batchQty + ' Pcs\n' +
          'Material Readiness: ' + b.readinessPct + '% (' + b.readyCount + ' Ready, ' + b.pendingCount + ' Pending of ' + b.totalCount + ' Components)\n' +
          'Verdict: ' + b.verdictText + '\n' +
          'ERP Issue Date: PENDING\n';

        if (b.pendingItems.length > 0) {
          text += '\nPending Components:\n' + b.pendingItems.map(function (it, i) {
            return (i + 1) + '. ' + it.itemName + ' (PO: ' + it.supplierPo + ', Status: ' + (it.storeStatus || it.aiStatus) + ')';
          }).join('\n') + '\n';
        }

        copyToClipboard(text, 'Copied Live Bulletin for Batch: ' + b.batchNo);
      });
    });
  }

  function consultBatchAi(batchNo) {
    var prompt = 'Analyze Batch "' + batchNo + '": it is currently pending ERP Issue Date in Connector Live Records. Detail why ERP issue is pending, which component materials are ready vs blocked, Store Manager Sandip Chatterjee status, and give actionable recommendations.';

    // 1. If running on standalone bai.html page already
    if (window.location.pathname.toLowerCase().indexOf('bai.html') !== -1 && window.BatchAnalysisAI && typeof window.BatchAnalysisAI.sendPrompt === 'function') {
      window.BatchAnalysisAI.sendPrompt(prompt);
      return;
    }

    // 2. Open dedicated Batch Analysis AI in a new tab with prompt and auto=1
    var url = 'bai.html?prompt=' + encodeURIComponent(prompt) + '&batch=' + encodeURIComponent(batchNo) + '&auto=1';
    var win = null;
    try {
      win = window.open(url, '_blank');
    } catch (e) {}

    if (!win || win.closed || typeof win.closed === 'undefined') {
      // If popup blocked, open in same window
      window.location.href = url;
    } else {
      showToast('Opening Batch Analysis AI for ' + batchNo + '...', 'info');
    }
  }

  function openInConnectorSheet(batchNo) {
    if (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.openWithBatch === 'function') {
      window.ConnectorSheetEngine.openWithBatch(batchNo);
    } else {
      showToast('Opening Connector for ' + batchNo + '...', 'info');
      var backdrop = document.getElementById('bai-sheet-modal-backdrop');
      if (backdrop) {
        backdrop.style.display = 'flex';
        var searchInput = document.getElementById('bai-sheet-search-input');
        if (searchInput) {
          searchInput.value = batchNo;
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else {
        showToast('Connector Sheet Engine not ready', 'warning');
      }
    }
  }

  function copyToClipboard(text, successMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          showToast(successMsg, 'copy');
        }).catch(function () {
          fallbackCopy(text, successMsg);
        });
      } else {
        fallbackCopy(text, successMsg);
      }
    } catch (e) {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(successMsg, 'copy');
    } catch (err) {
      showToast('Could not copy to clipboard', 'warning');
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Excel Export (.xlsx)
  // ---------------------------------------------------------------------------
  function exportExcel() {
    if (filteredBatches.length === 0) {
      showToast('No yet to be issued batches to export', 'warning');
      return;
    }

    if (typeof XLSX === 'undefined') {
      showToast('Excel library not loaded, standing by...', 'warning');
      return;
    }

    showToast('Generating Excel (.xlsx) report for ' + filteredBatches.length + ' live batches...', 'clock');

    setTimeout(function () {
      try {
        var wb = XLSX.utils.book_new();

        // 1. Summary Sheet
        var summaryHeaders = [
          '#', 'Batch No', 'Category', 'Style No', 'ITB', 'Indent No', 'Indent Date',
          'Batch Qty', 'Planned Qty', 'Prod Qty',
          'Total Components', 'Ready Components', 'Pending Components',
          'Readiness %', 'Verdict', 'ERP Issue Date Status'
        ];

        var summaryRows = [summaryHeaders];
        for (var i = 0; i < filteredBatches.length; i++) {
          var b = filteredBatches[i];
          summaryRows.push([
            i + 1,
            b.batchNo,
            b.category || 'HB',
            b.styleNo,
            b.itb,
            b.indentNo,
            b.indentDate,
            b.batchQty,
            b.plannedQty,
            b.prodQty,
            b.totalCount,
            b.readyCount,
            b.pendingCount,
            b.readinessPct + '%',
            b.verdict,
            'PENDING'
          ]);
        }

        var wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Live Batches Summary');

        // 2. Pending Components Sheet
        var compHeaders = [
          '#', 'Batch No', 'Style No', 'ITB', 'Indent No',
          'Component / Material Name', 'Pro Code', 'Supplier PO',
          'Store Status (Sandip)', 'Readiness Status / Blocker'
        ];

        var compRows = [compHeaders];
        var sNo = 1;
        for (var j = 0; j < filteredBatches.length; j++) {
          var bObj = filteredBatches[j];
          for (var p = 0; p < bObj.pendingItems.length; p++) {
            var it = bObj.pendingItems[p];
            compRows.push([
              sNo++,
              bObj.batchNo,
              bObj.styleNo,
              bObj.itb,
              bObj.indentNo,
              it.itemName,
              it.itemCode,
              it.supplierPo,
              it.storeStatus,
              it.blockerReason || it.aiStatus || 'Pending'
            ]);
          }
        }

        var wsComps = XLSX.utils.aoa_to_sheet(compRows);
        XLSX.utils.book_append_sheet(wb, wsComps, 'Pending Components');

        var fileName = 'Production_Live_ERP_Yet_To_Be_Issued_Batches_' + (new Date().toISOString().slice(0, 10)) + '.xlsx';
        XLSX.writeFile(wb, fileName);
        showToast('Exported ' + filteredBatches.length + ' batches to ' + fileName + '!', 'download');
      } catch (err) {
        console.error('[ProductionLive] Excel export error:', err);
        showToast('Export failed: ' + err.message, 'error');
      }
    }, 40);
  }

  function showLoadingPlaceholder() {
    var container = document.getElementById('prod-live-content-area');
    if (!container) return;
    container.innerHTML = '<div class="prod-live-loading-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:70px 20px; text-align:center;">' +
      '<div class="prod-live-spin" style="width:40px; height:40px; border:3px solid #cbd5e1; border-top-color:#ef4444; border-radius:0; margin-bottom:16px;"></div>' +
      '<div style="font-size:15px; font-family:\'Montserrat\',sans-serif; font-weight:800; color:#0f172a; letter-spacing:0.8px; text-transform:uppercase;">CONNECTING TO SHOPFLOOR TELEMETRY &amp; CONNECTOR STREAM...</div>' +
      '<div style="font-size:12.5px; font-family:\'Manrope\',sans-serif; color:#64748b; margin-top:8px;">Scanning batches pending ERP Issue Date, component readiness % &amp; Jyoti / Store bottlenecks...</div>' +
    '</div>';
  }

  function showView() {
    var kpiView = document.getElementById('batch-list-kpi-view');
    var liveView = document.getElementById('batch-list-production-live-view');

    if (kpiView) kpiView.style.display = 'none';

    // Hide other subviews in batch-list
    document.querySelectorAll('.batch-list-extra-view').forEach(function (v) {
      v.style.display = 'none';
    });
    var cuttingView = document.getElementById('batch-list-cutting-view');
    if (cuttingView) cuttingView.style.display = 'none';

    if (liveView) {
      liveView.style.removeProperty('display');
      liveView.style.display = 'flex';
    }

    var contentArea = document.querySelector('.content-area');
    if (contentArea) {
      contentArea.classList.add('prod-live-active');
      contentArea.scrollTop = 0;
    }
    var pageBatchList = document.getElementById('page-batch-list');
    if (pageBatchList) pageBatchList.classList.add('prod-live-active');

    var feedContainer = document.getElementById('prod-live-content-area');
    if (feedContainer) feedContainer.scrollTop = 0;

    // 1. INSTANT OPEN: Render immediately with 0ms wait if data exists in memory or fast cache
    if (allBatches && allBatches.length > 0) {
      applyFiltersAndSort(false);
    } else {
      if (loadFromFastCache()) {
        applyFiltersAndSort(false);
      } else {
        showLoadingPlaceholder();
      }
    }

    // 2. Start 10-second silent auto-refresh interval
    startSilentRefresh();

    // 3. Immediately trigger background refresh for latest updates
    setTimeout(function () {
      silentBackgroundRefresh();
    }, 50);
  }

  function hideView() {
    // 1. Stop 10-second silent auto-refresh interval
    stopSilentRefresh();

    var liveView = document.getElementById('batch-list-production-live-view');
    var kpiView = document.getElementById('batch-list-kpi-view');

    if (liveView) {
      liveView.style.setProperty('display', 'none', 'important');
    }
    if (kpiView) {
      kpiView.style.removeProperty('display');
      kpiView.style.display = '';
    }

    var contentArea = document.querySelector('.content-area');
    if (contentArea) {
      contentArea.classList.remove('prod-live-active');
      contentArea.scrollTop = 0;
    }
    var pageBatchList = document.getElementById('page-batch-list');
    if (pageBatchList) pageBatchList.classList.remove('prod-live-active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateLoadingUI(syncing) {
    var syncIcon = document.getElementById('prod-live-refresh-icon');
    if (syncIcon) {
      if (syncing) syncIcon.classList.add('prod-live-spin');
      else syncIcon.classList.remove('prod-live-spin');
    }
  }

  function setFilterChannel(channel) {
    currentFilterChannel = channel || 'all';

    var channelTabs = document.querySelectorAll('.prod-live-channel-tab');
    channelTabs.forEach(function (t) {
      if ((t.getAttribute('data-channel') || 'all') === currentFilterChannel) {
        t.classList.add('is-active');
      } else {
        t.classList.remove('is-active');
      }
    });

    var kpiCards = document.querySelectorAll('.prod-live-kpi-card[data-channel]');
    kpiCards.forEach(function (c) {
      var cardCh = c.getAttribute('data-channel') || 'all';
      if (cardCh === currentFilterChannel && currentFilterChannel !== 'all') {
        c.classList.add('is-active');
      } else {
        c.classList.remove('is-active');
      }
    });

    applyFiltersAndSort(false);
  }

  function bindEvents() {
    // 1. KPI Card click in Production Data
    var kpiCard = document.getElementById('kpi-production-live');
    if (kpiCard) {
      kpiCard.addEventListener('click', function (e) {
        e.preventDefault();
        showView();
      });
      kpiCard.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showView();
        }
      });
    }

    // 2. Back button
    var backBtn = document.getElementById('btn-back-production-live');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        hideView();
      });
    }

    // 3. Refresh Stream button
    var refreshBtn = document.getElementById('btn-refresh-prod-live');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        showToast('Refreshing live stream from Google Sheets...', 'clock');
        updateLoadingUI(true);
        flashSyncPulse(true);

        var pConn = (window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.syncSilent === 'function')
          ? window.ConnectorSheetEngine.syncSilent()
          : ((window.ConnectorSheetEngine && typeof window.ConnectorSheetEngine.sync === 'function')
            ? window.ConnectorSheetEngine.sync(false)
            : Promise.resolve());

        var pCut = (window.BatchCuttingSheetEngine && typeof window.BatchCuttingSheetEngine.syncSilent === 'function')
          ? window.BatchCuttingSheetEngine.syncSilent()
          : fetchCuttingCsvDirect().then(function (cRows) {
              if (cRows && cRows.length > 0) cachedCuttingCategoryMap = buildCuttingCategoryMap(cRows);
            });

        var pBan = (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.syncSilent === 'function')
          ? window.BantalaDetailsSheetEngine.syncSilent()
          : ((window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.sync === 'function')
            ? window.BantalaDetailsSheetEngine.sync()
            : fetchBantalaCsvDirect().then(function (bRows) {
                if (bRows && bRows.length > 0) cachedBantalaMap = buildBantalaMap(bRows);
              }));

        Promise.all([Promise.resolve(pConn), Promise.resolve(pCut), Promise.resolve(pBan)]).then(function () {
          var banRows = window.BantalaDetailsSheetEngine ? window.BantalaDetailsSheetEngine.getRows() : null;
          if (banRows && banRows.length > 0) {
            cachedBantalaMap = buildBantalaMap(banRows);
          }
          var cutRows = window.BatchCuttingSheetEngine ? window.BatchCuttingSheetEngine.getRows() : null;
          if (cutRows && cutRows.length > 0) {
            cachedCuttingCategoryMap = buildCuttingCategoryMap(cutRows);
          }
          var rows = window.ConnectorSheetEngine ? window.ConnectorSheetEngine.getAllRows() : null;
          if (rows && rows.length > 0) {
            processRowsIntoLiveBatches(rows, cachedBantalaMap, cachedCuttingCategoryMap, true);
          } else {
            return fetchLiveBatches(false);
          }
        }).catch(function (err) {
          console.warn('[ProductionLive] Manual refresh warning:', err);
        }).finally(function () {
          updateLoadingUI(false);
          flashSyncPulse(false);
          showToast('Live stream synced with latest sheet data!', 'check');
        });
      });
    }

    // 4. Export button
    var exportBtn = document.getElementById('btn-export-prod-live');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportExcel);
    }

    // 5. Search input
    var searchInput = document.getElementById('prod-live-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          currentSearchQuery = searchInput.value;
          applyFiltersAndSort(false);
        }, 150);
      });
    }

    // 5b. Category Multi-Select Filter (HB / SLG)
    var catBtn = document.getElementById('prod-live-cat-btn');
    var catMenu = document.getElementById('prod-live-cat-menu');
    var catWrap = document.getElementById('prod-live-cat-dropdown-wrap');

    if (catBtn && catMenu) {
      catBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = (catMenu.style.display !== 'none');
        catMenu.style.display = isOpen ? 'none' : 'block';
        if (isOpen) {
          catBtn.classList.remove('is-open');
        } else {
          catBtn.classList.add('is-open');
        }
      });

      document.addEventListener('click', function (e) {
        if (catWrap && !catWrap.contains(e.target)) {
          catMenu.style.display = 'none';
          catBtn.classList.remove('is-open');
        }
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && catMenu.style.display !== 'none') {
          catMenu.style.display = 'none';
          catBtn.classList.remove('is-open');
        }
      });
    }

    var checkHB = document.getElementById('prod-live-check-hb');
    var checkSLG = document.getElementById('prod-live-check-slg');
    var selectAllBtn = document.getElementById('prod-live-cat-all-btn');

    function onCategoryCheckboxChange() {
      selectedCategories.clear();
      if (checkHB && checkHB.checked) selectedCategories.add('HB');
      if (checkSLG && checkSLG.checked) selectedCategories.add('SLG');
      updateCategoryFilterUI();
      applyFiltersAndSort(true);
    }

    if (checkHB) checkHB.addEventListener('change', onCategoryCheckboxChange);
    if (checkSLG) checkSLG.addEventListener('change', onCategoryCheckboxChange);

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (checkHB) checkHB.checked = true;
        if (checkSLG) checkSLG.checked = true;
        selectedCategories.clear();
        selectedCategories.add('HB');
        selectedCategories.add('SLG');
        updateCategoryFilterUI();
        applyFiltersAndSort(true);
      });
    }

    // 6. Channel filter tabs
    var channelTabs = document.querySelectorAll('.prod-live-channel-tab');
    channelTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var ch = tab.getAttribute('data-channel') || 'all';
        setFilterChannel(ch);
      });
    });

    // 6b. Scoreboard KPI Cards click to filter
    var kpiCards = document.querySelectorAll('.prod-live-kpi-card[data-channel]');
    kpiCards.forEach(function (card) {
      card.addEventListener('click', function () {
        var ch = card.getAttribute('data-channel') || 'all';
        setFilterChannel(ch);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var ch = card.getAttribute('data-channel') || 'all';
          setFilterChannel(ch);
        }
      });
    });

    // 7. Sort select
    var sortSelect = document.getElementById('prod-live-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        currentSortMode = sortSelect.value;
        applyFiltersAndSort(false);
      });
    }

    // 8. View Switch Buttons
    var viewBtns = document.querySelectorAll('.prod-live-view-btn');
    viewBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        viewBtns.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        currentViewMode = btn.getAttribute('data-view') || 'news';
        renderAll(false);
      });
    });

    // 9. Wheel event forwarding from frozen header to scrollable container
    var stickyHeader = document.getElementById('prod-live-sticky-header');
    var contentArea = document.getElementById('prod-live-content-area');
    if (stickyHeader && contentArea) {
      stickyHeader.addEventListener('wheel', function (e) {
        if (e.deltaY) {
          var tableWrap = contentArea.querySelector('.prod-live-table-wrapper');
          if (tableWrap && currentViewMode === 'table') {
            tableWrap.scrollTop += e.deltaY;
          } else {
            contentArea.scrollTop += e.deltaY;
          }
        }
      }, { passive: true });
    }

    // 10. Auto-hide when user clicks any navigation item or leaves Production Data
    document.querySelectorAll('.nav-item').forEach(function (navItem) {
      navItem.addEventListener('click', function () {
        hideView();
      });
    });

    // 11. MutationObserver to automatically clean up if page-batch-list is hidden
    var pageBatchListEl = document.getElementById('page-batch-list');
    if (pageBatchListEl && window.MutationObserver) {
      var observer = new MutationObserver(function () {
        if (pageBatchListEl.style.display === 'none') {
          hideView();
        }
      });
      observer.observe(pageBatchListEl, { attributes: true, attributeFilter: ['style'] });
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Toast Helper
  // ---------------------------------------------------------------------------
  function showToast(msg, type) {
    if (window.showToast && typeof window.showToast === 'function') {
      try { window.showToast(msg, type); return; } catch (e) {}
    }
    // Fallback toast
    var existing = document.getElementById('prod-live-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'prod-live-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#0f172a;color:#f8fafc;padding:10px 16px;border-radius:0;box-shadow:0 10px 25px rgba(0,0,0,0.3);font-family:\'Montserrat\',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;z-index:999999;border-left:4px solid #ef4444;transition:all 0.25s ease;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3200);
  }

  function setElemText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------------
  // 9. Bootstrap Engine
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();

    // Listen for live Batch Cutting Details updates
    window.addEventListener('batch-cutting-synced', function (e) {
      var rows = (e.detail && e.detail.rows) ? e.detail.rows : (window.BatchCuttingSheetEngine ? window.BatchCuttingSheetEngine.getRows() : null);
      if (rows && rows.length > 0) {
        cachedCuttingCategoryMap = buildCuttingCategoryMap(rows);
        var freshConnRows = window.ConnectorSheetEngine ? window.ConnectorSheetEngine.getAllRows() : null;
        if (freshConnRows && freshConnRows.length > 0) {
          processRowsIntoLiveBatches(freshConnRows, cachedBantalaMap, cachedCuttingCategoryMap);
        }
      }
    });

    // Listen for live Bantala Details updates
    window.addEventListener('bantala-details-synced', function (e) {
      var rows = (e.detail && e.detail.rows) ? e.detail.rows : (window.BantalaDetailsSheetEngine ? window.BantalaDetailsSheetEngine.getRows() : null);
      if (rows && rows.length > 0) {
        cachedBantalaMap = buildBantalaMap(rows);
        var freshConnRows = window.ConnectorSheetEngine ? window.ConnectorSheetEngine.getAllRows() : null;
        if (freshConnRows && freshConnRows.length > 0) {
          processRowsIntoLiveBatches(freshConnRows, cachedBantalaMap, cachedCuttingCategoryMap);
        } else {
          loadConnectorRowsFromDB().then(function (dbRows) {
            if (dbRows && dbRows.length > 0) {
              processRowsIntoLiveBatches(dbRows, cachedBantalaMap, cachedCuttingCategoryMap);
            }
          });
        }
      }
    });

    // 0. Pre-index in-memory cutting records if already booted
    if (window.BatchCuttingSheetEngine && typeof window.BatchCuttingSheetEngine.getRows === 'function') {
      var initialCutting = window.BatchCuttingSheetEngine.getRows();
      if (initialCutting && initialCutting.length > 0) {
        cachedCuttingCategoryMap = buildCuttingCategoryMap(initialCutting);
      }
    }

    // 0b. Pre-index in-memory bantala records if already booted
    if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.getRows === 'function') {
      var initialBantala = window.BantalaDetailsSheetEngine.getRows();
      if (initialBantala && initialBantala.length > 0) {
        cachedBantalaMap = buildBantalaMap(initialBantala);
      }
    }

    // 1. Instantly populate memory from fast localStorage cache
    loadFromFastCache();
    // 2. Pre-warm data in background 250ms after boot so opening is instant
    setTimeout(function () {
      fetchLiveBatches(true);
      var liveView = document.getElementById('batch-list-production-live-view');
      if (liveView && liveView.style.display !== 'none') {
        startSilentRefresh();
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Global Engine Export
  window.ProductionLiveEngine = {
    init: start,
    show: showView,
    hide: hideView,
    refresh: fetchLiveBatches,
    exportExcel: exportExcel,
    getLiveBatches: function () { return allBatches; }
  };

})();
