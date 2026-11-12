/**
 * =============================================================================
 * Trio-AI Data Summary Live Engine (IndexedDB + Fast Google Sheets CSV)
 * =============================================================================
 * Reports Section KPI: Trio-AI Data
 * Sheet Name: Report Data | GID: 983316555
 * Spreadsheet ID: 1LlfKU7tC-2HYx8QJxe-lGNt-hoS4LZDeSDlWg22z-qk
 * Database: IndexedDB 'FMS_Trio_AI_Data_DB_v2'
 * Object Store: 'trio_ai_data_store_v2'
 *
 * 21 Real Columns (omits 11 blank intermediate columns):
 *   [0] BUYER, [1] ITB, [2] ITB DATE, [3] Buyer ETD, [4] ITB Qty,
 *   [5] INDENT NO., [6] INDENT DATE, [7] Style, [8] Colour, [9] PRO CODE,
 *   [10] PROD NAME, [11] Supplier PO, [12] PO Confirmation Date, [13] ORDER QTY,
 *   [14] ADJ GRN QTY, [15] PENDING QTY, [16] ETD MONTH, [17] User,
 *   [18] Category, [19] Status, [20] UNIQUE ID (STYLE + INDENT)
 *
 * Features & Header Styling (Identical to In-Line QC & Floor Supervisor):
 *   - Strict single-line horizontal alignment in header (white-space: nowrap)
 *   - Column Title + Sort Icon (arrow_upward / arrow_downward / unfold_more)
 *   - Square Google Sheets Style Column Filter Button (filter_list / filter_alt)
 *   - Click Column Title or Sort Icon to sort A-Z / Z-A directly
 *   - Google Sheets Style Column Filter Popover with live search, counts, checkboxes
 *   - Active Filter Chips Bar with single remove & Clear All Filters
 *   - Interactive Cell Selection (Click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (Strictly ZERO emojis)
 *   - High-performance RFC-4180 CSV Stream Fetch & in-memory parsing from Google Sheet
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Multi-URL fallback with detection for restricted Google Sheet sharing
 *   - Excel (.xlsx) Export via SheetJS
 *   - Pagination (25, 50, 100, 250, 500, All) with page jump input
 * =============================================================================
 */

