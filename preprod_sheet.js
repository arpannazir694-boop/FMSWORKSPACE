/**
 * =============================================================================
 * Pre-Production Data Live Engine (with IndexedDB Fast Cache)
 * =============================================================================
 * Sheet: Pre-Prod Data (Google Sheets)
 * Target Columns: A to W (All 23 Columns)
 * Database: IndexedDB 'FMS_PreProd_DB'
 * Features:
 *   - Instant 0-wait local loading on page open/refresh via IndexedDB
 *   - Fast CSV Stream Fetch & in-memory parsing (~31,000+ rows)
 *   - Instant sub-millisecond client-side Search across all 23 columns
 *   - Google Sheets Style Parallel Multi-Column Filtering with Popover & Value Search
 *   - Active Filter Chips bar with one-click remove & Clear All
 *   - Non-rounded, light theme standard layout with cell borders
 *   - Compact, slightly bold, text-wrapped cells
 *   - Cell-specific conditional styling:
 *       * "Data not found"    -> Red
 *       * "Material Received" -> Green
 *       * "Material Pending"  -> Orange
 *       * "In-Stock"          -> Purple
 *       * "Po not create"     -> Yellow
 *   - Interactive Cell Selection (Mouse click + Arrow Keys: Up/Down/Left/Right/Tab/Enter)
 *   - Ctrl + C / Cmd + C Cell Copy with Flash Animation & SVG Toast (NO emojis!)
 *   - Excel (.xlsx) Export via SheetJS with auto-width columns
 *   - Fast pagination (25, 50, 100, 250, 500 rows per page)
 * =============================================================================
 */

