/**
 * =============================================================================
 * Cutting Details & Dropdown Live Engine (IndexedDB + Fast Google Sheets CSV)
 * =============================================================================
 * Sheet 1: CUTTING DETAILS (GID: 1625638521, Range: A1:N)
 * Sheet 2: DROPDOWN (Sheet name: 'DROPDOWN', Range: A2:I)
 * Sheet 3: FMS DATA (Sheet name: 'FMS DATA', Range: C2:C for submitted batch IDs)
 *
 * Database: IndexedDB 'FMS_Cutting_Details_DB_v2'
 * Object Stores:
 *   - 'cutting_meta': headers, rows array, batch IDs, last_sync
 *   - 'batch_lookup': keyPath 'batchLower' for instant 0ms autofill lookups
 *   - 'dropdown_meta': cached dropdown options for units, seasons, supervisors, etc.
 *   - 'submitted_meta': cached list of all submitted batch IDs
 *
 * Synchronous Fast-Boot:
 *   - Uses localStorage for 0ms initial load at script execution time
 *   - Default seed data embedded for instant first-render with zero flicker
 *   - All dropdowns and batch validation ready in 0ms before DOMContentLoaded
 *   - Background non-blocking silent sync keeps everything fresh without spinners
 * =============================================================================
 */

(function (root) {
  'use strict';

  var SPREADSHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
  var CUTTING_GID    = '1625638521';

  var CUTTING_PRIMARY_CSV_URL  = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/export?format=csv&gid=' + CUTTING_GID + '&range=A1:N';
  var CUTTING_FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + CUTTING_GID + '&range=A1:N';
  var CUTTING_CSV_URL          = CUTTING_PRIMARY_CSV_URL;

  var DROPDOWN_PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/export?format=csv&headers=0&gid=0&range=A2:I';
  var DROPDOWN_FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/gviz/tq?tqx=out:csv&headers=0&gid=0&range=A2:I';
  var DROPDOWN_CSV_URL         = DROPDOWN_PRIMARY_CSV_URL;

  var SUBMITTED_CSV_URL        = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/gviz/tq?tqx=out:csv&sheet=FMS%20DATA&range=C2:C';

  var DB_NAME = 'FMS_Cutting_Details_DB_v2';
  var DB_VERSION = 2;
  var META_STORE = 'cutting_meta';
  var LOOKUP_STORE = 'batch_lookup';
  var DROPDOWN_STORE = 'dropdown_meta';
  var SUBMITTED_STORE = 'submitted_meta';

  var LS_KEY_DROPDOWNS = 'FMS_DROPDOWNS_CACHE_v2';
  var LS_KEY_SUBMITTED = 'FMS_SUBMITTED_BATCHES_v2';
  var LS_KEY_BATCH_IDS = 'FMS_BATCH_IDS_CACHE_v2';

  // Seed default dropdown options from live Google Sheet DROPDOWN tab
  var DEFAULT_SEED_DROPDOWNS = {
    batchIds: [],
    cuttingLeatherReceiveUnits: ['S-37', 'S-18', 'P-32', 'S-29', '14-B', '114', 'S-10', 'OUTSIDE'],
    brandNames: ['Piquadro', 'Brighton', 'Karl', 'Cleobella', 'Orlebar Brown', 'Bavarian Caps', 'Radley'],
    seasons: ['None', 'AW-26', 'SS-26', 'AW-27', 'SS-27', 'FW-26', 'FW-27', 'AW-22', 'SS-22', 'AW-23', 'SS-23', 'AW-24', 'SS-24', 'AW-25', 'SS-25'],
    categories: ['HB', 'SLG'],
    floorSupervisorNames: ['SUDIPTA KUMAR ROY', 'MUSTAFA KHAN', 'BHASKAR MONDAL', 'ABHIJIT PAUL', 'SOFI ULLA SARDAR', 'AMIT KUMAR DAS', 'JIYAULA HQ GAZI', 'INAMUL', 'BISWAJIT KARMAKAR'],
    inLineQCNames: ['PRASANTA SHAW', 'SHANKAR DAS', 'MADHU MOLLA', 'HAFIJUL MOLLA', 'SUMAN PURKAIT', 'SAHAJAMAL SK', 'MADHU MONDOL', 'GOBINDA DAS', 'JAYANTA', 'INAMUL', 'ARSHADUL GAZI', 'ALI HOSEN SARDAR', 'MD SAIF']
  };

  var dbInstance = null;
  var isSyncingCutting = false;
  var isSyncingDropdowns = false;
  var isSyncingSubmitted = false;

  // In-memory quick lookup structures for instant synchronous 0ms lookups
  var memoryLookup = {};        // batchLower -> { batch, brandName, poAsPerBuyer, styleNo, colour, quantity, category }
  var memoryBatchIds = [];      // sorted de-duplicated batch IDs
  var memoryHeaders = [];
  var memoryRows = [];
  var memoryDropdowns = null;
  var existingBatchesSet = new Set();
  var isReady = false;

  // ---------------------------------------------------------------------------
  // 0. Synchronous Fast-Boot Initialization (0ms startup)
  // ---------------------------------------------------------------------------
  try {
    var rawDD = localStorage.getItem(LS_KEY_DROPDOWNS);
    if (rawDD) {
      memoryDropdowns = JSON.parse(rawDD);
    } else {
      memoryDropdowns = JSON.parse(JSON.stringify(DEFAULT_SEED_DROPDOWNS));
    }

    var rawBatches = localStorage.getItem(LS_KEY_BATCH_IDS);
    if (rawBatches) {
      memoryBatchIds = JSON.parse(rawBatches);
      if (memoryBatchIds && memoryBatchIds.length > 0) {
        memoryDropdowns.batchIds = memoryBatchIds;
      }
    } else {
      var oldBatches = localStorage.getItem('FMS_BATCH_IDS_CACHE_v1') || localStorage.getItem('FMS_BATCH_IDS_CACHE');
      if (oldBatches) {
        try {
          memoryBatchIds = JSON.parse(oldBatches);
          if (memoryBatchIds && memoryBatchIds.length > 0) {
            memoryDropdowns.batchIds = memoryBatchIds;
          }
        } catch (e) {}
      }
    }

    var rawSubmitted = localStorage.getItem(LS_KEY_SUBMITTED);
    if (rawSubmitted) {
      var arrSub = JSON.parse(rawSubmitted);
      if (Array.isArray(arrSub)) {
        arrSub.forEach(function (b) {
          if (b) {
            existingBatchesSet.add(String(b).trim());
            existingBatchesSet.add(String(b).trim().toLowerCase());
          }
        });
      }
    }

    // Immediately provide dropdownData to root/window so app.js sees it at Line 1!
    if (typeof root.dropdownData === 'undefined' || !root.dropdownData || !root.dropdownData.batchIds || root.dropdownData.batchIds.length === 0) {
      root.dropdownData = memoryDropdowns;
    }
  } catch (e) {
    memoryDropdowns = JSON.parse(JSON.stringify(DEFAULT_SEED_DROPDOWNS));
  }

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Initialization
  // ---------------------------------------------------------------------------
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (dbInstance) return resolve(dbInstance);
      if (!window.indexedDB) {
        return reject(new Error('IndexedDB is not supported in this browser.'));
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
        if (!db.objectStoreNames.contains(LOOKUP_STORE)) {
          db.createObjectStore(LOOKUP_STORE, { keyPath: 'batchLower' });
        }
        if (!db.objectStoreNames.contains(DROPDOWN_STORE)) {
          db.createObjectStore(DROPDOWN_STORE);
        }
        if (!db.objectStoreNames.contains(SUBMITTED_STORE)) {
          db.createObjectStore(SUBMITTED_STORE);
        }
      };
      req.onsuccess = function (e) {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };
      req.onerror = function (e) {
        reject(e.target.error || new Error('Failed to open IndexedDB ' + DB_NAME));
      };
    });
  }

  // ---------------------------------------------------------------------------
  // 2. High Performance CSV Stream Parser
  // ---------------------------------------------------------------------------
  function parseCSVStream(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;

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
          if (curRow.length > 0) rows.push(curRow);
          curRow = [];
        } else if (c === '\n') {
          curRow.push(curVal.trim());
          curVal = '';
          if (curRow.length > 0) rows.push(curRow);
          curRow = [];
        } else {
          curVal += c;
        }
      }
    }
    if (curVal || curRow.length) {
      curRow.push(curVal.trim());
      if (curRow.length > 0) rows.push(curRow);
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // 3. Process Cutting Details Rows into Batch Lookup Index & Batch IDs
  // ---------------------------------------------------------------------------
  function processCuttingRows(headers, rawRows) {
    var lookupMap = {};
    var batchIdSeen = {};
    var batchIdList = [];

    for (var i = 0; i < rawRows.length; i++) {
      var r = rawRows[i];
      // Column M is index 12 (Batch ID)
      var batchVal = (r[12] || '').trim();
      if (!batchVal || batchVal === 'null' || batchVal === 'undefined') continue;

      var batchLower = batchVal.toLowerCase();

      if (!batchIdSeen[batchVal]) {
        batchIdSeen[batchVal] = true;
        batchIdList.push(batchVal);
      }

      // Preserve details for instant autofill
      if (!lookupMap[batchLower]) {
        lookupMap[batchLower] = {
          batchLower: batchLower,
          batch: batchVal,
          brandName: (r[2] || '').trim(),     // Column C (BUYER)
          poAsPerBuyer: (r[3] || '').trim(),  // Column D (PO NO)
          styleNo: (r[4] || '').trim(),       // Column E (STYLE)
          colour: (r[6] || '').trim(),        // Column G (COLOUR)
          quantity: (r[7] || '').trim(),      // Column H (QUANTITY)
          category: (r[11] || '').trim()      // Column L (CATEGORY)
        };
      }
    }

    return {
      batchIds: batchIdList,
      lookupMap: lookupMap
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Save Cutting Cache to IndexedDB & localStorage
  // ---------------------------------------------------------------------------
  function saveCuttingCache(headers, rows, lookupMap, batchIds) {
    try {
      localStorage.setItem(LS_KEY_BATCH_IDS, JSON.stringify(batchIds));
    } catch (e) {}

    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([META_STORE, LOOKUP_STORE], 'readwrite');
        var metaStore = tx.objectStore(META_STORE);
        var lookupStore = tx.objectStore(LOOKUP_STORE);

        metaStore.put(headers, 'headers');
        metaStore.put(rows, 'rows');
        metaStore.put(batchIds, 'batch_ids');
        metaStore.put(Date.now(), 'last_sync');

        lookupStore.clear();
        var keys = Object.keys(lookupMap);
        for (var i = 0; i < keys.length; i++) {
          lookupStore.put(lookupMap[keys[i]]);
        }

        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Load Cutting Cache from IndexedDB
  // ---------------------------------------------------------------------------
  function loadCuttingCache() {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([META_STORE, LOOKUP_STORE, DROPDOWN_STORE, SUBMITTED_STORE], 'readonly');
        var metaStore = tx.objectStore(META_STORE);
        var lookupStore = tx.objectStore(LOOKUP_STORE);
        var ddStore = tx.objectStore(DROPDOWN_STORE);
        var subStore = tx.objectStore(SUBMITTED_STORE);

        var reqHeaders = metaStore.get('headers');
        var reqRows = metaStore.get('rows');
        var reqBatchIds = metaStore.get('batch_ids');
        var reqSync = metaStore.get('last_sync');
        var reqLookup = lookupStore.getAll();
        var reqDD = ddStore.get('dropdown_data');
        var reqSub = subStore.get('submitted_batches');

        tx.oncomplete = function () {
          var rows = reqRows.result;
          var lookupMap = {};
          var lookupArr = reqLookup.result || [];
          for (var i = 0; i < lookupArr.length; i++) {
            lookupMap[lookupArr[i].batchLower] = lookupArr[i];
          }

          resolve({
            headers: reqHeaders.result || [],
            rows: rows || [],
            batchIds: reqBatchIds.result || [],
            lookupMap: lookupMap,
            dropdownData: reqDD.result || null,
            submittedBatches: reqSub.result || null,
            lastSync: reqSync.result || null
          });
        };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Sync Cutting Details Sheet (Background GVIZ CSV)
  // ---------------------------------------------------------------------------
  function syncCuttingDetails() {
    if (isSyncingCutting) return Promise.resolve(null);
    isSyncingCutting = true;

    var ts = Date.now();
    var primaryUrl = CUTTING_PRIMARY_CSV_URL + '&_ts=' + ts;
    var fallbackUrl = CUTTING_FALLBACK_CSV_URL + '&_ts=' + ts;

    return fetch(primaryUrl, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('Primary HTTP ' + res.status);
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 50) throw new Error('Primary payload empty');
        return csvText;
      })
      .catch(function (err) {
        console.warn('[CuttingDetailsSheet] Primary export failed, using GViz fallback:', err);
        return fetch(fallbackUrl, { cache: 'no-cache' }).then(function (res2) {
          if (!res2.ok) throw new Error('Fallback HTTP ' + res2.status);
          return res2.text();
        });
      })
      .then(function (csvText) {
        var parsed = parseCSVStream(csvText);
        if (!parsed || parsed.length < 2) {
          isSyncingCutting = false;
          return null;
        }

        var headers = parsed[0];
        var rows = parsed.slice(1);
        var processed = processCuttingRows(headers, rows);

        memoryHeaders = headers;
        memoryRows = rows;
        memoryBatchIds = processed.batchIds;
        memoryLookup = processed.lookupMap;
        isReady = true;

        if (memoryDropdowns) {
          memoryDropdowns.batchIds = processed.batchIds;
          applyDropdownsToDOM(memoryDropdowns);
        }

        return saveCuttingCache(headers, rows, processed.lookupMap, processed.batchIds).then(function () {
          isSyncingCutting = false;
          updateSyncBadge(rows.length);
          return { headers: headers, rows: rows, batchIds: processed.batchIds };
        });
      })
      .catch(function (err) {
        console.warn('[CuttingDetailsSheet] Live cutting sync failed:', err);
        isSyncingCutting = false;
        return null;
      });
  }

  // ---------------------------------------------------------------------------
  // 7. Sync Dropdown Sheet (Background GVIZ CSV)
  // ---------------------------------------------------------------------------
  function syncDropdowns() {
    if (isSyncingDropdowns) return Promise.resolve(null);
    isSyncingDropdowns = true;

    var ts = Date.now();
    var primaryUrl = DROPDOWN_PRIMARY_CSV_URL + '&_ts=' + ts;
    var fallbackUrl = DROPDOWN_FALLBACK_CSV_URL + '&_ts=' + ts;

    return fetch(primaryUrl, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('Primary HTTP ' + res.status);
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 20) throw new Error('Primary payload empty');
        return csvText;
      })
      .catch(function (err) {
        console.warn('[CuttingDetailsSheet] Dropdown primary export failed, using GViz fallback:', err);
        return fetch(fallbackUrl, { cache: 'no-cache' }).then(function (res2) {
          if (!res2.ok) throw new Error('Fallback HTTP ' + res2.status);
          return res2.text();
        });
      })
      .then(function (csvText) {
        var parsed = parseCSVStream(csvText);
        if (!parsed || parsed.length < 1) {
          isSyncingDropdowns = false;
          return null;
        }

        var units = [];
        var brands = [];
        var seasons = [];
        var categories = [];
        var supervisors = [];
        var qcs = [];

        var seenU = {}, seenB = {}, seenS = {}, seenC = {}, seenSup = {}, seenQ = {};

        // Row 0 is header or first data row (DROPDOWN range is A2:I so row 0 is data)
        for (var i = 0; i < parsed.length; i++) {
          var r = parsed[i];
          var u   = (r[2] || '').trim();
          var b   = (r[4] || '').trim();
          var s   = (r[5] || '').trim();
          var cat = (r[6] || '').trim();
          var sup = (r[7] || '').trim();
          var q   = (r[8] || '').trim();

          if (u && !seenU[u])     { seenU[u] = true; units.push(u); }
          if (b && !seenB[b])     { seenB[b] = true; brands.push(b); }
          if (s && !seenS[s])     { seenS[s] = true; seasons.push(s); }
          if (cat && !seenC[cat]) { seenC[cat] = true; categories.push(cat); }
          if (sup && !seenSup[sup]) { seenSup[sup] = true; supervisors.push(sup); }
          if (q && !seenQ[q])     { seenQ[q] = true; qcs.push(q); }
        }

        var newDD = {
          batchIds: memoryBatchIds || (memoryDropdowns && memoryDropdowns.batchIds) || [],
          cuttingLeatherReceiveUnits: units.length ? units : DEFAULT_SEED_DROPDOWNS.cuttingLeatherReceiveUnits,
          brandNames: brands.length ? brands : DEFAULT_SEED_DROPDOWNS.brandNames,
          seasons: seasons.length ? seasons : DEFAULT_SEED_DROPDOWNS.seasons,
          categories: categories.length ? categories : DEFAULT_SEED_DROPDOWNS.categories,
          floorSupervisorNames: supervisors.length ? supervisors : DEFAULT_SEED_DROPDOWNS.floorSupervisorNames,
          inLineQCNames: qcs.length ? qcs : DEFAULT_SEED_DROPDOWNS.inLineQCNames
        };

        memoryDropdowns = newDD;
        root.dropdownData = newDD;

        try { localStorage.setItem(LS_KEY_DROPDOWNS, JSON.stringify(newDD)); } catch (e) {}

        // Save to IndexedDB
        openDatabase().then(function (db) {
          var tx = db.transaction([DROPDOWN_STORE], 'readwrite');
          tx.objectStore(DROPDOWN_STORE).put(newDD, 'dropdown_data');
        }).catch(function () {});

        applyDropdownsToDOM(newDD);
        isSyncingDropdowns = false;
        return newDD;
      })
      .catch(function (err) {
        console.warn('[CuttingDetailsSheet] Dropdown sync failed:', err);
        isSyncingDropdowns = false;
        return null;
      });
  }

  // ---------------------------------------------------------------------------
  // 8. Sync Submitted Batches from FMS DATA Column C (Background GVIZ CSV)
  // ---------------------------------------------------------------------------
  function syncSubmittedBatches() {
    if (isSyncingSubmitted) return Promise.resolve(null);
    isSyncingSubmitted = true;

    var url = SUBMITTED_CSV_URL + '&_ts=' + Date.now();
    return fetch(url, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (csvText) {
        var parsed = parseCSVStream(csvText);
        if (!parsed) {
          isSyncingSubmitted = false;
          return null;
        }

        var list = [];
        for (var i = 0; i < parsed.length; i++) {
          var batch = (parsed[i][0] || '').trim();
          if (batch && batch !== 'null' && batch !== 'undefined' && batch !== 'Batch ID') {
            list.push(batch);
            existingBatchesSet.add(batch);
            existingBatchesSet.add(batch.toLowerCase());
          }
        }

        try { localStorage.setItem(LS_KEY_SUBMITTED, JSON.stringify(list)); } catch (e) {}

        openDatabase().then(function (db) {
          var tx = db.transaction([SUBMITTED_STORE], 'readwrite');
          tx.objectStore(SUBMITTED_STORE).put(list, 'submitted_batches');
        }).catch(function () {});

        isSyncingSubmitted = false;
        return list;
      })
      .catch(function (err) {
        console.warn('[CuttingDetailsSheet] Submitted batches sync failed:', err);
        isSyncingSubmitted = false;
        return null;
      });
  }

  // ---------------------------------------------------------------------------
  // 9. Synchronize All 3 Data Streams in Background
  // ---------------------------------------------------------------------------
  function syncAll() {
    return Promise.all([
      syncCuttingDetails(),
      syncDropdowns(),
      syncSubmittedBatches()
    ]);
  }

  // ---------------------------------------------------------------------------
  // 10. Update DOM Dropdown Components Live
  // ---------------------------------------------------------------------------
  function applyDropdownsToDOM(dd) {
    if (!dd) return;
    if (typeof root.dropdownData === 'object' && root.dropdownData !== null) {
      Object.assign(root.dropdownData, dd);
    }

    var map = {
      batchId:                   dd.batchIds,
      cuttingLeatherReceiveUnit: dd.cuttingLeatherReceiveUnits,
      season:                    dd.seasons,
      floorSupervisorName:       dd.floorSupervisorNames,
      inLineQCName:              dd.inLineQCNames
    };

    Object.keys(map).forEach(function (fieldId) {
      var opts = map[fieldId];
      if (!opts || !opts.length) return;
      var wrapper = document.querySelector('[data-dropdown="' + fieldId + '"]');
      if (wrapper && wrapper._dd && typeof wrapper._dd.setOptions === 'function') {
        wrapper._dd.setOptions(opts);
      }
    });
  }

  function updateSyncBadge(count) {
    var badge = document.getElementById('fms-cutting-idb-badge');
    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;color:#0284c7;vertical-align:middle;margin-right:4px;">bolt</span>' +
        'Database Ready (' + (count ? count.toLocaleString() : '0') + ' Batches)';
    }
  }

  // ---------------------------------------------------------------------------
  // 11. Public Lookup and Validation Methods (0ms Synchronous!)
  // ---------------------------------------------------------------------------
  function lookupBatchSync(batchVal) {
    if (!batchVal) return null;
    var key = String(batchVal).trim().toLowerCase();
    return memoryLookup[key] || null;
  }

  function lookupBatch(batchVal) {
    if (!batchVal) return Promise.resolve(null);
    var key = String(batchVal).trim().toLowerCase();

    // 1. Instant synchronous check
    if (memoryLookup[key]) {
      return Promise.resolve(memoryLookup[key]);
    }

    // 2. Fallback to IndexedDB
    return openDatabase().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(LOOKUP_STORE, 'readonly');
          var store = tx.objectStore(LOOKUP_STORE);
          var req = store.get(key);
          req.onsuccess = function () {
            if (req.result) {
              memoryLookup[key] = req.result;
              resolve(req.result);
            } else {
              resolve(null);
            }
          };
          req.onerror = function () { resolve(null); };
        } catch (e) {
          resolve(null);
        }
      });
    }).catch(function () { return null; });
  }

  function isBatchSubmitted(batchVal) {
    if (!batchVal) return false;
    var s = String(batchVal).trim();
    return existingBatchesSet.has(s) || existingBatchesSet.has(s.toLowerCase());
  }

  function markBatchSubmitted(batchVal) {
    if (!batchVal) return;
    var s = String(batchVal).trim();
    existingBatchesSet.add(s);
    existingBatchesSet.add(s.toLowerCase());

    try {
      var arr = Array.from(existingBatchesSet);
      localStorage.setItem(LS_KEY_SUBMITTED, JSON.stringify(arr));
    } catch (e) {}

    openDatabase().then(function (db) {
      var tx = db.transaction([SUBMITTED_STORE], 'readwrite');
      tx.objectStore(SUBMITTED_STORE).put(Array.from(existingBatchesSet), 'submitted_batches');
    }).catch(function () {});
  }

  // ---------------------------------------------------------------------------
  // 12. Engine Bootstrapping
  // ---------------------------------------------------------------------------
  function init() {
    loadCuttingCache().then(function (cached) {
      if (cached) {
        if (cached.headers && cached.headers.length) memoryHeaders = cached.headers;
        if (cached.rows && cached.rows.length) {
          memoryRows = cached.rows;
          memoryBatchIds = cached.batchIds || [];
          memoryLookup = cached.lookupMap || {};
          isReady = true;
          updateSyncBadge(cached.rows.length);
        }
        if (cached.dropdownData) {
          memoryDropdowns = cached.dropdownData;
          root.dropdownData = cached.dropdownData;
        }
        if (cached.submittedBatches && Array.isArray(cached.submittedBatches)) {
          cached.submittedBatches.forEach(function (b) {
            if (b) {
              existingBatchesSet.add(String(b).trim());
              existingBatchesSet.add(String(b).trim().toLowerCase());
            }
          });
        }
        if (memoryDropdowns) {
          applyDropdownsToDOM(memoryDropdowns);
        }
      }

      // Background non-blocking sync
      syncAll();
    }).catch(function (err) {
      console.warn('[CuttingDetailsSheet] Initial cache load error:', err);
      syncAll();
    });
  }

  // Run initial cache load immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export Engine API to window
  root.CuttingDetailsEngine = {
    init: init,
    syncAll: syncAll,
    syncCuttingDetails: syncCuttingDetails,
    syncDropdowns: syncDropdowns,
    syncSubmittedBatches: syncSubmittedBatches,
    lookupBatchSync: lookupBatchSync,
    lookupBatch: lookupBatch,
    isBatchSubmitted: isBatchSubmitted,
    markBatchSubmitted: markBatchSubmitted,
    getDropdownData: function () { return memoryDropdowns || DEFAULT_SEED_DROPDOWNS; },
    getBatchIds: function () { return memoryBatchIds.slice(); },
    getHeaders: function () { return memoryHeaders.slice(); },
    getRows: function () { return memoryRows.slice(); },
    isReady: function () { return isReady; }
  };

})(window);
