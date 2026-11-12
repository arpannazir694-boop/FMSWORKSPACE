/**
 * =============================================================================
 * Forma Data Summary Live Engine (IndexedDB + Fast Google Sheets CSV Stream)
 * Sheet: FORMA FORM DATA | Spreadsheet ID: 1OhtWmEx1ntqzAv6hMn7Xw5bMBdeKl6SpcaklgTJY4G4
 * 11 Standard Columns:
 *   [0] Timestamp, [1] Submitted By, [2] Buyer Name, [3] Sample Maker Name,
 *   [4] Style Number, [5] Forma Quantity (pcs), [6] PO Number, [7] PO Date,
 *   [8] Supplier Name, [9] ETA, [10] Forma Attachment
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV Stream Fetch & in-memory parsing from Google Sheet
 *   - Client-side Search across all columns
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Column sorting A-Z and Z-A
 *   - Direct In-Cell Image Thumbnail Grid (72px x 52px, max 3 per row with wrap)
 *   - In-App High-Resolution Lightbox Image Preview with Google Drive link
 *   - Interactive Cell Selection & Arrow Key Navigation (Up/Down/Left/Right/Tab/Enter)
 *   - Cell Copy (Ctrl+C / Cmd+C) with flash animation & clean SVG toast feedback
 *   - Client-Side Excel Export (.xlsx) via SheetJS
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1OhtWmEx1ntqzAv6hMn7Xw5bMBdeKl6SpcaklgTJY4G4';
  var CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=FORMA%20FORM%20DATA';

  var DB_NAME = 'FMS_Forma_Data_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'forma_data_store';

  var defaultHeaders = [
    'Timestamp',
    'Submitted By',
    'Buyer Name',
    'Sample Maker Name',
    'Style Number',
    'Forma Quantity (pcs)',
    'PO Number',
    'PO Date',
    'Supplier Name',
    'ETA',
    'Forma Attachment'
  ];
  var NUM_COLS = defaultHeaders.length; // 11

  // Application State
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
  var activeColumnFilters = {}; // colIdx -> Set of allowed values
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Cell Selection State
  var activeCellCoords = null; // { r: number, c: number }

  // Clean SVG Icons
  var SVG_ICONS = {
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    sync: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
  };

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Persistence Layer
  // ---------------------------------------------------------------------------
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (dbInstance) return resolve(dbInstance);
      if (!window.indexedDB) return reject(new Error('IndexedDB not supported'));

      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function (e) {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };
      req.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  function saveToCache(headers, rows, syncTimestamp) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        store.put(headers, 'headers');
        store.put(rows, 'rows');
        store.put(syncTimestamp || Date.now(), 'last_sync');
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function loadFromCache() {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var reqH = store.get('headers');
        var reqR = store.get('rows');
        var reqS = store.get('last_sync');
        tx.oncomplete = function () {
          if (reqR.result && Array.isArray(reqR.result) && reqR.result.length > 0) {
            resolve({ headers: reqH.result || defaultHeaders, rows: reqR.result, lastSync: reqS.result || null });
          } else {
            resolve(null);
          }
        };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 2. High-Performance RFC-4180 CSV Stream Parser
  // ---------------------------------------------------------------------------
  function parseCSV(text) {
    var p = '', row = [''], ret = [row], i = 0, r = 0, s = true, l = text.length;
    for (i = 0; i < l; i++) {
      var cc = text[i], nc = text[i + 1];
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
    return ret.filter(function (rw, idx) {
      if (idx === ret.length - 1 && rw.length === 1 && rw[0] === '') return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Fast Google Sheet CSV Fetch & Sync
  // ---------------------------------------------------------------------------
  function fetchGoogleSheetCSV() {
    var ts = Date.now();
    return fetch(CSV_URL + '&_=' + ts, { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.trim().length === 0) throw new Error('Empty CSV payload');
        var parsed = parseCSV(csvText);
        if (!parsed || parsed.length === 0) throw new Error('Could not parse CSV');

        // Header row
        var rawHeaders = parsed[0].slice(0, NUM_COLS);
        while (rawHeaders.length < NUM_COLS) {
          rawHeaders.push(defaultHeaders[rawHeaders.length] || ('Col ' + (rawHeaders.length + 1)));
        }
        var headers = rawHeaders.map(function (h, idx) {
          return String(h || '').trim() || defaultHeaders[idx];
        });

        // Data rows
        var rows = [];
        for (var i = 1; i < parsed.length; i++) {
          var r = parsed[i];
          var hasContent = r.some(function (cell) {
            return cell !== undefined && cell !== null && String(cell).trim() !== '';
          });
          if (hasContent) {
            var normRow = new Array(NUM_COLS);
            for (var c = 0; c < NUM_COLS; c++) {
              normRow[c] = (r[c] !== undefined && r[c] !== null) ? String(r[c]).trim() : '';
            }
            rows.push(normRow);
          }
        }
        return { headers: headers, rows: rows };
      });
  }

  function syncFromGoogleSheet(isManualClick) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, 'Connecting to Google Sheets FORMA FORM DATA CSV stream...');

    fetchGoogleSheetCSV()
      .then(function (result) {
        allHeaders = result.headers;
        allRows = result.rows;
        lastSyncTime = Date.now();
        return saveToCache(allHeaders, allRows, lastSyncTime);
      })
      .then(function () {
        applyAllFiltersAndSearch();
        updateHeaderBadge();
        updateSyncUI(false);
        if (isManualClick) {
          showToast('Synced ' + allRows.length.toLocaleString() + ' Forma tracker records', 'check');
        }
      })
      .catch(function (err) {
        console.error('Forma data sync error:', err);
        updateSyncUI(false);
        if (isManualClick) {
          showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
        }
      })
      .finally(function () {
        isSyncing = false;
      });
  }

  // ---------------------------------------------------------------------------
  // 4. Initial Engine Setup & Cache Restore
  // ---------------------------------------------------------------------------
  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Forma Data from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = (cached.headers && cached.headers.length === NUM_COLS) ? cached.headers : defaultHeaders.slice();
          allRows = cached.rows;
          lastSyncTime = cached.lastSync;
          filteredRows = allRows.slice();
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          updateSyncUI(false);
          // Refresh silently in background
          setTimeout(function () { syncFromGoogleSheet(false); }, 600);
        } else {
          updateSyncUI(true, 'Building first-time cache from Google Sheet...');
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('Forma cache read error:', err);
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 5. Table Header Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('forma-data-sheet-thead');
    if (!thead) return;
    thead.innerHTML = '';
    var tr = document.createElement('tr');

    // Serial # Column Header
    var thIndex = document.createElement('th');
    thIndex.className = 'bai-sheet-th-index';
    thIndex.textContent = '#';
    thIndex.style.width = '55px';
    thIndex.style.minWidth = '55px';
    thIndex.style.maxWidth = '55px';
    thIndex.style.textAlign = 'center';
    thIndex.style.background = '#091729';
    thIndex.style.color = '#94a3b8';
    thIndex.style.borderRight = '2px solid #334155';
    tr.appendChild(thIndex);

    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th-filterable';
      th.setAttribute('data-col-idx', colIdx);

      // Explicit column widths
      if (colIdx === 0) { // Timestamp
        th.style.width = '145px';
        th.style.minWidth = '145px';
      } else if (colIdx === 1) { // Submitted By
        th.style.width = '130px';
        th.style.minWidth = '130px';
      } else if (colIdx === 2) { // Buyer Name
        th.style.width = '135px';
        th.style.minWidth = '135px';
      } else if (colIdx === 3) { // Sample Maker Name
        th.style.width = '140px';
        th.style.minWidth = '140px';
      } else if (colIdx === 4) { // Style Number
        th.style.width = '130px';
        th.style.minWidth = '130px';
      } else if (colIdx === 5) { // Forma Quantity (pcs)
        th.style.width = '130px';
        th.style.minWidth = '130px';
      } else if (colIdx === 6) { // PO Number
        th.style.width = '125px';
        th.style.minWidth = '125px';
      } else if (colIdx === 7) { // PO Date
        th.style.width = '120px';
        th.style.minWidth = '120px';
      } else if (colIdx === 8) { // Supplier Name
        th.style.width = '140px';
        th.style.minWidth = '140px';
      } else if (colIdx === 9) { // ETA
        th.style.width = '120px';
        th.style.minWidth = '120px';
      } else if (colIdx === 10) { // Forma Attachment
        th.style.width = '250px';
        th.style.minWidth = '250px';
        th.style.textAlign = 'center';
      }

      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) th.classList.add('has-active-filter');

      var inner = document.createElement('div');
      inner.className = 'bai-sheet-th-content';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-th-title';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));
      labelSpan.title = hName;

      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'bai-sheet-col-filter-btn' + (hasFilter ? ' is-active' : '');
      filterBtn.title = 'Filter ' + hName;
      filterBtn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">' + (hasFilter ? 'filter_alt' : 'filter_list') + '</span>';

      filterBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openColumnFilterPopover(colIdx, filterBtn);
      });

      inner.appendChild(labelSpan);
      inner.appendChild(filterBtn);
      th.appendChild(inner);
      tr.appendChild(th);
    });

    thead.appendChild(tr);
  }

  // ---------------------------------------------------------------------------
  // 6. Filtering & Searching Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('forma-data-sheet-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];
    var activeFilterColKeys = Object.keys(activeColumnFilters);

    filteredRows = allRows.filter(function (row) {
      // 1. Global Multi-Token Search across all columns
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
          if (!allowedSet.has(cellVal)) return false;
        }
      }

      return true;
    });

    currentPage = 1;
    renderTablePage();
    renderActiveFilterChips();
    updateHeaderFilterIcons();

    var searchClear = document.getElementById('forma-data-sheet-search-clear');
    if (searchClear) {
      searchClear.style.display = (searchInput && searchInput.value) ? 'block' : 'none';
    }
  }

  function updateHeaderFilterIcons() {
    var thead = document.getElementById('forma-data-sheet-thead');
    if (!thead) return;
    var ths = thead.querySelectorAll('th.bai-sheet-th-filterable');
    ths.forEach(function (th) {
      var cIdx = parseInt(th.getAttribute('data-col-idx'), 10);
      var hasFilter = activeColumnFilters[cIdx] && activeColumnFilters[cIdx].size > 0;
      var btn = th.querySelector('.bai-sheet-col-filter-btn');
      if (hasFilter) {
        th.classList.add('has-active-filter');
        if (btn) {
          btn.classList.add('is-active');
          btn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">filter_alt</span>';
        }
      } else {
        th.classList.remove('has-active-filter');
        if (btn) {
          btn.classList.remove('is-active');
          btn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">filter_list</span>';
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Google Sheets Style Filter Popover
  // ---------------------------------------------------------------------------
  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    var colName = allHeaders[colIdx] || ('Column ' + (colIdx + 1));
    var popover = document.getElementById('forma-data-sheet-filter-popover');
    var titleEl = document.getElementById('forma-data-sheet-filter-pop-title');
    var searchInput = document.getElementById('forma-data-sheet-filter-search-input');
    var searchClear = document.getElementById('forma-data-sheet-filter-search-clear');

    if (titleEl) titleEl.textContent = 'Filter: ' + colName;
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.style.display = 'none';
    currentFilterSearchQuery = '';

    // Calculate unique values and frequencies from allRows
    var valCounts = {};
    for (var i = 0; i < allRows.length; i++) {
      var row = allRows[i];
      var raw = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
      var displayVal = raw === '' ? '(Blanks)' : raw;
      valCounts[displayVal] = (valCounts[displayVal] || 0) + 1;
    }
    currentFilterValueCounts = valCounts;
    currentFilterUniqueValues = Object.keys(valCounts).sort(function (a, b) {
      if (a === '(Blanks)') return 1;
      if (b === '(Blanks)') return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Populate currentFilterSelectedSet
    currentFilterSelectedSet = new Set();
    if (activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0) {
      var actSet = activeColumnFilters[colIdx];
      currentFilterUniqueValues.forEach(function (v) {
        var rawKey = v === '(Blanks)' ? '' : v;
        if (actSet.has(rawKey)) currentFilterSelectedSet.add(v);
      });
    } else {
      currentFilterUniqueValues.forEach(function (v) { currentFilterSelectedSet.add(v); });
    }

    renderColumnFilterValuesList();

    // Position popover relative to anchorBtn
    popover.style.display = 'flex';
    var rect = anchorBtn.getBoundingClientRect();
    var popW = 280;
    var popH = 390;
    var left = rect.left + window.scrollX;
    var top = rect.bottom + window.scrollY + 6;

    if (left + popW > window.innerWidth - 16) {
      left = window.innerWidth - popW - 20;
    }
    if (left < 16) left = 16;
    if (top + popH > window.innerHeight && rect.top > popH) {
      top = rect.top + window.scrollY - popH - 6;
    }

    popover.style.top = top + 'px';
    popover.style.left = left + 'px';

    setTimeout(function () {
      if (searchInput) searchInput.focus();
    }, 50);
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('forma-data-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderColumnFilterValuesList() {
    var listEl = document.getElementById('forma-data-sheet-filter-list');
    var countEl = document.getElementById('forma-data-sheet-filter-items-count');
    if (!listEl) return;
    listEl.innerHTML = '';

    var query = currentFilterSearchQuery.toLowerCase();
    var visibleVals = currentFilterUniqueValues.filter(function (v) {
      if (!query) return true;
      return v.toLowerCase().indexOf(query) !== -1;
    });

    if (countEl) countEl.textContent = visibleVals.length + ' item' + (visibleVals.length === 1 ? '' : 's');

    if (visibleVals.length === 0) {
      var emptyDiv = document.createElement('div');
      emptyDiv.className = 'bai-sheet-filter-empty';
      emptyDiv.textContent = 'No values match "' + currentFilterSearchQuery + '"';
      listEl.appendChild(emptyDiv);
      return;
    }

    var frag = document.createDocumentFragment();
    visibleVals.forEach(function (val) {
      var itemDiv = document.createElement('div');
      itemDiv.className = 'bai-sheet-filter-item';

      var leftDiv = document.createElement('div');
      leftDiv.className = 'bai-sheet-filter-item-left';

      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = currentFilterSelectedSet.has(val);
      chk.style.cursor = 'pointer';
      chk.addEventListener('change', function () {
        if (chk.checked) currentFilterSelectedSet.add(val);
        else currentFilterSelectedSet.delete(val);
      });

      var isBlank = (val === '');
      var spanVal = document.createElement('span');
      spanVal.className = 'bai-sheet-filter-item-text';
      spanVal.textContent = isBlank ? '(Blanks)' : val;
      if (isBlank) {
        spanVal.style.fontStyle = 'italic';
        spanVal.style.color = '#94a3b8';
      }

      leftDiv.appendChild(chk);
      leftDiv.appendChild(spanVal);

      var spanCount = document.createElement('span');
      spanCount.className = 'bai-sheet-filter-item-count';
      spanCount.textContent = currentFilterValueCounts[val] || 0;

      itemDiv.addEventListener('click', function (e) {
        if (e.target !== chk) {
          chk.checked = !chk.checked;
          if (chk.checked) currentFilterSelectedSet.add(val);
          else currentFilterSelectedSet.delete(val);
        }
      });

      itemDiv.appendChild(leftDiv);
      itemDiv.appendChild(spanCount);
      frag.appendChild(itemDiv);
    });
    listEl.appendChild(frag);
  }

  function applyCurrentColumnFilter() {
    if (currentFilterColIdx === null) return;
    var allCount = currentFilterUniqueValues.length;
    var selCount = currentFilterSelectedSet.size;

    if (selCount === allCount || selCount === 0) {
      delete activeColumnFilters[currentFilterColIdx];
    } else {
      var rawSet = new Set();
      currentFilterSelectedSet.forEach(function (v) {
        rawSet.add(v === '(Blanks)' ? '' : v);
      });
      activeColumnFilters[currentFilterColIdx] = rawSet;
    }

    closeColumnFilterPopover();
    applyAllFiltersAndSearch();
  }

  function resetCurrentColumnFilter() {
    if (currentFilterColIdx === null) return;
    delete activeColumnFilters[currentFilterColIdx];
    closeColumnFilterPopover();
    applyAllFiltersAndSearch();
  }

  function sortCurrentColumn(direction) {
    if (currentFilterColIdx === null) return;
    var col = currentFilterColIdx;
    allRows.sort(function (a, b) {
      var valA = (a[col] !== undefined && a[col] !== null) ? String(a[col]).trim() : '';
      var valB = (b[col] !== undefined && b[col] !== null) ? String(b[col]).trim() : '';
      var cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      return direction === 'asc' ? cmp : -cmp;
    });
    closeColumnFilterPopover();
    applyAllFiltersAndSearch();
  }

  // ---------------------------------------------------------------------------
  // 7b. Attachment Image Lightbox Modal
  // ---------------------------------------------------------------------------
  function ensureLightboxStyles() {
    if (document.getElementById('forma-lightbox-injected-style')) return;
    var style = document.createElement('style');
    style.id = 'forma-lightbox-injected-style';
    style.textContent = [
      '@keyframes formaFadeIn { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes formaZoomIn { from { transform: scale(0.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }',
      '#forma-attachment-lightbox-modal { animation: formaFadeIn 0.18s ease-out; }',
      '#forma-attachment-lightbox-modal #forma-lightbox-card { animation: formaZoomIn 0.22s cubic-bezier(0.16, 1, 0.3, 1); }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function openLightbox(imageUrl, driveUrl, title) {
    ensureLightboxStyles();
    var modal = document.getElementById('forma-attachment-lightbox-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'forma-attachment-lightbox-modal';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.backgroundColor = 'rgba(15, 23, 42, 0.85)';
      modal.style.backdropFilter = 'blur(5px)';
      modal.style.webkitBackdropFilter = 'blur(5px)';
      modal.style.zIndex = '999999';
      modal.style.display = 'flex';
      modal.style.flexDirection = 'column';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.padding = '20px';
      modal.style.boxSizing = 'border-box';

      modal.innerHTML = [
        '<div id="forma-lightbox-card" style="background:#ffffff; border-radius:12px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.6); max-width:92vw; max-height:92vh; display:flex; flex-direction:column; overflow:hidden; border:1px solid #334155;">',
        '  <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 18px; background:#0f172a; color:#f8fafc; border-bottom:1px solid #1e293b;">',
        '    <div style="display:flex; align-items:center; gap:8px;">',
        '      <span class="material-icons-round" style="color:#38bdf8; font-size:20px;">image</span>',
        '      <span id="forma-lightbox-title" style="font-weight:700; font-size:13.5px; letter-spacing:0.3px;">Forma Attachment Preview</span>',
        '    </div>',
        '    <button id="forma-lightbox-close-btn" type="button" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:24px; line-height:1; padding:2px 6px; display:flex; align-items:center; justify-content:center; border-radius:4px;" title="Close (Esc)">&times;</button>',
        '  </div>',
        '  <div style="flex:1; display:flex; align-items:center; justify-content:center; padding:16px; background:#020617; overflow:auto; min-height:220px;">',
        '    <img id="forma-lightbox-img" src="" alt="Forma Attachment Preview" referrerpolicy="no-referrer" style="max-width:100%; max-height:72vh; object-fit:contain; border-radius:6px; box-shadow:0 10px 25px rgba(0,0,0,0.5);" />',
        '  </div>',
        '  <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 18px; background:#f8fafc; border-top:1px solid #e2e8f0; gap:12px; flex-wrap:wrap;">',
        '    <span id="forma-lightbox-info" style="font-size:12px; color:#64748b; font-weight:500;">Forma Attachment Photo</span>',
        '    <div style="display:flex; align-items:center; gap:10px;">',
        '      <a id="forma-lightbox-drive-btn" href="#" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:6px; background:#0284c7; color:#ffffff; padding:7px 14px; border-radius:6px; font-size:12px; font-weight:600; text-decoration:none;">',
        '        <span class="material-icons-round" style="font-size:16px;">open_in_new</span> Open in Google Drive',
        '      </a>',
        '      <button id="forma-lightbox-btn-done" type="button" style="background:#e2e8f0; border:none; color:#334155; padding:7px 14px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">Close</button>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('\n');

      document.body.appendChild(modal);

      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeLightbox();
      });
      document.getElementById('forma-lightbox-close-btn').addEventListener('click', closeLightbox);
      document.getElementById('forma-lightbox-btn-done').addEventListener('click', closeLightbox);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeLightbox();
      });
    }

    var imgEl = document.getElementById('forma-lightbox-img');
    var titleEl = document.getElementById('forma-lightbox-title');
    var driveBtn = document.getElementById('forma-lightbox-drive-btn');

    if (imgEl) {
      imgEl.src = imageUrl;
    }
    if (titleEl) titleEl.textContent = title || 'Forma Attachment Preview';
    if (driveBtn) driveBtn.href = driveUrl || '#';

    modal.style.display = 'flex';
  }

  function closeLightbox() {
    var modal = document.getElementById('forma-attachment-lightbox-modal');
    if (modal) modal.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // 8. Pagination & Table Page Rendering
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('forma-data-sheet-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="' + (NUM_COLS + 1) + '" class="bai-sheet-table-empty">' + (msg || 'No matching records found') + '</td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('forma-data-sheet-tbody');
    var countLabel = document.getElementById('forma-data-sheet-count-label');
    var rangeLabel = document.getElementById('forma-data-sheet-showing-range');
    var pageNumInput = document.getElementById('forma-data-sheet-page-num');
    var totalPagesEl = document.getElementById('forma-data-sheet-total-pages');

    if (!tbody) return;

    var total = filteredRows.length;
    var totalAll = allRows.length;

    if (total === 0) {
      renderEmptyState(totalAll === 0 ? 'Loading records from Google Sheet...' : 'No records match the current filters and search.');
      if (countLabel) countLabel.textContent = '0 of ' + totalAll.toLocaleString() + ' records';
      if (rangeLabel) rangeLabel.textContent = 'Showing 0 - 0 of 0';
      if (pageNumInput) pageNumInput.value = 1;
      if (totalPagesEl) totalPagesEl.textContent = '1';
      updatePaginationButtons(1, 1);
      clearCellSelection();
      return;
    }

    var totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = (currentPage - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, total);
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

    var fragment = document.createDocumentFragment();

    pageRows.forEach(function (row, localRowIdx) {
      var globalRowIndex = startIdx + localRowIdx + 1;
      var tr = document.createElement('tr');
      tr.setAttribute('data-r', localRowIdx);

      // Serial Index Cell
      var tdIndex = document.createElement('td');
      tdIndex.className = 'bai-sheet-td-index';
      tdIndex.textContent = globalRowIndex;
      tdIndex.style.textAlign = 'center';
      tdIndex.style.fontWeight = '700';
      tdIndex.style.color = '#64748b';
      tdIndex.style.background = '#f8fafc';
      tdIndex.style.borderRight = '2px solid #cbd5e1';
      tr.appendChild(tdIndex);

      row.forEach(function (val, colIdx) {
        var td = document.createElement('td');
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);

        // Highlight selected cell
        if (activeCellCoords && activeCellCoords.r === localRowIdx && activeCellCoords.c === colIdx) {
          td.classList.add('bai-cell-selected');
        }

        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';

        if (colIdx === 0) { // Timestamp
          td.style.fontWeight = '600';
          td.style.color = '#0369a1';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal || '—';
        } else if (colIdx === 1) { // Submitted By
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal || '—';
        } else if (colIdx === 2) { // Buyer Name
          td.style.fontWeight = '700';
          td.style.color = '#1e293b';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal || '—';
        } else if (colIdx === 3) { // Sample Maker Name
          td.style.fontWeight = '600';
          td.style.color = '#334155';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal || '—';
        } else if (colIdx === 4) { // Style Number
          td.style.fontWeight = '600';
          td.style.color = '#334155';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal || '—';
        } else if (colIdx === 5) { // Forma Quantity (pcs)
          td.className = 'bai-sheet-td-num';
          td.style.fontWeight = '700';
          td.style.color = '#c2410c';
          td.style.textAlign = 'right';
          td.style.whiteSpace = 'nowrap';
          td.style.background = 'rgba(255, 247, 237, 0.6)';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal ? (isNaN(Number(strVal)) ? strVal : Number(strVal).toLocaleString()) : '—';
        } else if (colIdx === 6) { // PO Number
          td.style.fontFamily = 'monospace';
          td.style.fontWeight = '700';
          td.style.color = '#1e293b';
          td.style.letterSpacing = '0.3px';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal || '—';
        } else if (colIdx === 7) { // PO Date
          td.style.color = '#475569';
          td.style.fontWeight = '600';
          td.style.textAlign = 'center';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal || '—';
        } else if (colIdx === 8) { // Supplier Name
          td.style.fontWeight = '600';
          td.style.color = '#334155';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal || '—';
        } else if (colIdx === 9) { // ETA
          td.style.color = '#475569';
          td.style.fontWeight = '600';
          td.style.textAlign = 'center';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal || '—';
        } else if (colIdx === 10) { // Forma Attachment - Direct Image Thumbnail Preview Grid
          td.className = 'bai-sheet-td-attachment tracker-attachment-cell';
          td.style.minWidth = '250px';
          td.style.width = '250px';
          td.style.textAlign = 'center';
          td.style.padding = '6px 8px';
          td.style.verticalAlign = 'middle';

          if (strVal && strVal.toLowerCase().indexOf('http') !== -1) {
            var previews = document.createElement('div');
            previews.className = 'dice-attachment-grid';

            var urls = strVal.split(/\r?\n|,/).map(function (u) { return u.trim(); }).filter(Boolean);
            var buyerName = String(row[2] || '');
            var styleNum = String(row[4] || '');
            var poNum = String(row[6] || '');
            var previewTitle = 'Buyer: ' + (buyerName || '-') + ' • Style: ' + (styleNum || '-') + ' • PO: ' + (poNum || '-');

            urls.forEach(function (url, linkIndex) {
              if (!/^https?:\/\//i.test(url)) return;
              var fileIdMatch = url.match(/\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&#]+)/);
              var fileId = fileIdMatch ? fileIdMatch[1] : '';

              var link = document.createElement('a');
              link.href = url;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              link.className = 'dice-thumb-link';
              link.title = 'Click to enlarge / preview image';

              var thumbSrc = fileId
                ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w240'
                : url;
              var fullSrc = fileId
                ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1200'
                : url;

              // Open in-app Lightbox Preview on click
              link.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                openLightbox(fullSrc, url, previewTitle);
              });

              var img = document.createElement('img');
              img.alt = 'Forma Attachment ' + (linkIndex + 1);
              img.className = 'dice-thumb-img';
              img.loading = 'lazy';
              img.referrerPolicy = 'no-referrer';
              img.src = thumbSrc;

              img.onerror = function () {
                // Secondary CDN fallback for Google Drive images
                if (!this.dataset.triedLh3 && fileId) {
                  this.dataset.triedLh3 = '1';
                  this.src = 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(fileId) + '=s240';
                  return;
                }
                // Fallback icon button if image fails or is non-image file (e.g. PDF)
                this.style.display = 'none';
                link.className = 'dice-thumb-fallback';
                link.innerHTML = '<span class="material-icons-round" style="font-size:18px;color:#0284c7;">insert_drive_file</span><span style="font-size:9.5px;font-weight:700;line-height:1;margin-top:2px;color:#0369a1;">File</span>';
                link.onclick = null;
              };

              link.appendChild(img);
              previews.appendChild(link);
            });

            if (previews.children.length > 0) {
              td.appendChild(previews);
            } else {
              td.textContent = '—';
              td.style.color = '#94a3b8';
            }
          } else {
            td.textContent = '—';
            td.style.color = '#94a3b8';
          }
        } else {
          td.textContent = strVal || '—';
        }

        // Click to select
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
    var firstBtn = document.getElementById('forma-data-sheet-first-page');
    var prevBtn = document.getElementById('forma-data-sheet-prev-page');
    var nextBtn = document.getElementById('forma-data-sheet-next-page');
    var lastBtn = document.getElementById('forma-data-sheet-last-page');

    if (firstBtn) firstBtn.disabled = current <= 1;
    if (prevBtn) prevBtn.disabled = current <= 1;
    if (nextBtn) nextBtn.disabled = current >= total;
    if (lastBtn) lastBtn.disabled = current >= total;
  }

  // ---------------------------------------------------------------------------
  // 9. Active Filter Chips Bar
  // ---------------------------------------------------------------------------
  function renderActiveFilterChips() {
    var bar = document.getElementById('forma-data-sheet-active-filters-bar');
    var chipsContainer = document.getElementById('forma-data-sheet-active-filters-chips');
    if (!bar || !chipsContainer) return;

    var filterKeys = Object.keys(activeColumnFilters);
    if (filterKeys.length === 0) {
      bar.style.display = 'none';
      chipsContainer.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    chipsContainer.innerHTML = '';

    filterKeys.forEach(function (colKey) {
      var colIdx = parseInt(colKey, 10);
      var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
      var count = activeColumnFilters[colIdx].size;

      var chip = document.createElement('div');
      chip.className = 'floor-qc-filter-chip';
      chip.innerHTML = '<span class="floor-qc-filter-chip-name">' + colName + ':</span>' +
        '<span class="floor-qc-filter-chip-val">' + count + ' selected</span>' +
        '<button type="button" class="floor-qc-filter-chip-remove" title="Remove filter">&#x2715;</button>';

      chip.querySelector('.floor-qc-filter-chip-remove').addEventListener('click', function (e) {
        e.stopPropagation();
        delete activeColumnFilters[colIdx];
        applyAllFiltersAndSearch();
      });

      chipsContainer.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Interactive Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    clearCellSelection();
    activeCellCoords = { r: r, c: c };

    var tbody = document.getElementById('forma-data-sheet-tbody');
    if (!tbody) return;

    var targetTd = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (targetTd) {
      targetTd.classList.add('bai-cell-selected');
      updateActiveCellBadge(r, c);
      scrollCellIntoView(targetTd);
    }
  }

  function clearCellSelection() {
    activeCellCoords = null;
    var tbody = document.getElementById('forma-data-sheet-tbody');
    if (tbody) {
      var sel = tbody.querySelectorAll('.bai-cell-selected');
      sel.forEach(function (el) { el.classList.remove('bai-cell-selected'); });
    }
    var badge = document.getElementById('forma-data-sheet-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  function scrollCellIntoView(cellEl) {
    var wrapper = document.getElementById('forma-data-sheet-table-wrapper');
    if (!wrapper || !cellEl) return;
    var wrapperRect = wrapper.getBoundingClientRect();
    var cellRect = cellEl.getBoundingClientRect();

    if (cellRect.left < wrapperRect.left) {
      wrapper.scrollLeft -= (wrapperRect.left - cellRect.left + 20);
    } else if (cellRect.right > wrapperRect.right) {
      wrapper.scrollLeft += (cellRect.right - wrapperRect.right + 20);
    }
    if (cellRect.top < wrapperRect.top) {
      wrapper.scrollTop -= (wrapperRect.top - cellRect.top + 20);
    } else if (cellRect.bottom > wrapperRect.bottom) {
      wrapper.scrollTop += (cellRect.bottom - wrapperRect.bottom + 20);
    }
  }

  function updateActiveCellBadge(r, c) {
    var badge = document.getElementById('forma-data-sheet-active-cell-badge');
    if (!badge) return;

    var startIdx = (currentPage - 1) * pageSize;
    var globalRow = startIdx + r + 1;
    var colName = allHeaders[c] || ('Col ' + (c + 1));

    badge.style.display = 'inline-block';
    badge.textContent = 'Row ' + globalRow + ' \u203A ' + colName;
  }

  function copySelectedCellToClipboard() {
    var tbody = document.getElementById('forma-data-sheet-tbody');
    if (!tbody) return false;

    var selectedCell = tbody.querySelector('.bai-cell-selected');
    if (!selectedCell) return false;

    var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
    // If it was a link button, copy the href
    var anchor = selectedCell.querySelector('a');
    if (anchor && anchor.href) {
      text = anchor.href;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        triggerCellCopyAnimation(selectedCell);
        showToast('Copied: "' + (text.length > 36 ? text.substring(0, 36) + '...' : text) + '"', 'copy');
      }).catch(function () {
        fallbackCopyText(text, selectedCell);
      });
      return true;
    } else {
      fallbackCopyText(text, selectedCell);
      return true;
    }
  }

  function fallbackCopyText(text, cellEl) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      triggerCellCopyAnimation(cellEl);
      showToast('Copied to clipboard', 'copy');
    } catch (e) {
      showToast('Copy failed: ' + e.message, 'error');
    }
  }

  function triggerCellCopyAnimation(cellEl) {
    if (!cellEl) return;
    cellEl.classList.remove('bai-cell-copied');
    void cellEl.offsetWidth; // trigger reflow
    cellEl.classList.add('bai-cell-copied');
    setTimeout(function () {
      cellEl.classList.remove('bai-cell-copied');
    }, 450);
  }

  // ---------------------------------------------------------------------------
  // 11. Toast & Sync UI Notification
  // ---------------------------------------------------------------------------
  function showToast(msg, type) {
    var existing = document.getElementById('forma-data-sheet-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'forma-data-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + (type || 'info');
    var iconSvg = SVG_ICONS[type] || SVG_ICONS.info || SVG_ICONS.check;
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + msg + '</span>';
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('is-visible');
    }, 10);

    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () { if (toast.parentNode) toast.remove(); }, 250);
    }, 2800);
  }

  function updateSyncUI(isSyncingNow, message) {
    var banner = document.getElementById('forma-data-sheet-sync-banner');
    var bannerMsg = document.getElementById('forma-data-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('forma-data-sheet-sync-icon');

    if (banner) {
      banner.style.display = isSyncingNow ? 'flex' : 'none';
      if (bannerMsg && message) bannerMsg.textContent = message;
    }
    if (syncBtnIcon) {
      if (isSyncingNow) syncBtnIcon.classList.add('bai-sheet-spin');
      else syncBtnIcon.classList.remove('bai-sheet-spin');
    }
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('forma-data-sheet-db-badge');
    var syncText = document.getElementById('forma-data-sheet-last-sync-text');

    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px; color:#38bdf8;">bolt</span> ' + (allRows.length ? allRows.length.toLocaleString() + ' Rows Cached (Database)' : 'Database Ready');
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

  // ---------------------------------------------------------------------------
  // 12. Show & Hide View Management
  // ---------------------------------------------------------------------------
  function showView() {
    var formaView = document.getElementById('reports-forma-summary-view');
    var reportsKpiView = document.getElementById('reports-kpi-view');
    if (reportsKpiView) reportsKpiView.style.display = 'none';
    if (formaView) formaView.style.display = '';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) filteredRows = allRows.slice();
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var s = document.getElementById('forma-data-sheet-search-input');
      if (s) s.focus();
    }, 100);
  }

  function hideView() {
    var formaView = document.getElementById('reports-forma-summary-view');
    var reportsKpiView = document.getElementById('reports-kpi-view');
    if (formaView) formaView.style.display = 'none';
    if (reportsKpiView) reportsKpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  // ---------------------------------------------------------------------------
  // 13. Event Listeners & Binding
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // 1. KPI Card click in Reports
    var kpiCard = document.getElementById('kpi-forma-summary');
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
    var backBtn = document.getElementById('btn-back-forma-reports');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      });
    }

    // 3. Sync button
    var syncBtn = document.getElementById('btn-refresh-forma-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        syncFromGoogleSheet(true);
      });
    }

    // 4. Export button
    var exportBtn = document.getElementById('btn-download-forma-data-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        exportToExcel();
      });
    }

    // 5. Search Box & Clear
    var searchInput = document.getElementById('forma-data-sheet-search-input');
    var searchClear = document.getElementById('forma-data-sheet-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          applyAllFiltersAndSearch();
        }, 150);
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

    // 6. Page Size Selector
    var pageSizeSel = document.getElementById('forma-data-sheet-page-size');
    if (pageSizeSel) {
      pageSizeSel.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // 7. Clear All Filters Button
    var clearAllBtn = document.getElementById('forma-data-sheet-clear-all-filters-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
      });
    }

    // 8. Pagination Controls
    var firstBtn = document.getElementById('forma-data-sheet-first-page');
    var prevBtn = document.getElementById('forma-data-sheet-prev-page');
    var nextBtn = document.getElementById('forma-data-sheet-next-page');
    var lastBtn = document.getElementById('forma-data-sheet-last-page');
    var pageNumInput = document.getElementById('forma-data-sheet-page-num');

    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) { currentPage = 1; renderTablePage(); }
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) { currentPage--; renderTablePage(); }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) { currentPage++; renderTablePage(); }
      });
    }
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) { currentPage = totalPages; renderTablePage(); }
      });
    }
    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (isNaN(val) || val < 1) val = 1;
        if (val > totalPages) val = totalPages;
        currentPage = val;
        renderTablePage();
      });
    }

    // 9. Column Filter Popover Actions
    var popClose = document.getElementById('forma-data-sheet-filter-pop-close');
    var popCancel = document.getElementById('forma-data-sheet-filter-cancel-btn');
    var popReset = document.getElementById('forma-data-sheet-filter-reset-btn');
    var popOk = document.getElementById('forma-data-sheet-filter-ok-btn');
    var popSortAsc = document.getElementById('forma-data-sheet-sort-asc');
    var popSortDesc = document.getElementById('forma-data-sheet-sort-desc');
    var popSelAll = document.getElementById('forma-data-sheet-filter-select-all');
    var popClrAll = document.getElementById('forma-data-sheet-filter-clear-all');
    var popSearch = document.getElementById('forma-data-sheet-filter-search-input');
    var popSearchClr = document.getElementById('forma-data-sheet-filter-search-clear');

    if (popClose) popClose.addEventListener('click', closeColumnFilterPopover);
    if (popCancel) popCancel.addEventListener('click', closeColumnFilterPopover);
    if (popReset) popReset.addEventListener('click', resetCurrentColumnFilter);
    if (popOk) popOk.addEventListener('click', applyCurrentColumnFilter);

    if (popSortAsc) popSortAsc.addEventListener('click', function () { sortCurrentColumn('asc'); });
    if (popSortDesc) popSortDesc.addEventListener('click', function () { sortCurrentColumn('desc'); });

    if (popSelAll) {
      popSelAll.addEventListener('click', function () {
        currentFilterUniqueValues.forEach(function (v) { currentFilterSelectedSet.add(v); });
        renderColumnFilterValuesList();
      });
    }
    if (popClrAll) {
      popClrAll.addEventListener('click', function () {
        currentFilterSelectedSet.clear();
        renderColumnFilterValuesList();
      });
    }
    if (popSearch) {
      popSearch.addEventListener('input', function () {
        currentFilterSearchQuery = this.value;
        if (popSearchClr) popSearchClr.style.display = this.value ? 'block' : 'none';
        renderColumnFilterValuesList();
      });
    }
    if (popSearchClr) {
      popSearchClr.addEventListener('click', function () {
        if (popSearch) {
          popSearch.value = '';
          popSearch.focus();
        }
        currentFilterSearchQuery = '';
        popSearchClr.style.display = 'none';
        renderColumnFilterValuesList();
      });
    }

    // Dismiss popover when clicking outside
    document.addEventListener('click', function (e) {
      var pop = document.getElementById('forma-data-sheet-filter-popover');
      if (pop && pop.style.display !== 'none') {
        if (!pop.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Keyboard Shortcuts (Arrow Keys, Tab, Enter, Ctrl+C, Esc)
    document.addEventListener('keydown', function (e) {
      var formaView = document.getElementById('reports-forma-summary-view');
      if (!formaView || formaView.style.display === 'none') return;

      var tag = (e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '');
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'Escape') {
        var popover = document.getElementById('forma-data-sheet-filter-popover');
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
        var tbody = document.getElementById('forma-data-sheet-tbody');
        var rowsInPage = tbody ? tbody.querySelectorAll('tr').length : 0;
        if (rowsInPage === 0) return;

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
          selectCellByCoords(r, Math.min(NUM_COLS - 1, c + 1));
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 14. Excel Export (.xlsx via SheetJS)
  // ---------------------------------------------------------------------------
  function exportToExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS library not loaded for Excel export', 'error');
      return;
    }

    var dataToExport = filteredRows.length > 0 ? filteredRows : allRows;
    if (dataToExport.length === 0) {
      showToast('No records available to export', 'info');
      return;
    }

    try {
      showToast('Generating Forma Data Summary Excel spreadsheet...', 'info');

      var wsData = [];
      // Row 1: Headers
      var headers = allHeaders.slice();
      wsData.push(headers);

      // Rows
      for (var i = 0; i < dataToExport.length; i++) {
        var r = dataToExport[i];
        var rowVals = [];
        for (var c = 0; c < headers.length; c++) {
          var v = (r[c] !== undefined && r[c] !== null) ? r[c] : '';
          // Forma Quantity as Number
          if (c === 5 && v !== '' && !isNaN(Number(v))) {
            rowVals.push(Number(v));
          } else {
            rowVals.push(v);
          }
        }
        wsData.push(rowVals);
      }

      var ws = XLSX.utils.aoa_to_sheet(wsData);

      // Set column widths
      ws['!cols'] = [
        { wch: 20 }, // Timestamp
        { wch: 18 }, // Submitted By
        { wch: 20 }, // Buyer Name
        { wch: 22 }, // Sample Maker Name
        { wch: 18 }, // Style Number
        { wch: 22 }, // Forma Quantity (pcs)
        { wch: 16 }, // PO Number
        { wch: 15 }, // PO Date
        { wch: 22 }, // Supplier Name
        { wch: 15 }, // ETA
        { wch: 35 }  // Forma Attachment
      ];

      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Forma Data Summary');

      var dateStr = new Date().toISOString().split('T')[0];
      var fileName = 'Forma_Data_Summary_' + dateStr + '.xlsx';

      XLSX.writeFile(wb, fileName);
      showToast('Exported ' + dataToExport.length.toLocaleString() + ' records to ' + fileName, 'check');
    } catch (err) {
      console.error('Excel Export Error:', err);
      showToast('Export failed: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 15. Bootstrap
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = (cached.headers && cached.headers.length === NUM_COLS) ? cached.headers : defaultHeaders.slice();
        allRows = cached.rows;
        lastSyncTime = cached.lastSync;
        filteredRows = allRows.slice();
        updateHeaderBadge();
      }
    }).catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Global Controller Export
  window.FormaDataSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportToExcel,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
