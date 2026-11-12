/**
 * =============================================================================
 * Additional Work & Leave Analysis Live Engine (IndexedDB + Fast Google Sheets CSV)
 * =============================================================================
 * Sheet: Additional Work Details (Spreadsheet ID: 1JwMG1jv7_rVUC4zx3EJy9Do7P1qRJdZWiWpqxRKGzFs)
 * GID: 630622958
 * Range: B2:O (14 Columns)
 * Headers (Row 2):
 *   1. DATE
 *   2. NAME
 *   3. UNIT
 *   4. DEPT
 *   5. START TIME
 *   6. END TIME
 *   7. TOTAL TIME (HRS.)
 *   8. WORK DETAILS
 *   9. Leave After OT (1 Day)
 *   10. Leave After OT (2 Days)
 *   11. Leave After OT (3 Days)
 *   12. OT Before 1 Day of Leave
 *   13. OT Before 2 Days of Leave
 *   14. OT Before 3 Days of Leave
 * Database: IndexedDB 'FMS_Ot_Leave_Analysis_DB_v1'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV Stream Fetch & in-memory parsing from Google Sheet export/GVIZ endpoint
 *   - Real-time client-side search across all 14 columns
 *   - High-contrast Analysis Highlights for flagged rows where ANY of the last 6 columns is "YES"
 *   - Quick Analysis Filter Pills: "All Records" vs "Flagged Anomalies Only (YES)"
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover & Value Search
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Crisp, sharp-cornered non-rounded table layout with clear cell borders
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Excel (.xlsx) Export via SheetJS with styled headers & auto-width columns
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page)
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1JwMG1jv7_rVUC4zx3EJy9Do7P1qRJdZWiWpqxRKGzFs';
  var SHEET_GID = '630622958';
  var SHEET_NAME = 'Additional Work Details';

  var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID + '&range=B2:O';
  var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&range=B2:O';

  var DB_NAME = 'FMS_Ot_Leave_Analysis_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'ot_leave_analysis_store';

  var defaultHeaders = [
    'DATE',
    'NAME',
    'UNIT',
    'DEPT',
    'START TIME',
    'END TIME',
    'TOTAL TIME (HRS.)',
    'WORK DETAILS',
    'Leave After OT (1 Day)',
    'Leave After OT (2 Days)',
    'Leave After OT (3 Days)',
    'OT Before 1 Day of Leave',
    'OT Before 2 Days of Leave',
    'OT Before 3 Days of Leave'
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

  // Analysis filter tab: 'all' or 'flagged'
  var currentAnalysisTab = 'all';

  // Column Filters State
  var activeColumnFilters = {};
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Cell Selection State
  var activeCellCoords = null; // { r: localRowIdx, c: colIdx }

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
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 2. High Performance CSV Stream Parser (14 Columns)
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
          parsedHeaders = curRow.slice(0, 14);
          while (parsedHeaders.length < 14) {
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

        var normalizedRow = new Array(14);
        for (var j = 0; j < 14; j++) {
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
  // 3. Network Fetcher (Primary Export + GViz Fallback)
  // ---------------------------------------------------------------------------
  function fetchGoogleSheetCSV() {
    var ts = Date.now();
    return fetch(PRIMARY_CSV_URL + '&_=' + ts, { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' while downloading Additional Work & Leave Analysis');
        return res.text();
      })
      .then(function (csvText) {
        if (!csvText || csvText.length < 50 || (csvText.indexOf('google.visualization') !== -1 && csvText.indexOf('error') !== -1)) {
          throw new Error('Primary export returned incomplete payload');
        }
        return csvText;
      })
      .catch(function (err) {
        console.warn('[OtLeaveAnalysis] Primary export failed, trying GViz fallback:', err);
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
        updateAnalysisTabCounts();
        updateSyncUI(false);
        showToast('Successfully synced ' + allRows.length.toLocaleString() + ' records', 'success');
      })
      .catch(function (err) {
        console.error('Additional Work & Leave Analysis sync error:', err);
        updateSyncUI(false);
        showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
      })
      .finally(function () {
        isSyncing = false;
      });
  }

  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Additional Work & Leave Analysis from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = cached.headers && cached.headers.length === 14 ? cached.headers : defaultHeaders.slice();
          allRows = cached.rows;
          lastSyncTime = cached.lastSync;

          filteredRows = allRows.slice();
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          updateAnalysisTabCounts();
          updateSyncUI(false);

          // Background auto-refresh
          setTimeout(function () {
            syncFromGoogleSheet(false);
          }, 800);
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
  // 5. Analysis Flag Helpers
  // ---------------------------------------------------------------------------
  // Row is flagged if ANY of the last 6 columns (indices 8 to 13) contains "YES"
  function isRowFlagged(row) {
    if (!row) return false;
    for (var c = 8; c < 14; c++) {
      var val = row[c];
      if (val !== undefined && val !== null && String(val).trim().toUpperCase() === 'YES') {
        return true;
      }
    }
    return false;
  }

  function countFlaggedRows(rows) {
    var count = 0;
    for (var i = 0; i < rows.length; i++) {
      if (isRowFlagged(rows[i])) count++;
    }
    return count;
  }

  function updateAnalysisTabCounts() {
    var totalCount = allRows.length;
    var flaggedCount = countFlaggedRows(allRows);

    var allCountEl = document.getElementById('ot-leave-analysis-pill-all-count');
    var flaggedCountEl = document.getElementById('ot-leave-analysis-pill-flagged-count');

    if (allCountEl) allCountEl.textContent = totalCount.toLocaleString();
    if (flaggedCountEl) flaggedCountEl.textContent = flaggedCount.toLocaleString();
  }

  // ---------------------------------------------------------------------------
  // 6. Header Rendering
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var thead = document.getElementById('ot-leave-analysis-sheet-thead');
    if (!thead) return;

    thead.innerHTML = '';
    var tr = document.createElement('tr');

    // Serial # Header
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

      // Distinguish the 6 Analysis Columns with a special header styling
      if (colIdx >= 8) {
        th.style.background = '#1e1b4b'; // Deep indigo
        th.style.borderBottom = '3px solid #f43f5e'; // Rose bottom border
      }

      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) {
        th.classList.add('has-active-filter');
      }

      var inner = document.createElement('div');
      inner.className = 'bai-sheet-th-content';
      inner.style.display = 'flex';
      inner.style.alignItems = 'center';
      inner.style.justifyContent = 'space-between';
      inner.style.gap = '6px';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-th-title';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));
      labelSpan.title = hName;
      if (colIdx >= 8) {
        labelSpan.style.color = '#fda4af'; // light rose tint
      }

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
  // 7. Filtering & Searching Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('ot-leave-analysis-sheet-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];

    var activeFilterColKeys = Object.keys(activeColumnFilters);

    filteredRows = allRows.filter(function (row) {
      // 1. Analysis Tab Filter (All vs Flagged Only)
      if (currentAnalysisTab === 'flagged') {
        if (!isRowFlagged(row)) return false;
      }

      // 2. Global Search across all 14 columns
      if (searchTokens.length > 0) {
        var rowText = row.join(' ').toLowerCase();
        for (var t = 0; t < searchTokens.length; t++) {
          if (rowText.indexOf(searchTokens[t]) === -1) {
            return false;
          }
        }
      }

      // 3. Parallel Column Filters
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

    var searchClear = document.getElementById('ot-leave-analysis-sheet-search-clear');
    if (searchClear) {
      searchClear.style.display = rawSearch ? 'block' : 'none';
    }
  }

  function updateHeaderFilterIcons() {
    var thead = document.getElementById('ot-leave-analysis-sheet-thead');
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
    var bar = document.getElementById('ot-leave-analysis-sheet-active-filters-bar');
    var container = document.getElementById('ot-leave-analysis-sheet-active-filters-chips');
    if (!bar || !container) return;

    var activeKeys = Object.keys(activeColumnFilters);
    var hasTabFilter = currentAnalysisTab === 'flagged';

    if (activeKeys.length === 0 && !hasTabFilter) {
      bar.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    container.innerHTML = '';

    // If Tab filter is active, show a chip for it
    if (hasTabFilter) {
      var tabChip = document.createElement('div');
      tabChip.className = 'bai-sheet-filter-chip';
      tabChip.style.borderColor = '#fca5a5';
      tabChip.style.background = '#fef2f2';

      var tabTextSpan = document.createElement('span');
      tabTextSpan.className = 'bai-sheet-filter-chip-text';
      tabTextSpan.style.color = '#b91c1c';
      tabTextSpan.textContent = 'Mode: Flagged Anomalies Only (YES)';

      var tabRemoveBtn = document.createElement('button');
      tabRemoveBtn.type = 'button';
      tabRemoveBtn.className = 'bai-sheet-filter-chip-remove';
      tabRemoveBtn.style.color = '#ef4444';
      tabRemoveBtn.title = 'Switch back to all records';
      tabRemoveBtn.innerHTML = '&#x2715;';
      tabRemoveBtn.addEventListener('click', function () {
        setAnalysisTab('all');
      });

      tabChip.appendChild(tabTextSpan);
      tabChip.appendChild(tabRemoveBtn);
      container.appendChild(tabChip);
    }

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

  function setAnalysisTab(tab) {
    currentAnalysisTab = tab;
    var allBtn = document.getElementById('ot-leave-analysis-tab-all');
    var flaggedBtn = document.getElementById('ot-leave-analysis-tab-flagged');

    if (allBtn && flaggedBtn) {
      if (tab === 'flagged') {
        allBtn.classList.remove('active');
        allBtn.style.background = 'transparent';
        allBtn.style.color = '#64748b';
        allBtn.style.boxShadow = 'none';

        flaggedBtn.classList.add('active');
        flaggedBtn.style.background = '#ffffff';
        flaggedBtn.style.color = '#b91c1c';
        flaggedBtn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
      } else {
        flaggedBtn.classList.remove('active');
        flaggedBtn.style.background = 'transparent';
        flaggedBtn.style.color = '#64748b';
        flaggedBtn.style.boxShadow = 'none';

        allBtn.classList.add('active');
        allBtn.style.background = '#ffffff';
        allBtn.style.color = '#0f172a';
        allBtn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
      }
    }

    applyAllFiltersAndSearch();
  }

  // ---------------------------------------------------------------------------
  // 8. Column Filter Popover
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

    var popover = document.getElementById('ot-leave-analysis-sheet-filter-popover');
    var titleEl = document.getElementById('ot-leave-analysis-sheet-filter-pop-title');
    var searchInput = document.getElementById('ot-leave-analysis-sheet-filter-search-input');
    var searchClear = document.getElementById('ot-leave-analysis-sheet-filter-search-clear');

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
    var popover = document.getElementById('ot-leave-analysis-sheet-filter-popover');
    if (popover) {
      popover.style.display = 'none';
    }
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('ot-leave-analysis-sheet-filter-list');
    var countEl = document.getElementById('ot-leave-analysis-sheet-filter-items-count');
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
  // 9. Table Page & Cell Selection Rendering (14 Columns)
  // ---------------------------------------------------------------------------
  function renderEmptyState(msg) {
    var tbody = document.getElementById('ot-leave-analysis-sheet-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="15" class="bai-sheet-table-empty">' +
      '<div class="bai-sheet-empty-wrap" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:40px 10px;">' +
      '<span class="material-icons-round bai-sheet-spin" style="font-size:24px;color:#0284c7;">sync</span>' +
      '<span style="font-size:13px;font-weight:600;color:#64748b;">' + msg + '</span>' +
      '</div></td></tr>';
  }

  function renderTablePage() {
    var tbody = document.getElementById('ot-leave-analysis-sheet-tbody');
    var countLabel = document.getElementById('ot-leave-analysis-sheet-count-label');
    var showingRange = document.getElementById('ot-leave-analysis-sheet-showing-range');
    var totalPagesEl = document.getElementById('ot-leave-analysis-sheet-total-pages');
    var pageNumInput = document.getElementById('ot-leave-analysis-sheet-page-num');

    if (!tbody) return;

    if (filteredRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="15" class="bai-sheet-table-empty">' +
        (allRows.length === 0 ? 'No data in Additional Work & Leave Analysis sheet.' : 'No matching records found.') +
        '</td></tr>';
      if (countLabel) countLabel.textContent = '0 records found';
      if (showingRange) showingRange.textContent = 'Showing 0 - 0 of 0';
      if (totalPagesEl) totalPagesEl.textContent = '1';
      if (pageNumInput) pageNumInput.value = 1;
      updatePaginationButtons(1, 1);
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
    if (showingRange) {
      showingRange.textContent = 'Showing ' + (startIdx + 1).toLocaleString() + ' - ' + endIdx.toLocaleString() + ' of ' + filteredRows.length.toLocaleString();
    }
    if (totalPagesEl) totalPagesEl.textContent = totalPages;
    if (pageNumInput) {
      pageNumInput.value = currentPage;
      pageNumInput.max = totalPages;
    }

    updatePaginationButtons(currentPage, totalPages);

    var fragment = document.createDocumentFragment();

    pageRows.forEach(function (row, localRowIdx) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-r', localRowIdx);

      var flagged = isRowFlagged(row);
      if (flagged) {
        tr.className = 'bai-row-flagged-red';
        tr.style.background = '#fff1f2'; // Soft rose highlight
        tr.style.borderLeft = '3px solid #f43f5e'; // Distinct red anomaly bar
      }

      // Serial # Cell
      var tdNum = document.createElement('td');
      tdNum.className = 'bai-sheet-td-index';
      tdNum.textContent = (startIdx + localRowIdx + 1).toLocaleString();
      tdNum.style.textAlign = 'center';
      tdNum.style.color = flagged ? '#b91c1c' : '#64748b';
      tdNum.style.fontWeight = '700';
      tdNum.style.background = flagged ? '#ffe4e6' : '#f8fafc';
      tdNum.style.borderRight = '1px solid #e2e8f0';
      tr.appendChild(tdNum);

      // 14 Data Columns (B to O)
      row.forEach(function (val, colIdx) {
        var td = document.createElement('td');
        td.setAttribute('data-r', localRowIdx);
        td.setAttribute('data-c', colIdx);

        // Highlight selected cell
        if (activeCellCoords && activeCellCoords.r === localRowIdx && activeCellCoords.c === colIdx) {
          td.classList.add('bai-cell-selected');
        }

        var strVal = (val !== undefined && val !== null) ? String(val).trim() : '';

        // Visual distinction per column:
        if (colIdx === 0) { // Date
          td.style.fontWeight = '700';
          td.style.color = '#0369a1';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 1) { // Name
          td.style.fontWeight = '700';
          td.style.color = '#0f172a';
          td.textContent = strVal;
        } else if (colIdx === 2) { // Unit
          td.style.fontWeight = '700';
          td.style.color = '#15803d';
          td.textContent = strVal;
        } else if (colIdx === 3) { // Dept
          td.style.fontWeight = '600';
          td.style.color = '#7e22ce';
          td.textContent = strVal;
        } else if (colIdx === 4 || colIdx === 5) { // Start/End time
          td.style.color = '#475569';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 6) { // Total Time
          td.style.fontWeight = '700';
          td.style.color = '#c2410c';
          td.style.whiteSpace = 'nowrap';
          td.textContent = strVal;
        } else if (colIdx === 7) { // Work Details
          td.style.color = '#334155';
          td.style.minWidth = '220px';
          td.textContent = strVal;
        } else if (colIdx >= 8) { // Analysis Columns (8 to 13)
          td.style.textAlign = 'center';
          td.style.whiteSpace = 'nowrap';
          if (strVal.toUpperCase() === 'YES') {
            td.innerHTML = '<span class="bai-analysis-badge-yes" style="background:#fee2e2; color:#b91c1c; border:1px solid #f87171; border-radius:3px; padding:2px 8px; font-weight:800; font-size:11px; display:inline-flex; align-items:center; gap:4px; box-shadow:0 1px 2px rgba(239,68,68,0.15);">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
              'YES</span>';
          } else {
            td.innerHTML = '<span style="color:#cbd5e1; font-weight:400;">&ndash;</span>';
          }
        } else {
          td.textContent = strVal;
        }

        // Click to select cell
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
    var firstBtn = document.getElementById('ot-leave-analysis-sheet-first-page');
    var prevBtn = document.getElementById('ot-leave-analysis-sheet-prev-page');
    var nextBtn = document.getElementById('ot-leave-analysis-sheet-next-page');
    var lastBtn = document.getElementById('ot-leave-analysis-sheet-last-page');

    if (firstBtn) firstBtn.disabled = current <= 1;
    if (prevBtn) prevBtn.disabled = current <= 1;
    if (nextBtn) nextBtn.disabled = current >= total;
    if (lastBtn) lastBtn.disabled = current >= total;
  }

  // ---------------------------------------------------------------------------
  // 10. Interactive Cell Selection & Keyboard Navigation
  // ---------------------------------------------------------------------------
  function selectCellByCoords(localRowIdx, colIdx) {
    var tbody = document.getElementById('ot-leave-analysis-sheet-tbody');
    if (!tbody) return;

    var startIdx = (currentPage - 1) * pageSize;
    var pageRows = filteredRows.slice(startIdx, Math.min(startIdx + pageSize, filteredRows.length));
    if (localRowIdx < 0 || localRowIdx >= pageRows.length || colIdx < 0 || colIdx >= allHeaders.length) {
      return;
    }

    if (activeCellCoords) {
      var prevCell = tbody.querySelector('td[data-r="' + activeCellCoords.r + '"][data-c="' + activeCellCoords.c + '"]');
      if (prevCell) prevCell.classList.remove('bai-cell-selected');
    }

    activeCellCoords = { r: localRowIdx, c: colIdx };

    var newCell = tbody.querySelector('td[data-r="' + localRowIdx + '"][data-c="' + colIdx + '"]');
    if (newCell) {
      newCell.classList.add('bai-cell-selected');
      if (newCell.scrollIntoViewIfNeeded) {
        newCell.scrollIntoViewIfNeeded(false);
      } else {
        newCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    var badge = document.getElementById('ot-leave-analysis-sheet-active-cell-badge');
    if (badge) {
      var colName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
      var actualRow = startIdx + localRowIdx + 1;
      badge.textContent = 'Selected: Row ' + actualRow + ', Col: ' + colName;
      badge.style.display = 'inline-block';
    }
  }

  function clearCellSelection() {
    if (activeCellCoords) {
      var tbody = document.getElementById('ot-leave-analysis-sheet-tbody');
      if (tbody) {
        var prevCell = tbody.querySelector('td[data-r="' + activeCellCoords.r + '"][data-c="' + activeCellCoords.c + '"]');
        if (prevCell) prevCell.classList.remove('bai-cell-selected');
      }
      activeCellCoords = null;
    }
    var badge = document.getElementById('ot-leave-analysis-sheet-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // 11. Excel Export (SheetJS)
  // ---------------------------------------------------------------------------
  function exportExcelXLSX() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS (XLSX) library is loading, please try again in a moment.', 'warning');
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
          for (var c = 0; c < allHeaders.length; c++) {
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
          colWidths.push({ wch: Math.min(Math.max(maxLen + 3, 10), 45) });
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'OT & Leave Analysis');

        var filename = 'Additional_Work_Leave_Analysis_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        XLSX.writeFile(wb, filename);

        showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to Excel', 'success');
      } catch (err) {
        console.error('Excel Export Error:', err);
        showToast('Export failed: ' + (err.message || 'Error creating Excel file'), 'error');
      }
    }, 50);
  }

  // ---------------------------------------------------------------------------
  // 12. View Navigation & UI Badges
  // ---------------------------------------------------------------------------
  function showView() {
    var analysisView = document.getElementById('ot-leave-analysis-view');
    var kpiView = document.getElementById('ot-leave-kpi-view');
    var otDetailsView = document.getElementById('ot-details-view');
    var leaveView = document.getElementById('leave-details-view');

    if (kpiView) kpiView.style.display = 'none';
    if (otDetailsView) otDetailsView.style.display = 'none';
    if (leaveView) leaveView.style.display = 'none';
    if (analysisView) analysisView.style.display = '';

    if (window.AdditionalWorkSheetEngine && typeof window.AdditionalWorkSheetEngine.clearSelection === 'function') {
      window.AdditionalWorkSheetEngine.clearSelection();
    }
    if (window.LeaveDetailsSheetEngine && typeof window.LeaveDetailsSheetEngine.clearSelection === 'function') {
      window.LeaveDetailsSheetEngine.clearSelection();
    }

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) {
        filteredRows = allRows.slice();
      }
      renderHeaderRow();
      renderTablePage();
      updateAnalysisTabCounts();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var searchInput = document.getElementById('ot-leave-analysis-sheet-search-input');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  function hideView() {
    var analysisView = document.getElementById('ot-leave-analysis-view');
    var kpiView = document.getElementById('ot-leave-kpi-view');
    if (analysisView) analysisView.style.display = 'none';
    if (kpiView) kpiView.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
    if (typeof applyKpiCardAccess === 'function') {
      applyKpiCardAccess();
    }
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('ot-leave-analysis-sheet-db-badge');
    var syncText = document.getElementById('ot-leave-analysis-sheet-last-sync-text');

    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;color:#38bdf8;">bolt</span> ' +
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
    var syncBanner = document.getElementById('ot-leave-analysis-sheet-sync-banner');
    var syncMsg = document.getElementById('ot-leave-analysis-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('ot-leave-analysis-sheet-sync-icon');

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
    var existing = document.getElementById('ot-leave-analysis-sheet-toast');
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
    toast.id = 'ot-leave-analysis-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast--' + type;
    toast.innerHTML = '<span class="bai-sheet-toast-icon">' + iconSvg + '</span><span class="bai-sheet-toast-msg">' + cleanMsg + '</span>';
    document.body.appendChild(toast);

    setTimeout(function () { toast.classList.add('show'); }, 20);
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3600);
  }

  // ---------------------------------------------------------------------------
  // 13. Event Listeners Setup
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // KPI Card Click in "Additional Work & Leave" page
    var kpiCard = document.getElementById('kpi-ot-leave-analysis');
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

    // Back Button
    var backBtn = document.getElementById('btn-back-ot-leave-analysis');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideView();
      }, true);
    }

    // Refresh / Sync Button
    var syncBtn = document.getElementById('btn-refresh-ot-leave-analysis-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        syncFromGoogleSheet(true);
      }, true);
    }

    // Export Excel Button
    var exportBtn = document.getElementById('btn-download-ot-leave-analysis-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportExcelXLSX();
      }, true);
    }

    // Analysis Pills Toggle
    var allTabBtn = document.getElementById('ot-leave-analysis-tab-all');
    if (allTabBtn) {
      allTabBtn.addEventListener('click', function () {
        setAnalysisTab('all');
      });
    }

    var flaggedTabBtn = document.getElementById('ot-leave-analysis-tab-flagged');
    if (flaggedTabBtn) {
      flaggedTabBtn.addEventListener('click', function () {
        setAnalysisTab('flagged');
      });
    }

    // Global Search Input
    var searchInput = document.getElementById('ot-leave-analysis-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('ot-leave-analysis-sheet-search-clear');
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
    var pageSizeSelect = document.getElementById('ot-leave-analysis-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('ot-leave-analysis-sheet-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('ot-leave-analysis-sheet-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('ot-leave-analysis-sheet-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('ot-leave-analysis-sheet-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
        }
      });
    }

    var pageNumInput = document.getElementById('ot-leave-analysis-sheet-page-num');
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
        if (e.key === 'Enter') this.blur();
      });
    }

    // Clear All Filters Button
    var clearAllFiltersBtn = document.getElementById('ot-leave-analysis-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        currentAnalysisTab = 'all';
        var allBtn = document.getElementById('ot-leave-analysis-tab-all');
        var flaggedBtn = document.getElementById('ot-leave-analysis-tab-flagged');
        if (allBtn && flaggedBtn) {
          flaggedBtn.classList.remove('active');
          flaggedBtn.style.background = 'transparent';
          flaggedBtn.style.color = '#64748b';
          flaggedBtn.style.boxShadow = 'none';

          allBtn.classList.add('active');
          allBtn.style.background = '#ffffff';
          allBtn.style.color = '#0f172a';
          allBtn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
        }
        applyAllFiltersAndSearch();
        showToast('All column and analysis filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('ot-leave-analysis-sheet-filter-pop-close');
    if (popCloseBtn) {
      popCloseBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popSearchInput = document.getElementById('ot-leave-analysis-sheet-filter-search-input');
    var popSearchClear = document.getElementById('ot-leave-analysis-sheet-filter-search-clear');
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

    var popSelectAllBtn = document.getElementById('ot-leave-analysis-sheet-filter-select-all');
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

    var popClearAllBtn = document.getElementById('ot-leave-analysis-sheet-filter-clear-all');
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
    var sortAscBtn = document.getElementById('ot-leave-analysis-sheet-sort-asc');
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

    var sortDescBtn = document.getElementById('ot-leave-analysis-sheet-sort-desc');
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
    var resetFilterBtn = document.getElementById('ot-leave-analysis-sheet-filter-reset-btn');
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
    var cancelFilterBtn = document.getElementById('ot-leave-analysis-sheet-filter-cancel-btn');
    if (cancelFilterBtn) {
      cancelFilterBtn.addEventListener('click', closeColumnFilterPopover);
    }

    // OK Apply Filter
    var okFilterBtn = document.getElementById('ot-leave-analysis-sheet-filter-ok-btn');
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
      var view = document.getElementById('ot-leave-analysis-view');
      if (!view || view.style.display === 'none') return;

      var popover = document.getElementById('ot-leave-analysis-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (e.key === 'Escape') closeColumnFilterPopover();
        return;
      }

      if (!activeCellCoords) return;

      // Ignore when typing inside search inputs
      var targetTag = e.target && e.target.tagName;
      if (targetTag === 'INPUT' || targetTag === 'SELECT' || targetTag === 'TEXTAREA') {
        return;
      }

      var r = activeCellCoords.r;
      var c = activeCellCoords.c;
      var startIdx = (currentPage - 1) * pageSize;
      var pageRows = filteredRows.slice(startIdx, Math.min(startIdx + pageSize, filteredRows.length));
      var maxR = pageRows.length - 1;
      var maxC = allHeaders.length - 1;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (r > 0) selectCellByCoords(r - 1, c);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (r < maxR) selectCellByCoords(r + 1, c);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (c > 0) selectCellByCoords(r, c - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (c < maxC) selectCellByCoords(r, c + 1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          if (c > 0) selectCellByCoords(r, c - 1);
          else if (r > 0) selectCellByCoords(r - 1, maxC);
        } else {
          if (c < maxC) selectCellByCoords(r, c + 1);
          else if (r < maxR) selectCellByCoords(r + 1, 0);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (r < maxR) selectCellByCoords(r + 1, c);
      }
    });

    // Copy to Clipboard (Ctrl+C / Cmd+C)
    document.addEventListener('copy', function (e) {
      var view = document.getElementById('ot-leave-analysis-view');
      if (!view || view.style.display === 'none') return;

      if (window.getSelection && window.getSelection().toString().length > 0) {
        return; // Allow native copy of highlight text
      }

      if (activeCellCoords) {
        var startIdx = (currentPage - 1) * pageSize;
        var row = filteredRows[startIdx + activeCellCoords.r];
        if (row) {
          var val = row[activeCellCoords.c];
          var text = (val !== undefined && val !== null) ? String(val).trim() : '';

          var tbody = document.getElementById('ot-leave-analysis-sheet-tbody');
          var selectedCell = tbody ? tbody.querySelector('.bai-cell-selected') : null;

          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();

            if (selectedCell) {
              selectedCell.classList.remove('bai-cell-copied');
              void selectedCell.offsetWidth;
              selectedCell.classList.add('bai-cell-copied');
              setTimeout(function () {
                selectedCell.classList.remove('bai-cell-copied');
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
      if (!activeCellCoords) return;
      var table = document.getElementById('ot-leave-analysis-sheet-table');
      if (table && !table.contains(e.target)) {
        clearCellSelection();
      }
    });

    // Escape Key to close popover or clear selection
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('ot-leave-analysis-sheet-filter-popover');
        if (popover && popover.style.display !== 'none') {
          closeColumnFilterPopover();
        } else if (activeCellCoords) {
          clearCellSelection();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 14. Bootstrap Engine
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = (cached.headers && cached.headers.length === 14) ? cached.headers : defaultHeaders.slice();
        allRows = cached.rows;
        lastSyncTime = cached.lastSync;
        filteredRows = allRows.slice();
        updateHeaderBadge();
        updateAnalysisTabCounts();
      }
    }).catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Global Engine Interface
  var engineAPI = {
    init: start,
    show: showView,
    hide: hideView,
    clearSelection: clearCellSelection,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

  window.OtLeaveAnalysisSheetEngine = engineAPI;
  window.AdditionalWorkLeaveAnalysisSheetEngine = engineAPI;

})();
