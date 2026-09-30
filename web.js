// Pre-Production for Store table. Kept separate from main.js intentionally.
(function () {
    'use strict';

    var STORE_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwNV3OrAeVzHWBS0DwshJHPifXdajx1xji4D0hrl8gYw2RtBQKo-hjc1-AA-ohuw_nl/exec';

    function el(id) { return document.getElementById(id); }
    function helpers() { return window.FMS || {}; }
    function escapeHtml(value) { return helpers().esc ? helpers().esc(value) : String(value == null ? '' : value); }
    function pageRange(current, total) { return helpers().paginationRange ? helpers().paginationRange(current, total) : [current]; }

    // -----------------------------------------------------------------
    // Generic data-view controller. Both Store sub-views ("Pre-Production
    // for Store" and "Pre-Production Data") share this same search / sort /
    // filter / paginate / export behaviour; only the fetch action and the
    // (optional) editable last column differ.
    //
    // opts:
    //   prefix                 - DOM id prefix, e.g. 'store-preproduction-data'
    //   action                 - doGet ?action= value to fetch rows
    //   editableStatusColumn   - true to render the status <select>
    //                            (In-Stock / Material Removed) column
    //                            (Store view only). Its position is the last
    //                            column, or the second-to-last column if
    //                            editableTextColumn is also true.
    //   editableTextColumn     - true to render the LAST column as a free-text
    //                            <input> whose value is saved back to the
    //                            sheet (Store view only). Always rendered
    //                            wide (see .dt-col-wide in style.css).
    //   emptyMessage           - message shown when the sheet has no rows
    //   wideColumn             - { anchorPattern: RegExp, offset: number, width: '340px' }
    //                            finds the header matching anchorPattern, then widens
    //                            the header `offset` columns to its right (e.g. offset:2
    //                            = "second column to the right of Serial No.")
    //                            Ignored when editableTextColumn is true (that
    //                            column is always the one made wide instead).
    //   columnWidths           - { columnIndex: 'widthPx' } widens specific
    //                            columns by their 0-based index within
    //                            state.headers (i.e. NOT counting the '#'
    //                            serial column). e.g. { 0: '260px' } widens
    //                            the first real data column — the one right
    //                            after '#'.
    // -----------------------------------------------------------------
    function createDataView(opts) {
        var prefix = opts.prefix;
        var action = opts.action;
        var editableTextColumn = !!opts.editableTextColumn;
        var editableStatusColumn = !!opts.editableStatusColumn;
        var emptyMessage = opts.emptyMessage || 'No data found.';
        var state = { headers: [], allRows: [], filteredRows: [], sortCol: -1, sortAsc: true, page: 1, pageSize: 25, search: '', filters: {}, wideColIndex: -1 };

        // The status <select> column sits at the last column, unless the
        // free-text remarks column is also enabled, in which case the
        // remarks column takes the last slot and status moves one to the left.
        function statusColIndex() {
            if (!editableStatusColumn) return -1;
            var lastColumn = state.headers.length - 1;
            return editableTextColumn ? lastColumn - 1 : lastColumn;
        }
        function textColIndex() {
            return editableTextColumn ? state.headers.length - 1 : -1;
        }
        // Resolves a rowColor.column spec ('last', 'secondLast', or a numeric
        // index) against the current header count.
        function resolveColumnRef_(spec, lastColumn) {
            if (spec === 'last') return lastColumn;
            if (spec === 'secondLast') return lastColumn - 1;
            return spec;
        }

        // ---------------------------------------------------------------
        // Recently-saved edits (row/column -> value), kept for a short grace
        // window so a background refresh (silentRefresh, every autoRefreshMs)
        // can't momentarily overwrite a value the user JUST picked/typed with
        // a stale read of the sheet (which can lag a moment behind the write).
        // Without this, the dropdown/text box can flicker: correct value ->
        // reverts to old value on the next poll -> corrects again.
        // ---------------------------------------------------------------
        var pendingEdits = {}; // key: rowNum + ':' + column -> { value, expires }
        var PENDING_EDIT_TTL_MS = 60000;

        function rememberPendingEdit_(rowNum, column, value) {
            pendingEdits[rowNum + ':' + column] = { value: value, expires: Date.now() + PENDING_EDIT_TTL_MS };
        }

        // Re-applies any still-fresh pendingEdits onto freshly-fetched rows,
        // and prunes any that have expired (by that point the sheet read is
        // trusted to have caught up, so the fetched value wins again).
        function applyPendingEdits_(rows) {
            var keys = Object.keys(pendingEdits);
            if (!keys.length) return;
            var now = Date.now();
            var rowsByNum = {};
            rows.forEach(function (row) { rowsByNum[row.__rowNum] = row; });
            keys.forEach(function (key) {
                var entry = pendingEdits[key];
                if (now > entry.expires) { delete pendingEdits[key]; return; }
                var sep = key.lastIndexOf(':');
                var rowNum = key.slice(0, sep), column = Number(key.slice(sep + 1));
                var row = rowsByNum[rowNum];
                if (row) row[column] = entry.value;
            });
        }

        function fetchData() {
            var empty = el(prefix + '-empty'), table = el(prefix + '-table'), footer = el(prefix + '-footer');
            if (empty) { empty.querySelector('p').textContent = 'Loading data...'; empty.style.display = ''; }
            if (table) table.style.display = 'none';
            if (footer) footer.style.display = 'none';
            if (helpers().showSpinner) helpers().showSpinner('Fetching data...');

            fetch(STORE_WEB_APP_URL + '?action=' + encodeURIComponent(action) + '&_=' + Date.now())
                .then(function (response) { if (!response.ok) throw new Error('The Store server returned HTTP ' + response.status + '.'); return response.json(); })
                .then(function (result) {
                    if (!result || !result.success || !Array.isArray(result.headers) || !Array.isArray(result.rows)) throw new Error((result && result.error) || 'Redeploy Store.gs as a web app, then try again.');
                    var rowNumbers = Array.isArray(result.rowNumbers) ? result.rowNumbers : [];
                    state.headers = result.headers;
                    state.allRows = result.rows.map(function (row, i) { row.__rowNum = rowNumbers[i]; return row; });
                    applyPendingEdits_(state.allRows);
                    state.filteredRows = state.allRows.slice();
                    state.sortCol = -1; state.sortAsc = true; state.page = 1; state.search = ''; state.filters = {};
                    state.wideColIndex = computeWideColIndex();
                    if (el(prefix + '-search')) el(prefix + '-search').value = '';
                    updateSearchClear(); buildHeaders(); renderTable(); touchLastUpdated();
                })
                .catch(function (error) {
                    if (empty) { empty.querySelector('p').textContent = 'Error: ' + error.message; empty.style.display = ''; }
                    if (helpers().showToast) helpers().showToast('error', 'Data Error', error.message);
                })
                .finally(function () { if (helpers().hideSpinner) helpers().hideSpinner(); });
        }

        function computeWideColIndex() {
            // The free-text remarks column (always the last column) is
            // always rendered wide, regardless of any wideColumn option.
            if (editableTextColumn) return state.headers.length - 1;
            if (!opts.wideColumn) return -1;
            var anchorIdx = -1;
            for (var i = 0; i < state.headers.length; i++) {
                if (opts.wideColumn.anchorPattern.test(String(state.headers[i] || '').trim())) { anchorIdx = i; break; }
            }
            if (anchorIdx < 0) return -1;
            var target = anchorIdx + opts.wideColumn.offset;
            return (target >= 0 && target < state.headers.length) ? target : -1;
        }

        function buildHeaders() {
            var thead = el(prefix + '-thead'); thead.innerHTML = '';
            var filters = document.createElement('tr'); filters.className = 'dt-filter-row'; filters.innerHTML = '<th class="dt-filter-cell dt-filter-cell-num"></th>';
            var headings = document.createElement('tr'), number = document.createElement('th'); number.className = 'dt-th dt-th-num'; number.textContent = '#'; headings.appendChild(number);
            state.headers.forEach(function (header, column) {
                var isWide = column === state.wideColIndex;
                var explicitWidth = opts.columnWidths && opts.columnWidths[column];
                var filterCell = document.createElement('th'), input = document.createElement('input');
                filterCell.className = 'dt-filter-cell' + (isWide ? ' dt-col-wide' : ''); input.className = 'dt-col-filter'; input.placeholder = 'Filter...';
                if (isWide && opts.wideColumn && opts.wideColumn.width) filterCell.style.minWidth = opts.wideColumn.width;
                if (explicitWidth) filterCell.style.minWidth = explicitWidth;
                input.addEventListener('input', function () { state.filters[column] = input.value; applyFilters(); });
                filterCell.appendChild(input); filters.appendChild(filterCell);
                var th = document.createElement('th'); th.className = 'dt-th dt-th-sortable' + (isWide ? ' dt-col-wide' : ''); th.innerHTML = escapeHtml(header) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
                if (isWide && opts.wideColumn && opts.wideColumn.width) th.style.minWidth = opts.wideColumn.width;
                if (explicitWidth) th.style.minWidth = explicitWidth;
                th.addEventListener('click', function () { state.sortAsc = state.sortCol === column ? !state.sortAsc : true; state.sortCol = column; applyFilters(); }); headings.appendChild(th);
            });
            thead.appendChild(filters); thead.appendChild(headings);
        }

        function recomputeFilteredRows() {
            var search = state.search;
            state.filteredRows = state.allRows.filter(function (row) {
                if (search && !row.some(function (cell) { return String(cell).toLowerCase().indexOf(search) !== -1; })) return false;
                return Object.keys(state.filters).every(function (key) { var term = String(state.filters[key] || '').trim().toLowerCase(); return !term || String(row[key] || '').toLowerCase().indexOf(term) !== -1; });
            });
            if (state.sortCol >= 0) state.filteredRows.sort(function (a, b) { var av = String(a[state.sortCol] || ''), bv = String(b[state.sortCol] || ''), an = parseFloat(av), bn = parseFloat(bv), compare = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv); return state.sortAsc ? compare : -compare; });
        }

        function applyFilters() {
            recomputeFilteredRows();
            state.page = 1; renderTable();
        }

        function renderTable() {
            var tbody = el(prefix + '-tbody'), table = el(prefix + '-table'), empty = el(prefix + '-empty'), footer = el(prefix + '-footer');
            var total = state.filteredRows.length, pages = Math.max(1, Math.ceil(total / state.pageSize)); state.page = Math.min(state.page, pages);
            var start = (state.page - 1) * state.pageSize, end = Math.min(start + state.pageSize, total); tbody.innerHTML = '';
            table.style.display = ''; empty.style.display = 'none'; footer.style.display = total ? '' : 'none';
            if (!total) { var emptyRow = document.createElement('tr'), emptyCell = document.createElement('td'); emptyCell.className = 'dt-td-empty-msg'; emptyCell.colSpan = state.headers.length + 1; emptyCell.textContent = state.allRows.length ? 'No records match the current filter.' : emptyMessage; emptyRow.appendChild(emptyCell); tbody.appendChild(emptyRow); }
            var lastColumn = state.headers.length - 1;
            var rowColorColIdx = opts.rowColor ? resolveColumnRef_(opts.rowColor.column, lastColumn) : -1;
            var statusIdx = statusColIndex();
            var textIdx = textColIndex();
            state.filteredRows.slice(start, end).forEach(function (row, rowIndex) {
                var tr = document.createElement('tr'), num = document.createElement('td'); var rowClass = (start + rowIndex) % 2 ? 'dt-tr-odd' : 'dt-tr-even';
                if (rowColorColIdx >= 0) {
                    var statusKey = String(row[rowColorColIdx] == null ? '' : row[rowColorColIdx]).trim().toLowerCase();
                    var statusClass = opts.rowColor.map[statusKey];
                    if (statusClass) rowClass += ' dt-tr-status-' + statusClass;
                }
                tr.className = rowClass; num.className = 'dt-td dt-td-num'; num.textContent = start + rowIndex + 1; tr.appendChild(num);
                state.headers.forEach(function (_, column) {
                    var td = document.createElement('td');
                    var isNoteCell = editableTextColumn && column === textIdx;
                    td.className = 'dt-td' + (column === state.wideColIndex ? ' dt-col-wide' : '') + (isNoteCell ? ' dt-td-note' : '');
                    if (opts.columnWidths && opts.columnWidths[column]) td.style.minWidth = opts.columnWidths[column];
                    if (editableStatusColumn && column === statusIdx) { td.appendChild(buildStatusSelect(row, column)); }
                    else if (isNoteCell) { td.appendChild(buildTextInput(row, column)); }
                    else { td.textContent = row[column] == null ? '' : row[column]; }
                    tr.appendChild(td);
                }); tbody.appendChild(tr);
            });
            el(prefix + '-count-badge').textContent = total + ' record' + (total === 1 ? '' : 's'); el(prefix + '-info').textContent = total ? 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total + ' entries' : 'Showing 0 entries'; buildPagination(pages);
        }

        var STATUS_OPTIONS = [
            { value: '', label: 'Select' },
            { value: 'In-Stock', label: 'In-Stock' },
            { value: 'Material Removed', label: 'Material Removed' }
        ];

        function buildStatusSelect(row, column) {
            var select = document.createElement('select');
            select.className = 'dt-status-select';
            var currentValue = row[column] == null ? '' : String(row[column]);
            var isKnownStatus = STATUS_OPTIONS.some(function (opt) { return opt.value !== '' && opt.value === currentValue; });

            STATUS_OPTIONS.forEach(function (opt) {
                var option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                option.selected = opt.value === '' ? (currentValue === '' || !isKnownStatus) : currentValue === opt.value;
                select.appendChild(option);
            });

            select.addEventListener('change', function () {
                var message = select.value === 'In-Stock' ? 'Marked as In-Stock.' :
                    (select.value === 'Material Removed' ? 'Marked as Material Removed.' : 'Cleared.');
                updateCell(row, column, select.value, select, message);
            });
            return select;
        }

        // Free-text remarks column (Store view's last column). Saves on blur
        // or Enter, and only when the value actually changed.
        function buildTextInput(row, column) {
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'dt-text-input';
            input.placeholder = 'Add a note...';
            input.value = row[column] == null ? '' : String(row[column]);

            var lastSaved = input.value;
            function save() {
                if (input.value === lastSaved) return;
                lastSaved = input.value;
                updateCell(row, column, input.value, input, 'Note saved.');
            }
            input.addEventListener('blur', save);
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
            return input;
        }

        function updateCell(row, column, value, control, successMessage) {
            var rowNum = row.__rowNum;
            if (!rowNum) { if (helpers().showToast) helpers().showToast('error', 'Update Error', 'Could not determine the sheet row for this record.'); return; }
            var previousValue = row[column] == null ? '' : String(row[column]);
            control.disabled = true;
            var url = STORE_WEB_APP_URL + '?action=updateStoreCell&row=' + encodeURIComponent(rowNum) +
                '&column=' + encodeURIComponent(column) + '&value=' + encodeURIComponent(value) + '&_=' + Date.now();
            fetch(url)
                .then(function (response) { if (!response.ok) throw new Error('The Store server returned HTTP ' + response.status + '.'); return response.json(); })
                .then(function (result) {
                    if (!result || !result.success) throw new Error((result && result.error) || 'Failed to update the sheet.');
                    row[column] = value;
                    rememberPendingEdit_(rowNum, column, value);
                    if (helpers().showToast) helpers().showToast('success', 'Store Updated', successMessage || 'Saved.');
                    renderTable();
                })
                .catch(function (error) {
                    if (helpers().showToast) helpers().showToast('error', 'Update Error', error.message);
                    row[column] = previousValue;
                    renderTable();
                })
                .finally(function () { control.disabled = false; });
        }

        function buildPagination(totalPages) {
            var pager = el(prefix + '-pagination'); pager.innerHTML = '';
            function add(label, page, disabled, active, icon) { var button = document.createElement('button'); button.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : ''); button.disabled = disabled; button.innerHTML = icon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label; if (!disabled) button.addEventListener('click', function () { state.page = page; renderTable(); el(prefix + '-table-wrap').scrollTop = 0; }); pager.appendChild(button); }
            add('first_page', 1, state.page <= 1, false, true); add('chevron_left', state.page - 1, state.page <= 1, false, true);
            pageRange(state.page, totalPages).forEach(function (item) { if (item === '...' || item === '…') { var dots = document.createElement('span'); dots.className = 'dt-page-ellipsis'; dots.textContent = '…'; pager.appendChild(dots); } else add(item, item, false, item === state.page, false); });
            add('chevron_right', state.page + 1, state.page >= totalPages, false, true); add('last_page', totalPages, state.page >= totalPages, false, true);
        }

        function updateSearchClear() { var search = el(prefix + '-search'), clear = el(prefix + '-search-clear'); if (search && clear) clear.style.display = search.value ? '' : 'none'; }

        function touchLastUpdated() {
            var badge = el(prefix + '-last-updated');
            if (badge) badge.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        // Silent background refresh: re-fetches rows without showing the
        // loading state or disrupting the user's current search/filter/
        // sort/page — it just swaps in fresh data and re-renders in place.
        function silentRefresh() {
            if (document.hidden) return; // skip while tab is backgrounded
            fetch(STORE_WEB_APP_URL + '?action=' + encodeURIComponent(action) + '&_=' + Date.now())
                .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
                .then(function (result) {
                    if (!result || !result.success || !Array.isArray(result.headers) || !Array.isArray(result.rows)) return;
                    var rowNumbers = Array.isArray(result.rowNumbers) ? result.rowNumbers : [];
                    state.headers = result.headers;
                    state.allRows = result.rows.map(function (row, i) { row.__rowNum = rowNumbers[i]; return row; });
                    applyPendingEdits_(state.allRows);
                    state.wideColIndex = computeWideColIndex();
                    recomputeFilteredRows();
                    renderTable();
                    touchLastUpdated();
                })
                .catch(function () { /* silent — a failed background poll shouldn't interrupt the user */ });
        }

        var autoRefreshTimer = null;
        function startAutoRefresh() {
            if (!opts.autoRefreshMs || autoRefreshTimer) return;
            autoRefreshTimer = setInterval(silentRefresh, opts.autoRefreshMs);
        }
        function stopAutoRefresh() {
            if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
        }

        function show() {
            if (!state.allRows.length) fetchData(); else { renderTable(); touchLastUpdated(); }
            startAutoRefresh();
        }

        function hide() {
            stopAutoRefresh();
        }

        function init() {
            var refreshBtn = el(opts.refreshBtnId || ('btn-refresh-' + prefix));
            if (refreshBtn) refreshBtn.addEventListener('click', fetchData);
            var downloadBtn = el(opts.downloadBtnId || ('btn-download-' + prefix + '-excel'));
            if (downloadBtn) downloadBtn.addEventListener('click', function () {
                if (!helpers().exportRowsToXlsx) return;
                var lastColumn       = state.headers.length - 1;
                var rowColorColIdx   = opts.rowColor ? resolveColumnRef_(opts.rowColor.column, lastColumn) : -1;
                helpers().exportRowsToXlsx({
                    headers: state.headers,
                    rows: state.filteredRows,
                    sheetName: opts.sheetName || prefix,
                    filenamePrefix: opts.filenamePrefix || prefix,
                    // Mirrors the on-screen status-based row coloring (see
                    // opts.rowColor / renderTable() above) inside the .xlsx.
                    rowColor: rowColorColIdx >= 0 ? function (row) {
                        var statusKey   = String(row[rowColorColIdx] == null ? '' : row[rowColorColIdx]).trim().toLowerCase();
                        var statusClass = opts.rowColor.map[statusKey];
                        return statusClass && helpers().excelRowColor_ ? helpers().excelRowColor_('status-' + statusClass) : null;
                    } : null
                });
            });
            var search = el(prefix + '-search');
            search.addEventListener('input', function () { state.search = search.value.trim().toLowerCase(); updateSearchClear(); applyFilters(); });
            el(prefix + '-search-clear').addEventListener('click', function () { search.value = ''; state.search = ''; updateSearchClear(); applyFilters(); });
            el(prefix + '-page-size').addEventListener('change', function (event) { state.pageSize = parseInt(event.target.value, 10) || 25; state.page = 1; renderTable(); });
        }

        return { show: show, hide: hide, fetchData: fetchData, init: init };
    }

    // -----------------------------------------------------------------
    // The two Store sub-views
    // -----------------------------------------------------------------
    var storeView = createDataView({
        prefix: 'store-preproduction-data',
        action: 'getPreProductionForStoreData',
        editableStatusColumn: true,
        editableTextColumn: true,
        emptyMessage: 'No data found in STORE.',
        sheetName: 'STORE',
        // Widens the column right after '#' (i.e. "column 2" counting '#'
        // as column 1) — the first real data column from the sheet.
        columnWidths: { 0: '260px' },
        filenamePrefix: 'Pre_Production_for_Store',
        refreshBtnId: 'btn-refresh-store-preproduction-data',
        downloadBtnId: 'btn-download-store-preproduction-excel',
        autoRefreshMs: 30000,
        rowColor: {
            // The status column is second-to-last now that the free-text
            // remarks column (last) sits to its right.
            column: 'secondLast',
            map: {
                'in-stock': 'green',
                'material removed': 'orange'
            }
        }
    });

    var preprodDataView = createDataView({
        prefix: 'preprod-data',
        action: 'getPreProdData',
        emptyMessage: 'No data found in Pre-Prod Data.',
        sheetName: 'Pre-Prod Data',
        filenamePrefix: 'Pre_Production_Data',
        refreshBtnId: 'btn-refresh-preprod-data',
        downloadBtnId: 'btn-download-preprod-data-excel',
        wideColumn: { anchorPattern: /^itb$/i, offset: 0, width: '420px' },
        autoRefreshMs: 30000,
        rowColor: {
            column: 'last',
            map: {
                'in-stock': 'deep-green',
                'material received': 'light-green',
                'po not create': 'yellow',
                'material pending': 'orange',
                'itb mismatch': 'red'
            }
        }
    });

    // -----------------------------------------------------------------
    // Wires a KPI card -> its sub-view, toggling visibility of the Store
    // KPI grid and the requested detail view.
    // -----------------------------------------------------------------
    function wireKpiCard(cardId, backId, viewId, dataView) {
        var card = el(cardId), back = el(backId), kpi = el('store-kpi-view'), detail = el(viewId);

        function showDetail() {
            if (kpi) kpi.style.display = 'none';
            if (detail) detail.style.display = '';
            dataView.show();
        }
        function showKpi() {
            if (kpi) kpi.style.display = '';
            if (detail) detail.style.display = 'none';
            dataView.hide();
        }

        if (card) {
            card.addEventListener('click', showDetail);
            card.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showDetail(); } });
        }
        if (back) back.addEventListener('click', showKpi);
    }

    function initStorePreProduction() {
        wireKpiCard('kpi-store-ai-data', 'btn-back-store-ai-data', 'store-ai-data-view', storeView);
        wireKpiCard('kpi-preprod-data', 'btn-back-preprod-data', 'preprod-data-view', preprodDataView);
        storeView.init();
        preprodDataView.init();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStorePreProduction); else initStorePreProduction();
})();

