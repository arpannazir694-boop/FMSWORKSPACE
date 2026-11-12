/**
 * =============================================================================
 * Monthly Machine Inactivity Details Live Engine (IndexedDB + Google Sheets CSV)
 * =============================================================================
 * Spreadsheet ID: 1mEu7tllGicKVcbL-UWVis67uXnveXiLu1eBFljbThtU
 * Sheet Name: Monthly Machine Inactivity (Data)
 * Range: B3:E (4 Columns: Off Date, Month, Off Day, Status)
 * Row 3: Header Row
 * Database: IndexedDB 'FMS_Monthly_Machine_Inactivity_DB_v1'
 * =============================================================================
 */

(function () {
  'use strict';

  var SPREADSHEET_ID = '1mEu7tllGicKVcbL-UWVis67uXnveXiLu1eBFljbThtU';
  var SHEET_NAME = 'Monthly Machine Inactivity (Data)';
  var CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(SHEET_NAME) + '&range=B3:E';
  var GAS_FALLBACK_URL = 'https://script.google.com/macros/s/AKfycbxhrqvWSNWT62dk_nfAavlXAXYVIwM2qX4KSaLnP-mWyt98dAYgD-NpOuUEFn2jHyI/exec?action=getMonthlyMachineInactivityData';

  var DB_NAME = 'FMS_Monthly_Machine_Inactivity_DB_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'monthly_inactivity_store';

  var defaultHeaders = ['Off Date', 'Month', 'Off Day', 'Status'];

  // State
  var dbInstance = null;
  var allHeaders = defaultHeaders.slice();
  var allRows = [];
  var filteredRows = [];
  var currentPage = 1;
  var pageSize = 100;
  var isSyncing = false;
  var lastSyncTime = null;

  // Sorting State
  var sortColumn = -1;
  var sortAsc = true;

  // Column Filters State
  var activeColumnFilters = {};
  var currentFilterColIdx = null;
  var currentFilterUniqueValues = [];
  var currentFilterValueCounts = {};
  var currentFilterSelectedSet = new Set();
  var currentFilterSearchQuery = '';

  // Cell Selection State
  var activeCellCoords = null;

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Storage
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
  // 2. High Performance CSV Stream Parser (Columns B3:E -> 4 columns)
  // ---------------------------------------------------------------------------
  function parseCSVStream(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;
    var NUM_COLS = 4;

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
          if (i + 1 < len && csvText[i + 1] === '\n') i++;
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
          var parsed = curRow.slice(0, NUM_COLS);
          while (parsed.length < NUM_COLS) {
            parsed.push(defaultHeaders[parsed.length] || ('Col ' + (parsed.length + 1)));
          }
          allHeaders = parsed;
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
        var normalized = new Array(NUM_COLS);
        for (var j = 0; j < NUM_COLS; j++) {
          normalized[j] = (curRow[j] !== undefined && curRow[j] !== null) ? curRow[j] : '';
        }
        rows.push(normalized);
      }
      curRow = [];
    }

    return { headers: allHeaders, rows: rows };
  }

  // ---------------------------------------------------------------------------
  // 3. Network Fetcher (GViz CSV with GAS Fallback)
  // ---------------------------------------------------------------------------
  function fetchGoogleSheetData() {
    return fetch(CSV_URL + '&_=' + Date.now(), { method: 'GET', cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('GViz CSV returned HTTP ' + res.status);
        return res.text();
      })
      .then(function (csvText) {
        var result = parseCSVStream(csvText);
        if (result.rows && result.rows.length > 0) return result;
        throw new Error('CSV returned empty rows');
      })
      .catch(function (err) {
        console.warn('GViz CSV fetch failed, falling back to Apps Script endpoint:', err);
        return fetch(GAS_FALLBACK_URL + '&_=' + Date.now(), { method: 'GET', cache: 'no-cache' })
          .then(function (res) {
            if (!res.ok) throw new Error('Apps Script returned HTTP ' + res.status);
            return res.json();
          })
          .then(function (json) {
            if (!json || !json.success) {
              throw new Error((json && json.error) || 'Failed to fetch from Apps Script endpoint');
            }
            return {
              headers: (json.headers && json.headers.length >= 4) ? json.headers.slice(0, 4) : defaultHeaders.slice(),
              rows: json.rows || []
            };
          });
      });
  }

  // ---------------------------------------------------------------------------
  // 4. Background Sync & Cache Orchestration
  // ---------------------------------------------------------------------------
  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, isManual ? 'Connecting to Google Sheets...' : 'Checking for sheet updates...');

    fetchGoogleSheetData()
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
        showToast('Successfully synced ' + allRows.length.toLocaleString() + ' inactivity records', 'success');
      })
      .catch(function (err) {
        console.error('Monthly Machine Inactivity Data sync error:', err);
        updateSyncUI(false);
        showToast('Sync error: ' + (err.message || 'Check connection'), 'error');
      })
      .finally(function () { isSyncing = false; });
  }

  function initDataEngine() {
    renderHeaderRow();
    renderEmptyState('Loading Monthly Inactivity Details from local cache...');
    updateSyncUI(true, 'Reading local cache...');

    loadFromCache()
      .then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
          allHeaders = (cached.headers && cached.headers.length === 4) ? cached.headers : defaultHeaders.slice();
          allRows = cached.rows;
          lastSyncTime = cached.lastSync;
          filteredRows = allRows.slice();
          renderHeaderRow();
          renderTablePage();
          updateHeaderBadge();
          updateSyncUI(false);
          setTimeout(function () { syncFromGoogleSheet(false); }, 800);
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
    var thead = document.getElementById('monthly-inactivity-sheet-thead');
    if (!thead) return;
    thead.innerHTML = '';
    var tr = document.createElement('tr');

    // Serial # Column Header (Compact 38px)
    var thIndex = document.createElement('th');
    thIndex.className = 'bai-sheet-th-index';
    thIndex.textContent = '#';
    thIndex.style.cssText = 'width:38px!important;min-width:38px!important;max-width:42px!important;padding:8px 4px!important;text-align:center!important;white-space:nowrap!important;background:#091729!important;color:#94a3b8!important;border-right:2px solid #334155!important;';
    tr.appendChild(thIndex);

    allHeaders.forEach(function (hName, colIdx) {
      var th = document.createElement('th');
      th.className = 'bai-sheet-th-filterable';
      th.setAttribute('data-col-idx', colIdx);
      th.style.cssText = 'white-space:nowrap!important;padding:8px 12px!important;vertical-align:middle!important;';
      var hasFilter = activeColumnFilters[colIdx] && activeColumnFilters[colIdx].size > 0;
      if (hasFilter) th.classList.add('has-active-filter');

      var inner = document.createElement('div');
      inner.className = 'bai-sheet-th-content';
      inner.style.cssText = 'display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;width:100%!important;white-space:nowrap!important;box-sizing:border-box!important;';

      var labelSpan = document.createElement('span');
      labelSpan.className = 'bai-sheet-th-title';
      labelSpan.textContent = hName || ('Col ' + (colIdx + 1));
      labelSpan.title = hName;
      labelSpan.style.cssText = 'flex:1 1 auto!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;cursor:pointer!important;user-select:none!important;font-size:11.5px!important;font-weight:700!important;';
      labelSpan.addEventListener('click', function () {
        toggleColumnSort(colIdx);
      });

      var iconsWrap = document.createElement('div');
      iconsWrap.className = 'bai-sheet-th-icons';
      iconsWrap.style.cssText = 'display:inline-flex!important;flex-direction:row!important;align-items:center!important;gap:4px!important;flex-shrink:0!important;white-space:nowrap!important;';

      // Sort indicator icon
      var sortIcon = document.createElement('span');
      sortIcon.className = 'material-icons-round bai-sheet-sort-icon';
      sortIcon.style.cssText = 'cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:18px!important;height:18px!important;font-size:16px!important;line-height:1!important;user-select:none!important;flex-shrink:0!important;';
      if (sortColumn === colIdx) {
        sortIcon.textContent = sortAsc ? 'arrow_upward' : 'arrow_downward';
        sortIcon.style.opacity = '1';
        sortIcon.style.color = '#a78bfa';
      } else {
        sortIcon.textContent = 'unfold_more';
        sortIcon.style.opacity = '0.45';
        sortIcon.style.color = '#94a3b8';
      }
      sortIcon.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleColumnSort(colIdx);
      });

      // Filter Button
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

      iconsWrap.appendChild(sortIcon);
      iconsWrap.appendChild(filterBtn);

      inner.appendChild(labelSpan);
      inner.appendChild(iconsWrap);
      th.appendChild(inner);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
  }

  // ---------------------------------------------------------------------------
  // 6. Sorting Engine
  // ---------------------------------------------------------------------------
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
  }

  function sortDataRows(rows) {
    if (sortColumn === -1) return rows;
    var ci = sortColumn;
    var asc = sortAsc;

    return rows.slice().sort(function (rowA, rowB) {
      var valA = (rowA[ci] !== undefined && rowA[ci] !== null) ? String(rowA[ci]).trim() : '';
      var valB = (rowB[ci] !== undefined && rowB[ci] !== null) ? String(rowB[ci]).trim() : '';

      if (valA === '' && valB === '') return 0;
      if (valA === '') return 1;
      if (valB === '') return -1;

      // Chronological parsing for Date column (Off Date in DD/MM/YYYY)
      if (ci === 0) {
        var dMatchA = valA.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        var dMatchB = valB.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (dMatchA && dMatchB) {
          var tA = new Date(parseInt(dMatchA[3], 10), parseInt(dMatchA[2], 10) - 1, parseInt(dMatchA[1], 10)).getTime();
          var tB = new Date(parseInt(dMatchB[3], 10), parseInt(dMatchB[2], 10) - 1, parseInt(dMatchB[1], 10)).getTime();
          return asc ? tA - tB : tB - tA;
        }
      }

      var cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      return asc ? cmp : -cmp;
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Filtering & Searching Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('monthly-inactivity-sheet-search-input');
    var rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var searchTokens = rawSearch ? rawSearch.split(/\s+/).filter(Boolean) : [];
    var activeFilterColKeys = Object.keys(activeColumnFilters);

    var matching = allRows.filter(function (row) {
      if (searchTokens.length > 0) {
        var rowText = row.join(' ').toLowerCase();
        for (var t = 0; t < searchTokens.length; t++) {
          if (rowText.indexOf(searchTokens[t]) === -1) return false;
        }
      }
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

    filteredRows = sortDataRows(matching);
    currentPage = 1;
    renderHeaderRow();
    renderTablePage();
    renderActiveFilterChips();
    updateHeaderFilterIcons();

    var searchClear = document.getElementById('monthly-inactivity-sheet-search-clear');
    if (searchClear) searchClear.style.display = (searchInput && searchInput.value) ? 'block' : 'none';
  }

  function updateHeaderFilterIcons() {
    var thead = document.getElementById('monthly-inactivity-sheet-thead');
    if (!thead) return;
    thead.querySelectorAll('th').forEach(function (th) {
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
    var bar = document.getElementById('monthly-inactivity-sheet-active-filters-bar');
    var container = document.getElementById('monthly-inactivity-sheet-active-filters-chips');
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
      chip.className = 'bai-sheet-filter-chip';
      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-chip-text';
      textSpan.textContent = colName + ' (' + allowedSet.size + '/' + totalVals + ')';
      textSpan.title = colName + ': ' + Array.from(allowedSet).slice(0, 5).join(', ') + (allowedSet.size > 5 ? '...' : '');
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bai-sheet-filter-chip-remove';
      removeBtn.title = 'Remove filter for ' + colName;
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', (function (ci, cn) {
        return function () {
          delete activeColumnFilters[ci];
          applyAllFiltersAndSearch();
          showToast('Filter removed on ' + cn, 'filter');
        };
      })(colIdx, colName));
      chip.appendChild(textSpan);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Column Filter Popover Logic
  // ---------------------------------------------------------------------------
  function getUniqueValuesForColumn(colIdx) {
    var counts = {};
    var keys = [];
    allRows.forEach(function (r) {
      var val = (r[colIdx] !== undefined && r[colIdx] !== null) ? String(r[colIdx]).trim() : '';
      if (counts[val] === undefined) {
        counts[val] = 1;
        keys.push(val);
      } else {
        counts[val]++;
      }
    });
    keys.sort(function (a, b) {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    return { keys: keys, counts: counts };
  }

  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    var info = getUniqueValuesForColumn(colIdx);
    currentFilterUniqueValues = info.keys;
    currentFilterValueCounts = info.counts;

    var existingFilter = activeColumnFilters[colIdx];
    if (existingFilter && existingFilter.size > 0) {
      currentFilterSelectedSet = new Set(existingFilter);
    } else {
      currentFilterSelectedSet = new Set(currentFilterUniqueValues);
    }

    currentFilterSearchQuery = '';
    var searchInput = document.getElementById('monthly-inactivity-sheet-filter-search-input');
    if (searchInput) searchInput.value = '';
    var searchClear = document.getElementById('monthly-inactivity-sheet-filter-search-clear');
    if (searchClear) searchClear.style.display = 'none';

    var titleEl = document.getElementById('monthly-inactivity-sheet-filter-pop-title');
    if (titleEl) {
      titleEl.textContent = 'Filter: ' + (allHeaders[colIdx] || ('Col ' + (colIdx + 1)));
    }

    renderFilterList();

    var popover = document.getElementById('monthly-inactivity-sheet-filter-popover');
    if (popover && anchorBtn) {
      popover.style.display = 'flex';
      var rect = anchorBtn.getBoundingClientRect();
      var popWidth = 260;
      var left = rect.right - popWidth;
      if (left < 10) left = 10;
      if (left + popWidth > window.innerWidth - 10) left = window.innerWidth - popWidth - 10;
      var top = rect.bottom + 4;
      if (top + 340 > window.innerHeight) {
        top = Math.max(10, rect.top - 344);
      }
      popover.style.position = 'fixed';
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
      popover.style.zIndex = '99999';

      setTimeout(function () {
        if (searchInput) searchInput.focus();
      }, 50);
    }
  }

  function closeColumnFilterPopover() {
    var popover = document.getElementById('monthly-inactivity-sheet-filter-popover');
    if (popover) popover.style.display = 'none';
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listEl = document.getElementById('monthly-inactivity-sheet-filter-list');
    var countEl = document.getElementById('monthly-inactivity-sheet-filter-items-count');
    if (!listEl) return;
    listEl.innerHTML = '';

    var q = currentFilterSearchQuery.toLowerCase().trim();
    var visibleCount = 0;

    currentFilterUniqueValues.forEach(function (val) {
      var displayVal = val === '' ? '(blanks)' : val;
      if (q && displayVal.toLowerCase().indexOf(q) === -1) return;
      visibleCount++;

      var item = document.createElement('label');
      item.className = 'bai-sheet-filter-item';

      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = currentFilterSelectedSet.has(val);
      chk.addEventListener('change', function () {
        if (this.checked) currentFilterSelectedSet.add(val);
        else currentFilterSelectedSet.delete(val);
      });

      var textSpan = document.createElement('span');
      textSpan.className = 'bai-sheet-filter-item-text';
      textSpan.textContent = displayVal;
      if (val === '') textSpan.style.fontStyle = 'italic';

      var countSpan = document.createElement('span');
      countSpan.className = 'bai-sheet-filter-item-count';
      countSpan.textContent = currentFilterValueCounts[val] || 0;

      item.appendChild(chk);
      item.appendChild(textSpan);
      item.appendChild(countSpan);
      listEl.appendChild(item);
    });

    if (countEl) {
      countEl.textContent = visibleCount + ' of ' + currentFilterUniqueValues.length + ' values';
    }

    if (visibleCount === 0) {
      var emptyNotice = document.createElement('div');
      emptyNotice.className = 'bai-sheet-filter-empty';
      emptyNotice.textContent = 'No matching values';
      listEl.appendChild(emptyNotice);
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Table Page Rendering with Status Badges
  // ---------------------------------------------------------------------------
  function renderTablePage() {
    var tbody = document.getElementById('monthly-inactivity-sheet-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    var totalRows = filteredRows.length;
    var totalPages = Math.ceil(totalRows / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = (currentPage - 1) * pageSize;
    var endIdx = Math.min(startIdx + pageSize, totalRows);
    var pageRows = filteredRows.slice(startIdx, endIdx);

    if (pageRows.length === 0) {
      renderEmptyState(allRows.length === 0 ? 'No inactivity records found in sheet.' : 'No records match the current filter or search.');
      updatePaginationControls(0, 0, 0, 1);
      return;
    }

    var df = document.createDocumentFragment();

    pageRows.forEach(function (row, rowOffset) {
      var globalRowIdx = startIdx + rowOffset;
      var tr = document.createElement('tr');
      tr.setAttribute('data-row-idx', globalRowIdx);

      // Serial Index Cell
      var tdIndex = document.createElement('td');
      tdIndex.className = 'bai-sheet-td-index';
      tdIndex.textContent = globalRowIdx + 1;
      tdIndex.style.cssText = 'width:38px!important;min-width:38px!important;max-width:42px!important;text-align:center!important;padding:6px 2px!important;color:#64748b!important;background:#f8fafc!important;border-right:2px solid #cbd5e1!important;font-weight:600;';
      tr.appendChild(tdIndex);

      row.forEach(function (cellVal, colIdx) {
        var td = document.createElement('td');
        td.setAttribute('data-col-idx', colIdx);
        td.setAttribute('data-row-offset', rowOffset);

        var rawStr = (cellVal !== undefined && cellVal !== null) ? String(cellVal).trim() : '';

        // Status column (colIdx === 3) with distinct badge styling
        if (colIdx === 3) {
          var lowerStatus = rawStr.toLowerCase();
          if (lowerStatus === 'week off') {
            td.innerHTML = '<span style="background:#e0e7ff; color:#3730a3; padding:3px 10px; font-weight:700; font-size:11px; border-radius:4px; display:inline-flex; align-items:center; gap:5px;"><span class="material-icons-round" style="font-size:13px; color:#4f46e5;">beach_access</span> Week Off</span>';
          } else if (lowerStatus === 'inactive') {
            td.innerHTML = '<span style="background:#fee2e2; color:#991b1b; padding:3px 10px; font-weight:700; font-size:11px; border-radius:4px; display:inline-flex; align-items:center; gap:5px;"><span class="material-icons-round" style="font-size:13px; color:#dc2626;">pause_circle</span> Inactive</span>';
          } else if (rawStr) {
            td.innerHTML = '<span style="background:#f1f5f9; color:#334155; padding:3px 8px; font-weight:600; font-size:11px; border-radius:4px;">' + escapeHtml(rawStr) + '</span>';
          } else {
            td.textContent = '';
          }
        } else if (colIdx === 0) {
          // Off Date formatted cleanly
          td.style.fontWeight = '600';
          td.style.color = '#0f172a';
          td.textContent = rawStr;
        } else if (colIdx === 2) {
          // Off Day (e.g. Sunday, Monday)
          td.style.fontWeight = '500';
          td.style.color = '#334155';
          td.textContent = rawStr;
        } else {
          td.textContent = rawStr;
        }

        td.title = rawStr;

        // Cell Click Handler
        td.addEventListener('click', function (e) {
          e.stopPropagation();
          selectCell(td, rowOffset, colIdx, rawStr);
        });

        tr.appendChild(td);
      });

      df.appendChild(tr);
    });

    tbody.appendChild(df);
    updatePaginationControls(startIdx + 1, endIdx, totalRows, totalPages);
  }

  function renderEmptyState(message) {
    var tbody = document.getElementById('monthly-inactivity-sheet-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="bai-sheet-table-empty" style="text-align:center;padding:40px 10px;color:#64748b;font-weight:600;font-size:13px;">' +
      escapeHtml(message) + '</td></tr>';
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Pagination Controls & Counters
  // ---------------------------------------------------------------------------
  function updatePaginationControls(start, end, total, totalPages) {
    var rangeEl = document.getElementById('monthly-inactivity-sheet-showing-range');
    var countLabel = document.getElementById('monthly-inactivity-sheet-count-label');
    var pageNumInput = document.getElementById('monthly-inactivity-sheet-page-num');
    var totalPagesEl = document.getElementById('monthly-inactivity-sheet-total-pages');

    var firstBtn = document.getElementById('monthly-inactivity-sheet-first-page');
    var prevBtn = document.getElementById('monthly-inactivity-sheet-prev-page');
    var nextBtn = document.getElementById('monthly-inactivity-sheet-next-page');
    var lastBtn = document.getElementById('monthly-inactivity-sheet-last-page');

    if (rangeEl) {
      rangeEl.textContent = total > 0 ? ('Showing ' + start + ' - ' + end + ' of ' + total.toLocaleString()) : 'Showing 0 - 0 of 0';
    }

    if (countLabel) {
      if (total === allRows.length) {
        countLabel.textContent = total.toLocaleString() + ' Inactivity Records';
      } else {
        countLabel.textContent = total.toLocaleString() + ' records (filtered from ' + allRows.length.toLocaleString() + ')';
      }
    }

    if (pageNumInput) pageNumInput.value = currentPage;
    if (totalPagesEl) totalPagesEl.textContent = totalPages;

    if (firstBtn) firstBtn.disabled = currentPage <= 1;
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    if (lastBtn) lastBtn.disabled = currentPage >= totalPages;
  }

  // ---------------------------------------------------------------------------
  // 11. Cell Selection & Keyboard Copy
  // ---------------------------------------------------------------------------
  function selectCell(td, rowOffset, colIdx, rawVal) {
    clearCellSelection();
    td.classList.add('bai-cell-selected');
    activeCellCoords = { r: rowOffset, c: colIdx, val: rawVal };

    var badge = document.getElementById('monthly-inactivity-sheet-active-cell-badge');
    if (badge) {
      badge.style.display = 'inline-flex';
      var headerName = allHeaders[colIdx] || ('Col ' + (colIdx + 1));
      var preview = rawVal.length > 25 ? rawVal.slice(0, 25) + '...' : rawVal;
      badge.textContent = headerName + ' [R' + (rowOffset + 1) + ', C' + (colIdx + 1) + ']: ' + (preview || '(blank)');
    }
  }

  function clearCellSelection() {
    activeCellCoords = null;
    var tbody = document.getElementById('monthly-inactivity-sheet-tbody');
    if (tbody) {
      tbody.querySelectorAll('.bai-cell-selected').forEach(function (el) {
        el.classList.remove('bai-cell-selected');
      });
    }
    var badge = document.getElementById('monthly-inactivity-sheet-active-cell-badge');
    if (badge) badge.style.display = 'none';
  }

  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('monthly-inactivity-sheet-tbody');
    if (!tbody) return;
    var tr = tbody.querySelectorAll('tr')[r];
    if (!tr) return;
    var td = tr.querySelectorAll('td[data-col-idx]')[c];
    if (td) {
      var raw = (td.title !== undefined ? td.title : td.textContent || '').trim();
      selectCell(td, r, c, raw);
      td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function flashCopiedCell(cell) {
    if (!cell) return;
    cell.classList.add('bai-cell-copied');
    setTimeout(function () {
      cell.classList.remove('bai-cell-copied');
    }, 450);
  }

  // ---------------------------------------------------------------------------
  // 12. Excel Export (.xlsx)
  // ---------------------------------------------------------------------------
  function exportExcelXLSX() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS (XLSX) library not loaded yet', 'error');
      return;
    }
    if (filteredRows.length === 0) {
      showToast('No records to export', 'warning');
      return;
    }

    showToast('Generating Excel file...', 'info');

    setTimeout(function () {
      try {
        var exportData = [allHeaders.slice()];
        filteredRows.forEach(function (row) {
          exportData.push(row.slice());
        });

        var ws = XLSX.utils.aoa_to_sheet(exportData);

        // Styling column widths
        ws['!cols'] = [
          { wch: 15 }, // Off Date
          { wch: 18 }, // Month
          { wch: 15 }, // Off Day
          { wch: 16 }  // Status
        ];

        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Monthly Inactivity');
        XLSX.writeFile(wb, 'Monthly_Machine_Inactivity_Details_' + new Date().toISOString().slice(0, 10) + '.xlsx');
        showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to Excel', 'success');
      } catch (err) {
        console.error('Excel Export Error:', err);
        showToast('Export failed: ' + (err.message || 'Error'), 'error');
      }
    }, 50);
  }

  // ---------------------------------------------------------------------------
  // 13. View Navigation & UI Badges
  // ---------------------------------------------------------------------------
  function showView() {
    var kpiView = document.getElementById('machine-kpi-view');
    var dieLessSubmenu = document.getElementById('die-less-knife-cutting-machine-details-view');
    var machineDataView = document.getElementById('machine-data-view');
    var monthlyInactivityView = document.getElementById('monthly-machine-inactivity-data-view');
    var repairView = document.getElementById('machine-repairing-details-view');

    if (kpiView) kpiView.style.display = 'none';
    if (dieLessSubmenu) dieLessSubmenu.style.display = 'none';
    if (repairView) repairView.style.display = 'none';
    if (machineDataView) machineDataView.style.display = 'none';
    if (monthlyInactivityView) monthlyInactivityView.style.display = '';

    if (allRows.length > 0) {
      if (!filteredRows || filteredRows.length === 0) filteredRows = allRows.slice();
      renderHeaderRow();
      renderTablePage();
      updateHeaderBadge();
    } else if (!isSyncing) {
      initDataEngine();
    }

    setTimeout(function () {
      var s = document.getElementById('monthly-inactivity-sheet-search-input');
      if (s) s.focus();
    }, 100);
  }

  function hideView() {
    var monthlyInactivityView = document.getElementById('monthly-machine-inactivity-data-view');
    var dieLessSubmenu = document.getElementById('die-less-knife-cutting-machine-details-view');
    if (monthlyInactivityView) monthlyInactivityView.style.display = 'none';
    if (dieLessSubmenu) dieLessSubmenu.style.display = '';
    closeColumnFilterPopover();
    clearCellSelection();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('monthly-inactivity-sheet-db-badge');
    var syncText = document.getElementById('monthly-inactivity-sheet-last-sync-text');
    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px; color:#a78bfa;">bolt</span> ' +
        (allRows.length ? allRows.length.toLocaleString() + ' Rows Cached (Database)' : 'Database Ready');
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
    var syncBanner = document.getElementById('monthly-inactivity-sheet-sync-banner');
    var syncMsg = document.getElementById('monthly-inactivity-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('monthly-inactivity-sheet-sync-icon');
    if (syncBanner) syncBanner.style.display = syncing ? 'flex' : 'none';
    if (syncMsg && msg) syncMsg.textContent = msg;
    if (syncBtnIcon) {
      if (syncing) syncBtnIcon.classList.add('bai-sheet-spin');
      else syncBtnIcon.classList.remove('bai-sheet-spin');
    }
  }

  var SVG_ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  function showToast(msg, customType) {
    var existing = document.getElementById('monthly-inactivity-sheet-toast');
    if (existing) existing.remove();
    var cleanMsg = String(msg || '').replace(/\s+/g, ' ').trim();
    if (!cleanMsg) return;

    var type = 'info';
    var lower = cleanMsg.toLowerCase();
    if (customType) type = customType;
    else if (lower.indexOf('fail') !== -1 || lower.indexOf('error') !== -1) type = 'error';
    else if (lower.indexOf('warn') !== -1) type = 'warning';
    else if (lower.indexOf('copied') !== -1) type = 'copy';
    else if (lower.indexOf('export') !== -1 || lower.indexOf('download') !== -1) type = 'download';
    else if (lower.indexOf('filter') !== -1) type = 'filter';
    else if (lower.indexOf('sync') !== -1 || lower.indexOf('ready') !== -1 || lower.indexOf('succ') !== -1) type = 'check';

    var toast = document.createElement('div');
    toast.id = 'monthly-inactivity-sheet-toast';
    toast.className = 'bai-sheet-toast bai-sheet-toast-' + type;
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999999;display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:0;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.25);background:#0f172a;color:#ffffff;border-left:4px solid #a78bfa;animation:baiToastSlideIn 0.25s ease-out;';
    if (type === 'error') toast.style.borderLeftColor = '#ef4444';
    else if (type === 'warning') toast.style.borderLeftColor = '#f59e0b';
    else if (type === 'copy' || type === 'filter') toast.style.borderLeftColor = '#38bdf8';
    else if (type === 'check') toast.style.borderLeftColor = '#10b981';

    var iconHtml = SVG_ICONS[type] || SVG_ICONS.info;
    toast.innerHTML = '<span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + iconHtml + '</span>' +
      '<span>' + cleanMsg + '</span>';
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 2800);
  }

  // ---------------------------------------------------------------------------
  // 14. Event Listeners & Binding
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // Back button to Die-Less Knife Cutting Machine Details
    var backBtn = document.getElementById('btn-back-monthly-machine-inactivity-data');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        hideView();
        if (typeof showDieLessKnifeCuttingMachineDetailsView === 'function') {
          showDieLessKnifeCuttingMachineDetailsView();
        }
      });
    }

    // Sub-view tab: Switch to Machine Details
    var tabToMachine = document.getElementById('btn-tab-monthly-to-machine-details');
    if (tabToMachine) {
      tabToMachine.addEventListener('click', function () {
        if (window.DieLessCuttingSheetEngine && typeof window.DieLessCuttingSheetEngine.show === 'function') {
          window.DieLessCuttingSheetEngine.show();
        } else if (typeof showMachineDetailView === 'function') {
          showMachineDetailView('machine-data');
        }
      });
    }

    // Refresh / Sync Button
    var refreshBtn = document.getElementById('btn-refresh-monthly-inactivity-data');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () { syncFromGoogleSheet(true); });
    }

    // Excel Export Button
    var exportBtn = document.getElementById('btn-download-monthly-inactivity-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () { exportExcelXLSX(); });
    }

    // Search Input
    var searchInput = document.getElementById('monthly-inactivity-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        applyAllFiltersAndSearch();
      });
    }

    // Search Clear
    var searchClear = document.getElementById('monthly-inactivity-sheet-search-clear');
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
          applyAllFiltersAndSearch();
        }
      });
    }

    // Page Size Select
    var pageSizeSelect = document.getElementById('monthly-inactivity-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination buttons
    var firstBtn = document.getElementById('monthly-inactivity-sheet-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('monthly-inactivity-sheet-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('monthly-inactivity-sheet-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('monthly-inactivity-sheet-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
        }
      });
    }

    // Page Number Input Jump
    var pageNumInput = document.getElementById('monthly-inactivity-sheet-page-num');
    if (pageNumInput) {
      pageNumInput.addEventListener('change', function () {
        var val = parseInt(this.value, 10);
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (val >= 1 && val <= totalPages) {
          currentPage = val;
          renderTablePage();
        } else {
          this.value = currentPage;
        }
      });
    }

    // Clear All Filters
    var clearAllFiltersBtn = document.getElementById('monthly-inactivity-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover controls
    var popCloseBtn = document.getElementById('monthly-inactivity-sheet-filter-pop-close');
    if (popCloseBtn) popCloseBtn.addEventListener('click', closeColumnFilterPopover);

    var popSearchInput = document.getElementById('monthly-inactivity-sheet-filter-search-input');
    var popSearchClear = document.getElementById('monthly-inactivity-sheet-filter-search-clear');
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
          renderFilterList();
        }
      });
    }

    var popSelectAllBtn = document.getElementById('monthly-inactivity-sheet-filter-select-all');
    if (popSelectAllBtn) {
      popSelectAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        currentFilterUniqueValues.forEach(function (val) {
          if (!q || (val === '' ? '(blanks)' : val).toLowerCase().indexOf(q) !== -1) {
            currentFilterSelectedSet.add(val);
          }
        });
        renderFilterList();
      });
    }

    var popClearAllBtn = document.getElementById('monthly-inactivity-sheet-filter-clear-all');
    if (popClearAllBtn) {
      popClearAllBtn.addEventListener('click', function () {
        var q = currentFilterSearchQuery.toLowerCase().trim();
        if (!q) {
          currentFilterSelectedSet.clear();
        } else {
          currentFilterUniqueValues.forEach(function (val) {
            if ((val === '' ? '(blanks)' : val).toLowerCase().indexOf(q) !== -1) {
              currentFilterSelectedSet.delete(val);
            }
          });
        }
        renderFilterList();
      });
    }

    var popResetBtn = document.getElementById('monthly-inactivity-sheet-filter-reset');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          delete activeColumnFilters[currentFilterColIdx];
          closeColumnFilterPopover();
          applyAllFiltersAndSearch();
          showToast('Filter reset for column', 'filter');
        }
      });
    }

    var popOkBtn = document.getElementById('monthly-inactivity-sheet-filter-ok');
    if (popOkBtn) {
      popOkBtn.addEventListener('click', function () {
        if (currentFilterColIdx !== null) {
          if (currentFilterSelectedSet.size === currentFilterUniqueValues.length) {
            delete activeColumnFilters[currentFilterColIdx];
          } else {
            activeColumnFilters[currentFilterColIdx] = new Set(currentFilterSelectedSet);
          }
          closeColumnFilterPopover();
          applyAllFiltersAndSearch();
          showToast('Filter applied', 'filter');
        }
      });
    }

    var popCancelBtn = document.getElementById('monthly-inactivity-sheet-filter-cancel');
    if (popCancelBtn) popCancelBtn.addEventListener('click', closeColumnFilterPopover);

    // Click outside to close popover
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('monthly-inactivity-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Click outside table: clear selection
    document.addEventListener('mousedown', function (e) {
      if (!activeCellCoords) return;
      var tableWrap = document.getElementById('monthly-inactivity-sheet-table-wrapper');
      if (tableWrap && !tableWrap.contains(e.target)) {
        clearCellSelection();
      }
    });

    // Keyboard navigation
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('monthly-machine-inactivity-data-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      var key = e.key;
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Tab' || key === 'Enter') {
        var tbody = document.getElementById('monthly-inactivity-sheet-tbody');
        if (!tbody) return;
        var rowsInPage = tbody.querySelectorAll('tr').length;
        if (rowsInPage === 0) return;
        var colsCount = allHeaders.length;
        var r = activeCellCoords ? activeCellCoords.r : 0;
        var c = activeCellCoords ? activeCellCoords.c : 0;

        if (key === 'ArrowUp') { e.preventDefault(); r = Math.max(0, r - 1); }
        else if (key === 'ArrowDown' || key === 'Enter') { e.preventDefault(); r = Math.min(rowsInPage - 1, r + 1); }
        else if (key === 'ArrowLeft') { e.preventDefault(); c = Math.max(0, c - 1); }
        else if (key === 'ArrowRight') { e.preventDefault(); c = Math.min(colsCount - 1, c + 1); }
        else if (key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) { c--; if (c < 0) { c = colsCount - 1; r = Math.max(0, r - 1); } }
          else { c++; if (c >= colsCount) { c = 0; r = Math.min(rowsInPage - 1, r + 1); } }
        }
        selectCellByCoords(r, c);
      }
    });

    // Native copy event
    document.addEventListener('copy', function (e) {
      var view = document.getElementById('monthly-machine-inactivity-data-view');
      if (!view || view.style.display === 'none') return;
      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('monthly-inactivity-sheet-tbody');
        if (!tbody) return;
        var selectedCell = tbody.querySelector('.bai-cell-selected');
        if (selectedCell) {
          var text = (selectedCell.title !== undefined && selectedCell.title !== '') ? selectedCell.title : (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
          if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();
            flashCopiedCell(selectedCell);
            var preview = text.length > 35 ? text.slice(0, 35) + '...' : text;
            if (preview === '') preview = '(Blank)';
            showToast('Copied: "' + preview + '"', 'copy');
          }
        }
      }
    });

    // Escape Key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('monthly-inactivity-sheet-filter-popover');
        if (popover && popover.style.display !== 'none') closeColumnFilterPopover();
        else if (activeCellCoords) clearCellSelection();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 15. Bootstrap & Export
  // ---------------------------------------------------------------------------
  function start() {
    bindEvents();
    loadFromCache().then(function (cached) {
      if (cached && cached.rows && cached.rows.length > 0) {
        allHeaders = (cached.headers && cached.headers.length === 4) ? cached.headers : defaultHeaders.slice();
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

  window.MonthlyMachineInactivitySheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; },
    setRows: function (headers, rows) {
      if (headers) allHeaders = headers;
      if (rows) {
        allRows = rows;
        filteredRows = rows.slice();
        renderHeaderRow();
        renderTablePage();
        updateHeaderBadge();
      }
    }
  };

})();