(function () {
  'use strict';

  var SHEET_ID = '1t9llK-HxXXdPxTNj5ncHePZ_UKfrQJC0UJAcMwzr1b8';
  var SHEET_GID = '2084068790';
  var SHEET_NAME = 'Pre-Prod Data';

  var CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID + '&headers=1';

  // Columns A to W (23 columns)
  var WANTED_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];
  var WANTED_COUNT = 23;

  var DB_NAME = 'FMS_PreProd_DB';
  var DB_VERSION = 2;
  var STORE_NAME = 'preprod_store';

  // Default headers if cache not loaded yet
  var defaultHeaders = [
    'BUYER (A)', 'ITB (B)', 'ITB DATE (C)', 'ITB Qty (D)', 'Buyer ETD (E)',
    'Buyer PO (F)', 'PO Confirmation Date (G)', 'INDENT NO. (H)', 'INDENT DATE (I)',
    'Style (J)', 'Colour (K)', 'PRO CODE (L)', 'PROD NAME (M)', 'SUPPLIER NAME (N)',
    'Supplier PO (O)', 'GRN NO. (P)', 'GRN DATE (Q)', 'ORDER QTY (R)', 'ADJ GRN QTY (S)',
    'PENDING QTY (T)', 'Category (U)', 'STORE STATUS (V)', 'Status (W)'
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
      if (dbInstance && dbInstance.objectStoreNames.contains(STORE_NAME)) {
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
      };
      req.onsuccess = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          console.warn('[PreProdSheet] Store missing in ' + DB_NAME + ', auto-repairing...');
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
            console.warn('[PreProdSheet] saveToCache tx error:', e.target.error);
            resolve();
          };
        } catch (err) {
          console.warn('[PreProdSheet] saveToCache error:', err);
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
          console.warn('[PreProdSheet] loadFromCache error:', err);
          dbInstance = null;
          resolve(null);
        }
      });
    }).catch(function () { return Promise.resolve(null); });
  }

  // ---------------------------------------------------------------------------
  // 2. High Performance CSV Stream Parser (Columns A to W)
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
        for (var k = 0; k < WANTED_COUNT; k++) {
          var letter = WANTED_LETTERS[k];
          var title = (rawHeaders[k] || '').trim();
          customHeaders.push(title ? title + ' (' + letter + ')' : 'Column ' + letter);
        }
        allHeaders = customHeaders;
        isFirstRow = false;
      } else {
        // Only keep if row is not completely blank
        var hasContent = false;
        var filtered = new Array(WANTED_COUNT);
        for (var j = 0; j < WANTED_COUNT; j++) {
          var cellVal = curRow[j] !== undefined ? curRow[j] : '';
          filtered[j] = cellVal;
          if (cellVal !== '') hasContent = true;
        }
        if (hasContent) {
          rows.push(filtered);
        }
      }
      curRow = [];
    }

    return {
      headers: allHeaders,
      rows: rows
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Sync from Google Sheet
  // ---------------------------------------------------------------------------
  function syncFromGoogleSheet(isManual) {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncUI(true, 'Downloading rows from Pre-Prod Data Google Sheet CSV stream...');

    var startTime = performance.now();

    fetch(CSV_URL + '&_=' + Date.now(), { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('Network response was ' + res.status + ': ' + res.statusText);
        updateSyncUI(true, 'Parsing rows & extracting columns A to W...');
        return res.text();
      })
      .then(function (csvText) {
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
          console.log('[PreProdSheet] Synced ' + allRows.length + ' rows in ' + totalDuration + 's (Parse: ' + parseDuration + 's)');
          applyAllFiltersAndSearch();
          updateHeaderBadge();
          updateSyncUI(false, 'Synced ' + allRows.length.toLocaleString() + ' records in ' + totalDuration + 's!');
          if (isManual) {
            showToast(allRows.length.toLocaleString() + ' records synced & cached into Database!', 'check');
          }
        });
      })
      .catch(function (err) {
        console.error('[PreProdSheet] Sync error:', err);
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
  // 4. Initial Load (Instant 0-Wait IndexedDB Cache Check)
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
          console.log('[PreProdSheet] INSTANT LOAD from IndexedDB: ' + allRows.length.toLocaleString() + ' rows ready in 0.05s!');
        } else {
          console.log('[PreProdSheet] No local cache found. Starting background sync...');
          syncFromGoogleSheet(false);
        }
      })
      .catch(function (err) {
        console.warn('[PreProdSheet] IndexedDB load failed, trying network fetch:', err);
        syncFromGoogleSheet(false);
      });
  }

  // ---------------------------------------------------------------------------
  // 5. Table Rendering & Pagination
  // ---------------------------------------------------------------------------
  function renderHeaderRow() {
    var theadRow = document.getElementById('preprod-sheet-thead-row');
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
    var tbody = document.getElementById('preprod-sheet-tbody');
    if (!tbody) return;

    var total = filteredRows.length;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIndex = (currentPage - 1) * pageSize;
    var endIndex = Math.min(startIndex + pageSize, total);
    var pageItems = filteredRows.slice(startIndex, endIndex);

    if (pageItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (allHeaders.length + 1) + '" class="bai-sheet-table-empty">No matching records found in Pre-Prod Data.</td></tr>';
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
          td.textContent = val;
          td.setAttribute('data-r', i);
          td.setAttribute('data-c', j);
          td.setAttribute('tabindex', '-1');

          // Highlight specific columns
          if (j === 1) { // ITB (B)
            td.className = 'bai-sheet-td-batch';
          } else if (j === 3 || j === 17 || j === 18 || j === 19) { // Numeric QTY columns (ITB Qty, ORDER QTY, ADJ GRN QTY, PENDING QTY)
            td.className = 'bai-sheet-td-num';
          }

          // Conditional Cell Color Coding (Applied strictly to the matching cell)
          // 1. Data not found    -> Red
          // 2. Material Received -> Green
          // 3. Material Pending  -> Orange
          // 4. In-Stock          -> Purple
          // 5. Po not create     -> Yellow
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

          // Restore selection if matching active cell
          if (activeCellCoords && activeCellCoords.r === i && activeCellCoords.c === j) {
            td.classList.add('bai-cell-selected');
          }

          // Mouse click cell selection
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
    var showingRangeEl = document.getElementById('preprod-sheet-showing-range');
    if (showingRangeEl) {
      if (total === 0) {
        showingRangeEl.textContent = 'Showing 0 of 0 records';
      } else {
        showingRangeEl.textContent = 'Showing ' + (startIndex + 1).toLocaleString() + ' – ' + endIndex.toLocaleString() + ' of ' + total.toLocaleString() + ' records';
      }
    }

    var countLabelEl = document.getElementById('preprod-sheet-count-label');
    if (countLabelEl) {
      countLabelEl.textContent = total.toLocaleString() + ' records' + (total !== allRows.length ? ' (filtered from ' + allRows.length.toLocaleString() + ')' : '');
    }

    var pageNumInput = document.getElementById('preprod-sheet-page-num');
    if (pageNumInput) pageNumInput.value = currentPage;

    var totalPagesEl = document.getElementById('preprod-sheet-total-pages');
    if (totalPagesEl) totalPagesEl.textContent = totalPages.toLocaleString();

    var firstBtn = document.getElementById('preprod-sheet-first-page');
    var prevBtn = document.getElementById('preprod-sheet-prev-page');
    var nextBtn = document.getElementById('preprod-sheet-next-page');
    var lastBtn = document.getElementById('preprod-sheet-last-page');

    if (firstBtn) firstBtn.disabled = (currentPage <= 1);
    if (prevBtn) prevBtn.disabled = (currentPage <= 1);
    if (nextBtn) nextBtn.disabled = (currentPage >= totalPages);
    if (lastBtn) lastBtn.disabled = (currentPage >= totalPages);

    var tableWrapper = document.getElementById('preprod-sheet-table-wrapper');
    if (tableWrapper) tableWrapper.scrollTop = 0;
  }

  // ---------------------------------------------------------------------------
  // 5.1 Interactive Cell Control & Selection Engine (Mouse + Arrow Keys)
  // ---------------------------------------------------------------------------
  function selectCellByCoords(r, c) {
    var tbody = document.getElementById('preprod-sheet-tbody');
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

    var badge = document.getElementById('preprod-sheet-active-cell-badge');
    if (badge) {
      var startIndex = (currentPage - 1) * pageSize;
      var rowNum = startIndex + r + 1;
      var colHeader = allHeaders[c] || ('Col ' + c);
      var text = targetCell.textContent || '';
      if (text.length > 25) text = text.slice(0, 25) + '...';
      badge.style.display = 'inline-flex';
      badge.innerHTML = '<span class="material-icons-round">my_location</span> Cell [' + colHeader + ', Row ' + rowNum.toLocaleString() + ']: <span style="color:#059669;margin-left:4px;">' + escapeHtml(text) + '</span>';
    }
  }

  function clearCellSelection() {
    var tbody = document.getElementById('preprod-sheet-tbody');
    if (tbody) {
      var prev = tbody.querySelector('.bai-cell-selected');
      if (prev) {
        prev.classList.remove('bai-cell-selected');
      }
    }
    activeCellCoords = null;
    var badge = document.getElementById('preprod-sheet-active-cell-badge');
    if (badge) {
      badge.style.display = 'none';
      badge.innerHTML = '';
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
    var tbody = document.getElementById('preprod-sheet-tbody');
    if (!tbody) return false;

    var selectedCell = tbody.querySelector('.bai-cell-selected');
    if (!selectedCell) return false;

    var cellText = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();

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
  // 6. Multi-Column Filters & Search Engine
  // ---------------------------------------------------------------------------
  function applyAllFiltersAndSearch() {
    var searchInput = document.getElementById('preprod-sheet-search-input');
    var query = (searchInput ? searchInput.value : '').toLowerCase().trim();

    var clearBtn = document.getElementById('preprod-sheet-search-clear');
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
        // 2. Parallel Column Filters
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
  // 6.1 Google Sheets Style Filter Popover
  // ---------------------------------------------------------------------------
  function openColumnFilterPopover(colIdx, anchorBtn) {
    currentFilterColIdx = colIdx;
    currentFilterSearchQuery = '';

    var popover = document.getElementById('preprod-sheet-filter-popover');
    if (!popover) return;

    var titleEl = document.getElementById('preprod-sheet-filter-pop-title');
    if (titleEl) {
      titleEl.textContent = allHeaders[colIdx] || ('Column ' + colIdx);
    }

    var searchInput = document.getElementById('preprod-sheet-filter-search-input');
    if (searchInput) {
      searchInput.value = '';
    }
    var searchClear = document.getElementById('preprod-sheet-filter-search-clear');
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
    var popover = document.getElementById('preprod-sheet-filter-popover');
    if (popover) {
      popover.style.display = 'none';
    }
    currentFilterColIdx = null;
  }

  function renderFilterList() {
    var listContainer = document.getElementById('preprod-sheet-filter-list');
    var countEl = document.getElementById('preprod-sheet-filter-items-count');
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
    var bar = document.getElementById('preprod-sheet-active-filters-bar');
    var chipsContainer = document.getElementById('preprod-sheet-active-filters-chips');
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
          return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Pre-Prod Data');

        var fileName = 'Pre_Production_Data_Export_' + (new Date().toISOString().slice(0, 10)) + '.xlsx';
        XLSX.writeFile(wb, fileName);

        var duration = ((performance.now() - startExport) / 1000).toFixed(1);
        showToast('Exported ' + count.toLocaleString() + ' records to ' + fileName + ' (' + duration + 's)!', 'download');
      } catch (err) {
        console.error('[PreProdSheet] Excel export error:', err);
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
    a.download = 'Pre_Production_Data_Export_' + (new Date().toISOString().slice(0, 10)) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported ' + filteredRows.length.toLocaleString() + ' records to CSV!', 'download');
  }

  // ---------------------------------------------------------------------------
  // 8. UI Helpers & View Toggling
  // ---------------------------------------------------------------------------
  function showView() {
    var view = document.getElementById('preprod-data-view');
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
      var searchInput = document.getElementById('preprod-sheet-search-input');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  function hideView() {
    var view = document.getElementById('preprod-data-view');
    var kpi = document.getElementById('store-kpi-view');
    if (view) view.style.display = 'none';
    if (kpi) kpi.style.display = '';
    closeColumnFilterPopover();
  }

  function updateHeaderBadge() {
    var badge = document.getElementById('preprod-sheet-db-badge');
    var syncText = document.getElementById('preprod-sheet-last-sync-text');
    var lastUpdatedLive = document.getElementById('preprod-data-last-updated');

    if (badge) {
      badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;">bolt</span> ' + (allRows.length ? allRows.length.toLocaleString() + ' Rows Cached (Database)' : 'Database Ready');
    }
    if (syncText) {
      if (lastSyncTime) {
        var d = new Date(lastSyncTime);
        var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString() + ')';
        syncText.textContent = 'Last synced: ' + timeStr;
        if (lastUpdatedLive) lastUpdatedLive.textContent = timeStr;
      } else {
        syncText.textContent = 'Not synced yet';
      }
    }
  }

  function updateSyncUI(syncing, msg) {
    var syncBanner = document.getElementById('preprod-sheet-sync-banner');
    var syncMsg = document.getElementById('preprod-sheet-sync-msg');
    var syncBtnIcon = document.getElementById('preprod-sheet-sync-icon');

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
    var existing = document.getElementById('preprod-sheet-toast');
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
    toast.id = 'preprod-sheet-toast';
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
    // KPI Card Click in Store Page
    var kpiCard = document.getElementById('kpi-preprod-data');
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
    var backBtn = document.getElementById('btn-back-preprod-data');
    if (backBtn) {
      backBtn.addEventListener('click', hideView);
    }

    // Refresh / Sync button
    var syncBtn = document.getElementById('btn-refresh-preprod-data');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        syncFromGoogleSheet(true);
      });
    }

    // Export Excel button
    var exportBtn = document.getElementById('btn-download-preprod-data-excel');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportExcelXLSX);
    }

    // Global Search Input
    var searchInput = document.getElementById('preprod-sheet-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyAllFiltersAndSearch, 180);
      });
    }

    // Search Clear Button
    var searchClear = document.getElementById('preprod-sheet-search-clear');
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
    var pageSizeSelect = document.getElementById('preprod-sheet-page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10) || 100;
        currentPage = 1;
        renderTablePage();
      });
    }

    // Pagination Steppers
    var firstBtn = document.getElementById('preprod-sheet-first-page');
    if (firstBtn) {
      firstBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage = 1;
          renderTablePage();
        }
      });
    }

    var prevBtn = document.getElementById('preprod-sheet-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
          currentPage--;
          renderTablePage();
        }
      });
    }

    var nextBtn = document.getElementById('preprod-sheet-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTablePage();
        }
      });
    }

    var lastBtn = document.getElementById('preprod-sheet-last-page');
    if (lastBtn) {
      lastBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage = totalPages;
          renderTablePage();
        }
      });
    }

    var pageNumInput = document.getElementById('preprod-sheet-page-num');
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
    var clearAllFiltersBtn = document.getElementById('preprod-sheet-clear-all-filters-btn');
    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.addEventListener('click', function () {
        activeColumnFilters = {};
        applyAllFiltersAndSearch();
        showToast('All column filters cleared', 'filter');
      });
    }

    // Filter Popover Events
    var popCloseBtn = document.getElementById('preprod-sheet-filter-pop-close');
    if (popCloseBtn) {
      popCloseBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popSearchInput = document.getElementById('preprod-sheet-filter-search-input');
    var popSearchClear = document.getElementById('preprod-sheet-filter-search-clear');
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

    var popSelectAllBtn = document.getElementById('preprod-sheet-filter-select-all');
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

    var popClearAllBtn = document.getElementById('preprod-sheet-filter-clear-all');
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
    var sortAscBtn = document.getElementById('preprod-sheet-sort-asc');
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

    var sortDescBtn = document.getElementById('preprod-sheet-sort-desc');
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

    var popResetBtn = document.getElementById('preprod-sheet-filter-reset-btn');
    if (popResetBtn) {
      popResetBtn.addEventListener('click', function () {
        if (currentFilterColIdx === null) return;
        delete activeColumnFilters[currentFilterColIdx];
        applyAllFiltersAndSearch();
        closeColumnFilterPopover();
        showToast('Filter cleared on ' + allHeaders[currentFilterColIdx], 'filter');
      });
    }

    var popCancelBtn = document.getElementById('preprod-sheet-filter-cancel-btn');
    if (popCancelBtn) {
      popCancelBtn.addEventListener('click', closeColumnFilterPopover);
    }

    var popOkBtn = document.getElementById('preprod-sheet-filter-ok-btn');
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

    // Global click outside to close popover
    document.addEventListener('mousedown', function (e) {
      var popover = document.getElementById('preprod-sheet-filter-popover');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && !e.target.closest('.bai-sheet-col-filter-btn')) {
          closeColumnFilterPopover();
        }
      }
    });

    // Keyboard Navigation & Ctrl + C handler inside Pre-Prod View
    document.addEventListener('keydown', function (e) {
      var view = document.getElementById('preprod-data-view');
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
        var tbody = document.getElementById('preprod-sheet-tbody');
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
      var view = document.getElementById('preprod-data-view');
      if (!view || view.style.display === 'none') return;

      var tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;

      var selection = window.getSelection ? window.getSelection().toString() : '';
      if (!selection) {
        var tbody = document.getElementById('preprod-sheet-tbody');
        if (!tbody) return;
        var selectedCell = tbody.querySelector('.bai-cell-selected');
        if (selectedCell) {
          var text = (selectedCell.innerText !== undefined ? selectedCell.innerText : selectedCell.textContent || '').trim();
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
      var table = document.getElementById('preprod-sheet-table');
      if (table && !table.contains(e.target)) {
        clearCellSelection();
      }
    });

    // Escape Key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var popover = document.getElementById('preprod-sheet-filter-popover');
        if (popover && popover.style.display !== 'none') {
          closeColumnFilterPopover();
        } else if (activeCellCoords) {
          clearCellSelection();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Bootstrap Engine
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

  // Expose global controller
  window.PreProdSheetEngine = {
    init: start,
    show: showView,
    hide: hideView,
    sync: function () { syncFromGoogleSheet(true); },
    exportExcel: exportExcelXLSX,
    getRows: function () { return allRows; },
    getHeaders: function () { return allHeaders; }
  };

})();
