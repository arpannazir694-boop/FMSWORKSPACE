/**
 * =============================================================================
 * End-Line QC Live Engine (IndexedDB + Fast Google Sheets CSV + PDF Generator)
 * =============================================================================
 * Sheet: END-LINE QC (Spreadsheet ID: 1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E)
 * GID: 1426523859
 * Range: B7:AE (30 Columns)
 * Row 7: Header Row
 * Database: IndexedDB 'FMS_End_Line_QC_DB_v1'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV stream fetch & RFC-4180 in-memory parser from Google Sheet export/gviz
 *   - Precision table layout with cell borders & text wrapping matching In-Line QC & Floor Supervisor
 *   - Action Column (PDF FILE): One-click print/PDF download of the official END-LINE INSPECTION REPORT
 *   - Instant client-side Search across all 30 columns with match highlighting
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover & Value Search
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Dual PDF Generation:
 *       1. Row-Level: End-Line QC Inspection Report (Single-page print/PDF checklist)
 *       2. Table-Level: Full landscape A4 PDF export of filtered table records
 *   - Excel (.xlsx) Export via SheetJS with styled headers & auto-width
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page) with numbered page pills
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
  var SHEET_GID = '1426523859';
  var SHEET_NAME = 'END-LINE QC';

  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=B7:AE';
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=B7:AE';
  var CSV_URL = PRIMARY_CSV_URL;

  var DB_NAME = 'FMS_End_Line_QC_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'endline_qc_store';
  var NUM_COLS = 30;

  var defaultHeaders = [
    'FMS UPLOAD TIMESTAMP',
    'BACTCH NO.',
    'LEATHER RECEIVED DATE',
    'CREATOR (DOER)',
    'UNIT',
    'FABRICATOR NAME (NO)',
    'BRAND',
    'SEASON',
    'CATEGORY',
    'SKU',
    'FAC / REF NO',
    'COLOUR',
    'QUANTITY',
    'ETD AS PER ORDER',
    'PO AS PER BUYER',
    'FLOOR SUPERVISOR NAME',
    'INLINE QC NAME',
    'PLANNED DATE',
    'FOLLOWUP TIMESTAMP',
    'STATUS',
    'TOTAL CHECKED QTY',
    'QUANTITY SEND TO WAREHOUSE',
    'TOTAL REPAIR QTY',
    'PENDING QTY',
    'REMARKS (FOLLOW UP)',
    'ACTUAL TIMESTAMP',
    'STATUS (JYOTI)',
    'REMARKS',
    'DELAY',
    'END-LINE QC NAME'
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

  // Cell Selection State
  var selectedCell = null; // { r: localRowIdx, c: colIdx, el: tdElement }

  // Column Filters State
  var activeColumnFilters = {};
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Engine
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
        reject(e.target.error || new Error('Failed to open ' + DB_NAME));
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
            resolve({
              headers: reqH.result || allHeaders,
              rows: reqR.result,
              lastSync: reqS.result || null
            });
          } else {
            resolve(null);
          }
        };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 2. High Performance CSV Stream Parser (30 Columns)
  // ---------------------------------------------------------------------------
  function parseCSVStream(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;
    var parsedHeaders = [];

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
        if (curRow.length > 0 && curRow.some(function (h) { return h.length > 0; })) {
          parsedHeaders = curRow.slice(0, NUM_COLS);
          while (parsedHeaders.length < NUM_COLS) {
            parsedHeaders.push(defaultHeaders[parsedHeaders.length] || ('Col ' + (parsedHeaders.length + 1)));
          }
          allHeaders = parsedHeaders;
        }
        isFirstRow = false;
      } else {
        var hasContent = curRow.some(function (cell) {
          return cell !== undefined && cell !== null && String(cell).trim() !== '';
        });
        if (!hasContent) {
          curRow = [];
          return;
        }

        var normalizedRow = new Array(NUM_COLS);
        for (var j = 0; j < NUM_COLS; j++) {
          normalizedRow[j] = curRow[j] !== undefined && curRow[j] !== null ? curRow[j] : '';
        }
        rows.push(normalizedRow);
      }
      curRow = [];
    }

    return {
      headers: allHeaders,
      rows: rows
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Network Fetcher (Direct Export + GViz Fallback)
  // ---------------------------------------------------------------------------
  function fetchGoogleSheetCSV() {
    var ts = Date.now();
    return fetch(PRIMARY_CSV_URL + '&_=' + ts, { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' while downloading End-Line QC');
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 50 || (csvText.indexOf('google.visualization') !== -1 && csvText.indexOf('error') !== -1)) {
          throw new Error('Primary export returned incomplete payload');
        }
        return csvText;
      })
      .catch(function (err) {
        console.warn('[EndLineQC] Primary export failed, trying GViz fallback:', err);
        return fetch(FALLBACK_CSV_URL + '&_=' + ts, { method: 'GET', cache: 'no-cache' })
          .then(function (r2) {
            if (!r2.ok) throw new Error('Fallback HTTP status ' + r2.status);
            return r2.text();
          });
      })
      .then(function (validCsv) {
        return parseCSVStream(validCsv);
      });
  }

  // ---------------------------------------------------------------------------
  // 4. Background Sync & Cache Orchestration
  // ---------------------------------------------------------------------------
  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, isManual ? 'Connecting to Google Sheets...' : 'Checking for sheet updates...');

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
        showToast('Successfully synced ' + allRows.length.toLocaleString() + ' records', 'success');
      })
      .catch(function (err) {
        console.error('End-Line QC sync error:', err);
        updateSyncUI(false);
        showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
      })
      .finally(function () {
        isSyncing = false;
      });
  }

  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading End-Line QC records from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = cached.headers && cached.headers.length === NUM_COLS ? cached.headers : defaultHeaders.slice();
          allRows = cached.rows;
          lastSyncTime = cached.lastSync;

          filteredRows = allRows.slice();
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          updateSyncUI(false);

          // Fast background refresh if stale
          if (!lastSyncTime || (Date.now() - lastSyncTime > 5 * 60 * 1000)) {
            setTimeout(function () {
              syncFromGoogleSheet(false);
            }, 800);
          }
        } else {
          updateSyncUI(true, 'First-time cache building from Google Sheet...');
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('Cache read error, falling back to direct fetch:', err);
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 5. Header Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('endline-qc-thead');
    if (!thead) return;

    thead.innerHTML = '';
    var tr = document.createElement('tr');

    // 1. Serial # Column Header
    var thIndex = document.createElement('th');
    thIndex.className = 'bai-sheet-th-index';
    thIndex.textContent = '#';
    thIndex.style.cssText = 'width:55px!important;min-width:55px!important;max-width:55px!important;text-align:center!important;background:#091729;color:#94a3b8;border-right:2px solid #334155;';
    tr.appendChild(thIndex);

    // 2. PDF FILE Action Column Header
    var thPdf = document.createElement('th');
    thPdf.className = 'bai-sheet-th bai-sheet-th-action bai-th-pdf-action';
    thPdf.style.cssText = 'width:70px!important;min-width:70px!important;max-width:70px!important;text-align:center!important;white-space:nowrap!important;padding:8px 4px!important;background:#0f172a;color:#f8fafc;';
    thPdf.textContent = 'PDF FILE';
    tr.appendChild(thPdf);

    // 3. 30 Data Column Headers
    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th-filterable';
      th.setAttribute('data-col-idx', colIdx);

      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) {
        th.classList.add('has-active-filter');
      }

      var inner = document.createElement('div');
      inner.className = 'bai-sheet-th-content';
      inner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-th-title';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));
      labelSpan.title = hName;

      var filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'bai-sheet-col-filter-btn' + (hasFilter ? ' is-active' : '');
      filterBtn.title = 'Filter ' + hName;
      filterBtn.innerHTML = '<span class="material-icons-round" style="font-size:14px;">' + (hasFilter ? 'filter_alt' : 'filter_list') + '</span>';

      filterBtn.addEventListener('click', (function (ci, fb) {
        return function (e) {
          e.stopPropagation();
          openColumnFilterPopover(ci, fb);
        };
      })(colIdx, filterBtn));

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
    var searchInput = document.getElementById('endline-qc-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];

    var activeFilterColKeys = Object.keys(activeColumnFilters);

    filteredRows = allRows.filter(function (row) {
      // 1. Global Search across all 30 columns
      if (searchTokens.length > 0) {
        var rowText = row.join(' ').toLowerCase();
        for (var t = 0; t < searchTokens.length; t++) {
          if (rowText.indexOf(searchTokens[t]) === -1) {
            return false;
          }
        }
      }

      // 2. Parallel Column Filters
      for (var f = 0; f < activeFilterColKeys.length; f++) {
        var colIdx = parseInt(activeFilterColKeys[f], 10);
        var allowedSet = activeColumnFilters[colIdx];
        if (allowedSet && allowedSet.size > 0) {
          var cellVal = (row[colIdx] !== undefined && row[colIdx] !== null) ? String(row[colIdx]).trim() : '';
          if (!allowedSet.has(cellVal)) {
            return false;
          }
        }
      }

      return true;
    });

    currentPage = 1;
    renderTablePage();
    renderActiveFilterChips();
    updateHeaderFilterIcons();

    var searchClear = document.getElementById('endline-qc-search-clear');
    if (searchClear) {
      searchClear.style.display = rawSearch ? 'block' : 'none';
    }
  }

  function updateHeaderFilterIcons() {
    var thead = document.getElementById('endline-qc-thead');
    if (!thead) return;

    var thList = thead.querySelectorAll('th.bai-sheet-th-filterable');
    thList.forEach(function (th) {
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
    var bar = document.getElementById('endline-qc-active-filters-bar');
    var container = document.getElementById('endline-qc-active-filters-chips');
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
      var totalVals = getUniqueValuesForColumn(colIdx).length;
      var selectedCount = allowedSet.size;

      var chip = document.createElement('div');
      chip.className = 'bai-sheet-filter-chip';

      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-chip-text';
      textSpan.textContent = colName + ' (' + selectedCount + '/' + totalVals + ')';
      textSpan.title = colName + ': ' + Array.from(allowedSet).slice(0, 5).join(', ') + (allowedSet.size > 5 ? '...' : '');

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bai-sheet-filter-chip-remove';
      removeBtn.title = 'Remove filter for ' + colName;
      removeBtn.innerHTML = '&#x2715;';
      removeBtn.addEventListener('click', function () {
        delete activeColumnFilters[colIdx];
        applyAllFiltersAndSearch();
        showToast('Filter removed on ' + colName, 'filter');
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

    var popover = document.getElementById('endline-qc-filter-popover');
    var titleEl = document.getElementById('endline-qc-filter-pop-title');
    var searchInput = document.getElementById('endline-qc-filter-search-input');
    var searchClear = document.getElementById('endline-qc-filter-search-clear');

    if (titleEl) {
      titleEl.textContent = 'Filter: ' + colName;
      titleEl.title = colName;
    }
    if (searchInput) {
      searchInput.value = '';
      currentFilterSearchQuery = '';
    }
    if (searchClear) {
      searchClear.style.display = 'none';
    }

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

    // Smart Positioning
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
    var popover = document.getElementById('endline-qc-filter-popover');
    if (popover) {
      popover.style.display = 'none';
    }
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('endline-qc-filter-list');
    var countEl = document.getElementById('endline-qc-filter-items-count');
    if (!listEl) return;

    listEl.innerHTML = '';
    var q = currentFilterSearchQuery.toLowerCase().trim();

    var visibleVals = currentFilterUniqueValues.filter(function (val) {
      if (!q) return true;
      var label = val === '' ? '(blanks)' : val;
      return label.toLowerCase().indexOf(q) !== -1;
    });

    if (countEl) {
      countEl.textContent = visibleVals.length.toLocaleString() + ' items';
    }

    if (visibleVals.length === 0) {
      listEl.innerHTML = '<div class="bai-sheet-filter-empty">No matching values</div>';
      return;
    }

    visibleVals.forEach(function (val) {
      var isChecked = currentFilterSelectedSet.has(val);
      var displayLabel = val === '' ? '(Blanks)' : val;
      var count = currentFilterValueCounts[val] || 0;

      var item = document.createElement('label');
      item.className = 'bai-sheet-filter-item';

      var leftDiv = document.createElement('div');
      leftDiv.className = 'bai-sheet-filter-item-left';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.addEventListener('change', (function (v, checkbox) {
        return function () {
          if (checkbox.checked) currentFilterSelectedSet.add(v);
          else currentFilterSelectedSet.delete(v);
        };
      })(val, cb));

      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-item-text';
      textSpan.textContent = displayLabel;
      textSpan.title = displayLabel;
      if (val === '') {
        textSpan.style.fontStyle = 'italic';
        textSpan.style.color = '#94a3b8';
      }

      leftDiv.appendChild(cb);
      leftDiv.appendChild(textSpan);

      var countBadge = document.createElement('span');
      countBadge.className = 'bai-sheet-filter-item-count';
      countBadge.textContent = '(' + count.toLocaleString() + ')';

      item.appendChild(leftDiv);
      item.appendChild(countBadge);
      listEl.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Text Match Highlighter
  // ---------------------------------------------------------------------------
  function highlightMatch(text, query) {
    if (!query || text === null || text === undefined) return escapeHtml(text);
    var str = String(text);
    var idx = str.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(str);
    var before = str.substring(0, idx);
    var match = str.substring(idx, idx + query.length);
    var after = str.substring(idx + query.length);
    return escapeHtml(before) + '<mark class="dt-highlight">' + escapeHtml(match) + '</mark>' + escapeHtml(after);
  }

  // ---------------------------------------------------------------------------
  // 9. Table Page & Cell Selection Rendering
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('endline-qc-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="32" class="bai-sheet-table-empty">' +
      '<div class="bai-sheet-empty-wrap" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:40px 10px;">' +
      '<span class="material-icons-round bai-sheet-spin" style="font-size:24px;color:#d97706;">sync</span>' +
      '<span style="font-size:13px;font-weight:600;color:#64748b;">' + msg + '</span>' +
      '</div></td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('endline-qc-tbody');
    var countLabel = document.getElementById('endline-qc-record-count');
    var infoText = document.getElementById('endline-qc-info');
    var totalPagesEl = document.getElementById('endline-qc-total-pages');
    var pageInput = document.getElementById('endline-qc-page-input');

    if (!tbody) return;

    var searchInput = document.getElementById('endline-qc-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="32" class="bai-sheet-table-empty">' +
        (allRows.length === 0 ? 'No data in END-LINE QC sheet.' : 'No matching records found.') +
        '</td></tr>';
      if (countLabel) countLabel.textContent = '0 records found';
      if (infoText) infoText.textContent = 'Showing 0 - 0 of 0 entries';
      if (totalPagesEl) totalPagesEl.textContent = '1';
      if (pageInput) pageInput.value = 1;
      updatePaginationControls(1, 1);
      clearCellSelection();
      return;
    }

    var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = (currentPage - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, filteredRows.length);
    var pageRows = filteredRows.slice(startIdx, endIdx);

    if (countLabel) {
      countLabel.textContent = filteredRows.length.toLocaleString() + ' of ' + allRows.length.toLocaleString() + ' records';
    }
    if (infoText) {
      infoText.textContent = 'Showing ' + (startIdx + 1).toLocaleString() + ' - ' + endIdx.toLocaleString() + ' of ' + filteredRows.length.toLocaleString() + ' entries';
    }
    if (totalPagesEl) totalPagesEl.textContent = totalPages;
    if (pageInput) {
      pageInput.value = currentPage;
      pageInput.max = totalPages;
    }

    updatePaginationControls(currentPage, totalPages);

    var fragment = document.createDocumentFragment();

    pageRows.forEach(function (row, localRowIdx) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-r', localRowIdx);

      // 1. Serial # Cell
      var tdNum = document.createElement('td');
      tdNum.className = 'bai-sheet-td-index';
      tdNum.textContent = (startIdx + localRowIdx + 1).toLocaleString();
      tdNum.style.cssText = 'text-align:center;color:#64748b;font-weight:700;background:#f8fafc;border-right:1px solid #e2e8f0;font-size:11px;';
      tr.appendChild(tdNum);

      // 2. PDF Download Action Button
      var tdPdf = document.createElement('td');
      tdPdf.className = 'bai-td-pdf-action bai-sheet-td-action';
      tdPdf.style.cssText = 'width:70px!important;min-width:70px!important;max-width:70px!important;text-align:center!important;vertical-align:middle!important;padding:4px!important;';

      var pdfBtn = document.createElement('button');
      pdfBtn.type = 'button';
      pdfBtn.className = 'bai-btn-row-pdf dt-pdf-download-btn';
      pdfBtn.title = 'Download Inspection Report PDF for Batch: ' + (row[1] || 'Row ' + (startIdx + localRowIdx + 1));
      pdfBtn.innerHTML = '<span class="material-icons-round">picture_as_pdf</span>';

      (function (capturedRow) {
        pdfBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          downloadRowInspectionReportPdf(capturedRow);
        });
      })(row);

      tdPdf.appendChild(pdfBtn);
      tr.appendChild(tdPdf);

      // 3. 30 Data Columns
      row.forEach(function (val, colIdx) {
        var td = document.createElement('td');
        td.className = 'bai-td-data';
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);

        // Highlight selected cell
        if (selectedCell && selectedCell.r === localRowIdx && selectedCell.c === colIdx) {
          td.classList.add('bai-cell-selected');
        }

        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';

        // Style specific columns:
        if (colIdx === 1) { // Batch No
          td.style.fontWeight = '700';
          td.style.color = '#0284c7';
          td.style.whiteSpace = 'nowrap';
        } else if (colIdx === 4) { // Unit
          td.style.fontWeight = '700';
          td.style.color = '#15803d';
          td.style.whiteSpace = 'nowrap';
        } else if (colIdx === 5) { // Fabricator
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
        } else if (colIdx === 9) { // SKU
          td.style.fontWeight = '700';
          td.style.color = '#7e22ce';
          td.style.whiteSpace = 'nowrap';
        } else if (colIdx === 12) { // Quantity
          td.style.fontWeight = '700';
          td.style.color = '#c2410c';
          td.style.whiteSpace = 'nowrap';
        } else if (colIdx === 19 || colIdx === 26) { // Status / Status (Jyoti)
          var upperStatus = strVal.toUpperCase();
          if (upperStatus === 'DONE' || upperStatus === 'COMPLETE' || upperStatus === 'COMPLETED') {
            td.innerHTML = '<span class="bai-sheet-badge-done" style="background:#dcfce7;color:#15803d;border:1px solid #86efac;font-weight:700;padding:1px 6px;font-size:10.5px;">' + escapeHtml(strVal) + '</span>';
            td.addEventListener('mousedown', function () { selectCell(td, localRowIdx, colIdx); });
            tr.appendChild(td);
            return;
          } else if (upperStatus === 'PENDING') {
            td.innerHTML = '<span style="background:#fef3c7;color:#b45309;border:1px solid #fcd34d;font-weight:700;padding:1px 6px;font-size:10.5px;border-radius:2px;">' + escapeHtml(strVal) + '</span>';
            td.addEventListener('mousedown', function () { selectCell(td, localRowIdx, colIdx); });
            tr.appendChild(td);
            return;
          }
        } else if (colIdx === 28) { // Delay
          var delayNum = parseInt(strVal, 10);
          if (!isNaN(delayNum) && delayNum > 0) {
            td.style.fontWeight = '700';
            td.style.color = '#ef4444';
          }
        } else if (colIdx === 29) { // End-Line QC Name
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
        }

        if (rawSearch && strVal.toLowerCase().indexOf(rawSearch) !== -1) {
          td.innerHTML = highlightMatch(strVal, rawSearch);
        } else {
          td.textContent = strVal;
        }

        // Cell Selection on click
        td.addEventListener('mousedown', function () {
          selectCell(td, localRowIdx, colIdx);
        });

        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  // ---------------------------------------------------------------------------
  // 10. Pagination Controls & Page Pills
  // ---------------------------------------------------------------------------
  function getPaginationRange(current, total, maxVisible) {
    if (total <= maxVisible) {
      var arr = [];
      for (var i = 1; i <= total; i++) arr.push(i);
      return arr;
    }
    var half = Math.floor(maxVisible / 2);
    var start = Math.max(1, current - half);
    var end = Math.min(total, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    var res = [];
    for (var j = start; j <= end; j++) res.push(j);
    return res;
  }

  function updatePaginationControls(current, total) {
    var firstBtn = document.getElementById('btn-first-page-eqc');
    var prevBtn = document.getElementById('btn-prev-page-eqc');
    var nextBtn = document.getElementById('btn-next-page-eqc');
    var lastBtn = document.getElementById('btn-last-page-eqc');
    var pillsContainer = document.getElementById('endline-qc-page-pills');

    if (firstBtn) firstBtn.disabled = current <= 1;
    if (prevBtn) prevBtn.disabled = current <= 1;
    if (nextBtn) nextBtn.disabled = current >= total;
    if (lastBtn) lastBtn.disabled = current >= total;

    if (pillsContainer) {
      pillsContainer.innerHTML = '';
      if (total > 1) {
        var pillRange = getPaginationRange(current, total, 5);
        pillRange.forEach(function (p) {
          var pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'floor-supervisor-page-pill' + (p === current ? ' active' : '');
          pill.textContent = p;
          pill.setAttribute('aria-label', 'Page ' + p);
          pill.addEventListener('click', function () {
            if (p !== currentPage) {
              currentPage = p;
              renderTablePage();
            }
          });
          pillsContainer.appendChild(pill);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 11. Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCell(td, localRowIdx, colIdx) {
    var tbody = document.getElementById('endline-qc-tbody');
    if (!tbody) return;

    if (selectedCell && selectedCell.el) {
      selectedCell.el.classList.remove('bai-cell-selected');
    }

    selectedCell = { r: localRowIdx, c: colIdx, el: td };
    td.classList.add('bai-cell-selected');

    if (td.scrollIntoViewIfNeeded) {
      td.scrollIntoViewIfNeeded(false);
    } else {
      td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    var badge = document.getElementById('endline-qc-active-cell-badge');
    if (badge) {
      var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
      var startIdx = (currentPage - 1) * pageSize;
      var actualRow = startIdx + localRowIdx + 1;
      badge.textContent = 'Selected: Row ' + actualRow + ', Col: ' + colName;
      badge.style.display = 'inline-block';
    }
  }

  function clearCellSelection() {
    if (selectedCell && selectedCell.el) {
      selectedCell.el.classList.remove('bai-cell-selected');
    }
    selectedCell = null;
    var badge = document.getElementById('endline-qc-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // 12. Row Fields Extractor & Inspection Report Builder
  // ---------------------------------------------------------------------------
  function extractRowFields(row) {
    if (!row) return {};
    var byHdr = function (pattern, fallbackIdx) {
      for (var i = 0; i < allHeaders.length; i++) {
        if (pattern.test(allHeaders[i])) return row[i] || '';
      }
      return row[fallbackIdx] || '';
    };

    return {
      fmsTimestamp:  byHdr(/fms\s*upload/i, 0),
      batchId:       byHdr(/bact?ch\s*no/i, 1),
      leatherDate:   byHdr(/leather\s*received/i, 2),
      creator:       byHdr(/creator/i, 3),
      unit:          byHdr(/unit/i, 4),
      fabricator:    byHdr(/fabricator/i, 5),
      brand:         byHdr(/brand/i, 6),
      season:        byHdr(/season/i, 7),
      category:      byHdr(/category/i, 8),
      sku:           byHdr(/sku/i, 9),
      styleNo:       byHdr(/fac\s*\/\s*ref|style/i, 10),
      colour:        byHdr(/colou?r/i, 11),
      quantity:      byHdr(/quantity|^qty$/i, 12),
      etd:           byHdr(/etd/i, 13),
      po:            byHdr(/po\s*as\s*per/i, 14),
      floorSup:      byHdr(/floor\s*supervisor/i, 15),
      inLineQc:      byHdr(/in.?line\s*qc/i, 16),
      plannedDate:   byHdr(/planned\s*date/i, 17),
      followupTs:    byHdr(/followup\s*timestamp/i, 18),
      status:        byHdr(/^status$/i, 19),
      checkedQty:    byHdr(/checked\s*qty/i, 20),
      sentWhQty:     byHdr(/warehouse/i, 21),
      repairQty:     byHdr(/repair\s*qty/i, 22),
      pendingQty:    byHdr(/pending\s*qty/i, 23),
      remarksFu:     byHdr(/remarks\s*\(follow/i, 24),
      actualTs:      byHdr(/actual\s*timestamp/i, 25),
      statusJyoti:   byHdr(/status\s*\(jyoti/i, 26),
      remarks:       byHdr(/^remarks$/i, 27),
      delay:         byHdr(/delay/i, 28),
      endLineQcName: byHdr(/end.?line\s*qc/i, 29)
    };
  }

  function buildEndLineQcInspectionReportHtml(f) {
    var companyLogoUrl = 'https://res.cloudinary.com/dnrgcigsj/image/upload/v1789365942/trio-dark-logo_ayyhkh.svg';
    var companyName = 'TRIO TREND EXPORTS PVT. LTD.';
    var reportTitle = 'END-LINE QC INSPECTION REPORT';

    var genDate = new Date().toLocaleDateString('en-GB');

    var TOTAL_CHECKLIST_ROWS = 25;
    var checkRowsHtml = '';
    for (var i = 1; i <= TOTAL_CHECKLIST_ROWS; i++) {
      checkRowsHtml +=
        '<tr>' +
        '<td class="col-sl">' + i + '</td>' +
        '<td class="col-cp">&nbsp;</td>' +
        '<td class="col-qty"><div class="fill-box"></div></td>' +
        '<td class="col-check"><div class="chk-box"></div></td>' +
        '<td class="col-remarks"><div class="remark-line"></div></td>' +
        '</tr>';
    }

    var css =
      '*,*::before,*::after{ box-sizing: border-box; margin: 0; padding: 0; }' +
      'html, body { background: #e2e8f0; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }' +
      '.doc-page { width: 794px; margin: 10px auto; background: #ffffff; padding: 10px 16px 8px 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); border: 1.5px solid #000000; box-sizing: border-box; }' +
      '.top-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #000000; padding-bottom: 4px; margin-bottom: 4px; position: relative; }' +
      '.top-header::after { content: ""; position: absolute; bottom: -3px; left: 0; right: 0; height: 1.5px; background: linear-gradient(90deg, #d97706 0%, #f59e0b 50%, #d97706 100%); }' +
      '.brand-col { display: flex; align-items: center; gap: 12px; }' +
      '.company-logo { height: 38px; width: auto; max-width: 140px; object-fit: contain; }' +
      '.brand-meta { display: flex; flex-direction: column; justify-content: center; }' +
      '.company-title { font-size: 15px; font-weight: 900; color: #0f2744; letter-spacing: 0.8px; text-transform: uppercase; line-height: 1.15; }' +
      '.company-sub { font-size: 9px; font-weight: 700; color: #475569; letter-spacing: 0.5px; margin-top: 1px; text-transform: uppercase; }' +
      '.report-title-col { text-align: right; }' +
      '.report-badge { display: inline-block; background: #0f2744; color: #ffffff; font-size: 12px; font-weight: 900; letter-spacing: 0.6px; padding: 3px 9px; border-radius: 4px; border: 1px solid #d97706; }' +
      '.report-meta-sub { font-size: 9.5px; color: #1e293b; font-weight: 700; margin-top: 2px; }' +
      '.report-meta-sub strong { color: #000000; }' +
      '.info-card { background: #ffffff; border: 1.5px solid #000000; border-radius: 4px; overflow: hidden; margin-bottom: 4px; }' +
      '.info-grid-table { width: 100%; border-collapse: collapse; table-layout: fixed; }' +
      '.info-grid-table th, .info-grid-table td { border: 1px solid #000000; padding: 3.5px 5px; text-align: center; word-wrap: break-word; }' +
      '.info-grid-table th { background: #f1f5f9; color: #000000; font-weight: 900; font-size: 9px; letter-spacing: 0.4px; text-transform: uppercase; }' +
      '.info-grid-table td { font-weight: 800; color: #000000; font-size: 11.5px; line-height: 1.15; }' +
      '.val-highlight { color: #0f2744 !important; font-size: 12px !important; font-weight: 900 !important; }' +
      '.val-highlight-amber { color: #b45309 !important; font-size: 12px !important; font-weight: 900 !important; }' +
      '.metrics-card { border: 1.5px solid #000000; border-radius: 4px; overflow: hidden; margin-bottom: 4px; background: #ffffff; }' +
      '.metrics-header { background: #0f2744; color: #ffffff; display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; border-bottom: 1.5px solid #000000; }' +
      '.metrics-title { font-size: 10px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; display: flex; align-items: center; gap: 6px; }' +
      '.metrics-badge { background: #d97706; color: #ffffff; font-size: 9px; font-weight: 900; padding: 1px 6px; border-radius: 2px; }' +
      '.metrics-status-tag { font-size: 9px; color: #ffe066; font-weight: 800; }' +
      '.metrics-table { width: 100%; border-collapse: collapse; table-layout: fixed; }' +
      '.metrics-table th, .metrics-table td { border: 1px solid #000000; text-align: center; padding: 3px 4px; }' +
      '.metrics-table th { background: #f8fafc; font-size: 8.5px; font-weight: 900; color: #0f1724; text-transform: uppercase; letter-spacing: 0.3px; }' +
      '.metrics-table td { height: 26px; vertical-align: middle; }' +
      '.metric-val { font-size: 13px; font-weight: 900; color: #0f2744; }' +
      '.metric-val--green { color: #15803d; }' +
      '.metric-val--red { color: #b91c1c; }' +
      '.metric-val--amber { color: #b45309; }' +
      '.checklist-card { border: 1.5px solid #000000; border-radius: 4px; overflow: hidden; margin-bottom: 4px; background: #ffffff; }' +
      '.checklist-header { background: #0f2744; color: #ffffff; display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; border-bottom: 1.5px solid #000000; font-size: 10px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; }' +
      '.checklist-table { width: 100%; border-collapse: collapse; }' +
      '.checklist-table th, .checklist-table td { border: 1px solid #000000; padding: 2px 5px; vertical-align: middle; }' +
      '.checklist-table thead tr { background: #f1f5f9; }' +
      '.checklist-table th { color: #000000; font-weight: 900; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.3px; padding: 2.5px 4px; text-align: center; }' +
      '.checklist-table tbody tr { height: 21px; }' +
      '.checklist-table tbody tr:nth-child(even) { background: #fbfcfe; }' +
      '.col-sl { width: 26px; text-align: center; font-weight: 900; color: #000000; font-size: 9px; }' +
      '.col-cp { color: #000000; font-weight: 700; font-size: 9px; line-height: 1.15; letter-spacing: 0.1px; height: 21px; }' +
      '.col-qty { width: 55px; text-align: center; }' +
      '.fill-box { display: inline-block; width: 36px; height: 12px; border-bottom: 1px solid #000000; }' +
      '.col-check { width: 48px; text-align: center; }' +
      '.chk-box { display: inline-block; width: 13px; height: 13px; border: 1.8px solid #000000; border-radius: 2px; background: #ffffff; vertical-align: middle; }' +
      '.col-remarks { width: 160px; }' +
      '.remark-line { width: 100%; border-bottom: 1px dotted #475569; height: 12px; }' +
      '.sign-section { display: flex; justify-content: space-between; gap: 12px; margin-top: 5px; }' +
      '.sign-box { flex: 1; border: 1.5px solid #000000; border-radius: 4px; padding: 4px 6px; background: #fafafa; text-align: center; }' +
      '.sign-title { font-size: 9px; font-weight: 900; color: #0f2744; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 18px; }' +
      '.sign-line { border-bottom: 1.5px solid #000000; margin: 0 10px 2px 10px; }' +
      '.sign-caption { font-size: 8px; color: #334155; font-weight: 700; }' +
      '.footer-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 2px; border-top: 1.5px solid #000000; font-size: 8px; color: #334155; font-weight: 700; }' +
      '@media print { body { background: #ffffff !important; padding: 0 !important; margin: 0 !important; } .doc-page { margin: 0 auto !important; padding: 4px 10px !important; box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; } @page { size: A4 portrait; margin: 3mm 4mm; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }';

    return (
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<title>End-Line QC Inspection Report - ' + escapeHtml(f.batchId || 'Batch') + '</title>' +
      '<style>' + css + '</style>' +
      '</head><body><div class="doc doc-page">' +
      '<!-- Top Header Bar -->' +
      '<div class="top-header">' +
      '<div class="brand-col">' +
      '<img class="company-logo" src="' + companyLogoUrl + '" alt="Trio Group Logo" />' +
      '<div class="brand-meta">' +
      '<div class="company-title">' + escapeHtml(companyName) + '</div>' +
      '<div class="company-sub">Quality Assurance &amp; End-Line QC Final Inspection Division</div>' +
      '</div>' +
      '</div>' +
      '<div class="report-title-col">' +
      '<div class="report-badge">' + reportTitle + '</div>' +
      '<div class="report-meta-sub">' +
      '<strong>DATE:</strong> ' + escapeHtml(f.plannedDate || f.actualTs || genDate) + ' &nbsp;|&nbsp; ' +
      '<strong>BATCH:</strong> ' + escapeHtml(f.batchId || 'N/A') +
      '</div>' +
      '</div>' +
      '</div>' +

      '<!-- Batch Information Card -->' +
      '<div class="info-card">' +
      '<table class="info-grid-table">' +
      '<thead><tr>' +
      '<th style="width:14%;">BATCH ID</th>' +
      '<th style="width:14%;">PO / BUYER</th>' +
      '<th style="width:10%;">UNIT</th>' +
      '<th style="width:14%;">BRAND</th>' +
      '<th style="width:16%;">SKU</th>' +
      '<th style="width:17%;">STYLE / REF</th>' +
      '<th style="width:15%;">COLOUR</th>' +
      '<th style="width:14%;">ORDER QTY</th>' +
      '</tr></thead>' +
      '<tbody><tr>' +
      '<td class="val-highlight">' + escapeHtml(f.batchId || '-') + '</td>' +
      '<td>' + escapeHtml(f.po || '-') + '</td>' +
      '<td>' + escapeHtml(f.unit || '-') + '</td>' +
      '<td>' + escapeHtml(f.brand || '-') + '</td>' +
      '<td class="val-highlight">' + escapeHtml(f.sku || '-') + '</td>' +
      '<td>' + escapeHtml(f.styleNo || '-') + '</td>' +
      '<td>' + escapeHtml(f.colour || '-') + '</td>' +
      '<td class="val-highlight">' + escapeHtml(f.quantity || '-') + '</td>' +
      '</tr></tbody>' +
      '</table>' +
      '<table class="info-grid-table" style="border-top:none;">' +
      '<thead><tr>' +
      '<th style="width:25%;">FABRICATOR NAME</th>' +
      '<th style="width:25%;">FLOOR SUPERVISOR</th>' +
      '<th style="width:25%;">IN-LINE QC NAME</th>' +
      '<th style="width:25%;">END-LINE QC NAME</th>' +
      '</tr></thead>' +
      '<tbody><tr>' +
      '<td>' + escapeHtml(f.fabricator || '-') + '</td>' +
      '<td>' + escapeHtml(f.floorSup || '-') + '</td>' +
      '<td>' + escapeHtml(f.inLineQc || '-') + '</td>' +
      '<td class="val-highlight-amber">' + escapeHtml(f.endLineQcName || '-') + '</td>' +
      '</tr></tbody>' +
      '</table>' +
      '<table class="info-grid-table" style="border-top:none;">' +
      '<thead><tr>' +
      '<th style="width:25%;">ETD (EXP. DELIVERY)</th>' +
      '<th style="width:25%;">PLANNED DATE</th>' +
      '<th style="width:25%;">LEATHER RECEIVED DATE</th>' +
      '<th style="width:25%;">OVERALL DELAY</th>' +
      '</tr></thead>' +
      '<tbody><tr>' +
      '<td class="val-highlight">' + escapeHtml(f.etd || '-') + '</td>' +
      '<td>' + escapeHtml(f.plannedDate || '-') + '</td>' +
      '<td>' + escapeHtml(f.leatherDate || '-') + '</td>' +
      '<td>' + escapeHtml(f.delay || 'None') + '</td>' +
      '</tr></tbody>' +
      '</table>' +
      '</div>' +

      '<!-- Final Inspection Metrics Summary Card -->' +
      '<div class="metrics-card">' +
      '<div class="metrics-header">' +
      '<div class="metrics-title">' +
      '<span class="metrics-badge">QC SUMMARY</span>' +
      '<span>Final Inspection &amp; Warehouse Dispatch Reconciliation</span>' +
      '</div>' +
      '<div class="metrics-status-tag">STATUS: ' + escapeHtml(f.status || f.statusJyoti || 'PENDING') + '</div>' +
      '</div>' +
      '<table class="metrics-table">' +
      '<thead><tr>' +
      '<th style="width:20%;">TOTAL CHECKED QTY</th>' +
      '<th style="width:20%;">SENT TO WAREHOUSE</th>' +
      '<th style="width:20%;">TOTAL REPAIR QTY</th>' +
      '<th style="width:20%;">PENDING QTY</th>' +
      '<th style="width:20%;">REMARKS / FOLLOW UP</th>' +
      '</tr></thead>' +
      '<tbody><tr>' +
      '<td>' + (f.checkedQty ? '<span class="metric-val">' + escapeHtml(f.checkedQty) + '</span>' : '<span class="fill-box" style="width:60px;"></span>') + '</td>' +
      '<td>' + (f.sentWhQty ? '<span class="metric-val metric-val--green">' + escapeHtml(f.sentWhQty) + '</span>' : '<span class="fill-box" style="width:60px;"></span>') + '</td>' +
      '<td>' + (f.repairQty ? '<span class="metric-val metric-val--red">' + escapeHtml(f.repairQty) + '</span>' : '<span class="fill-box" style="width:60px;"></span>') + '</td>' +
      '<td>' + (f.pendingQty ? '<span class="metric-val metric-val--amber">' + escapeHtml(f.pendingQty) + '</span>' : '<span class="fill-box" style="width:60px;"></span>') + '</td>' +
      '<td style="font-size:9.5px;font-weight:700;color:#334155;">' + escapeHtml(f.remarksFu || f.remarks || '-') + '</td>' +
      '</tr></tbody>' +
      '</table>' +
      '</div>' +

      '<!-- Quality Checkpoints & Repair Reasons Checklist Table -->' +
      '<div class="checklist-card">' +
      '<div class="checklist-header">' +
      '<span>Quality Parameters, Checkpoints &amp; Repairing Reasons</span>' +
      '<span style="font-size:8.5px;color:#cbd5e1;font-weight:600;">Form Ref: FMS-EQC-01</span>' +
      '</div>' +
      '<table class="checklist-table">' +
      '<thead><tr>' +
      '<th class="col-sl">#</th>' +
      '<th class="col-cp" style="text-align:left;padding-left:8px;">CHECKPOINTS &amp; REPAIRING REASONS</th>' +
      '<th class="col-qty">DEFECT QTY</th>' +
      '<th class="col-check">STATUS</th>' +
      '<th class="col-remarks">OBSERVATIONS &amp; CORRECTIVE ACTION</th>' +
      '</tr></thead>' +
      '<tbody>' + checkRowsHtml + '</tbody>' +
      '</table>' +
      '</div>' +

      '<!-- Signatures Section -->' +
      '<div class="sign-section">' +
      '<div class="sign-box">' +
      '<div class="sign-title">End-Line QC Inspector</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Authorized Sign &amp; Date Stamp</div>' +
      '</div>' +
      '<div class="sign-box">' +
      '<div class="sign-title">Floor Supervisor</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Verified &amp; Date Stamp</div>' +
      '</div>' +
      '<div class="sign-box">' +
      '<div class="sign-title">QA Head / Factory Manager</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Final Approval &amp; Warehouse Release</div>' +
      '</div>' +
      '</div>' +

      '<!-- Footer Security Notice -->' +
      '<div class="footer-bar">' +
      '<span>Trio Trend Exports Pvt. Ltd. &bull; End-Line QC Final Inspection System &bull; Confidential Document</span>' +
      '<span>Form Ref: FMS-EQC-01</span>' +
      '</div>' +
      '</div></body></html>'
    );
  }

  function downloadRowInspectionReportPdf(row) {
    try {
      var f = extractRowFields(row);
      var html = buildEndLineQcInspectionReportHtml(f);

      var win = window.open('', '_blank', 'width=920,height=800');
      if (!win) {
        showToast('Popup blocked. Please allow popups to download the PDF.', 'error');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();

      setTimeout(function () {
        try {
          var doc = win.document.querySelector('.doc-page, .doc');
          if (doc) {
            var PAGE_HEIGHT_PX = 1050;
            if (doc.scrollHeight > PAGE_HEIGHT_PX) {
              var ratio = Math.max(0.85, PAGE_HEIGHT_PX / doc.scrollHeight);
              doc.style.zoom = ratio;
            }
          }
        } catch (e) { }
        try { win.print(); } catch (e) { }
      }, 350);
    } catch (err) {
      console.error('End-Line QC Row PDF error:', err);
      showToast('Could not generate PDF: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 13. Full Table Landscape PDF Export (AutoTable + Fallback)
  // ---------------------------------------------------------------------------
  function exportFilteredTablePdf() {
    if (filteredRows.length === 0) {
      showToast('No records available to export.', 'info');
      return;
    }

    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (jsPDFCtor) {
      try {
        var doc = new jsPDFCtor({ orientation: 'landscape', unit: 'pt', format: 'a4' });

        var fontFamily = 'helvetica';
        if (typeof registerPdfFonts_ === 'function') {
          try { registerPdfFonts_(doc); fontFamily = 'IBMPlexSans'; } catch (e) { fontFamily = 'helvetica'; }
        }
        doc.setFont(fontFamily, 'normal');

        var pageWidth = doc.internal.pageSize.getWidth();
        var pageHeight = doc.internal.pageSize.getHeight();
        var marginX = 20;

        // Header Title
        doc.setFont(fontFamily, 'bold');
        doc.setFontSize(14);
        doc.setTextColor(15, 23, 42);
        doc.text('END-LINE QC - INSPECTION & PRODUCTION REPORT', marginX, 28);

        // Gold line accent
        doc.setDrawColor(217, 119, 6);
        doc.setLineWidth(1.5);
        doc.line(marginX, 32, pageWidth - marginX, 32);

        doc.setFont(fontFamily, 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        var genDateStr = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString('en-GB');
        doc.text('Trio Trend Exports Pvt. Ltd. · Quality Assurance Division · Generated: ' + genDateStr + ' · Records: ' + filteredRows.length.toLocaleString(), marginX, 44);

        var exportCols = [
          { title: '#', dataKey: 'idx' },
          { title: 'Batch No.', dataKey: 'batchNo' },
          { title: 'Unit', dataKey: 'unit' },
          { title: 'Fabricator', dataKey: 'fabricator' },
          { title: 'Brand', dataKey: 'brand' },
          { title: 'SKU', dataKey: 'sku' },
          { title: 'Style', dataKey: 'style' },
          { title: 'Colour', dataKey: 'colour' },
          { title: 'Order Qty', dataKey: 'qty' },
          { title: 'Checked', dataKey: 'checkedQty' },
          { title: 'Sent Wh', dataKey: 'sentWhQty' },
          { title: 'Repair', dataKey: 'repairQty' },
          { title: 'Pending', dataKey: 'pendingQty' },
          { title: 'Status', dataKey: 'status' },
          { title: 'Supervisor', dataKey: 'floorSup' },
          { title: 'End-Line QC', dataKey: 'endLineQc' },
          { title: 'Delay', dataKey: 'delay' }
        ];

        var tableBody = filteredRows.map(function (row, i) {
          return {
            idx: String(i + 1),
            batchNo: String(row[1] || ''),
            unit: String(row[4] || ''),
            fabricator: String(row[5] || ''),
            brand: String(row[6] || ''),
            sku: String(row[9] || ''),
            style: String(row[10] || ''),
            colour: String(row[11] || ''),
            qty: String(row[12] || ''),
            checkedQty: String(row[20] || ''),
            sentWhQty: String(row[21] || ''),
            repairQty: String(row[22] || ''),
            pendingQty: String(row[23] || ''),
            status: String(row[19] || ''),
            floorSup: String(row[15] || ''),
            endLineQc: String(row[29] || ''),
            delay: String(row[28] || '')
          };
        });

        doc.autoTable({
          columns: exportCols,
          body: tableBody,
          startY: 52,
          margin: { left: marginX, right: marginX, bottom: 30 },
          styles: {
            font: fontFamily,
            fontSize: 7.2,
            cellPadding: 3.2,
            lineColor: [203, 213, 225],
            lineWidth: 0.5,
            textColor: [15, 23, 42]
          },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 7.5,
            halign: 'center'
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252]
          },
          columnStyles: {
            idx: { cellWidth: 20, halign: 'center' },
            batchNo: { cellWidth: 62, fontStyle: 'bold' },
            unit: { cellWidth: 30, halign: 'center' },
            fabricator: { cellWidth: 70 },
            brand: { cellWidth: 45 },
            sku: { cellWidth: 42 },
            style: { cellWidth: 55 },
            colour: { cellWidth: 48 },
            qty: { cellWidth: 35, halign: 'right' },
            checkedQty: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
            sentWhQty: { cellWidth: 38, halign: 'right' },
            repairQty: { cellWidth: 38, halign: 'right' },
            pendingQty: { cellWidth: 36, halign: 'right' },
            status: { cellWidth: 50, halign: 'center' },
            floorSup: { cellWidth: 65 },
            endLineQc: { cellWidth: 68, fontStyle: 'bold' },
            delay: { cellWidth: 38, halign: 'center' }
          },
          didDrawPage: function (data) {
            var pageCount = doc.internal.getNumberOfPages();
            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text('Page ' + data.pageNumber + ' of ' + pageCount, pageWidth - marginX - 45, pageHeight - 12);
            doc.text('Trio Trend Exports Pvt. Ltd. · End-Line QC Inspection & Production Report · Confidential', marginX, pageHeight - 12);
          }
        });

        var filename = 'End_Line_QC_Report_' + new Date().toISOString().slice(0, 10) + '.pdf';
        doc.save(filename);
        showToast('PDF Export complete: ' + filename, 'download');
        return;
      } catch (err) {
        console.error('jsPDF autoTable export error, falling back to print window:', err);
      }
    }

    // Fallback: Elegant HTML Landscape Print Window with Trio Trend Logo & Dark Header
    try {
      var printWin = window.open('', '_blank', 'width=1200,height=850');
      if (!printWin) {
        showToast('Popup blocked. Please allow popups for PDF download.', 'error');
        return;
      }

      var dateStr = new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var title = 'END-LINE QC INSPECTION & PRODUCTION REPORT';
      var companyLogoUrl = 'https://res.cloudinary.com/dnrgcigsj/image/upload/v1789365942/trio-dark-logo_ayyhkh.svg';

      var theadThs = '<th style="width:30px;">#</th>';
      allHeaders.forEach(function (h) {
        theadThs += '<th>' + escapeHtml(h) + '</th>';
      });

      var tbodyRows = '';
      filteredRows.forEach(function (row, idx) {
        tbodyRows += '<tr><td style="text-align:center;font-weight:700;">' + (idx + 1) + '</td>';
        for (var c = 0; c < NUM_COLS; c++) {
          var cell = (row[c] !== undefined && row[c] !== null) ? String(row[c]) : '';
          tbodyRows += '<td>' + escapeHtml(cell) + '</td>';
        }
        tbodyRows += '</tr>';
      });

      var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<title>' + title + ' - ' + dateStr + '</title>' +
        '<style>' +
        '@page { size: A4 landscape; margin: 6mm 8mm; }' +
        '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }' +
        'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; background: #fff; padding: 12px; }' +
        '.rpt-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; position: relative; }' +
        '.rpt-header::after { content: ""; position: absolute; bottom: -3px; left: 0; right: 0; height: 1.5px; background: linear-gradient(90deg, #d97706 0%, #f59e0b 50%, #d97706 100%); }' +
        '.rpt-brand { display: flex; align-items: center; gap: 10px; }' +
        '.rpt-logo { height: 34px; width: auto; max-width: 120px; object-fit: contain; }' +
        '.rpt-title { font-size: 15px; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }' +
        '.rpt-sub { font-size: 9.5px; color: #475569; font-weight: 700; text-transform: uppercase; margin-top: 1px; }' +
        '.rpt-meta { font-size: 10px; color: #334155; font-weight: 700; text-align: right; }' +
        '.rpt-badge { display: inline-block; background: #0f172a; color: #ffffff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 3px; margin-bottom: 3px; }' +
        'table { width: 100%; border-collapse: collapse; font-size: 7.2px; }' +
        'th, td { border: 1px solid #cbd5e1; padding: 2.5px 3.5px; text-align: left; word-break: break-word; }' +
        'th { background: #0f172a; color: #f8fafc; font-weight: 700; text-transform: uppercase; font-size: 7px; text-align: center; }' +
        'tr:nth-child(even) td { background: #f8fafc; }' +
        '.rpt-footer { margin-top: 10px; display: flex; justify-content: space-between; font-size: 8.5px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 6px; font-weight: 600; }' +
        '@media print { body { padding: 0 !important; } }' +
        '</style></head><body>' +
        '<div class="rpt-header">' +
        '<div class="rpt-brand">' +
        '<img class="rpt-logo" src="' + companyLogoUrl + '" alt="Trio Group" />' +
        '<div>' +
        '<div class="rpt-title">' + title + '</div>' +
        '<div class="rpt-sub">TRIO TREND EXPORTS PVT. LTD. &bull; Quality Assurance Division</div>' +
        '</div>' +
        '</div>' +
        '<div class="rpt-meta">' +
        '<div class="rpt-badge">EXPORT REPORT</div>' +
        '<div>Date: <strong>' + dateStr + '</strong> &bull; Records: <strong>' + filteredRows.length + '</strong></div>' +
        '</div>' +
        '</div>' +
        '<table><thead><tr>' + theadThs + '</tr></thead><tbody>' + tbodyRows + '</tbody></table>' +
        '<div class="rpt-footer">' +
        '<span>Trio Trend Exports Pvt. Ltd. &bull; End-Line QC System &bull; Confidential Document</span>' +
        '<span>Form Ref: FMS-EQC-01</span>' +
        '</div>' +
        '</body></html>';

      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
      printWin.focus();
      setTimeout(function () {
        try { printWin.print(); } catch (e) { }
      }, 400);
    } catch (err) {
      console.error('End-Line QC Table PDF Export Error:', err);
      showToast('Export error: ' + err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 14. Excel Export (.xlsx via SheetJS)
  // ---------------------------------------------------------------------------
  function exportFilteredTableExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS (XLSX) library is loading, please try again.', 'warning');
      return;
    }

    if (filteredRows.length === 0) {
      showToast('No records available to export', 'warning');
      return;
    }

    showToast('Generating Excel file...', 'clock');

    setTimeout(function () {
      try {
        var aoa = [];
        var headersWithIndex = ['#'].concat(allHeaders.slice());
        aoa.push(headersWithIndex);

        filteredRows.forEach(function (row, idx) {
          var excelRow = [idx + 1];
          for (var c = 0; c < NUM_COLS; c++) {
            excelRow.push(row[c] || '');
          }
          aoa.push(excelRow);
        });

        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);

        // Auto-width
        var colWidths = [{ wch: 6 }];
        allHeaders.forEach(function (h, idx) {
          var maxLen = (h || '').length;
          for (var r = 0; r < Math.min(filteredRows.length, 100); r++) {
            var valStr = String(filteredRows[r][idx] || '');
            if (valStr.length > maxLen) maxLen = valStr.length;
          }
          colWidths.push({ wch: Math.min(Math.max(maxLen + 3, 10), 40) });
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'End-Line QC');

        var filename = 'End_Line_QC_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        XLSX.writeFile(wb, filename);

        showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to Excel', 'success');
      } catch (err) {
        console.error('Excel Export Error:', err);
        showToast('Export failed: ' + (err.message || 'Error creating Excel file'), 'error');
      }
    }, 50);
  }

  // ---------------------------------------------------------------------------
  // 15. View Navigation & UI Badges
  // ---------------------------------------------------------------------------
  function showView() {
    var kpiView = document.getElementById('pdf-kpi-view');
    var fsView = document.getElementById('pdf-floor-supervisor-view');
    var iqcView = document.getElementById('pdf-inline-qc-view');
    var eqcView = document.getElementById('pdf-endline-qc-view');
    var epView = document.getElementById('pdf-edge-paint-view');

    if (kpiView) kpiView.style.display = 'none';
    if (fsView) fsView.style.display = 'none';
    if (iqcView) iqcView.style.display = 'none';
    if (eqcView) eqcView.style.display = 'block';
    if (epView) epView.style.display = 'none';

    if (window.FloorSupervisorSheetEngine && typeof window.FloorSupervisorSheetEngine.clearSelection === 'function') {
      window.FloorSupervisorSheetEngine.clearSelection();
    }
    if (window.InLineQcSheetEngine && typeof window.InLineQcSheetEngine.clearSelection === 'function') {
      window.InLineQcSheetEngine.clearSelection();
    }
    if (window.EdgePaintSheetEngine && typeof window.EdgePaintSheetEngine.clearSelection === 'function') {
      window.EdgePaintSheetEngine.clearSelection();
    }

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) {
        filteredRows = allRows.slice();
      }
      renderHeaderRow();
      renderTablePage();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var searchInput = document.getElementById('endline-qc-search-input');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  function hideView() {
    var kpiView = document.getElementById('pdf-kpi-view');
    var eqcView = document.getElementById('pdf-endline-qc-view');
    if (eqcView) eqcView.style.display = 'none';
    if (kpiView) kpiView.style.display = 'block';
    closeColumnFilterPopover();
    clearCellSelection();
    if (typeof applyKpiCardAccess === 'function') {
      applyKpiCardAccess();
    }
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('endline-qc-sheet-db-badge');
    var syncText = document.getElementById('endline-qc-sheet-sync-status');

    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;color:#f59e0b;">bolt</span> ' +
        (allRows.length ? allRows.length.toLocaleString() + ' Rows Cached (Database)' : 'Database Ready');
    }
    if (syncText) {
      if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString() + ')';
        syncText.textContent = 'Last synced: ' + timeStr;
      } else {
        syncText.textContent = 'Not synced yet';
      }
    }
  }

  function updateSyncUI(syncing, msg) {
    var syncBanner = document.getElementById('endline-qc-sheet-sync-banner');
    var syncMsg = document.getElementById('endline-qc-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('endline-qc-sheet-sync-icon');

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
    var existing = document.getElementById('endline-qc-sheet-toast');
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
    toast.id = 'endline-qc-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + type;
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + cleanMsg + '</span>';
    document.body.appendChild(toast);

    setTimeout(function () { toast.classList.add('show'); }, 20);
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3600);
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
  // 16. Event Listeners Setup
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // KPI Card Click in "PDF" page
    var kpiCard = document.getElementById('kpi-pdf-endline-qc');
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

    // Back to PDF Button
    var backBtn = document.getElementById('btn-back-pdf-endline-qc');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      }, true);
    }

    // Sync Button
    var syncBtn = document.getElementById('btn-sync-endline-qc-sheet');
    if (syncBtn) {
      syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        syncFromGoogleSheet(true);
      }, true);
    }

    // Export Excel Button
    var exportBtn = document.getElementById('btn-download-endline-qc-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportFilteredTableExcel();
      }, true);
    }

    // Export Table PDF Button
    var exportPdfBtn = document.getElementById('btn-export-endline-qc-pdf');
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportFilteredTablePdf();
      }, true);
    }

    // Global Search Input
    var searchInput = document.getElementById('endline-qc-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('endline-qc-search-clear');
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
    var pageSizeSelect = document.getElementById('endline-qc-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('btn-first-page-eqc');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('btn-prev-page-eqc');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('btn-next-page-eqc');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('btn-last-page-eqc');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
        }
      });
    }

    var pageInput = document.getElementById('endline-qc-page-input');
    if (pageInput) {
      pageInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (!isNaN(val)) {
          if (val < 1) val = 1;
          if (val > totalPages) val = totalPages;
          currentPage = val;
          renderTablePage();
        }
      });
      pageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') this.blur();
      });
    }

    // Clear All Filters Button
    var clearAllFiltersBtn = document.getElementById('endline-qc-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('endline-qc-filter-pop-close');
    if (popCloseBtn) {
      popCloseBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popSearchInput = document.getElementById('endline-qc-filter-search-input');
    var popSearchClear = document.getElementById('endline-qc-filter-search-clear');
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

    var popSelectAllBtn = document.getElementById('endline-qc-filter-select-all');
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

    var popClearAllBtn = document.getElementById('endline-qc-filter-clear-all');
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
    var sortAscBtn = document.getElementById('endline-qc-sort-asc');
    if (sortAscBtn) {
      sortAscBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var ci = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          var va = a[ci] !== undefined && a[ci] !== null ? String(a[ci]).trim() : '';
          var vb = b[ci] !== undefined && b[ci] !== null ? String(b[ci]).trim() : '';
          if (va === '' && vb !== '') return 1;
          if (va !== '' && vb === '') return -1;
          return va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted column ' + (allHeaders[ci] || '') + ' Ascending', 'sort');
      });
    }

    var sortDescBtn = document.getElementById('endline-qc-sort-desc');
    if (sortDescBtn) {
      sortDescBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var ci = currentFilterColIdx;
        filteredRows.sort(function (a, b) {
          var va = a[ci] !== undefined && a[ci] !== null ? String(a[ci]).trim() : '';
          var vb = b[ci] !== undefined && b[ci] !== null ? String(b[ci]).trim() : '';
          if (va === '' && vb !== '') return 1;
          if (va !== '' && vb === '') return -1;
          return vb.localeCompare(va, undefined, { numeric: true, sensitivity: 'base' });
        });
        currentPage = 1;
        renderTablePage();
        closeColumnFilterPopover();
        showToast('Sorted column ' + (allHeaders[ci] || '') + ' Descending', 'sort');
      });
    }

    // Reset Column Filter
    var resetFilterBtn = document.getElementById('endline-qc-filter-reset-btn');
    if (resetFilterBtn) {
      resetFilterBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          var colName = allHeaders[currentFilterColIdx];
          delete activeColumnFilters[currentFilterColIdx];
          applyAllFiltersAndSearch();
          closeColumnFilterPopover();
          showToast('Reset filter on ' + colName, 'filter');
        }
      });
    }

    // Cancel Popover
    var cancelFilterBtn = document.getElementById('endline-qc-filter-cancel-btn');
    if (cancelFilterBtn) {
      cancelFilterBtn.addEventListener('click', closeColumnFilterPopover);
    }

    // OK Apply Filter
    var okFilterBtn = document.getElementById('endline-qc-filter-ok-btn');
    if (okFilterBtn) {
      okFilterBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        var ci = currentFilterColIdx;
        var totalVals = currentFilterUniqueValues.length;

        if (currentFilterSelectedSet.size >= totalVals) {
          delete activeColumnFilters[ci];
        } else {
          activeColumnFilters[ci] = new Set(currentFilterSelectedSet);
        }

        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Applied filter on ' + (allHeaders[ci] || ''), 'filter');
      });
    }

    // Keyboard Navigation for Table Cells
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('pdf-endline-qc-view');
      if (!view || view.style.display === 'none') return;

      var popover = document.getElementById('endline-qc-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (e.key === 'Escape') closeColumnFilterPopover();
        return;
      }

      if (!selectedCell) return;

      var targetTag = e.target && e.target.tagName;
      if (targetTag === 'INPUT' || targetTag === 'SELECT' || targetTag === 'TEXTAREA') {
        return;
      }

      var r = selectedCell.r;
      var c = selectedCell.c;
      var startIdx = (currentPage - 1) * pageSize;
      var pageRows = filteredRows.slice(startIdx, Math.min(startIdx + pageSize, filteredRows.length));
      var maxR = pageRows.length - 1;
      var maxC = NUM_COLS - 1;

      var handled = false;
      var nextR = r;
      var nextC = c;

      if (e.key === 'ArrowUp') {
        if (r > 0) { nextR = r - 1; handled = true; }
      } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
        if (r < maxR) { nextR = r + 1; handled = true; }
      } else if (e.key === 'ArrowLeft') {
        if (c > 0) { nextC = c - 1; handled = true; }
      } else if (e.key === 'ArrowRight') {
        if (c < maxC) { nextC = c + 1; handled = true; }
      } else if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (c > 0) { nextC = c - 1; handled = true; }
          else if (r > 0) { nextR = r - 1; nextC = maxC; handled = true; }
        } else {
          if (c < maxC) { nextC = c + 1; handled = true; }
          else if (r < maxR) { nextR = r + 1; nextC = 0; handled = true; }
        }
      }

      if (handled) {
        e.preventDefault();
        var tbody = document.getElementById('endline-qc-tbody');
        if (tbody) {
          var targetTd = tbody.querySelector('td.bai-td-data[data-r="' + nextR + '"][data-c="' + nextC + '"]');
          if (targetTd) {
            selectCell(targetTd, nextR, nextC);
          }
        }
      }
    });

    // Copy to Clipboard (Ctrl+C / Cmd+C)
    document.addEventListener('copy', function (e) {
      var view = document.getElementById('pdf-endline-qc-view');
      if (!view || view.style.display === 'none') return;

      if (window.getSelection && window.getSelection().toString().length > 0) {
        return;
      }

      if (selectedCell) {
        var startIdx = (currentPage - 1) * pageSize;
        var row = filteredRows[startIdx + selectedCell.r];
        if (row) {
          var val = row[selectedCell.c];
          var text = (val !== undefined && val !== null) ? String(val).trim() : '';

          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();

            if (selectedCell.el) {
              selectedCell.el.classList.remove('bai-cell-copied');
              void selectedCell.el.offsetWidth;
              selectedCell.el.classList.add('bai-cell-copied');
              setTimeout(function () {
                if (selectedCell && selectedCell.el) selectedCell.el.classList.remove('bai-cell-copied');
              }, 500);
            }

            var displayPreview = text;
            if (displayPreview.length > 35) displayPreview = displayPreview.slice(0, 35) + '...';
            if (displayPreview === '') displayPreview = '(Blank)';
            showToast('Copied: "' + displayPreview + '"', 'copy');
          }
        }
      }
    });

    // Click outside table: clear active selection
    document.addEventListener('mousedown', function (e) {
      if (!selectedCell) return;
      var table = document.getElementById('endline-qc-table');
      if (table && !table.contains(e.target)) {
        clearCellSelection();
      }
    });

    // Escape Key to close popover or clear selection
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('endline-qc-filter-popover');
        if (popover && popover.style.display !== 'none') {
          closeColumnFilterPopover();
        } else if (selectedCell) {
          clearCellSelection();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 17. Bootstrap Engine
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

  // Expose global interface
  window.EndLineQcSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportFilteredTableExcel,
    exportPdf: exportFilteredTablePdf,
    downloadRowPdf: downloadRowInspectionReportPdf,
    buildReportHtml: buildEndLineQcInspectionReportHtml,
    extractRowFields: extractRowFields,
    clearSelection: clearCellSelection,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