(function () {
  'use strict';

  var SPREADSHEET_ID = '1LlfKU7tC-2HYx8QJxe-lGNt-hoS4LZDeSDlWg22z-qk';
  var SHEET_GID = '983316555';
  var SHEET_NAME = 'Report Data';
  var GOOGLE_SHEET_EDIT_URL = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit?gid=' + SHEET_GID + '#gid=' + SHEET_GID;

  var CSV_ENDPOINTS = [
    'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/export?format=csv&gid=' + SHEET_GID,
    'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID,
    'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/gviz/tq?sheet=' + encodeURIComponent(SHEET_NAME)
  ];

  var DB_NAME = 'FMS_Trio_AI_Data_DB_v3';
  var DB_VERSION = 2;
  var STORE_NAME = 'trio_ai_data_store_v3';

  // 20 Canonical Headers from Google Sheet strictly up to Status
  var defaultHeaders = [
    'BUYER',
    'ITB',
    'ITB DATE',
    'Buyer ETD',
    'ITB Qty',
    'INDENT NO.',
    'INDENT DATE',
    'Style',
    'Colour',
    'PRO CODE',
    'PROD NAME',
    'Supplier PO',
    'PO Confirmation Date',
    'ORDER QTY',
    'ADJ GRN QTY',
    'PENDING QTY',
    'ETD MONTH',
    'User',
    'Category',
    'Status'
  ];

  var dbInstance = null;
  var allHeaders = defaultHeaders.slice();
  var allRows = [];
  var filteredRows = [];
  var currentPage = 1;
  var pageSize = 100;
  var isSyncing = false;
  var lastSyncTime = null;
  var searchDebounceTimer = null;

  // Sorting State
  var sortColumn = -1;
  var sortAsc = true;

  // Column Filters State: colIdx -> Set of allowed string values
  var activeColumnFilters = {};
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Interactive Cell Selection State
  var activeCellCoords = null; // { r: localRowIndex, c: colIndex }

  // Strict SVG Icons (NO EMOJIS)
  var SVG_ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    sort: '<svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 12h12m-9 6h6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>'
  };

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Cache Engine
  // ---------------------------------------------------------------------------
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (dbInstance && dbInstance.objectStoreNames.contains(STORE_NAME)) {
        return resolve(dbInstance);
      }
      dbInstance = null;
      if (!window.indexedDB) return reject(new Error('IndexedDB is not supported on this browser'));
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
          console.warn('[TrioAIData] Store missing in ' + DB_NAME + ', auto-repairing...');
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
        reject(e.target.error || new Error('Failed to open IndexedDB ' + DB_NAME));
      };
    });
  }

  function saveToCache(headers, rows) {
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
          store.put(Date.now(), 'last_sync');
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function (e) {
            console.warn('[TrioAIData] saveToCache tx error:', e.target.error);
            resolve();
          };
        } catch (err) {
          console.warn('[TrioAIData] saveToCache error:', err);
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
          var reqH = store.get('headers');
          var reqR = store.get('rows');
          var reqS = store.get('last_sync');
          tx.oncomplete = function () {
            if (reqR.result && Array.isArray(reqR.result) && reqR.result.length > 0) {
              // Check if cached headers contain old dummy columns or columns past Status
              var hasInvalid = (reqH.result || []).some(function (h) {
                return typeof h === 'string' && (/^column \d+/i.test(h) || h.toLowerCase().indexOf('unique id') !== -1);
              });
              if (hasInvalid || (reqH.result && reqH.result.length > 20)) {
                resolve(null); // Purge cache so it refreshes with exactly up to Status
                return;
              }
              resolve({
                headers: (reqH.result && Array.isArray(reqH.result) && reqH.result.length > 0) ? reqH.result : defaultHeaders,
                rows: reqR.result,
                lastSync: reqS.result || null
              });
            } else {
              resolve(null);
            }
          };
          tx.onerror = function () { resolve(null); };
        } catch (err) {
          console.warn('[TrioAIData] loadFromCache error:', err);
          dbInstance = null;
          resolve(null);
        }
      });
    }).catch(function () { return Promise.resolve(null); });
  }

  // ---------------------------------------------------------------------------
  // 2. High-Performance RFC-4180 CSV Stream Parser
  // ---------------------------------------------------------------------------
  function parseCSVStream(csvText) {
    var p = '', row = [''], ret = [row], i = 0, r = 0, s = true, l = csvText.length;
    for (i = 0; i < l; i++) {
      var cc = csvText[i], nc = csvText[i + 1];
      if (cc === '"') {
        if (s && cc === p) {
          row[r] += cc;
        }
        s = !s;
      } else if (cc === ',' && s) {
        row[++r] = '';
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

    if (!cleanRows || cleanRows.length === 0) {
      throw new Error('CSV payload is empty or invalid');
    }

    // Dynamic Header Detection: extract row 0, stopping strictly at "Status" column
    var rawHeaders = cleanRows[0];
    var validColIndices = [];
    var parsedHeaders = [];

    for (var c = 0; c < rawHeaders.length; c++) {
      var hName = String(rawHeaders[c] || '').trim();
      if (hName.length > 0) {
        validColIndices.push(c);
        parsedHeaders.push(hName);
        // Stop strictly at "Status" column - no columns beyond that
        if (hName.toLowerCase() === 'status') {
          break;
        }
      }
    }

    // Fallback if sheet had no headers
    if (parsedHeaders.length === 0) {
      parsedHeaders = defaultHeaders.slice();
      validColIndices = defaultHeaders.map(function (_, idx) { return idx; });
    }

    var rows = [];
    for (var k = 1; k < cleanRows.length; k++) {
      var curR = cleanRows[k];
      var hasContent = curR.some(function (cell) {
        return cell !== undefined && cell !== null && String(cell).trim() !== '';
      });
      if (hasContent) {
        var normRow = new Array(validColIndices.length);
        for (var colIdx = 0; colIdx < validColIndices.length; colIdx++) {
          var srcIdx = validColIndices[colIdx];
          normRow[colIdx] = (curR[srcIdx] !== undefined && curR[srcIdx] !== null) ? String(curR[srcIdx]).trim() : '';
        }
        rows.push(normRow);
      }
    }

    return { headers: parsedHeaders, rows: rows };
  }

  // ---------------------------------------------------------------------------
  // 3. Google Sheet CSV Fetch with Fallback & Permission Guard
  // ---------------------------------------------------------------------------
  function fetchEndpoint(urlIndex) {
    if (urlIndex >= CSV_ENDPOINTS.length) {
      return Promise.reject(new Error('All Google Sheet CSV endpoints failed to respond'));
    }
    var targetUrl = CSV_ENDPOINTS[urlIndex] + (CSV_ENDPOINTS[urlIndex].indexOf('?') !== -1 ? '&' : '?') + '_=' + Date.now();

    return fetch(targetUrl, { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        return res.text();
      })
      .then(function (text) {
        if (!text || text.trim().length === 0) {
          throw new Error('Empty CSV body');
        }

        // Check if Google redirected to HTML login page (Restricted Sheet)
        var isHtmlAuth = (
          text.indexOf('<!DOCTYPE html') !== -1 ||
          text.indexOf('accounts.google.com') !== -1 ||
          text.indexOf('ServiceLogin') !== -1 ||
          text.indexOf('<html') !== -1
        );

        if (isHtmlAuth) {
          var err = new Error('GOOGLE_AUTH_RESTRICTED');
          err.code = 'GOOGLE_AUTH_RESTRICTED';
          throw err;
        }

        return parseCSVStream(text);
      })
      .catch(function (err) {
        if (err.code === 'GOOGLE_AUTH_RESTRICTED') {
          throw err;
        }
        console.warn('Endpoint ' + (urlIndex + 1) + ' failed: ' + err.message + '. Trying next endpoint...');
        return fetchEndpoint(urlIndex + 1);
      });
  }

  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    hideRestrictedModal();
    updateSyncUI(true, isManual ? 'Connecting to Google Sheets...' : 'Checking for sheet updates...');

    fetchEndpoint(0)
      .then(function (result) {
        allHeaders = result.headers;
        allRows = result.rows;
        lastSyncTime = Date.now();
        return saveToCache(allHeaders, allRows);
      })
      .then(function () {
        applyAllFiltersAndSearch();
        renderHeaderRow();
        updateHeaderBadge();
        updateSyncUI(false);
        if (isManual) {
          showToast('Successfully synced ' + allRows.length.toLocaleString() + ' Trio-AI Data records', 'check');
        }
      })
      .catch(function (err) {
        console.error('Trio-AI Data sync error:', err);
        updateSyncUI(false);

        if (err.code === 'GOOGLE_AUTH_RESTRICTED') {
          showRestrictedBanner();
          if (isManual) {
            showRestrictedModal();
          }
        } else if (isManual) {
          showToast('Sync error: ' + (err.message || 'Check network connection'), 'error');
        }
      })
      .finally(function () {
        isSyncing = false;
      });
  }

  // ---------------------------------------------------------------------------
  // 4. Restricted Permission Helpers
  // ---------------------------------------------------------------------------
  function showRestrictedBanner() {
    var banner = document.getElementById('trio-ai-data-sheet-sync-banner');
    if (!banner) return;
    banner.style.display = 'flex';
    banner.style.background = '#fffbeb';
    banner.style.borderColor = '#fde68a';
    banner.style.color = '#92400e';
    banner.innerHTML = [
      '<span class="material-icons-round" style="color:#d97706; font-size:18px;">lock</span>',
      '<span style="font-weight:600;">Google Sheet Sharing Restricted:</span>',
      '<span>Please set Google Sheet permission to <strong>"Anyone with the link can view"</strong>.</span>',
      '<a href="' + GOOGLE_SHEET_EDIT_URL + '" target="_blank" rel="noopener noreferrer" style="margin-left:auto; display:inline-flex; align-items:center; gap:4px; background:#d97706; color:#ffffff; padding:4px 10px; font-size:11.5px; font-weight:700; text-decoration:none; border-radius:3px;">',
      '<span class="material-icons-round" style="font-size:14px;">open_in_new</span> Open Sheet &amp; Share</a>'
    ].join(' ');
  }

  function showRestrictedModal() {
    var modal = document.getElementById('trio-ai-restricted-help-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'trio-ai-restricted-help-modal';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.backgroundColor = 'rgba(15, 23, 42, 0.75)';
      modal.style.backdropFilter = 'blur(4px)';
      modal.style.zIndex = '999999';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.padding = '20px';
      modal.style.boxSizing = 'border-box';

      modal.innerHTML = [
        '<div style="background:#ffffff; max-width:540px; width:100%; border-radius:8px; box-shadow:0 20px 40px rgba(0,0,0,0.3); border:1px solid #cbd5e1; overflow:hidden;">',
        '  <div style="background:#0f172a; color:#f8fafc; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #0d9488;">',
        '    <div style="display:flex; align-items:center; gap:8px;">',
        '      <span class="material-icons-round" style="color:#2dd4bf; font-size:20px;">lock_clock</span>',
        '      <strong style="font-size:14.5px;">Google Sheet Permission Required</strong>',
        '    </div>',
        '    <button id="btn-close-trio-help-modal" type="button" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer; line-height:1;">&times;</button>',
        '  </div>',
        '  <div style="padding:20px 24px; color:#1e293b; font-size:13.5px; line-height:1.6;">',
        '    <p style="margin-top:0; font-weight:600; color:#0f172a;">',
        '      Trio-AI Data Google Sheet-টি বর্তমানে Private / Restricted করা রয়েছে।',
        '    </p>',
        '    <p style="color:#475569; margin-bottom:14px;">',
        '      IndexedDB ও Live Sync সচল করার জন্য অনুগ্রহ করে নিচের ধাপগুলো অনুসরণ করুন:',
        '    </p>',
        '    <ol style="margin:0 0 18px 20px; padding:0; color:#334155;">',
        '      <li style="margin-bottom:6px;">নিচের <strong>"Open Google Sheet"</strong> বাটনে ক্লিক করে শিটটি খুলুন।</li>',
        '      <li style="margin-bottom:6px;">উপরের ডানদিকের <strong>Share</strong> (শেয়ার) বাটনে ক্লিক করুন।</li>',
        '      <li style="margin-bottom:6px;">General Access-এ <em>Restricted</em> পরিবর্তন করে <strong>"Anyone with the link"</strong> এবং Role <strong>"Viewer"</strong> নির্বাচন করুন।</li>',
        '      <li>তারপর এখানে ফিরে এসে <strong>"Sync Google Sheet"</strong> বাটনে ক্লিক করুন।</li>',
        '    </ol>',
        '    <div style="background:#f0fdfa; border:1px solid #99f6e4; padding:10px 14px; border-radius:4px; font-size:12.5px; color:#0f766e; margin-bottom:18px;">',
        '      <strong>টিপ:</strong> একবার অনুমতি দিলে ডাটা IndexedDB-তে ক্যাশ হয়ে যাবে এবং পরবর্তী প্রতিটি পেজ লোড তাৎক্ষণিক ০-সেকেন্ডে হবে।',
        '    </div>',
        '    <div style="display:flex; align-items:center; justify-content:flex-end; gap:10px; flex-wrap:wrap;">',
        '      <a href="' + GOOGLE_SHEET_EDIT_URL + '" target="_blank" rel="noopener noreferrer" style="background:#0d9488; color:#ffffff; padding:8px 16px; border-radius:4px; font-weight:700; font-size:13px; text-decoration:none; display:inline-flex; align-items:center; gap:6px;">',
        '        <span class="material-icons-round" style="font-size:16px;">open_in_new</span> Open Google Sheet',
        '      </a>',
        '      <button id="btn-trio-help-retry" type="button" style="background:#0f172a; color:#ffffff; padding:8px 16px; border-radius:4px; font-weight:700; font-size:13px; border:none; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">',
        '        <span class="material-icons-round" style="font-size:16px;">sync</span> Retry Sync',
        '      </button>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('\n');

      document.body.appendChild(modal);

      modal.addEventListener('click', function (e) {
        if (e.target === modal) hideRestrictedModal();
      });
      var closeBtn = document.getElementById('btn-close-trio-help-modal');
      if (closeBtn) closeBtn.addEventListener('click', hideRestrictedModal);
      var retryBtn = document.getElementById('btn-trio-help-retry');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          hideRestrictedModal();
          syncFromGoogleSheet(true);
        });
      }
    }
    modal.style.display = 'flex';
  }

  function hideRestrictedModal() {
    var modal = document.getElementById('trio-ai-restricted-help-modal');
    if (modal) modal.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // 5. Initial Engine Setup & Cache Restore
  // ---------------------------------------------------------------------------
  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Trio-AI Data from local IndexedDB cache...');
    updateSyncUI(true, 'Reading local IndexedDB cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = cached.headers;
          allRows = cached.rows;
          lastSyncTime = cached.lastSync;
          filteredRows = allRows.slice();
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          updateSyncUI(false);
          // Silently refresh in background
          setTimeout(function () { syncFromGoogleSheet(false); }, 600);
        } else {
          updateSyncUI(true, 'Building first-time cache from Google Sheet...');
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('Trio-AI cache read error:', err);
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 6. Header Row Rendering & Specific Column Widths
  // ---------------------------------------------------------------------------
  function getColumnWidth(hName) {
    var lower = String(hName || '').toLowerCase().trim();
    if (lower === 'buyer') return '170px';
    if (lower === 'itb') return '260px';
    if (lower.indexOf('date') !== -1 || lower.indexOf('etd') !== -1) return '115px';
    if (lower.indexOf('qty') !== -1) return '105px';
    if (lower.indexOf('indent no') !== -1) return '145px';
    if (lower === 'style') return '125px';
    if (lower === 'colour' || lower === 'color') return '115px';
    if (lower === 'pro code') return '115px';
    if (lower === 'prod name') return '250px';
    if (lower === 'supplier po') return '165px';
    if (lower === 'user') return '150px';
    if (lower === 'category') return '130px';
    if (lower === 'status') return '125px';
    return Math.max(120, Math.min(260, hName.length * 10 + 40)) + 'px';
  }

  function renderHeaderRow() {
    var thead = document.getElementById('trio-ai-data-sheet-thead');
    if (!thead) return;
    thead.innerHTML = '';
    var tr = document.createElement('tr');

    // 1. # Serial Column (Narrow compact width matching In-Line QC)
    var thIndex = document.createElement('th');
    thIndex.className = 'bai-sheet-th bai-sheet-th-index bai-th-row-num';
    thIndex.style.cssText = 'width:36px!important;min-width:36px!important;max-width:38px!important;text-align:center!important;white-space:nowrap!important;padding:8px 2px!important;background:#091729!important;color:#94a3b8!important;border-right:2px solid #334155!important;';
    thIndex.textContent = '#';
    tr.appendChild(thIndex);

    // 2. Data Columns
    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th bai-sheet-th-filterable';
      th.setAttribute('data-col-idx', colIdx);

      var width = getColumnWidth(hName);
      th.style.cssText = 'width:' + width + '!important;min-width:' + width + '!important;white-space:nowrap!important;padding:8px 10px!important;vertical-align:middle!important;';

      var isFiltered = (activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0);
      if (isFiltered) th.classList.add('has-active-filter');

      var thInner = document.createElement('div');
      thInner.className = 'bai-sheet-th-content';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-th-title';
      labelSpan.title = hName + ' (Click to sort)';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));

      // Click title to toggle sort
      labelSpan.addEventListener('click', function () {
        toggleColumnSort(colIdx);
      });

      var iconsWrap = document.createElement('div');
      iconsWrap.className = 'bai-sheet-th-icons';

      // Sort indicator icon
      var sortIcon = document.createElement('span');
      sortIcon.className = 'material-icons-round bai-sheet-sort-icon';
      sortIcon.title = 'Sort ' + hName;
      if (sortColumn === colIdx) {
        sortIcon.textContent = sortAsc ? 'arrow_upward' : 'arrow_downward';
        sortIcon.style.opacity = '1';
        sortIcon.style.color = '#38bdf8';
      } else {
        sortIcon.textContent = 'unfold_more';
        sortIcon.style.opacity = '0.45';
        sortIcon.style.color = '#94a3b8';
      }
      sortIcon.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleColumnSort(colIdx);
      });

      // Filter button
      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'bai-sheet-col-filter-btn' + (isFiltered ? ' is-active active' : '');
      filterBtn.title = 'Filter ' + hName;
      filterBtn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">' + (isFiltered ? 'filter_alt' : 'filter_list') + '</span>';
      filterBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openColumnFilterPopover(colIdx, filterBtn);
      });

      iconsWrap.appendChild(sortIcon);
      iconsWrap.appendChild(filterBtn);

      thInner.appendChild(labelSpan);
      thInner.appendChild(iconsWrap);
      th.appendChild(thInner);
      tr.appendChild(th);
    });

    thead.appendChild(tr);
  }

  // ---------------------------------------------------------------------------
  // 7. Filtering & Sorting Engine
  // ---------------------------------------------------------------------------
  function parseDateToTimestamp(str) {
    if (!str || typeof str !== 'string') return null;
    var dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
      return new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10)).getTime();
    }
    var ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymdMatch) {
      return new Date(parseInt(ymdMatch[1], 10), parseInt(ymdMatch[2], 10) - 1, parseInt(ymdMatch[3], 10)).getTime();
    }
    return null;
  }

  function toggleColumnSort(colIdx) {
    if (sortColumn === colIdx) {
      if (sortAsc) {
        sortAsc = false;
      } else {
        sortColumn = -1;
        sortAsc = true;
      }
    } else {
      sortColumn = colIdx;
      sortAsc = true;
    }
    applyAllFiltersAndSearch();
    renderHeaderRow();
    if (sortColumn >= 0) {
      showToast('Sorted by ' + allHeaders[colIdx] + ' (' + (sortAsc ? 'Ascending' : 'Descending') + ')', 'sort');
    } else {
      showToast('Sort reset to original order', 'check');
    }
  }

  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('trio-ai-data-sheet-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];
    var activeFilterColKeys = Object.keys(activeColumnFilters);

    filteredRows = allRows.filter(function (row) {
      // 1. Multi-Token Search
      if (searchTokens.length > 0) {
        var rowText = row.join(' ').toLowerCase();
        for (var t = 0; t < searchTokens.length; t++) {
          if (rowText.indexOf(searchTokens[t]) === -1) return false;
        }
      }

      // 2. Parallel Column Filters
      for (var f = 0; f < activeFilterColKeys.length; f++) {
        var colIdx = parseInt(activeFilterColKeys[f], 10);
        var allowedSet = activeColumnFilters[colIdx];
        if (allowedSet && allowedSet.size > 0) {
          var cellVal = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
          var lookupVal = (cellVal === '') ? '(Blank)' : cellVal;
          if (!allowedSet.has(cellVal) && !allowedSet.has(lookupVal)) return false;
        }
      }

      return true;
    });

    // 3. Sorting
    if (sortColumn >= 0 && sortColumn < allHeaders.length) {
      var col = sortColumn;
      var hLower = (allHeaders[col] || '').toLowerCase();
      var isColNumeric = (hLower.indexOf('qty') !== -1 || hLower.indexOf('amount') !== -1);

      filteredRows.sort(function (a, b) {
        var valA = String(a[col] !== undefined && a[col] !== null ? a[col] : '').trim();
        var valB = String(b[col] !== undefined && b[col] !== null ? b[col] : '').trim();

        if (isColNumeric) {
          var numA = parseFloat(valA.replace(/,/g, ''));
          var numB = parseFloat(valB.replace(/,/g, ''));
          var bothNum = !isNaN(numA) && !isNaN(numB);
          if (bothNum) {
            return sortAsc ? (numA - numB) : (numB - numA);
          }
        }

        var dateA = parseDateToTimestamp(valA);
        var dateB = parseDateToTimestamp(valB);
        if (dateA !== null && dateB !== null) {
          return sortAsc ? (dateA - dateB) : (dateB - dateA);
        }

        var cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        return sortAsc ? cmp : -cmp;
      });
    }

    currentPage = 1;
    renderTablePage();
    renderActiveFilterChips();
    updateHeaderFilterIcons();

    var searchClear = document.getElementById('trio-ai-data-sheet-search-clear');
    if (searchClear) searchClear.style.display = (searchInput && searchInput.value) ? 'block' : 'none';
  }

  function updateHeaderFilterIcons() {
    var thead = document.getElementById('trio-ai-data-sheet-thead');
    if (!thead) return;
    thead.querySelectorAll('th.bai-sheet-th-filterable').forEach(function (th) {
      var colIdx = parseInt(th.getAttribute('data-col-idx'), 10);
      var btn = th.querySelector('.bai-sheet-col-filter-btn');
      var isFiltered = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (isFiltered) {
        th.classList.add('has-active-filter');
        if (btn) {
          btn.classList.add('is-active', 'active');
          var icon = btn.querySelector('.material-icons-round');
          if (icon) icon.textContent = 'filter_alt';
        }
      } else {
        th.classList.remove('has-active-filter');
        if (btn) {
          btn.classList.remove('is-active', 'active');
          var icon = btn.querySelector('.material-icons-round');
          if (icon) icon.textContent = 'filter_list';
        }
      }

      var sortIcon = th.querySelector('.bai-sheet-sort-icon');
      if (sortIcon) {
        if (sortColumn === colIdx) {
          sortIcon.textContent = sortAsc ? 'arrow_upward' : 'arrow_downward';
          sortIcon.style.opacity = '1';
          sortIcon.style.color = '#38bdf8';
        } else {
          sortIcon.textContent = 'unfold_more';
          sortIcon.style.opacity = '0.45';
          sortIcon.style.color = '#94a3b8';
        }
      }
    });
  }

  function renderActiveFilterChips() {
    var bar = document.getElementById('trio-ai-data-sheet-active-filters-bar');
    var container = document.getElementById('trio-ai-data-sheet-active-filters-chips');
    if (!bar || !container) return;

    var activeKeys = Object.keys(activeColumnFilters);
    if (activeKeys.length === 0) {
      bar.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    container.innerHTML = '';

    activeKeys.forEach(function (k) {
      var colIdx = parseInt(k, 10);
      var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
      var allowedSet = activeColumnFilters[colIdx];
      var totalVals = getUniqueValuesForColumn(colIdx).keys.length;

      var chip = document.createElement('div');
      chip.className = 'floor-qc-filter-chip';

      var textSpan = document.createElement('span');
      textSpan.className = 'floor-qc-filter-chip-text';
      textSpan.textContent = colName + ' (' + allowedSet.size + '/' + totalVals + ')';
      textSpan.title = colName + ': ' + Array.from(allowedSet).slice(0, 5).join(', ') + (allowedSet.size > 5 ? '...' : '');

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'floor-qc-filter-chip-remove';
      removeBtn.innerHTML = '&#x2715;';
      removeBtn.title = 'Remove filter for ' + colName;
      removeBtn.addEventListener('click', function () {
        delete activeColumnFilters[colIdx];
        applyAllFiltersAndSearch();
        renderHeaderRow();
        showToast('Filter removed on ' + colName, 'check');
      });

      chip.appendChild(textSpan);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Column Filter Popover
  // ---------------------------------------------------------------------------
  function getUniqueValuesForColumn(colIdx) {
    var map = {};
    for (var i = 0; i < allRows.length; i++) {
      var val = (allRows[i][colIdx] !== undefined && allRows[i][colIdx] !== null) ? String(allRows[i][colIdx]).trim() : '';
      var key = (val === '') ? '(Blank)' : val;
      map[key] = (map[key] || 0) + 1;
    }
    var keys = Object.keys(map);
    keys.sort(function (a, b) {
      if (a === '(Blank)') return 1;
      if (b === '(Blank)') return -1;
      var numA = parseFloat(a), numB = parseFloat(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    return { keys: keys, counts: map };
  }

  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));

    var popover = document.getElementById('trio-ai-data-sheet-filter-popover');
    var titleEl = document.getElementById('trio-ai-data-sheet-filter-pop-title');
    var searchInput = document.getElementById('trio-ai-data-sheet-filter-search-input');
    var searchClear = document.getElementById('trio-ai-data-sheet-filter-search-clear');

    if (titleEl) titleEl.textContent = 'Filter: ' + colName;
    if (searchInput) {
      searchInput.value = '';
      currentFilterSearchQuery = '';
    }
    if (searchClear) searchClear.style.display = 'none';

    var uv = getUniqueValuesForColumn(colIdx);
    currentFilterUniqueValues = uv.keys;
    currentFilterValueCounts = uv.counts;

    if (activeColumnFilters[colIdx]) {
      currentFilterSelectedSet = new Set(activeColumnFilters[colIdx]);
    } else {
      currentFilterSelectedSet = new Set(currentFilterUniqueValues);
    }

    renderFilterList();

    if (!popover) return;
    popover.style.display = 'block';

    var rect = anchorBtn.getBoundingClientRect();
    var popWidth = 320;
    var left = rect.left + window.scrollX;
    var top = rect.bottom + window.scrollY + 6;
    if (left + popWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - popWidth - 16);
    }

    var maxTop = window.innerHeight - 440;
    if (top > maxTop) {
      top = Math.max(16, rect.top - 410);
    }

    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    setTimeout(function () {
      if (searchInput) searchInput.focus();
    }, 50);
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('trio-ai-data-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('trio-ai-data-sheet-filter-list');
    var countEl = document.getElementById('trio-ai-data-sheet-filter-items-count');
    if (!listEl) return;

    listEl.innerHTML = '';
    var q = currentFilterSearchQuery.toLowerCase().trim();

    var visibleValues = currentFilterUniqueValues.filter(function (val) {
      if (!q) return true;
      return val.toLowerCase().indexOf(q) !== -1;
    });

    if (countEl) {
      countEl.textContent = visibleValues.length + ' / ' + currentFilterUniqueValues.length + ' items';
    }

    if (visibleValues.length === 0) {
      listEl.innerHTML = '<div class="bai-sheet-filter-empty">No matching values</div>';
      return;
    }

    var frag = document.createDocumentFragment();

    visibleValues.forEach(function (val) {
      var item = document.createElement('div');
      item.className = 'bai-sheet-filter-item';

      var leftDiv = document.createElement('div');
      leftDiv.className = 'bai-sheet-filter-item-left';

      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = currentFilterSelectedSet.has(val);
      chk.style.cursor = 'pointer';

      var isBlank = (val === '(Blank)');
      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-filter-item-text';
      labelSpan.textContent = val;
      if (isBlank) {
        labelSpan.style.fontStyle = 'italic';
        labelSpan.style.color = '#94a3b8';
      }

      leftDiv.appendChild(chk);
      leftDiv.appendChild(labelSpan);

      var countSpan = document.createElement('span');
      countSpan.className = 'bai-sheet-filter-item-count';
      countSpan.textContent = (currentFilterValueCounts[val] || 0).toLocaleString();

      item.addEventListener('click', function (e) {
        if (e.target !== chk) {
          chk.checked = !chk.checked;
        }
        if (chk.checked) {
          currentFilterSelectedSet.add(val);
        } else {
          currentFilterSelectedSet.delete(val);
        }
      });

      item.appendChild(leftDiv);
      item.appendChild(countSpan);
      frag.appendChild(item);
    });

    listEl.appendChild(frag);
  }

  // ---------------------------------------------------------------------------
  // 9. Table Page Rendering
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('trio-ai-data-sheet-tbody');
    if (!tbody) return;
    var numCols = allHeaders.length || defaultHeaders.length;
    tbody.innerHTML = '<tr><td colspan="' + (numCols + 1) + '" class="bai-sheet-table-empty">' + (msg || 'No matching records found') + '</td></tr>';
  }

  function highlightMatches(text, query) {
    if (!query || !text) return text;
    var tokens = query.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return text;

    var escapedTokens = tokens.map(function (t) {
      return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    var regex = new RegExp('(' + escapedTokens.join('|') + ')', 'gi');
    return text.replace(regex, '<mark style="background:#fef08a;color:#713f12;padding:0 2px;border-radius:2px;">$1</mark>');
  }

  function renderTablePage() {
    var tbody = document.getElementById('trio-ai-data-sheet-tbody');
    var countLabel = document.getElementById('trio-ai-data-sheet-count-label');
    var rangeLabel = document.getElementById('trio-ai-data-sheet-showing-range');
    var pageNumInput = document.getElementById('trio-ai-data-sheet-page-num');
    var totalPagesEl = document.getElementById('trio-ai-data-sheet-total-pages');

    if (!tbody) return;

    var total = filteredRows.length;
    var totalAll = allRows.length;

    if (total === 0) {
      renderEmptyState(totalAll === 0 ? 'No records loaded. Click "Sync Google Sheet" to download latest data.' : 'No records match the current filters and search.');
      if (countLabel) countLabel.textContent = '0 of ' + totalAll.toLocaleString() + ' records';
      if (rangeLabel) rangeLabel.textContent = 'Showing 0 - 0 of 0';
      if (pageNumInput) pageNumInput.value = 1;
      if (totalPagesEl) totalPagesEl.textContent = '1';
      updatePaginationButtons(1, 1);
      clearCellSelection();
      return;
    }

    var totalPages = pageSize === 'all' ? 1 : Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = pageSize === 'all' ? 0 : (currentPage - 1) * pageSize;
    var endIdx = pageSize === 'all' ? total : Math.min(startIdx + pageSize, total);
    var pageRows = filteredRows.slice(startIdx, endIdx);

    if (countLabel) {
      countLabel.textContent = total.toLocaleString() + (total !== totalAll ? ' (filtered from ' + totalAll.toLocaleString() + ')' : '') + ' records';
    }
    if (rangeLabel) {
      rangeLabel.textContent = 'Showing ' + (startIdx + 1).toLocaleString() + ' \u2013 ' + endIdx.toLocaleString() + ' of ' + total.toLocaleString();
    }
    if (pageNumInput) {
      pageNumInput.value = currentPage;
      pageNumInput.max = totalPages;
    }
    if (totalPagesEl) {
      totalPagesEl.textContent = totalPages;
    }

    updatePaginationButtons(currentPage, totalPages);

    var searchInput = document.getElementById('trio-ai-data-sheet-search-input');
    var searchQuery = searchInput ? searchInput.value.trim() : '';

    var fragment = document.createDocumentFragment();

    pageRows.forEach(function (row, localRowIdx) {
      var globalRowIndex = startIdx + localRowIdx + 1;
      var tr = document.createElement('tr');
      tr.className = (localRowIdx % 2 === 0) ? 'bai-row-even' : 'bai-row-odd';
      tr.setAttribute('data-r', localRowIdx);

      // Serial Index Cell (Narrow compact width)
      var tdIndex = document.createElement('td');
      tdIndex.className = 'bai-sheet-td-index bai-td-row-num';
      tdIndex.textContent = globalRowIndex;
      tdIndex.style.cssText = 'width:36px!important;min-width:36px!important;max-width:38px!important;text-align:center!important;padding:6px 2px!important;font-weight:700!important;color:#64748b!important;background:#f8fafc!important;border-right:2px solid #cbd5e1!important;';
      tr.appendChild(tdIndex);

      allHeaders.forEach(function (hName, colIdx) {
        var td = document.createElement('td');
        td.className = 'bai-td-data';
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);

        // Highlight selected cell
        if (activeCellCoords && activeCellCoords.r === localRowIdx && activeCellCoords.c === colIdx) {
          td.classList.add('bai-cell-selected');
        }

        var val = row[colIdx];
        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';
        var lowerH = String(hName || '').toLowerCase();

        // 1. Link / Attachment Detection
        if (strVal && /^https?:\/\//i.test(strVal)) {
          var isDrive = strVal.indexOf('drive.google.com') !== -1;
          var link = document.createElement('a');
          link.href = strVal;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.style.display = 'inline-flex';
          link.style.alignItems = 'center';
          link.style.gap = '4px';
          link.style.padding = '3px 8px';
          link.style.borderRadius = '4px';
          link.style.fontSize = '12px';
          link.style.fontWeight = '600';
          link.style.textDecoration = 'none';
          link.style.background = isDrive ? '#f0fdfa' : '#f1f5f9';
          link.style.color = isDrive ? '#0f766e' : '#2563eb';
          link.style.border = isDrive ? '1px solid #99f6e4' : '1px solid #cbd5e1';
          link.innerHTML = '<span class="material-icons-round" style="font-size:14px;">' + (isDrive ? 'attach_file' : 'open_in_new') + '</span><span>' + (isDrive ? 'Drive File' : 'Open Link') + '</span>';
          td.appendChild(link);
          td.style.textAlign = 'center';
        }
        // 2. Numeric Formatting
        else if (strVal && lowerH.indexOf('qty') !== -1 && !isNaN(Number(strVal.replace(/,/g, '')))) {
          td.className = 'bai-td-data bai-sheet-td-num';
          td.style.fontWeight = '700';
          td.style.color = '#0d9488';
          td.style.textAlign = 'right';
          td.style.fontVariantNumeric = 'tabular-nums';
          var cleanNum = Number(strVal.replace(/,/g, ''));
          td.innerHTML = highlightMatches(cleanNum.toLocaleString(), searchQuery);
        }
        // 3. PO / Style / Code
        else if (lowerH.indexOf('style') !== -1 || lowerH.indexOf('indent no') !== -1 || lowerH.indexOf('pro code') !== -1 || lowerH.indexOf('supplier po') !== -1) {
          td.style.fontFamily = 'monospace';
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
          td.style.letterSpacing = '0.3px';
          td.innerHTML = highlightMatches(strVal || '—', searchQuery);
        }
        // 4. Date / Timestamp / ETD
        else if (lowerH.indexOf('date') !== -1 || lowerH.indexOf('etd') !== -1) {
          td.style.fontWeight = '600';
          td.style.color = '#0284c7';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.innerHTML = highlightMatches(strVal || '—', searchQuery);
        }
        // 5. Status Pill
        else if (lowerH === 'status' && strVal) {
          var sLower = strVal.toLowerCase();
          var bg = '#f1f5f9', fg = '#475569', bd = '#cbd5e1';
          if (sLower.indexOf('pass') !== -1 || sLower.indexOf('done') !== -1 || sLower.indexOf('complete') !== -1 || sLower.indexOf('ok') !== -1 || sLower.indexOf('active') !== -1 || sLower.indexOf('in-stock') !== -1 || sLower.indexOf('received') !== -1) {
            bg = '#f0fdf4'; fg = '#15803d'; bd = '#bbf7d0';
          } else if (sLower.indexOf('fail') !== -1 || sLower.indexOf('reject') !== -1 || sLower.indexOf('error') !== -1 || sLower.indexOf('delay') !== -1) {
            bg = '#fef2f2'; fg = '#b91c1c'; bd = '#fecaca';
          } else if (sLower.indexOf('pending') !== -1 || sLower.indexOf('hold') !== -1 || sLower.indexOf('progress') !== -1 || sLower.indexOf('transit') !== -1) {
            bg = '#fffbeb'; fg = '#b45309'; bd = '#fde68a';
          }
          var span = document.createElement('span');
          span.style.display = 'inline-block';
          span.style.padding = '2px 8px';
          span.style.borderRadius = '999px';
          span.style.fontSize = '11px';
          span.style.fontWeight = '700';
          span.style.background = bg;
          span.style.color = fg;
          span.style.border = '1px solid ' + bd;
          span.innerHTML = highlightMatches(strVal, searchQuery);
          td.appendChild(span);
        }
        // 6. Generic Text
        else {
          td.innerHTML = highlightMatches(strVal || '—', searchQuery);
        }

        // Cell Selection on Mouse Down
        td.addEventListener('mousedown', function () {
          selectCellByCoords(localRowIdx, colIdx);
        });

        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function updatePaginationButtons(current, total) {
    var firstBtn = document.getElementById('trio-ai-data-sheet-first-page');
    var prevBtn = document.getElementById('trio-ai-data-sheet-prev-page');
    var nextBtn = document.getElementById('trio-ai-data-sheet-next-page');
    var lastBtn = document.getElementById('trio-ai-data-sheet-last-page');

    if (firstBtn) firstBtn.disabled = current <= 1;
    if (prevBtn) prevBtn.disabled = current <= 1;
    if (nextBtn) nextBtn.disabled = current >= total;
    if (lastBtn) lastBtn.disabled = current >= total;
  }

  // ---------------------------------------------------------------------------
  // 10. Interactive Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('trio-ai-data-sheet-tbody');
    if (!tbody) return;

    var prevSelected = tbody.querySelector('.bai-cell-selected');
    if (prevSelected) prevSelected.classList.remove('bai-cell-selected');

    var targetCell = tbody.querySelector('td.bai-td-data[data-r="' + r + '"][data-c="' + c + '"]');
    if (targetCell) {
      targetCell.classList.add('bai-cell-selected');
      activeCellCoords = { r: r, c: c };
      targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      updateActiveCellBadge(r, c);
    }
  }

  function clearCellSelection() {
    var tbody = document.getElementById('trio-ai-data-sheet-tbody');
    if (tbody) {
      var prevSelected = tbody.querySelector('.bai-cell-selected');
      if (prevSelected) prevSelected.classList.remove('bai-cell-selected');
    }
    activeCellCoords = null;
    var badge = document.getElementById('trio-ai-data-sheet-active-cell-badge');
    if (badge) {
      badge.style.display = 'none';
      badge.textContent = '';
    }
  }

  function updateActiveCellBadge(r, c) {
    var badge = document.getElementById('trio-ai-data-sheet-active-cell-badge');
    if (!badge) return;

    var startIdx = pageSize === 'all' ? 0 : (currentPage - 1) * pageSize;
    var globalRow = startIdx + r + 1;
    var colName = allHeaders[c] || ('Col ' + (c + 1));

    badge.style.display = 'inline-block';
    badge.textContent = 'Row ' + globalRow + ' \u203A ' + colName;
  }

  function copySelectedCellToClipboard() {
    var tbody = document.getElementById('trio-ai-data-sheet-tbody');
    if (!tbody) return false;

    var selectedCell = tbody.querySelector('.bai-cell-selected');
    if (!selectedCell) return false;

    var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
    var anchor = selectedCell.querySelector('a');
    if (anchor && anchor.href) {
      text = anchor.href;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
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
      }).catch(function () {
        fallbackClipboardCopy(text);
      });
      return true;
    } else {
      fallbackClipboardCopy(text);
      return true;
    }
  }

  function fallbackClipboardCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard', 'copy');
    } catch (e) {
      showToast('Copy failed', 'error');
    }
    document.body.removeChild(ta);
  }

  // ---------------------------------------------------------------------------
  // 11. Excel (.xlsx) Export Engine
  // ---------------------------------------------------------------------------
  function exportToExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS library not loaded. Cannot export.', 'error');
      return;
    }

    var exportData = [];
    exportData.push(allHeaders);

    var rowsToExport = filteredRows.length > 0 ? filteredRows : allRows;
    for (var i = 0; i < rowsToExport.length; i++) {
      exportData.push(rowsToExport[i]);
    }

    var ws = XLSX.utils.aoa_to_sheet(exportData);
    var colWidths = [];
    for (var c = 0; c < allHeaders.length; c++) {
      var maxL = (allHeaders[c] || '').length;
      colWidths.push({ wch: Math.max(maxL + 4, 15) });
    }
    ws['!cols'] = colWidths;

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report Data');

    var dateStr = new Date().toISOString().slice(0, 10);
    var filename = 'Trio_AI_Report_Data_' + dateStr + '.xlsx';
    XLSX.writeFile(wb, filename);

    showToast('Exported ' + rowsToExport.length.toLocaleString() + ' records to ' + filename, 'check');
  }

  // ---------------------------------------------------------------------------
  // 12. Toast & Sync UI Notification
  // ---------------------------------------------------------------------------
  function showToast(msg, type) {
    var existing = document.getElementById('trio-ai-data-sheet-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'trio-ai-data-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + (type || 'info');
    var iconSvg = SVG_ICONS[type] || SVG_ICONS.info || SVG_ICONS.check;
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + msg + '</span>';
    document.body.appendChild(toast);

    setTimeout(function () { toast.classList.add('show'); }, 20);
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3800);
  }

  function updateSyncUI(loading, msg) {
    var syncBtn = document.getElementById('btn-refresh-trio-data');
    var syncIcon = document.getElementById('trio-ai-data-sheet-sync-icon');
    var banner = document.getElementById('trio-ai-data-sheet-sync-banner');
    var bannerMsg = document.getElementById('trio-ai-data-sheet-sync-msg');

    if (syncBtn) syncBtn.disabled = loading;
    if (syncIcon) {
      if (loading) {
        syncIcon.classList.add('bai-sheet-spin');
      } else {
        syncIcon.classList.remove('bai-sheet-spin');
      }
    }
    if (banner && bannerMsg) {
      if (loading) {
        banner.style.display = 'flex';
        banner.style.background = '#f0fdfa';
        banner.style.borderColor = '#99f6e4';
        banner.style.color = '#0f766e';
        bannerMsg.textContent = msg || 'Syncing data from Google Sheet...';
      } else {
        banner.style.display = 'none';
      }
    }
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('trio-ai-data-sheet-db-badge');
    var syncText = document.getElementById('trio-ai-data-sheet-last-sync-text');

    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px; color:#2dd4bf;">bolt</span> Database Ready (' + allRows.length.toLocaleString() + ' records)';
    }

    if (syncText) {
      if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        var dateStr = d.toLocaleDateString();
        syncText.textContent = 'Synced: ' + dateStr + ' ' + timeStr;
      } else {
        syncText.textContent = 'Not synced yet';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 13. View Show / Hide Management
  // ---------------------------------------------------------------------------
  function showView() {
    var trioView = document.getElementById('reports-trio-ai-data-view');
    var reportsKpiView = document.getElementById('reports-kpi-view');
    if (reportsKpiView) reportsKpiView.style.display = 'none';
    if (trioView) trioView.style.display = '';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) filteredRows = allRows.slice();
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var s = document.getElementById('trio-ai-data-sheet-search-input');
      if (s) s.focus();
    }, 100);
  }

  function hideView() {
    var trioView = document.getElementById('reports-trio-ai-data-view');
    var reportsKpiView = document.getElementById('reports-kpi-view');
    if (trioView) trioView.style.display = 'none';
    if (reportsKpiView) reportsKpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  // ---------------------------------------------------------------------------
  // 14. Event Binding & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // 1. KPI Card click in Reports
    var kpiCard = document.getElementById('kpi-trio-ai-data');
    if (kpiCard) {
      kpiCard.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showView();
      }, true);
      kpiCard.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopImmediatePropagation();
          showView();
        }
      }, true);
    }

    // 2. Back button
    var backBtn = document.getElementById('btn-back-trio-reports');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      }, true);
    }

    // 3. Sync button
    var syncBtn = document.getElementById('btn-refresh-trio-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        syncFromGoogleSheet(true);
      }, true);
    }

    // 4. Export button
    var exportBtn = document.getElementById('btn-download-trio-data-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportToExcel();
      }, true);
    }

    // 5. Search input
    var searchInput = document.getElementById('trio-ai-data-sheet-search-input');
    var searchClear = document.getElementById('trio-ai-data-sheet-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        applyAllFiltersAndSearch();
      });
    }

    // 6. Page size selector
    var pageSizeSelect = document.getElementById('trio-ai-data-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = this.value === 'all' ? 'all' : (parseInt(this.value, 10) || 100);
        currentPage = 1;
        renderTablePage();
      });
    }

    // 7. Pagination buttons
    var firstBtn = document.getElementById('trio-ai-data-sheet-first-page');
    var prevBtn = document.getElementById('trio-ai-data-sheet-prev-page');
    var nextBtn = document.getElementById('trio-ai-data-sheet-next-page');
    var lastBtn = document.getElementById('trio-ai-data-sheet-last-page');
    var pageNumInput = document.getElementById('trio-ai-data-sheet-page-num');

    if (firstBtn) firstBtn.addEventListener('click', function () { currentPage = 1; renderTablePage(); });
    if (prevBtn) prevBtn.addEventListener('click', function () { if (currentPage > 1) { currentPage--; renderTablePage(); } });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      var tp = pageSize === 'all' ? 1 : Math.ceil(filteredRows.length / pageSize) || 1;
      if (currentPage < tp) { currentPage++; renderTablePage(); }
    });
    if (lastBtn) lastBtn.addEventListener('click', function () {
      var tp = pageSize === 'all' ? 1 : Math.ceil(filteredRows.length / pageSize) || 1;
      if (currentPage < tp) { currentPage = tp; renderTablePage(); }
    });

    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var tp = pageSize === 'all' ? 1 : Math.ceil(filteredRows.length / pageSize) || 1;
        if (!isNaN(val)) {
          if (val < 1) val = 1;
          if (val > tp) val = tp;
          currentPage = val;
          renderTablePage();
        }
      });
      pageNumInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') this.blur();
      });
    }

    // 8. Clear all filters
    var clearAllFiltersBtn = document.getElementById('trio-ai-data-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        renderHeaderRow();
        showToast('All column filters cleared', 'check');
      });
    }

    // 9. Popover Controls
    var popCloseBtn = document.getElementById('trio-ai-data-sheet-filter-pop-close');
    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);

    var popSearchInput = document.getElementById('trio-ai-data-sheet-filter-search-input');
    var popSearchClear = document.getElementById('trio-ai-data-sheet-filter-search-clear');
    if (popSearchInput) {
      popSearchInput.addEventListener('input', function () {
        currentFilterSearchQuery = this.value;
        if (popSearchClear) popSearchClear.style.display = this.value ? 'block' : 'none';
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

    var popSelectAllBtn = document.getElementById('trio-ai-data-sheet-filter-select-all');
    if (popSelectAllBtn) {
      popSelectAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        currentFilterUniqueValues.forEach(function (v) {
          if (!q || v.toLowerCase().indexOf(q) !== -1) {
            currentFilterSelectedSet.add(v);
          }
        });
        renderFilterList();
      });
    }

    var popClearAllBtn = document.getElementById('trio-ai-data-sheet-filter-clear-all');
    if (popClearAllBtn) {
      popClearAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        if (!q) {
          currentFilterSelectedSet.clear();
        } else {
          currentFilterUniqueValues.forEach(function (v) {
            if (v.toLowerCase().indexOf(q) !== -1) {
              currentFilterSelectedSet.delete(v);
            }
          });
        }
        renderFilterList();
      });
    }

    var sortAscBtn = document.getElementById('trio-ai-data-sheet-sort-asc');
    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        sortColumn = currentFilterColIdx;
        sortAsc = true;
        applyAllFiltersAndSearch();
        renderHeaderRow();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[sortColumn] + ' (A to Z)', 'sort');
      });
    }

    var sortDescBtn = document.getElementById('trio-ai-data-sheet-sort-desc');
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        sortColumn = currentFilterColIdx;
        sortAsc = false;
        applyAllFiltersAndSearch();
        renderHeaderRow();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[sortColumn] + ' (Z to A)', 'sort');
      });
    }

    var popResetBtn = document.getElementById('trio-ai-data-sheet-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        delete activeColumnFilters[currentFilterColIdx];
        applyAllFiltersAndSearch();
        renderHeaderRow();
        closeColumnFilterPopover();
        showToast('Filter cleared on ' + allHeaders[currentFilterColIdx], 'check');
      });
    }

    var popCancelBtn = document.getElementById('trio-ai-data-sheet-filter-cancel-btn');
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);

    var popOkBtn = document.getElementById('trio-ai-data-sheet-filter-ok-btn');
    if (popOkBtn) {
      popOkBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        if (currentFilterSelectedSet.size === currentFilterUniqueValues.length) {
          delete activeColumnFilters[currentFilterColIdx];
        } else {
          activeColumnFilters[currentFilterColIdx] = new Set(currentFilterSelectedSet);
        }
        applyAllFiltersAndSearch();
        renderHeaderRow();
        closeColumnFilterPopover();
        showToast('Filter applied on ' + allHeaders[currentFilterColIdx], 'check');
      });
    }

    // Close popover when clicking outside
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('trio-ai-data-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Clear cell selection when clicking outside table
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('trio-ai-data-sheet-table');
      if (table && !table.contains(e.target)) clearCellSelection();
    });

    // Keyboard navigation & Shortcuts
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('reports-trio-ai-data-view');
      if (!view || view.style.display === 'none') return;

      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'Escape') {
        var popover = document.getElementById('trio-ai-data-sheet-filter-popover');
        if (popover && popover.style.display !== 'none') {
          closeColumnFilterPopover();
        } else if (activeCellCoords) {
          clearCellSelection();
        }
        return;
      }

      // Copy (Ctrl+C / Cmd+C)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (activeCellCoords) {
          var didCopy = copySelectedCellToClipboard();
          if (didCopy) e.preventDefault();
        }
        return;
      }

      // Arrow Key Navigation
      if (activeCellCoords) {
        var r = activeCellCoords.r;
        var c = activeCellCoords.c;
        var tbody = document.getElementById('trio-ai-data-sheet-tbody');
        var rowsInPage = tbody ? tbody.querySelectorAll('tr').length : 0;
        if (rowsInPage === 0) return;

        var numCols = allHeaders.length;

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectCellByCoords(Math.max(0, r - 1), c);
        } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault();
          selectCellByCoords(Math.min(rowsInPage - 1, r + 1), c);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          selectCellByCoords(r, Math.max(0, c - 1));
        } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
          e.preventDefault();
          selectCellByCoords(r, Math.min(numCols - 1, c + 1));
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 15. Bootstrap
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = cached.headers;
        allRows = cached.rows;
        lastSyncTime = cached.lastSync;
        filteredRows = allRows.slice();
        renderHeaderRow();
        updateHeaderBadge();
      }
    }).catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Global Engine Export
  window.TrioAiDataSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportToExcel,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
