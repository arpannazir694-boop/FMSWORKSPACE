/**
 * =============================================================================
 * Dice Data Summary Live Engine (IndexedDB + Fast Google Sheets CSV)
 * =============================================================================
 * Mirrors the architecture of Submitted FMS Data (submitted_fms_sheet.js)
 * Sheet: DICE FORM DATA | Spreadsheet ID: 1OhtWmEx1ntqzAv6hMn7Xw5bMBdeKl6SpcaklgTJY4G4
 * 9 Columns: Timestamp, Submitted By, PO Number, Style Number, Dice Quantity,
 *            Dice Attachment, Received Date, Handover Date, Receiving Person
 * Database: IndexedDB 'FMS_Dice_Data_DB_v1'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV Stream Fetch & in-memory parsing from Google Sheet
 *   - Client-side Search across all columns
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis)
 *   - Clickable Google Drive Attachment buttons for Dice Attachments
 *   - Excel (.xlsx) Export via SheetJS with auto-width
 *   - Pagination (25, 50, 100, 250, 500 rows per page)
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1OhtWmEx1ntqzAv6hMn7Xw5bMBdeKl6SpcaklgTJY4G4';
  var SHEET_NAME = 'DICE FORM DATA';
  var CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(SHEET_NAME);

  var DB_NAME = 'FMS_Dice_Data_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'dice_data_store';
  var NUM_COLS = 9;

  var defaultHeaders = [
    'Timestamp',
    'Submitted By',
    'PO Number',
    'Style Number',
    'Dice Quantity',
    'Dice Attachment',
    'Received Date',
    'Handover Date',
    'Receiving Person'
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

  // Column Filters State
  var activeColumnFilters = {}; // colIdx -> Set of allowed string values
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Cell Selection State
  var activeCellCoords = null; // { r: localRowIndex, c: colIndex }

  // SVG Icons
  var SVG_ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    sort: '<svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 12h12m-9 6h6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Cache Engine
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
        reject(e.target.error || new Error('Failed to open IndexedDB ' + DB_NAME));
      };
    });
  }

  function saveToCache(headers, rows) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        store.put(headers, 'headers');
        store.put(rows, 'rows');
        store.put(Date.now(), 'last_sync');
        tx.oncomplete = function () { resolve(); };
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

  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, isManual ? 'Connecting to Google Sheets...' : 'Checking for updates...');

    fetchGoogleSheetCSV()
      .then(function (result) {
        allHeaders = result.headers;
        allRows = result.rows;
        lastSyncTime = Date.now();
        return saveToCache(allHeaders, allRows);
      })
      .then(function () {
        applyAllFiltersAndSearch();
        updateHeaderBadge();
        updateSyncUI(false);
        showToast('Synced ' + allRows.length.toLocaleString() + ' Dice tracker records', 'check');
      })
      .catch(function (err) {
        console.error('Dice data sync error:', err);
        updateSyncUI(false);
        showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
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
    renderEmptyState('Loading Dice Data from local cache...');
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
        console.warn('Dice cache read error:', err);
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 5. Table Header Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('dice-data-sheet-thead');
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

      // Column width presets
      if (colIdx === 0) { // Timestamp
        th.style.width = '150px';
        th.style.minWidth = '150px';
      } else if (colIdx === 1) { // Submitted By
        th.style.width = '130px';
        th.style.minWidth = '130px';
      } else if (colIdx === 2) { // PO Number
        th.style.width = '120px';
        th.style.minWidth = '120px';
      } else if (colIdx === 3) { // Style Number
        th.style.width = '130px';
        th.style.minWidth = '130px';
      } else if (colIdx === 4) { // Dice Quantity
        th.style.width = '120px';
        th.style.minWidth = '120px';
      } else if (colIdx === 5) { // Dice Attachment
        th.style.width = '250px';
        th.style.minWidth = '250px';
        th.style.textAlign = 'center';
      } else if (colIdx === 6 || colIdx === 7) { // Received Date, Handover Date
        th.style.width = '125px';
        th.style.minWidth = '125px';
      } else if (colIdx === 8) { // Receiving Person
        th.style.width = '140px';
        th.style.minWidth = '140px';
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
    var searchInput = document.getElementById('dice-data-sheet-search-input');
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

    var searchClear = document.getElementById('dice-data-sheet-search-clear');
    if (searchClear) searchClear.style.display = (searchInput && searchInput.value) ? 'block' : 'none';
  }

  function updateHeaderFilterIcons() {
    var thead = document.getElementById('dice-data-sheet-thead');
    if (!thead) return;
    thead.querySelectorAll('th.bai-sheet-th-filterable').forEach(function (th) {
      var colIdx = parseInt(th.getAttribute('data-col-idx'), 10);
      var btn = th.querySelector('.bai-sheet-col-filter-btn');
      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
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

  function renderActiveFilterChips() {
    var bar = document.getElementById('dice-data-sheet-active-filters-bar');
    var container = document.getElementById('dice-data-sheet-active-filters-chips');
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
        showToast('Filter removed on ' + colName, 'check');
      });

      chip.appendChild(textSpan);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Column Filter Popover
  // ---------------------------------------------------------------------------
  function getUniqueValuesForColumn(colIdx) {
    var map = {};
    for (var i = 0; i < allRows.length; i++) {
      var val = (allRows[i][colIdx] !== undefined && allRows[i][colIdx] !== null) ? String(allRows[i][colIdx]).trim() : '';
      map[val] = (map[val] || 0) + 1;
    }
    var keys = Object.keys(map);
    keys.sort(function (a, b) {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    return { keys: keys, counts: map };
  }

  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));

    var popover = document.getElementById('dice-data-sheet-filter-popover');
    var titleEl = document.getElementById('dice-data-sheet-filter-pop-title');
    var searchInput = document.getElementById('dice-data-sheet-filter-search-input');
    var searchClear = document.getElementById('dice-data-sheet-filter-search-clear');

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
    var left = rect.left;
    if (left + popWidth > window.innerWidth - 16) {
      left = window.innerWidth - popWidth - 16;
    }
    if (left < 16) left = 16;

    var top = rect.bottom + 6;
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
    var popover = document.getElementById('dice-data-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('dice-data-sheet-filter-list');
    var countEl = document.getElementById('dice-data-sheet-filter-items-count');
    if (!listEl) return;

    listEl.innerHTML = '';
    var q = currentFilterSearchQuery.toLowerCase().trim();

    var visibleValues = currentFilterUniqueValues.filter(function (val) {
      if (!q) return true;
      var label = (val === '' ? '(blanks)' : val).toLowerCase();
      return label.indexOf(q) !== -1;
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

      var isBlank = (val === '');
      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-filter-item-text';
      labelSpan.textContent = isBlank ? '(Blanks)' : val;
      if (isBlank) {
        labelSpan.style.fontStyle = 'italic';
        labelSpan.style.color = '#94a3b8';
      }

      leftDiv.appendChild(chk);
      leftDiv.appendChild(labelSpan);

      var countSpan = document.createElement('span');
      countSpan.className = 'bai-sheet-filter-item-count';
      countSpan.textContent = currentFilterValueCounts[val] || 0;

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
  // 7b. Attachment Image Lightbox Modal
  // ---------------------------------------------------------------------------
  function ensureLightboxStyles() {
    if (document.getElementById('dice-lightbox-injected-style')) return;
    var style = document.createElement('style');
    style.id = 'dice-lightbox-injected-style';
    style.textContent = [
      '@keyframes diceFadeIn { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes diceZoomIn { from { transform: scale(0.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }',
      '#dice-attachment-lightbox-modal { animation: diceFadeIn 0.18s ease-out; }',
      '#dice-attachment-lightbox-modal #dice-lightbox-card { animation: diceZoomIn 0.22s cubic-bezier(0.16, 1, 0.3, 1); }',
      '.dice-attachment-grid { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; align-items: center !important; justify-content: center !important; max-width: 232px !important; margin: 0 auto !important; padding: 2px 0 !important; }',
      '.dice-thumb-link { width: 72px !important; height: 52px !important; min-width: 72px !important; max-width: 72px !important; min-height: 52px !important; max-height: 52px !important; box-sizing: border-box !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; overflow: hidden !important; background: #ffffff !important; border: 1.5px solid #cbd5e1 !important; border-radius: 6px !important; padding: 2px !important; text-decoration: none !important; transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1) !important; cursor: pointer !important; box-shadow: 0 1px 3px rgba(0,0,0,0.08) !important; flex: 0 0 72px !important; }',
      '.dice-thumb-link:hover { transform: scale(1.08) !important; border-color: #0284c7 !important; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35) !important; z-index: 2 !important; }',
      '.dice-thumb-img { width: 100% !important; height: 100% !important; max-width: 100% !important; max-height: 100% !important; object-fit: contain !important; display: block !important; border-radius: 4px !important; background: #ffffff !important; }',
      '.dice-thumb-fallback { width: 72px !important; height: 52px !important; min-width: 72px !important; max-width: 72px !important; min-height: 52px !important; max-height: 52px !important; box-sizing: border-box !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; background: #f0f9ff !important; border: 1.5px solid #bae6fd !important; border-radius: 6px !important; color: #0369a1 !important; text-decoration: none !important; cursor: pointer !important; flex: 0 0 72px !important; padding: 2px !important; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function openLightbox(imageUrl, driveUrl, title) {
    ensureLightboxStyles();
    var modal = document.getElementById('dice-attachment-lightbox-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dice-attachment-lightbox-modal';
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
        '<div id="dice-lightbox-card" style="background:#ffffff; border-radius:12px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.6); max-width:92vw; max-height:92vh; display:flex; flex-direction:column; overflow:hidden; border:1px solid #334155;">',
        '  <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 18px; background:#0f172a; color:#f8fafc; border-bottom:1px solid #1e293b;">',
        '    <div style="display:flex; align-items:center; gap:8px;">',
        '      <span class="material-icons-round" style="color:#38bdf8; font-size:20px;">image</span>',
        '      <span id="dice-lightbox-title" style="font-weight:700; font-size:13.5px; letter-spacing:0.3px;">Dice Attachment Preview</span>',
        '    </div>',
        '    <button id="dice-lightbox-close-btn" type="button" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:24px; line-height:1; padding:2px 6px; display:flex; align-items:center; justify-content:center; border-radius:4px;" title="Close (Esc)">&times;</button>',
        '  </div>',
        '  <div style="flex:1; display:flex; align-items:center; justify-content:center; padding:16px; background:#020617; overflow:auto; min-height:220px;">',
        '    <img id="dice-lightbox-img" src="" alt="Dice Attachment Preview" referrerpolicy="no-referrer" style="max-width:100%; max-height:72vh; object-fit:contain; border-radius:6px; box-shadow:0 10px 25px rgba(0,0,0,0.5);" />',
        '  </div>',
        '  <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 18px; background:#f8fafc; border-top:1px solid #e2e8f0; gap:12px; flex-wrap:wrap;">',
        '    <span id="dice-lightbox-info" style="font-size:12px; color:#64748b; font-weight:500;">Dice Attachment Photo</span>',
        '    <div style="display:flex; align-items:center; gap:10px;">',
        '      <a id="dice-lightbox-drive-btn" href="#" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:6px; background:#0284c7; color:#ffffff; padding:7px 14px; border-radius:6px; font-size:12px; font-weight:600; text-decoration:none;">',
        '        <span class="material-icons-round" style="font-size:16px;">open_in_new</span> Open in Google Drive',
        '      </a>',
        '      <button id="dice-lightbox-btn-done" type="button" style="background:#e2e8f0; border:none; color:#334155; padding:7px 14px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">Close</button>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('\n');

      document.body.appendChild(modal);

      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeLightbox();
      });
      document.getElementById('dice-lightbox-close-btn').addEventListener('click', closeLightbox);
      document.getElementById('dice-lightbox-btn-done').addEventListener('click', closeLightbox);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeLightbox();
      });
    }

    var imgEl = document.getElementById('dice-lightbox-img');
    var titleEl = document.getElementById('dice-lightbox-title');
    var driveBtn = document.getElementById('dice-lightbox-drive-btn');

    if (imgEl) {
      imgEl.src = imageUrl;
    }
    if (titleEl) titleEl.textContent = title || 'Dice Attachment Preview';
    if (driveBtn) driveBtn.href = driveUrl || '#';

    modal.style.display = 'flex';
  }

  function closeLightbox() {
    var modal = document.getElementById('dice-attachment-lightbox-modal');
    if (modal) modal.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // 8. Pagination & Table Page Rendering
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('dice-data-sheet-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="' + (NUM_COLS + 1) + '" class="bai-sheet-table-empty">' + (msg || 'No matching records found') + '</td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('dice-data-sheet-tbody');
    var countLabel = document.getElementById('dice-data-sheet-count-label');
    var rangeLabel = document.getElementById('dice-data-sheet-showing-range');
    var pageNumInput = document.getElementById('dice-data-sheet-page-num');
    var totalPagesEl = document.getElementById('dice-data-sheet-total-pages');

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
        } else if (colIdx === 2) { // PO Number
          td.style.fontFamily = 'monospace';
          td.style.fontWeight = '700';
          td.style.color = '#1e293b';
          td.style.letterSpacing = '0.3px';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal || '—';
        } else if (colIdx === 3) { // Style Number
          td.style.fontWeight = '600';
          td.style.color = '#334155';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal || '—';
        } else if (colIdx === 4) { // Dice Quantity
          td.className = 'bai-sheet-td-num';
          td.style.fontWeight = '700';
          td.style.color = '#c2410c';
          td.style.textAlign = 'right';
          td.style.whiteSpace = 'nowrap';
          td.style.background = 'rgba(255, 247, 237, 0.6)';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal ? (isNaN(Number(strVal)) ? strVal : Number(strVal).toLocaleString()) : '—';
        } else if (colIdx === 5) { // Dice Attachment - Direct Image Thumbnail Preview
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
            var poNum = String(row[2] || '');
            var styleNum = String(row[3] || '');
            var previewTitle = 'PO: ' + (poNum || '-') + ' • Style: ' + (styleNum || '-');

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
              img.alt = 'Dice Attachment ' + (linkIndex + 1);
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
        } else if (colIdx === 6 || colIdx === 7) { // Received Date, Handover Date
          td.style.color = '#475569';
          td.style.fontWeight = '600';
          td.style.textAlign = 'center';
          td.style.whiteSpace = 'nowrap';
          td.style.fontVariantNumeric = 'tabular-nums';
          td.textContent = strVal || '—';
        } else if (colIdx === 8) { // Receiving Person
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal || '—';
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
    var firstBtn = document.getElementById('dice-data-sheet-first-page');
    var prevBtn = document.getElementById('dice-data-sheet-prev-page');
    var nextBtn = document.getElementById('dice-data-sheet-next-page');
    var lastBtn = document.getElementById('dice-data-sheet-last-page');

    if (firstBtn) firstBtn.disabled = current <= 1;
    if (prevBtn) prevBtn.disabled = current <= 1;
    if (nextBtn) nextBtn.disabled = current >= total;
    if (lastBtn) lastBtn.disabled = current >= total;
  }

  // ---------------------------------------------------------------------------
  // 9. Interactive Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('dice-data-sheet-tbody');
    if (!tbody) return;

    var prevSelected = tbody.querySelector('.bai-cell-selected');
    if (prevSelected) prevSelected.classList.remove('bai-cell-selected');

    var targetCell = tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (targetCell) {
      targetCell.classList.add('bai-cell-selected');
      activeCellCoords = { r: r, c: c };
      targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      updateActiveCellBadge(r, c);
    }
  }

  function clearCellSelection() {
    var tbody = document.getElementById('dice-data-sheet-tbody');
    if (tbody) {
      var prevSelected = tbody.querySelector('.bai-cell-selected');
      if (prevSelected) prevSelected.classList.remove('bai-cell-selected');
    }
    activeCellCoords = null;
    var badge = document.getElementById('dice-data-sheet-active-cell-badge');
    if (badge) {
      badge.style.display = 'none';
      badge.textContent = '';
    }
  }

  function updateActiveCellBadge(r, c) {
    var badge = document.getElementById('dice-data-sheet-active-cell-badge');
    if (!badge) return;

    var startIdx = (currentPage - 1) * pageSize;
    var globalRow = startIdx + r + 1;
    var colName = allHeaders[c] || ('Col ' + (c + 1));

    badge.style.display = 'inline-block';
    badge.textContent = 'Row ' + globalRow + ' \u203A ' + colName;
  }

  function copySelectedCellToClipboard() {
    var tbody = document.getElementById('dice-data-sheet-tbody');
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
  // 10. Excel (.xlsx) Export Engine
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
    for (var c = 0; c < NUM_COLS; c++) {
      var maxL = (allHeaders[c] || '').length;
      colWidths.push({ wch: Math.max(maxL + 4, 15) });
    }
    ws['!cols'] = colWidths;

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dice Data');

    var dateStr = new Date().toISOString().slice(0, 10);
    var filename = 'Dice_Data_Summary_' + dateStr + '.xlsx';
    XLSX.writeFile(wb, filename);

    showToast('Exported ' + rowsToExport.length.toLocaleString() + ' records to ' + filename, 'check');
  }

  // ---------------------------------------------------------------------------
  // 11. Toast & Sync UI Notification
  // ---------------------------------------------------------------------------
  function showToast(msg, type) {
    var existing = document.getElementById('dice-data-sheet-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'dice-data-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + (type || 'info');
    var iconSvg = SVG_ICONS[type] || SVG_ICONS.info || SVG_ICONS.check;
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + msg + '</span>';
    document.body.appendChild(toast);

    setTimeout(function () { toast.classList.add('show'); }, 20);
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3200);
  }

  function updateSyncUI(syncing, msg) {
    var banner = document.getElementById('dice-data-sheet-sync-banner');
    var bannerMsg = document.getElementById('dice-data-sheet-sync-msg');
    var syncIcon = document.getElementById('dice-data-sheet-sync-icon');

    if (banner) banner.style.display = syncing ? 'flex' : 'none';
    if (bannerMsg && msg) bannerMsg.textContent = msg;
    if (syncIcon) {
      if (syncing) syncIcon.classList.add('bai-sheet-spin');
      else syncIcon.classList.remove('bai-sheet-spin');
    }
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('dice-data-sheet-db-badge');
    var syncText = document.getElementById('dice-data-sheet-last-sync-text');

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
    var diceView = document.getElementById('reports-dice-summary-view');
    var reportsKpiView = document.getElementById('reports-kpi-view');
    if (reportsKpiView) reportsKpiView.style.display = 'none';
    if (diceView) diceView.style.display = '';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) filteredRows = allRows.slice();
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var s = document.getElementById('dice-data-sheet-search-input');
      if (s) s.focus();
    }, 100);
  }

  function hideView() {
    var diceView = document.getElementById('reports-dice-summary-view');
    var reportsKpiView = document.getElementById('reports-kpi-view');
    if (diceView) diceView.style.display = 'none';
    if (reportsKpiView) reportsKpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  // ---------------------------------------------------------------------------
  // 13. Event Listeners & Binding
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // 1. KPI Card click in Reports
    var kpiCard = document.getElementById('kpi-dice-summary');
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
    var backBtn = document.getElementById('btn-back-dice-reports');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      }, true);
    }

    // 3. Sync button
    var syncBtn = document.getElementById('btn-refresh-dice-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        syncFromGoogleSheet(true);
      }, true);
    }

    // 4. Export button
    var exportBtn = document.getElementById('btn-download-dice-data-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportToExcel();
      }, true);
    }

    // 5. Search input
    var searchInput = document.getElementById('dice-data-sheet-search-input');
    var searchClear = document.getElementById('dice-data-sheet-search-clear');
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

    // 6. Page size
    var pageSizeSelect = document.getElementById('dice-data-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // 7. Pagination buttons
    var firstBtn = document.getElementById('dice-data-sheet-first-page');
    var prevBtn = document.getElementById('dice-data-sheet-prev-page');
    var nextBtn = document.getElementById('dice-data-sheet-next-page');
    var lastBtn = document.getElementById('dice-data-sheet-last-page');
    var pageNumInput = document.getElementById('dice-data-sheet-page-num');

    if (firstBtn) firstBtn.addEventListener('click', function () { currentPage = 1; renderTablePage(); });
    if (prevBtn) prevBtn.addEventListener('click', function () { if (currentPage > 1) { currentPage--; renderTablePage(); } });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      var tp = Math.ceil(filteredRows.length / pageSize) || 1;
      if (currentPage < tp) { currentPage++; renderTablePage(); }
    });
    if (lastBtn) lastBtn.addEventListener('click', function () {
      var tp = Math.ceil(filteredRows.length / pageSize) || 1;
      if (currentPage < tp) { currentPage = tp; renderTablePage(); }
    });

    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var tp = Math.ceil(filteredRows.length / pageSize) || 1;
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
    var clearAllFiltersBtn = document.getElementById('dice-data-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'check');
      });
    }

    // 9. Popover Controls
    var popCloseBtn = document.getElementById('dice-data-sheet-filter-pop-close');
    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);

    var popSearchInput = document.getElementById('dice-data-sheet-filter-search-input');
    var popSearchClear = document.getElementById('dice-data-sheet-filter-search-clear');
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

    var popSelectAllBtn = document.getElementById('dice-data-sheet-filter-select-all');
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

    var popClearAllBtn = document.getElementById('dice-data-sheet-filter-clear-all');
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

    var sortAscBtn = document.getElementById('dice-data-sheet-sort-asc');
    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          return String(a[col] || '').localeCompare(String(b[col] || ''), undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (A to Z)', 'sort');
      });
    }

    var sortDescBtn = document.getElementById('dice-data-sheet-sort-desc');
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var col = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          return String(b[col] || '').localeCompare(String(a[col] || ''), undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted ' + allHeaders[col] + ' (Z to A)', 'sort');
      });
    }

    var popResetBtn = document.getElementById('dice-data-sheet-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        delete activeColumnFilters[currentFilterColIdx];
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter cleared on ' + allHeaders[currentFilterColIdx], 'check');
      });
    }

    var popCancelBtn = document.getElementById('dice-data-sheet-filter-cancel-btn');
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);

    var popOkBtn = document.getElementById('dice-data-sheet-filter-ok-btn');
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
        showToast('Filter applied on ' + allHeaders[currentFilterColIdx], 'check');
      });
    }

    // Close popover when clicking outside
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('dice-data-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Clear cell selection when clicking outside table
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var table = document.getElementById('dice-data-sheet-table');
      if (table && !table.contains(e.target)) clearCellSelection();
    });

    // Keyboard navigation & Shortcuts
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('reports-dice-summary-view');
      if (!view || view.style.display === 'none') return;

      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'Escape') {
        var popover = document.getElementById('dice-data-sheet-filter-popover');
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
        var tbody = document.getElementById('dice-data-sheet-tbody');
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
  // 14. Bootstrap
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
  window.DiceDataSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportToExcel,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