// =============================================================================
// Follow-Up Planned — Report by Planned Date (PDF section)
// =============================================================================
// This is a SEPARATE Google Spreadsheet from the main FMS workbook, so it
// calls its own dedicated Web App (PlannedDate.gs), same pattern as the
// Store section above.
//
// Flow:
//   1. User opens PDF > Follow-Up Planned, picks a Planned Date, clicks
//      "Generate Report".
//   2. We call PlannedDate.gs's getPlannedDateReport action with that date.
//   3. The backend scans the "PLANNED DATE" sheet and returns every record
//      due, grouped into 11 independent stages — 1st/2nd/3rd Follow-up are
//      each split into a separate "Floor Supervisor" stage and a separate
//      "In-Line QC" stage (never merged), plus End-Line QC, Edge-Paint,
//      Pre-AQL, Post AQL and Shipment.
//   4. We render one table per stage that actually has records, and enable
//      the "Download PDF" button, which uses jsPDF + jspdf-autotable to
//      build a clean, table-based PDF client-side, styled with IBM Plex Sans.
// =============================================================================
(function () {
    'use strict';

    // After deploying PlannedDate.gs as a Web App, paste its /exec URL here.
    var PLANNED_DATE_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzGgpe9DPGQ50pCID9lNTaoqYqzdfRS1Vc3pLDItpPscRBxbFl4aKq8mMdygnLsQUr58Q/exec';

    // Columns rendered in every stage table / PDF table, in order. The
    // source-sheet AD value is placed immediately after In-Line QC and is
    // given extra PDF width so longer values remain readable. Floor
    // Supervisor and In-Line QC are always kept as two separate columns —
    // never combined into one value. "Follow-Up Remarks" has no backing
    // data field — it's intentionally left blank (wider than the other
    // columns) so the printed/exported report has room for handwritten
    // notes.
    // pdfWidth values are proportioned to fill the full usable page width
    // (A4 landscape, tight margins) at render time — see buildPdf(), which
    // rescales them to the exact usable width so the table always spans
    // edge-to-edge regardless of page size/margin tweaks.
    var PD_COLUMNS = [
        { key: 'unit',                label: 'Unit',             pdfWidth: 40 },
        { key: 'batchNo',             label: 'Batch No.',        pdfWidth: 80 },
        { key: 'brand',               label: 'Brand',            pdfWidth: 55 },
        { key: 'sku',                 label: 'SKU',              pdfWidth: 55 },
        { key: 'style',               label: 'Style',            pdfWidth: 55 },
        { key: 'colour',              label: 'Colour',           pdfWidth: 55 },
        { key: 'quantity',            label: 'Quantity',         pdfWidth: 45, halign: 'right' },
        { key: 'etd',                 label: 'ETD',              pdfWidth: 60 },
        { key: 'fabricatorName',      label: 'Fabricator Name',  pdfWidth: 85 },
        { key: 'floorSupervisorName', label: 'Floor Supervisor', pdfWidth: 110 },
        { key: 'inlineQcName',        label: 'In-Line QC',       pdfWidth: 95 },
        { key: 'adData',              label: 'AD',               pdfWidth: 165 },
        { key: 'followUpRemarks',     label: 'Follow-Up Remarks', pdfWidth: 150 }
    ];

    // AD's header comes from the source sheet, so the report displays the
    // same field name the user sees there instead of the technical column
    // letter. The fallback only applies when the source header is blank.
    function getPdColumnLabel_(col) {
        if (col.key !== 'adData') return col.label;
        var label = lastReport && String(lastReport.adColumnLabel || '').trim();
        return label || col.label;
    }

    var STAGE_ICONS = {
        fu1_fs: 'looks_one', fu1_qc: 'looks_one',
        fu2_fs: 'looks_two', fu2_qc: 'looks_two',
        fu3_fs: 'looks_3',   fu3_qc: 'looks_3',
        endline: 'checklist', edgepaint: 'format_paint',
        preaql: 'fact_check', postaql: 'verified', shipment: 'local_shipping'
    };

    // Worksheet names for the Excel export — one worksheet per stage. Kept
    // short (Excel caps sheet names at 31 characters and disallows
    // : \ / ? * [ ]), while still matching the stage labels above.
    var STAGE_SHEET_NAMES = {
        fu1_fs:    '1st FU - Floor Supervisor',
        fu1_qc:    '1st FU - In-Line QC',
        fu2_fs:    '2nd FU - Floor Supervisor',
        fu2_qc:    '2nd FU - In-Line QC',
        fu3_fs:    '3rd FU - Floor Supervisor',
        fu3_qc:    '3rd FU - In-Line QC',
        endline:   'End-Line QC',
        edgepaint: 'Edge-Paint',
        preaql:    'Pre-AQL',
        postaql:   'Post AQL',
        shipment:  'Shipment'
    };

    // Plain black / white / grey palette only — no brand colours. Grey is
    // used purely for structure (a faint header-row fill) so the PDF stays
    // readable; everything else is pure black text/rules on white.
    var PDF_COLORS = {
        black:    [0, 0, 0],
        text:     [0, 0, 0],
        subtext:  [90, 90, 90],
        border:   [0, 0, 0],
        headFill: [235, 235, 235],
        white:    [255, 255, 255]
    };

    var lastReport = null; // { date, stages } from the last successful fetch

    // Units to always exclude from the report/PDF entirely, mirroring
    // PD_EXCLUDED_UNITS/isExcludedUnit_ in PlannedDate.gs. Comparison is
    // case-insensitive and ignores surrounding whitespace. This acts as a
    // client-side safety net so the exclusion applies immediately even if
    // the Apps Script web app hasn't been redeployed with the same logic yet.
    var PD_EXCLUDED_UNITS = ['14-B', '114'];
    function isExcludedUnit_(unitValue) {
        var normalized = String(unitValue == null ? '' : unitValue).trim().toUpperCase();
        return PD_EXCLUDED_UNITS.some(function (u) { return String(u).trim().toUpperCase() === normalized; });
    }

    // Sorts records by their "Unit" field (e.g. "14-B", "P-32", "S-18",
    // "S-37") using a natural/numeric-aware comparison — "S-9" sorts before
    // "S-18" rather than after it, unlike a plain string sort. This mirrors
    // compareByUnit_/naturalCompare_ in PlannedDate.gs and acts as a
    // client-side safety net: it applies unit-wise sorting immediately even
    // if the Apps Script web app hasn't been redeployed with the same logic
    // yet, and guarantees the on-screen table and the PDF always match.
    function compareRecordsByUnit_(a, b) {
        return naturalCompareUnit_(String((a && a.unit) || ''), String((b && b.unit) || ''));
    }

    // Picks the right comparator for a given stage — mirrors
    // compareForStage_/compareByField_ in PlannedDate.gs:
    //   - "…_fs"  (Floor Supervisor stages)  -> sort A-Z by floorSupervisorName
    //   - "…_qc"  (In-Line QC stages)        -> sort A-Z by inlineQcName
    //   - everything else (End-Line QC, Edge-Paint, Pre-AQL, Post AQL,
    //     Shipment) -> keep the original Unit-wise natural sort
    function compareRecordsForStage_(stageKey) {
        if (/_fs$/.test(stageKey)) return compareRecordsByField_('floorSupervisorName');
        if (/_qc$/.test(stageKey)) return compareRecordsByField_('inlineQcName');
        return compareRecordsByUnit_;
    }

    // Case-insensitive A-Z comparator for a given record field (e.g. Floor
    // Supervisor Name / In-Line QC Name). Blank values sort last.
    function compareRecordsByField_(field) {
        return function (a, b) {
            var av = String((a && a[field]) || '').trim();
            var bv = String((b && b[field]) || '').trim();
            if (av === '' && bv === '') return 0;
            if (av === '') return 1;
            if (bv === '') return -1;
            return av.toLowerCase().localeCompare(bv.toLowerCase());
        };
    }

    function naturalCompareUnit_(a, b) {
        var re = /(\d+)|(\D+)/g;
        var aParts = String(a).match(re) || [];
        var bParts = String(b).match(re) || [];
        var len = Math.max(aParts.length, bParts.length);

        for (var i = 0; i < len; i++) {
            var ap = aParts[i], bp = bParts[i];
            if (ap === undefined) return -1;
            if (bp === undefined) return 1;

            var aIsNum = /^\d+$/.test(ap);
            var bIsNum = /^\d+$/.test(bp);

            if (aIsNum && bIsNum) {
                var diff = parseInt(ap, 10) - parseInt(bp, 10);
                if (diff !== 0) return diff;
            } else {
                var cmp = ap.toLowerCase().localeCompare(bp.toLowerCase());
                if (cmp !== 0) return cmp;
            }
        }
        return 0;
    }

    function el(id) { return document.getElementById(id); }
    function helpers() { return window.FMS || {}; }
    function escapeHtml(value) { return helpers().esc ? helpers().esc(value) : String(value == null ? '' : value); }
    function toast(type, title, msg) { if (helpers().showToast) helpers().showToast(type, title, msg); }

    function formatDateForTitle(dateStr) {
        var parts = String(dateStr || '').split('-');
        if (parts.length !== 3) return dateStr || '';
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var m = parseInt(parts[1], 10) - 1;
        return parts[2] + '-' + (months[m] || parts[1]) + '-' + parts[0];
    }

    // -----------------------------------------------------------------
    // View reset / fetch / render
    // -----------------------------------------------------------------
    function resetView() {
        lastReport = null;
        var dateInput = el('followup-planned-date-input');
        if (dateInput) dateInput.value = '';
        var results = el('followup-planned-results');
        if (results) results.innerHTML = '';
        var emptyState = el('followup-planned-empty-state');
        if (emptyState) {
            emptyState.style.display = '';
            emptyState.innerHTML = '<span class="material-icons-round">event_repeat</span>' +
                '<p>Select a Planned Date and click "Generate Report" to see 1st/2nd/3rd Follow-up ' +
                '(Floor Supervisor and In-Line QC shown separately), End-Line QC, Edge-Paint, Pre-AQL, ' +
                'Post AQL and Shipment records due on that date.</p>';
        }
        var badge = el('followup-planned-summary-badge');
        if (badge) badge.style.display = 'none';
        var pdfBtn = el('btn-download-followup-planned-pdf');
        if (pdfBtn) pdfBtn.disabled = true;
        var excelBtn = el('btn-download-followup-planned-report-excel');
        if (excelBtn) excelBtn.disabled = true;
    }

    function fetchReport(dateStr) {
        var emptyState = el('followup-planned-empty-state');
        var results = el('followup-planned-results');
        var pdfBtn = el('btn-download-followup-planned-pdf');
        var excelBtn = el('btn-download-followup-planned-report-excel');
        var badge = el('followup-planned-summary-badge');

        if (results) results.innerHTML = '';
        if (badge) badge.style.display = 'none';
        if (pdfBtn) pdfBtn.disabled = true;
        if (excelBtn) excelBtn.disabled = true;
        if (emptyState) {
            emptyState.style.display = '';
            emptyState.innerHTML = '<span class="material-icons-round">hourglass_empty</span><p>Loading data…</p>';
        }
        if (helpers().showSpinner) helpers().showSpinner('Fetching Follow-Up Planned data...');

        fetch(PLANNED_DATE_WEB_APP_URL + '?action=getPlannedDateReport&date=' + encodeURIComponent(dateStr) + '&_=' + Date.now())
            .then(function (response) {
                if (!response.ok) throw new Error('The Planned Date server returned HTTP ' + response.status + '.');
                return response.json();
            })
            .then(function (result) {
                if (!result || !result.success || !Array.isArray(result.stages)) {
                    throw new Error((result && result.error) || 'Redeploy PlannedDate.gs as a web app, then try again.');
                }
                result.stages.forEach(function (stage) {
                    if (!Array.isArray(stage.records)) return;
                    stage.records = stage.records.filter(function (record) { return !isExcludedUnit_(record && record.unit); });
                    stage.records.sort(compareRecordsForStage_(stage.key));
                    stage.count = stage.records.length;
                });
                lastReport = {
                    date: result.date || dateStr,
                    adColumnLabel: result.adColumnLabel || 'AD',
                    stages: result.stages
                };
                renderReport();
            })
            .catch(function (error) {
                lastReport = null;
                if (emptyState) {
                    emptyState.style.display = '';
                    emptyState.innerHTML = '<span class="material-icons-round">error_outline</span><p>Error: ' + escapeHtml(error.message) + '</p>';
                }
                toast('error', 'Data Error', error.message);
            })
            .finally(function () { if (helpers().hideSpinner) helpers().hideSpinner(); });
    }

    function renderReport() {
        var emptyState = el('followup-planned-empty-state');
        var results = el('followup-planned-results');
        var pdfBtn = el('btn-download-followup-planned-pdf');
        var excelBtn = el('btn-download-followup-planned-report-excel');
        var badge = el('followup-planned-summary-badge');
        if (!results || !lastReport) return;

        var stagesWithData = lastReport.stages.filter(function (s) { return s.count > 0; });
        var totalRecords = stagesWithData.reduce(function (sum, s) { return sum + s.count; }, 0);

        if (badge) {
            badge.style.display = '';
            badge.textContent = totalRecords + ' record' + (totalRecords === 1 ? '' : 's') + ' · ' +
                stagesWithData.length + ' stage' + (stagesWithData.length === 1 ? '' : 's');
        }

        if (stagesWithData.length === 0) {
            results.innerHTML = '';
            if (emptyState) {
                emptyState.style.display = '';
                emptyState.innerHTML = '<span class="material-icons-round">event_busy</span>' +
                    '<p>No Follow-Up, QC, Edge-Paint, AQL or Shipment records are planned for ' +
                    escapeHtml(formatDateForTitle(lastReport.date)) + '.</p>';
            }
            if (pdfBtn) pdfBtn.disabled = true;
            if (excelBtn) excelBtn.disabled = true;
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (pdfBtn) pdfBtn.disabled = false;
        if (excelBtn) excelBtn.disabled = false;

        var html = '';
        stagesWithData.forEach(function (stage) {
            html += '<div class="page-card data-table-card fup-stage-section">';
            html += '  <div class="fup-stage-header">';
            html += '    <span class="material-icons-round">' + (STAGE_ICONS[stage.key] || 'event') + '</span>';
            html += '    <span class="fup-stage-title">' + escapeHtml(stage.label) + '</span>';
            html += '    <span class="fup-stage-count">' + stage.count + ' record' + (stage.count === 1 ? '' : 's') + '</span>';
            html += '  </div>';
            html += '  <div class="fup-stage-table-wrap">';
            html += '    <table class="dt-table">';
            html += '      <thead><tr>';
            PD_COLUMNS.forEach(function (col) { html += '<th class="dt-th">' + escapeHtml(getPdColumnLabel_(col)) + '</th>'; });
            html += '      </tr></thead>';
            html += '      <tbody>';
            stage.records.forEach(function (record, i) {
                html += '<tr class="' + (i % 2 ? 'dt-tr-odd' : 'dt-tr-even') + '">';
                PD_COLUMNS.forEach(function (col) { html += '<td class="dt-td">' + escapeHtml(record[col.key]) + '</td>'; });
                html += '</tr>';
            });
            html += '      </tbody>';
            html += '    </table>';
            html += '  </div>';
            html += '</div>';
        });
        html += '<div class="fup-summary-note">Report generated for Planned Date: ' +
            escapeHtml(formatDateForTitle(lastReport.date)) + '. Stages with no records for this date are omitted. ' +
            'Floor Supervisor and In-Line QC are always listed as separate stages/columns, never combined.</div>';

        results.innerHTML = html;
    }

    // Formats a Date as dd/MM/yyyy HH:mm:ss (24-hour, zero-padded), used for
    // the "Generated:" label in the PDF so it's locale-independent — unlike
    // Date#toLocaleString(), which varies by the browser's locale settings.
    function formatPdfTimestamp_(date) {
        function pad2(n) { return n < 10 ? '0' + n : '' + n; }
        return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1) + '/' + date.getFullYear() +
            ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
    }

    // -----------------------------------------------------------------
    // PDF generation (client-side, via jsPDF + jspdf-autotable)
    // Plain, professional, black-and-white, table-based layout: a simple
    // text header with a single rule, one bordered table per stage with a
    // plain section heading, and a page-numbered footer (company name,
    // report label, and page number) repeated on every page. No colour, no
    // fills, no rounded shapes — just clean typography and rules.
    // IBM Plex Sans (embedded, see pdf-fonts.js) is used for every piece of text,
    // and every table spans the full usable page width.
    // -----------------------------------------------------------------
    function buildPdf() {
        if (!lastReport) return;
        var stagesWithData = lastReport.stages.filter(function (s) { return s.count > 0; });
        if (stagesWithData.length === 0) { toast('error', 'Nothing to Export', 'No records found for the selected Planned Date.'); return; }

        var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDFCtor) { toast('error', 'PDF Error', 'PDF library failed to load. Check your internet connection and try again.'); return; }

        var doc = new jsPDFCtor({ orientation: 'landscape', unit: 'pt', format: 'a4' });

        var fontFamily = 'helvetica'; // fallback if IBM Plex Sans fails to register
        if (typeof registerPdfFonts_ === 'function') {
            try { registerPdfFonts_(doc); fontFamily = 'IBMPlexSans'; }
            catch (e) {
                fontFamily = 'helvetica';
                // Surfaced so a broken/missing pdf-fonts.js is visible in the
                // console instead of silently downgrading every PDF to Helvetica.
                console.warn('registerPdfFonts_ failed — falling back to Helvetica for this PDF:', e);
            }
        } else {
            console.warn('registerPdfFonts_ is not defined (pdf-fonts.js missing or not loaded) — falling back to Helvetica for this PDF.');
        }
        doc.setFont(fontFamily, 'normal');

        var pageWidth  = doc.internal.pageSize.getWidth();
        var pageHeight = doc.internal.pageSize.getHeight();
        var marginX = 14;
        var usableWidth = pageWidth - marginX * 2;
        var headerTop = 26;
        var headerRuleY = 56;
        var contentTop = headerRuleY + 20;
        var footerRuleY = pageHeight - 30;
        var totalRecords = stagesWithData.reduce(function (sum, s) { return sum + s.count; }, 0);
        var reportDateLabel = formatDateForTitle(lastReport.date);
        var generatedLabel = formatPdfTimestamp_(new Date());

        // Rescale the configured column widths so the table always spans
        // the exact full usable width, regardless of page/margin size.
        var configuredWidth = PD_COLUMNS.reduce(function (sum, col) { return sum + col.pdfWidth; }, 0);
        var widthScale = usableWidth / configuredWidth;

        // ---- Repeats the plain text title + rules on every page ----
        function drawPageFrame() {
            doc.setTextColor(PDF_COLORS.black[0], PDF_COLORS.black[1], PDF_COLORS.black[2]);

            doc.setFont(fontFamily, 'bold');
            doc.setFontSize(15);
            doc.text('PRODUCTION FOLLOW-UP REPORT', marginX, headerTop);

            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(9);
            doc.text(
                'Planned Date: ' + reportDateLabel + '   |   ' + totalRecords + ' record' +
                (totalRecords === 1 ? '' : 's') + ' across ' + stagesWithData.length + ' stage' +
                (stagesWithData.length === 1 ? '' : 's'),
                marginX, headerTop + 16
            );

            doc.setFontSize(8.5);
            doc.setTextColor(PDF_COLORS.subtext[0], PDF_COLORS.subtext[1], PDF_COLORS.subtext[2]);
            doc.text('Generated: ' + generatedLabel, pageWidth - marginX, headerTop, { align: 'right' });

            doc.setFont(fontFamily, 'bold');
            doc.setTextColor(PDF_COLORS.black[0], PDF_COLORS.black[1], PDF_COLORS.black[2]);
            doc.text('Trio Trend Exports Pvt. Ltd.', pageWidth - marginX, headerTop + 16, { align: 'right' });

            // Single rule under the header
            doc.setDrawColor(PDF_COLORS.black[0], PDF_COLORS.black[1], PDF_COLORS.black[2]);
            doc.setLineWidth(1);
            doc.line(marginX, headerRuleY, pageWidth - marginX, headerRuleY);

            // Footer rule
            doc.setLineWidth(0.6);
            doc.line(marginX, footerRuleY, pageWidth - marginX, footerRuleY);
            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(8);
            doc.setTextColor(PDF_COLORS.subtext[0], PDF_COLORS.subtext[1], PDF_COLORS.subtext[2]);
            doc.text('Follow-Up Planned Report · Planned Date ' + reportDateLabel, marginX, footerRuleY + 14);
        }

        function drawPageNumbers() {
            var pageCount = doc.internal.getNumberOfPages();
            for (var p = 1; p <= pageCount; p++) {
                doc.setPage(p);
                doc.setFont(fontFamily, 'normal');
                doc.setFontSize(8);
                doc.setTextColor(PDF_COLORS.subtext[0], PDF_COLORS.subtext[1], PDF_COLORS.subtext[2]);
                doc.text('Page ' + p + ' of ' + pageCount, pageWidth - marginX, footerRuleY + 14, { align: 'right' });
            }
        }

        drawPageFrame();
        var cursorY = contentTop;

        var tableHead = [PD_COLUMNS.map(function (col) { return getPdColumnLabel_(col); })];
        var columnStyles = {};
        PD_COLUMNS.forEach(function (col, i) {
            columnStyles[i] = { cellWidth: col.pdfWidth * widthScale, halign: col.halign || 'left' };
        });

        stagesWithData.forEach(function (stage, idx) {
            // Start a fresh page if a new stage heading wouldn't fit.
            if (cursorY > pageHeight - 130) {
                doc.addPage();
                drawPageFrame();
                cursorY = contentTop;
            } else if (idx > 0) {
                cursorY += 14;
            }

            // Plain section heading: bold label + record count, thin rule below.
            doc.setFont(fontFamily, 'bold');
            doc.setFontSize(11);
            doc.setTextColor(PDF_COLORS.black[0], PDF_COLORS.black[1], PDF_COLORS.black[2]);
            doc.text(stage.label, marginX, cursorY + 10);

            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(9);
            doc.setTextColor(PDF_COLORS.subtext[0], PDF_COLORS.subtext[1], PDF_COLORS.subtext[2]);
            doc.text(stage.count + ' record' + (stage.count === 1 ? '' : 's'), pageWidth - marginX, cursorY + 10, { align: 'right' });

            cursorY += 16;
            doc.setDrawColor(PDF_COLORS.black[0], PDF_COLORS.black[1], PDF_COLORS.black[2]);
            doc.setLineWidth(0.75);
            doc.line(marginX, cursorY, pageWidth - marginX, cursorY);
            cursorY += 8;

            var body = stage.records.map(function (record) {
                return PD_COLUMNS.map(function (col) { return record[col.key] == null ? '' : String(record[col.key]); });
            });

            // Row indices (within this stage's table body) where a new Unit
            // group begins — i.e. its Unit differs from the previous
            // record's Unit. Records arrive pre-sorted by Unit, so this
            // just finds the boundaries; used below to draw a thick rule
            // above each new group so Unit-wise groups are clearly
            // separated in the PDF, matching the on-screen sort order.
            var groupStartRows = {};
            stage.records.forEach(function (record, i) {
                if (i === 0) return; // first row never needs a divider above it
                var prevUnit = String(stage.records[i - 1].unit == null ? '' : stage.records[i - 1].unit).trim();
                var curUnit  = String(record.unit == null ? '' : record.unit).trim();
                if (curUnit !== prevUnit) groupStartRows[i] = true;
            });

            doc.autoTable({
                head: tableHead,
                body: body,
                startY: cursorY,
                margin: { left: marginX, right: marginX, top: contentTop, bottom: 44 },
                tableWidth: usableWidth,
                styles: {
                    font: fontFamily,
                    fontSize: 7.5,
                    cellPadding: 5,
                    overflow: 'linebreak',
                    lineColor: PDF_COLORS.border,
                    lineWidth: 0.5,
                    textColor: PDF_COLORS.text,
                    fillColor: PDF_COLORS.white
                },
                headStyles: {
                    font: fontFamily,
                    fontStyle: 'bold',
                    fillColor: PDF_COLORS.headFill,
                    textColor: PDF_COLORS.black,
                    fontSize: 8.7,
                    halign: 'center',
                    lineColor: PDF_COLORS.border,
                    lineWidth: 0.5
                },
                columnStyles: columnStyles,
                theme: 'grid',
                didParseCell: function (data) {
                    // Thick, bold top rule on the first row of every new
                    // Unit group (except the very first row of the table).
                    if (data.section === 'body' && groupStartRows[data.row.index]) {
                        data.cell.styles.lineWidth = { top: 1.75, right: 0.5, bottom: 0.5, left: 0.5 };
                        data.cell.styles.lineColor = PDF_COLORS.black;
                    }
                },
                didDrawPage: function () {
                    // A new page was started mid-table by autoTable itself —
                    // redraw the header/footer frame on it too.
                    drawPageFrame();
                }
            });

            cursorY = doc.lastAutoTable.finalY + 18;
        });

        drawPageNumbers();

        var filenameDate = String(lastReport.date || '').replace(/-/g, '');
        doc.save('Follow_Up_Planned_Report_' + filenameDate + '.pdf');
    }

    // -----------------------------------------------------------------
    // Excel generation (client-side, via ExcelJS — shared with the rest
    // of the app through window.FMS.loadExcelJs so the library is only
    // ever fetched once). Unlike the PDF, which stacks every stage into
    // one continuous document, the workbook gets ONE WORKSHEET PER STAGE
    // so each part of the report (1st Follow-up — Floor Supervisor,
    // 1st Follow-up — In-Line QC, End-Line QC, etc.) lives in its own
    // sheet rather than being merged into a single flat table.
    // -----------------------------------------------------------------
    function buildExcel() {
        if (!lastReport) return;
        var stagesWithData = lastReport.stages.filter(function (s) { return s.count > 0; });
        if (stagesWithData.length === 0) { toast('error', 'Nothing to Export', 'No records found for the selected Planned Date.'); return; }

        var loadExcelJs = helpers().loadExcelJs;
        if (typeof loadExcelJs !== 'function') {
            toast('error', 'Excel Error', 'Excel export library helper is unavailable.');
            return;
        }

        if (helpers().showSpinner) helpers().showSpinner('Building Excel workbook...');

        var EXCEL_FONT_NAME  = 'Calibri';
        var HEADER_FILL_ARGB = 'FF1F4E78'; // deep blue
        var border      = { style: 'thin', color: { argb: 'FF000000' } };
        var groupBorder = { style: 'medium', color: { argb: 'FF000000' } };
        var reportDateLabel = formatDateForTitle(lastReport.date);

        // Applies a thin border to every cell (1..colCount) of a given row,
        // even ones that were never explicitly written to (e.g. spacer rows),
        // so borders cover the entire worksheet, not just the data table.
        function borderEntireRow(row, colCount) {
            for (var c = 1; c <= colCount; c++) {
                row.getCell(c).border = { top: border, left: border, bottom: border, right: border };
            }
        }

        loadExcelJs().then(function (ExcelJS) {
            var workbook = new ExcelJS.Workbook();
            var usedNames = {};

            stagesWithData.forEach(function (stage) {
                // Keep worksheet names unique, <=31 chars, and free of the
                // characters Excel disallows in sheet names.
                var baseName = (STAGE_SHEET_NAMES[stage.key] || stage.label).replace(/[:\\/?*\[\]]/g, '-').substring(0, 31);
                var sheetName = baseName;
                var suffix = 2;
                while (usedNames[sheetName]) {
                    sheetName = baseName.substring(0, 28) + ' (' + suffix + ')';
                    suffix++;
                }
                usedNames[sheetName] = true;

                var worksheet = workbook.addWorksheet(sheetName);
                var colCount = PD_COLUMNS.length + 1; // + row-number column

                worksheet.columns = [{ width: 6 }].concat(PD_COLUMNS.map(function (col) {
                    return { width: col.key === 'adData' ? 28 : (col.key === 'followUpRemarks' ? 34 : 18) };
                }));

                // Title + subtitle rows, merged across every column.
                var titleRow = worksheet.addRow(['Follow-Up Planned — ' + stage.label]);
                worksheet.mergeCells(titleRow.number, 1, titleRow.number, colCount);
                titleRow.height = 22;
                titleRow.getCell(1).font = { name: EXCEL_FONT_NAME, bold: true, size: 13, color: { argb: 'FF000000' } };
                titleRow.getCell(1).alignment = { vertical: 'middle', wrapText: false };
                borderEntireRow(titleRow, colCount);

                var subRow = worksheet.addRow([
                    'Planned Date: ' + reportDateLabel + '   |   ' + stage.count + ' record' + (stage.count === 1 ? '' : 's')
                ]);
                worksheet.mergeCells(subRow.number, 1, subRow.number, colCount);
                subRow.getCell(1).font = { name: EXCEL_FONT_NAME, italic: true, size: 9, color: { argb: 'FF5A5A5A' } };
                subRow.getCell(1).alignment = { vertical: 'middle', wrapText: false };
                borderEntireRow(subRow, colCount);

                var spacerRow = worksheet.addRow([]); // spacer row
                borderEntireRow(spacerRow, colCount);

                var headerRow = worksheet.addRow(['#'].concat(PD_COLUMNS.map(function (col) { return getPdColumnLabel_(col); })));
                headerRow.height = 22;
                headerRow.eachCell(function (cell) {
                    cell.font      = { name: EXCEL_FONT_NAME, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
                    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
                    cell.border    = { top: border, left: border, bottom: border, right: border };
                });

                // Data rows — a thicker top rule marks the first row of
                // every new Unit group, matching the PDF's grouping.
                stage.records.forEach(function (record, idx) {
                    var prevUnit = idx > 0 ? String(stage.records[idx - 1].unit == null ? '' : stage.records[idx - 1].unit).trim() : null;
                    var curUnit  = String(record.unit == null ? '' : record.unit).trim();
                    var isNewGroup = idx > 0 && curUnit !== prevUnit;

                    var rowValues = [idx + 1].concat(PD_COLUMNS.map(function (col) {
                        return record[col.key] == null ? '' : String(record[col.key]);
                    }));
                    var excelRow = worksheet.addRow(rowValues);
                    excelRow.height = 18;
                    excelRow.eachCell(function (cell, colNumber) {
                        var isRowNumCol = colNumber === 1;
                        cell.alignment = { vertical: 'middle', wrapText: false, horizontal: isRowNumCol ? 'center' : undefined };
                        cell.border = { top: isNewGroup ? groupBorder : border, left: border, bottom: border, right: border };
                        if (isRowNumCol) {
                            cell.font = { name: EXCEL_FONT_NAME, size: 9, color: { argb: 'FF94A3B8' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                        } else {
                            cell.font = { name: EXCEL_FONT_NAME, size: 9 };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };
                        }
                    });
                });

                worksheet.views = [{ state: 'frozen', ySplit: 4 }];
            });

            return workbook.xlsx.writeBuffer();
        }).then(function (buffer) {
            if (helpers().hideSpinner) helpers().hideSpinner();
            var filenameDate = String(lastReport.date || '').replace(/-/g, '');
            var filename = 'Follow_Up_Planned_Report_' + filenameDate + '.xlsx';
            var blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            var url    = URL.createObjectURL(blob);
            var anchor = document.createElement('a');
            anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
            document.body.appendChild(anchor); anchor.click();
            setTimeout(function () { URL.revokeObjectURL(url); document.body.removeChild(anchor); }, 300);
            toast('success', 'Download Started', stagesWithData.length + ' sheet' + (stagesWithData.length === 1 ? '' : 's') + ' exported to ' + filename);
        }).catch(function (err) {
            if (helpers().hideSpinner) helpers().hideSpinner();
            toast('error', 'Excel Download Failed', err && err.message ? err.message : 'Could not create the Excel file.');
        });
    }

    // -----------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------
    function initPlannedDateReport() {
        var kpiCard = el('kpi-pdf-followup-planned');
        if (kpiCard) {
            kpiCard.addEventListener('click', resetView);
            kpiCard.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') resetView(); });
        }

        var genBtn = el('btn-generate-followup-planned-report');
        if (genBtn) {
            genBtn.addEventListener('click', function () {
                var dateInput = el('followup-planned-date-input');
                var val = dateInput && dateInput.value;
                if (!val) { toast('error', 'Select a Date', 'Please select a Planned Date first.'); return; }
                fetchReport(val);
            });
        }

        var clearBtn = el('btn-clear-followup-planned-report');
        if (clearBtn) clearBtn.addEventListener('click', resetView);

        var dateInput = el('followup-planned-date-input');
        if (dateInput) {
            dateInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && dateInput.value) fetchReport(dateInput.value);
            });
        }

        var pdfBtn = el('btn-download-followup-planned-pdf');
        if (pdfBtn) pdfBtn.addEventListener('click', buildPdf);

        var excelBtn = el('btn-download-followup-planned-report-excel');
        if (excelBtn) excelBtn.addEventListener('click', buildExcel);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPlannedDateReport); else initPlannedDateReport();
})();
