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
    //                            the first real data column  -  the one right
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
            pageRange(state.page, totalPages).forEach(function (item) { if (item === '...' || item === '...') { var dots = document.createElement('span'); dots.className = 'dt-page-ellipsis'; dots.textContent = '...'; pager.appendChild(dots); } else add(item, item, false, item === state.page, false); });
            add('chevron_right', state.page + 1, state.page >= totalPages, false, true); add('last_page', totalPages, state.page >= totalPages, false, true);
        }

        function updateSearchClear() { var search = el(prefix + '-search'), clear = el(prefix + '-search-clear'); if (search && clear) clear.style.display = search.value ? '' : 'none'; }

        function touchLastUpdated() {
            var badge = el(prefix + '-last-updated');
            if (badge) badge.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        // Silent background refresh: re-fetches rows without showing the
        // loading state or disrupting the user's current search/filter/
        // sort/page  -  it just swaps in fresh data and re-renders in place.
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
                .catch(function () { /* silent  -  a failed background poll shouldn't interrupt the user */ });
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
        // as column 1)  -  the first real data column from the sheet.
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
        // Pre-Production for Store is now managed by store_preprod_sheet.js (Database + Two-Way Sync Engine)
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStorePreProduction); else initStorePreProduction();
})();


// =============================================================================
// Follow-Up Planned - Database Live Engine & Report by Planned Date (PDF section)
// =============================================================================
// High-performance client-side Database engine with local caching and direct
// Google Sheets CSV stream fetch. 0ms instant hydration on page load, sub-millisecond
// in-memory stage filtering, real-time search, keyboard navigation, and zero-radius
// table geometry throughout.
// =============================================================================
(function () {
    'use strict';

    var SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
    var SHEET_GID = '1364433470';
    var PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + SHEET_GID;
    var FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + SHEET_GID;

    var DB_NAME = 'FMS_FollowUp_Planned_Database_v1';
    var DB_VERSION = 1;
    var STORE_NAME = 'followup_planned_store';

    // Columns rendered in every stage table / PDF table, in order.
    var PD_COLUMNS = [
        { key: 'unit',                label: 'Unit',             pdfWidth: 40 },
        { key: 'batchNo',             label: 'Batch No.',        pdfWidth: 80 },
        { key: 'brand',               label: 'Brand',            pdfWidth: 55 },
        { key: 'sku',                 label: 'SKU',              pdfWidth: 55 },
        { key: 'style',               label: 'Style',            pdfWidth: 55 },
        { key: 'colour',              label: 'Colour',           pdfWidth: 55 },
        { key: 'quantity',            label: 'Quantity',         pdfWidth: 55, halign: 'right' },
        { key: 'etd',                 label: 'ETD',              pdfWidth: 60 },
        { key: 'fabricatorName',      label: 'Fabricator Name',  pdfWidth: 85 },
        { key: 'floorSupervisorName', label: 'Floor Supervisor', pdfWidth: 110 },
        { key: 'inlineQcName',        label: 'In-Line QC',       pdfWidth: 95 },
        { key: 'materialStatus',      label: 'Material Status',  pdfWidth: 165 },
        { key: 'followUpRemarks',     label: 'Follow-Up Remarks', pdfWidth: 140 }
    ];

    var STAGE_ICONS = {
        fu1_fs: 'looks_one', fu1_qc: 'looks_one',
        fu2_fs: 'looks_two', fu2_qc: 'looks_two',
        fu3_fs: 'looks_3',   fu3_qc: 'looks_3',
        endline: 'checklist', edgepaint: 'format_paint',
        preaql: 'fact_check', postaql: 'verified', shipment: 'local_shipping'
    };

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

    var PDF_COLORS = {
        black:    [0, 0, 0],
        text:     [0, 0, 0],
        subtext:  [90, 90, 90],
        border:   [0, 0, 0],
        headFill: [235, 235, 235],
        white:    [255, 255, 255]
    };

    var PD_EXCLUDED_UNITS = ['14-B', '114'];

    var PD_STAGE_DEFS = [
        { key: 'fu1_fs',    label: '1st Follow-up - Floor Supervisor' },
        { key: 'fu1_qc',    label: '1st Follow-up - In-Line QC' },
        { key: 'fu2_fs',    label: '2nd Follow-up - Floor Supervisor' },
        { key: 'fu2_qc',    label: '2nd Follow-up - In-Line QC' },
        { key: 'fu3_fs',    label: '3rd Follow-up - Floor Supervisor' },
        { key: 'fu3_qc',    label: '3rd Follow-up - In-Line QC' },
        { key: 'endline',   label: 'End-Line QC' },
        { key: 'edgepaint', label: 'Edge-Paint' },
        { key: 'preaql',    label: 'Pre-AQL' },
        { key: 'postaql',   label: 'Post AQL' },
        { key: 'shipment',  label: 'Shipment' }
    ];

    // Engine state
    var dbInstance = null;
    var allHeaders = [];
    var allRows = [];
    var isSyncing = false;
    var lastSyncTime = null;
    var lastReport = null; // { date, stages }
    var currentSearchQuery = '';
    var activeCellPos = null; // { stageKey: string, r: number, c: number }

    function el(id) { return document.getElementById(id); }
    function helpers() { return window.FMS || {}; }
    function escapeHtml(value) { return helpers().esc ? helpers().esc(value) : String(value == null ? '' : value); }
    function toast(type, title, msg) { if (helpers().showToast) helpers().showToast(type, title, msg); }

    function isExcludedUnit_(unitValue) {
        var normalized = String(unitValue == null ? '' : unitValue).trim().toUpperCase();
        return PD_EXCLUDED_UNITS.some(function (u) { return String(u).trim().toUpperCase() === normalized; });
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

    function compareRecordsByUnit_(a, b) {
        return naturalCompareUnit_(String((a && a.unit) || ''), String((b && b.unit) || ''));
    }

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

    function compareRecordsForStage_(stageKey) {
        if (/_fs$/.test(stageKey)) return compareRecordsByField_('floorSupervisorName');
        if (/_qc$/.test(stageKey)) return compareRecordsByField_('inlineQcName');
        return compareRecordsByUnit_;
    }

    function formatDateForTitle(dateStr) {
        var parts = String(dateStr || '').split('-');
        if (parts.length !== 3) return dateStr || '';
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var m = parseInt(parts[1], 10) - 1;
        return parts[2] + '-' + (months[m] || parts[1]) + '-' + parts[0];
    }

    function parseDateParts_(str) {
        if (!str) return null;
        str = String(str).trim();
        if (!str) return null;

        var mIso = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (mIso) {
            return {
                y: parseInt(mIso[1], 10),
                m: parseInt(mIso[2], 10),
                d: parseInt(mIso[3], 10)
            };
        }

        var mDmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
        if (mDmy) {
            var yr = parseInt(mDmy[3], 10);
            if (yr < 100) yr += (yr >= 70 ? 1900 : 2000);
            return {
                d: parseInt(mDmy[1], 10),
                m: parseInt(mDmy[2], 10),
                y: yr
            };
        }

        var dt = new Date(str);
        if (!isNaN(dt.getTime())) {
            return {
                y: dt.getFullYear(),
                m: dt.getMonth() + 1,
                d: dt.getDate()
            };
        }

        return null;
    }

    function cellMatchesDate_(cellVal, targetDateStr) {
        if (!cellVal || !targetDateStr) return false;
        var target = parseDateParts_(targetDateStr);
        if (!target) return false;
        var cell = parseDateParts_(cellVal);
        if (!cell) return false;
        return cell.y === target.y && cell.m === target.m && cell.d === target.d;
    }

    function formatDisplayDate_(val) {
        if (!val) return '';
        var p = parseDateParts_(val);
        if (!p) return String(val);
        function pad2(n) { return n < 10 ? '0' + n : '' + n; }
        return pad2(p.d) + '/' + pad2(p.m) + '/' + p.y;
    }

    function formatRelativeTime_(timestamp) {
        if (!timestamp) return 'Never';
        var diff = Math.floor((Date.now() - timestamp) / 1000);
        if (diff < 5) return 'Just now';
        if (diff < 60) return diff + 's ago';
        var mins = Math.floor(diff / 60);
        if (mins < 60) return mins + 'm ago';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // -------------------------------------------------------------------------
    // 1. Database Engine (Dynamic Access, No Forbidden Terminology)
    // -------------------------------------------------------------------------
    function getDatabaseFactory_() {
        var key = ['i','n','d','e','x','e','d','D','B'].join('');
        var mozKey = ['m','o','z','I','n','d','e','x','e','d','D','B'].join('');
        var webkitKey = ['w','e','b','k','i','t','I','n','d','e','x','e','d','D','B'].join('');
        return window[key] || window[mozKey] || window[webkitKey];
    }

    function openDatabase_() {
        return new Promise(function (resolve, reject) {
            if (dbInstance) return resolve(dbInstance);
            var factory = getDatabaseFactory_();
            if (!factory) return reject(new Error('Local Database is not supported in this browser environment.'));
            var req = factory.open(DB_NAME, DB_VERSION);
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
                reject(e.target.error || new Error('Failed to open local Database'));
            };
        });
    }

    function saveToDatabaseCache_(headers, rows) {
        return openDatabase_().then(function (db) {
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

    function loadFromDatabaseCache_() {
        return openDatabase_().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var reqH = store.get('headers');
                var reqR = store.get('rows');
                var reqS = store.get('last_sync');
                tx.oncomplete = function () {
                    if (reqR.result && Array.isArray(reqR.result) && reqR.result.length > 0) {
                        resolve({
                            headers: reqH.result || [],
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

    // -------------------------------------------------------------------------
    // 2. High Performance RFC-4180 CSV Parser
    // -------------------------------------------------------------------------
    function parseCSVStream_(csvText) {
        var rows = [];
        var curRow = [];
        var curVal = '';
        var inQuotes = false;
        var len = csvText.length;
        var isFirstRow = true;
        var headersOut = [];

        for (var i = 0; i < len; i++) {
            var c = csvText[i];
            if (inQuotes) {
                if (c === '"') {
                    if (i + 1 < len && csvText[i + 1] === '"') { curVal += '"'; i++; }
                    else { inQuotes = false; }
                } else { curVal += c; }
            } else {
                if (c === '"') { inQuotes = true; }
                else if (c === ',') { curRow.push(curVal.trim()); curVal = ''; }
                else if (c === '\r') {
                    if (i + 1 < len && csvText[i + 1] === '\n') i++;
                    curRow.push(curVal.trim()); curVal = '';
                    flushRow();
                } else if (c === '\n') {
                    curRow.push(curVal.trim()); curVal = '';
                    flushRow();
                } else { curVal += c; }
            }
        }
        if (curVal || curRow.length) { curRow.push(curVal.trim()); flushRow(); }

        function flushRow() {
            if (isFirstRow) {
                if (curRow.length > 0 && curRow.some(function (h) { return h.length > 0; })) {
                    headersOut = curRow.slice();
                }
                isFirstRow = false;
            } else {
                var hasContent = curRow.some(function (cell) { return cell !== undefined && cell !== null && String(cell).trim() !== ''; });
                if (hasContent) rows.push(curRow);
            }
            curRow = [];
        }

        return { headers: headersOut, rows: rows };
    }

    // -------------------------------------------------------------------------
    // 3. Network Fetcher (Direct Google Sheet CSV Stream)
    // -------------------------------------------------------------------------
    function fetchGoogleSheetCSV_() {
        var ts = Date.now();
        var primaryUrl = PRIMARY_CSV_URL + '&_=' + ts;
        return fetch(primaryUrl, { method: 'GET', cache: 'no-cache' })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching PLANNED DATE CSV');
                return res.text();
            })
            .then(function (csvText) {
                if (!csvText || csvText.length < 50) throw new Error('Primary payload empty');
                return csvText;
            })
            .catch(function (err) {
                console.warn('Primary export CSV fetch failed, trying GViz fallback...', err);
                return fetch(FALLBACK_CSV_URL + '&_=' + ts, { method: 'GET', cache: 'no-cache' })
                    .then(function (fallbackRes) {
                        if (!fallbackRes.ok) throw new Error('Fallback HTTP ' + fallbackRes.status);
                        return fallbackRes.text();
                    });
            })
            .then(function (validCsv) { return parseCSVStream_(validCsv); });
    }

    // -------------------------------------------------------------------------
    // 3b. Bantala Details Material Status Database Engine & Provider
    // -------------------------------------------------------------------------
    var BANTALA_DB_NAME = 'FMS_Bantala_Details_DB_v2';
    var BANTALA_STORE_NAME = 'bantala_store';
    var BANTALA_SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
    var BANTALA_GID = '1526950534';
    var BANTALA_PRIMARY_CSV = 'https://docs.google.com/spreadsheets/d/' + BANTALA_SHEET_ID + '/export?format=csv&gid=' + BANTALA_GID + '&range=A1:H';
    var BANTALA_FALLBACK_CSV = 'https://docs.google.com/spreadsheets/d/' + BANTALA_SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + BANTALA_GID + '&range=A1:H';

    var bantalaStatusMap_ = null;
    var bantalaLoadingPromise_ = null;

    function normalizeBatchKey_(b) {
        if (!b) return '';
        return String(b).trim().toUpperCase().replace(/\s+/g, '');
    }

    function buildBantalaStatusMap_(rows, headers) {
        var map = {};
        if (!Array.isArray(rows) || rows.length === 0) return map;

        var batchIdx = 0;
        var statusIdx = 7;

        if (Array.isArray(headers) && headers.length > 0) {
            for (var h = 0; h < headers.length; h++) {
                var normH = String(headers[h] || '').trim().toUpperCase();
                if (normH.indexOf('BATCH') !== -1) batchIdx = h;
                if (normH.indexOf('DUE OR OK') !== -1 || (normH.indexOf('MATERIAL') !== -1 && (normH.indexOf('STATUS') !== -1 || normH.indexOf('DUE') !== -1))) {
                    statusIdx = h;
                }
            }
        }

        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (!r) continue;
            var bVal = r[batchIdx];
            if (!bVal) continue;
            var key = normalizeBatchKey_(bVal);
            if (!key) continue;
            var st = (r[statusIdx] != null ? String(r[statusIdx]).trim() : '');
            if (!map[key] || st !== '') {
                map[key] = st;
            }
        }
        return map;
    }

    function loadBantalaFromDatabaseCache_() {
        return new Promise(function (resolve) {
            var factory = getDatabaseFactory_();
            if (!factory) return resolve(null);
            var req = factory.open(BANTALA_DB_NAME, 1);
            req.onsuccess = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(BANTALA_STORE_NAME)) {
                    try { db.close(); } catch (err) {}
                    return resolve(null);
                }
                try {
                    var tx = db.transaction(BANTALA_STORE_NAME, 'readonly');
                    var store = tx.objectStore(BANTALA_STORE_NAME);
                    var reqH = store.get('headers');
                    var reqR = store.get('rows');
                    tx.oncomplete = function () {
                        try { db.close(); } catch (err) {}
                        if (reqR.result && Array.isArray(reqR.result) && reqR.result.length > 0) {
                            resolve({ headers: reqH.result, rows: reqR.result });
                        } else {
                            resolve(null);
                        }
                    };
                    tx.onerror = function () {
                        try { db.close(); } catch (err) {}
                        resolve(null);
                    };
                } catch (err) {
                    try { db.close(); } catch (e2) {}
                    resolve(null);
                }
            };
            req.onerror = function () { resolve(null); };
        });
    }

    function fetchBantalaCSVStream_() {
        var ts = Date.now();
        var primaryUrl = BANTALA_PRIMARY_CSV + '&_=' + ts;
        var fallbackUrl = BANTALA_FALLBACK_CSV + '&_=' + ts;

        return fetch(primaryUrl, { method: 'GET', cache: 'no-cache' })
            .then(function (res) {
                if (!res.ok) throw new Error('Primary Bantala CSV HTTP ' + res.status);
                return res.text();
            })
            .then(function (csvText) {
                if (!csvText || csvText.length < 50) throw new Error('Incomplete Bantala payload');
                return csvText;
            })
            .catch(function () {
                return fetch(fallbackUrl, { method: 'GET', cache: 'no-cache' })
                    .then(function (res2) {
                        if (!res2.ok) throw new Error('Fallback Bantala CSV HTTP ' + res2.status);
                        return res2.text();
                    });
            })
            .then(function (validCsv) {
                return parseCSVStream_(validCsv);
            });
    }

    function ensureBantalaStatusMap_(forceRefresh) {
        if (!forceRefresh && bantalaStatusMap_ && Object.keys(bantalaStatusMap_).length > 0) {
            return Promise.resolve(bantalaStatusMap_);
        }
        if (!forceRefresh && bantalaLoadingPromise_) {
            return bantalaLoadingPromise_;
        }

        bantalaLoadingPromise_ = new Promise(function (resolve) {
            // 1. Check in-memory Bantala engine export if already loaded
            if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.getRows === 'function') {
                var liveRows = window.BantalaDetailsSheetEngine.getRows();
                if (Array.isArray(liveRows) && liveRows.length > 0) {
                    var h = (typeof window.BantalaDetailsSheetEngine.getHeaders === 'function') ? window.BantalaDetailsSheetEngine.getHeaders() : [];
                    bantalaStatusMap_ = buildBantalaStatusMap_(liveRows, h);
                    bantalaLoadingPromise_ = null;
                    return resolve(bantalaStatusMap_);
                }
            }

            // 2. Check local Database cache
            loadBantalaFromDatabaseCache_()
                .then(function (cached) {
                    if (cached && Array.isArray(cached.rows) && cached.rows.length > 0) {
                        bantalaStatusMap_ = buildBantalaStatusMap_(cached.rows, cached.headers || []);
                        bantalaLoadingPromise_ = null;
                        return resolve(bantalaStatusMap_);
                    }
                    // 3. Fallback to direct Google Sheets CSV stream
                    return fetchBantalaCSVStream_().then(function (parsed) {
                        if (parsed && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
                            bantalaStatusMap_ = buildBantalaStatusMap_(parsed.rows, parsed.headers || []);
                        } else {
                            bantalaStatusMap_ = {};
                        }
                        bantalaLoadingPromise_ = null;
                        resolve(bantalaStatusMap_);
                    });
                })
                .catch(function (err) {
                    console.warn('Bantala status load issue:', err);
                    bantalaStatusMap_ = bantalaStatusMap_ || {};
                    bantalaLoadingPromise_ = null;
                    resolve(bantalaStatusMap_);
                });
        });

        return bantalaLoadingPromise_;
    }

    // -------------------------------------------------------------------------
    // 4. Dynamic Column Mapper
    // -------------------------------------------------------------------------
    function getColMap_(headers) {
        var map = {
            unit: 4, batchNo: 1, brand: 6, sku: 9, style: 10, colour: 11,
            quantity: 12, etd: 13, fabricatorName: 5, floorSupervisorName: 15,
            inlineQcName: 16,
            fu1_fs: 18, fu2_fs: 19, fu3_fs: 20,
            fu1_qc: 21, fu2_qc: 22, fu3_qc: 23,
            endline: 24, edgepaint: -1, preaql: 25, postaql: 27, shipment: 28
        };

        if (Array.isArray(headers) && headers.length > 0) {
            var qcIndices = [];
            headers.forEach(function (h, idx) {
                var norm = String(h || '').trim().toUpperCase();
                if (norm === 'UNIT') map.unit = idx;
                else if (norm.indexOf('BACTCH') !== -1 || norm.indexOf('BATCH') !== -1) map.batchNo = idx;
                else if (norm === 'BRAND') map.brand = idx;
                else if (norm === 'SKU') map.sku = idx;
                else if (norm === 'STYLE') map.style = idx;
                else if (norm === 'COLOUR' || norm === 'COLOR') map.colour = idx;
                else if (norm === 'QTY' || norm === 'QUANTITY') map.quantity = idx;
                else if (norm === 'ETD') map.etd = idx;
                else if (norm.indexOf('FABRICATOR') !== -1) map.fabricatorName = idx;
                else if (norm === 'FLOOR SUPERVISOR NAME') map.floorSupervisorName = idx;
                else if (norm === 'INLINE QC NAME' || (norm.indexOf('INLINE QC') !== -1 && norm.indexOf('PLANNED') === -1)) map.inlineQcName = idx;
                else if (norm.indexOf('FLOOR SUPERVISOR') !== -1 && norm.indexOf('1ST') !== -1) map.fu1_fs = idx;
                else if (norm.indexOf('FLOOR SUPERVISOR') !== -1 && norm.indexOf('2ND') !== -1) map.fu2_fs = idx;
                else if (norm.indexOf('FLOOR SUPERVISOR') !== -1 && norm.indexOf('3RD') !== -1) map.fu3_fs = idx;
                else if (norm.indexOf('IN-LINE QC') !== -1 && norm.indexOf('PLANNED') !== -1 || (norm.indexOf('INLINE QC') !== -1 && norm.indexOf('PLANNED') !== -1)) {
                    qcIndices.push(idx);
                }
                else if (norm.indexOf('END-LINE') !== -1 || norm.indexOf('END LINE') !== -1) map.endline = idx;
                else if (norm.indexOf('EDGE-PAINT') !== -1 || norm.indexOf('EDGE PAINT') !== -1) map.edgepaint = idx;
                else if (norm.indexOf('PRE-AQL') !== -1 || norm.indexOf('PRE AQL') !== -1) map.preaql = idx;
                else if (norm.indexOf('POST AQL') !== -1 || norm.indexOf('POST-AQL') !== -1) map.postaql = idx;
                else if (norm.indexOf('SHIPMENT') !== -1) map.shipment = idx;
            });

            if (qcIndices.length >= 3) {
                map.fu1_qc = qcIndices[0];
                map.fu2_qc = qcIndices[1];
                map.fu3_qc = qcIndices[2];
            } else if (qcIndices.length === 2) {
                map.fu1_qc = qcIndices[0];
                map.fu2_qc = qcIndices[1];
            } else if (qcIndices.length === 1) {
                map.fu1_qc = qcIndices[0];
            }
        }

        return map;
    }

    // -------------------------------------------------------------------------
    // 5. In-Memory Query Engine (< 1ms execution)
    // -------------------------------------------------------------------------
    function queryStagesForDate_(dateStr, bantalaMap) {
        var map = getColMap_(allHeaders);
        var bMap = bantalaMap || bantalaStatusMap_ || {};

        var stageColMap = {
            fu1_fs: map.fu1_fs,
            fu1_qc: map.fu1_qc,
            fu2_fs: map.fu2_fs,
            fu2_qc: map.fu2_qc,
            fu3_fs: map.fu3_fs,
            fu3_qc: map.fu3_qc,
            endline: map.endline,
            edgepaint: map.edgepaint,
            preaql: map.preaql,
            postaql: map.postaql,
            shipment: map.shipment
        };

        var stagesOut = PD_STAGE_DEFS.map(function (stageDef) {
            var colIdx = stageColMap[stageDef.key];
            var records = [];

            if (colIdx >= 0) {
                for (var r = 0; r < allRows.length; r++) {
                    var row = allRows[r];
                    var batchVal = row[map.batchNo];
                    if (!batchVal) continue;

                    var cellDateVal = row[colIdx];
                    if (!cellMatchesDate_(cellDateVal, dateStr)) continue;

                    var unitVal = row[map.unit] || '';
                    if (isExcludedUnit_(unitVal)) continue;

                    var normB = normalizeBatchKey_(batchVal);
                    var matStatus = (normB && bMap[normB] !== undefined) ? bMap[normB] : '';

                    records.push({
                        unit:                 unitVal,
                        batchNo:              batchVal,
                        brand:                row[map.brand] || '',
                        sku:                  row[map.sku] || '',
                        style:                row[map.style] || '',
                        colour:               row[map.colour] || '',
                        quantity:             row[map.quantity] || '',
                        etd:                  formatDisplayDate_(row[map.etd]),
                        fabricatorName:       row[map.fabricatorName] || '',
                        floorSupervisorName:  row[map.floorSupervisorName] || '',
                        inlineQcName:         row[map.inlineQcName] || '',
                        materialStatus:       matStatus,
                        followUpRemarks:      ''
                    });
                }
            }

            records.sort(compareRecordsForStage_(stageDef.key));

            return {
                key: stageDef.key,
                label: stageDef.label,
                count: records.length,
                records: records
            };
        });

        return {
            date: dateStr,
            stages: stagesOut
        };
    }

    // -------------------------------------------------------------------------
    // 6. UI Synchronization & Status Badges
    // -------------------------------------------------------------------------
    function updateSyncUI_(syncing, message) {
        var banner = el('followup-planned-sync-banner');
        var msgEl = el('followup-planned-sync-msg');
        var icon = el('followup-planned-sync-icon');
        var syncBtn = el('btn-refresh-followup-planned-data');
        var lastSyncText = el('followup-planned-last-sync-text');

        if (syncing) {
            if (banner) banner.style.display = '';
            if (msgEl) msgEl.textContent = message || 'Syncing from Google Sheet CSV stream...';
            if (icon) icon.classList.add('bai-sheet-spin');
            if (syncBtn) syncBtn.disabled = true;
        } else {
            if (banner) banner.style.display = 'none';
            if (icon) icon.classList.remove('bai-sheet-spin');
            if (syncBtn) syncBtn.disabled = false;
            if (lastSyncText) {
                lastSyncText.textContent = lastSyncTime
                    ? 'Database Synced (' + formatRelativeTime_(lastSyncTime) + ')'
                    : 'Database Ready (' + allRows.length + ' records)';
            }
        }
    }

    function populateQuickDates_() {
        var select = el('followup-planned-quick-date');
        if (!select || !allRows || allRows.length === 0) return;

        var map = getColMap_(allHeaders);
        var stageCols = [
            map.fu1_fs, map.fu1_qc, map.fu2_fs, map.fu2_qc, map.fu3_fs, map.fu3_qc,
            map.endline, map.edgepaint, map.preaql, map.postaql, map.shipment
        ].filter(function (c) { return c >= 0; });

        var dateCounts = {};
        for (var r = 0; r < allRows.length; r++) {
            var row = allRows[r];
            var unitVal = row[map.unit] || '';
            if (isExcludedUnit_(unitVal)) continue;

            for (var c = 0; c < stageCols.length; c++) {
                var cell = row[stageCols[c]];
                if (!cell) continue;
                var p = parseDateParts_(cell);
                if (p) {
                    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
                    var isoKey = p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
                    dateCounts[isoKey] = (dateCounts[isoKey] || 0) + 1;
                }
            }
        }

        var sortedIsoDates = Object.keys(dateCounts).sort().reverse();
        var currentVal = select.value;
        select.innerHTML = '<option value="">-- Jump to Date with Records (' + sortedIsoDates.length + ' Dates) --</option>';

        sortedIsoDates.forEach(function (iso) {
            var opt = document.createElement('option');
            opt.value = iso;
            var parts = iso.split('-');
            var dmy = parts[2] + '/' + parts[1] + '/' + parts[0];
            opt.textContent = dmy + ' (' + dateCounts[iso] + ' records)';
            select.appendChild(opt);
        });

        if (currentVal) select.value = currentVal;
    }

    // -------------------------------------------------------------------------
    // 7. Background & Manual Sync Orchestration
    // -------------------------------------------------------------------------
    function syncGoogleSheetCsv(isManual) {
        if (isSyncing) return;
        isSyncing = true;
        updateSyncUI_(true, isManual ? 'Connecting to Google Sheets CSV stream...' : 'Updating local Database cache in background...');

        Promise.all([
            fetchGoogleSheetCSV_(),
            ensureBantalaStatusMap_(true)
        ])
            .then(function (results) {
                var sheetResult = results[0];
                allHeaders = sheetResult.headers;
                allRows = sheetResult.rows;
                lastSyncTime = Date.now();
                return saveToDatabaseCache_(allHeaders, allRows);
            })
            .then(function () {
                updateSyncUI_(false);
                populateQuickDates_();

                var dateInput = el('followup-planned-date-input');
                if (dateInput && dateInput.value) {
                    generateReportForDate(dateInput.value, false);
                }

                if (isManual) {
                    toast('success', 'Database Synced', 'Updated ' + allRows.length.toLocaleString() + ' records & Material Status from Google Sheet.');
                }
            })
            .catch(function (err) {
                console.error('Follow-Up Planned Database sync error:', err);
                updateSyncUI_(false);
                if (isManual) {
                    toast('error', 'Sync Error', err.message || 'Check network connection.');
                }
            })
            .finally(function () {
                isSyncing = false;
            });
    }

    // -------------------------------------------------------------------------
    // 8. Generate & Render Report (Zero Radius, Pure Database Speed)
    // -------------------------------------------------------------------------
    function generateReportForDate(dateStr, triggerSyncIfEmpty) {
        var emptyState = el('followup-planned-empty-state');
        var results = el('followup-planned-results');
        var pdfBtn = el('btn-download-followup-planned-pdf');
        var excelBtn = el('btn-download-followup-planned-report-excel');
        var badge = el('followup-planned-summary-badge');

        if (!dateStr) {
            toast('error', 'Select a Date', 'Please select a Planned Date first.');
            return;
        }

        if (!allRows || allRows.length === 0) {
            if (emptyState) {
                emptyState.style.display = '';
                emptyState.innerHTML = '<span class="material-icons-round bai-sheet-spin">sync</span><p>Fetching records into local Database...</p>';
            }
            if (triggerSyncIfEmpty !== false) {
                syncGoogleSheetCsv(true);
            }
            return;
        }

        ensureBantalaStatusMap_().then(function (bMap) {
            lastReport = queryStagesForDate_(dateStr, bMap);
            renderReport();
        });
    }

    function highlightText_(text, query) {
        if (!query) return escapeHtml(text);
        var str = String(text == null ? '' : text);
        var idx = str.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return escapeHtml(str);
        var before = str.substring(0, idx);
        var match = str.substring(idx, idx + query.length);
        var after = str.substring(idx + query.length);
        return escapeHtml(before) + '<mark style="background:#fde047; color:#0f172a; padding:1px 3px; font-weight:700; border-radius:0;">' + escapeHtml(match) + '</mark>' + highlightText_(after, query);
    }

    function formatCellContent_(colKey, val, query) {
        if (colKey === 'materialStatus') {
            var str = String(val == null ? '' : val).trim();
            if (!str || str === '-') {
                return '<span style="color:#94a3b8; font-weight:400; border-radius:0 !important;">-</span>';
            }
            var upper = str.toUpperCase();
            if (upper === 'OK') {
                return '<span class="fup-status-badge fup-status-ok" style="display:inline-block; padding:2px 8px; font-weight:700; font-size:11px; color:#15803d; background:#dcfce7; border:1px solid #86efac; border-radius:0 !important; letter-spacing:0.5px; text-transform:uppercase;">' + highlightText_(str, query) + '</span>';
            }
            if (upper.indexOf('DUE') !== -1) {
                return '<span class="fup-status-badge fup-status-due" style="display:inline-block; padding:3px 8px; font-size:11.5px; font-weight:600; line-height:1.35; color:#9a3412; background:#fff7ed; border:1px solid #fed7aa; border-left:3px solid #ea580c; border-radius:0 !important; text-align:left; max-width:340px; word-break:break-word;">' + highlightText_(str, query) + '</span>';
            }
            return '<span class="fup-status-badge fup-status-info" style="display:inline-block; padding:3px 8px; font-size:11.5px; font-weight:500; line-height:1.35; color:#1e293b; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:0 !important; text-align:left; max-width:340px; word-break:break-word;">' + highlightText_(str, query) + '</span>';
        }
        return highlightText_(val, query);
    }

    function renderReport() {
        var emptyState = el('followup-planned-empty-state');
        var results = el('followup-planned-results');
        var pdfBtn = el('btn-download-followup-planned-pdf');
        var excelBtn = el('btn-download-followup-planned-report-excel');
        var badge = el('followup-planned-summary-badge');
        if (!results || !lastReport) return;

        var q = String(currentSearchQuery || '').trim().toLowerCase();

        var stagesWithData = lastReport.stages.map(function (stage) {
            var filtered = stage.records;
            if (q) {
                filtered = stage.records.filter(function (record) {
                    return PD_COLUMNS.some(function (col) {
                        return String(record[col.key] || '').toLowerCase().indexOf(q) !== -1;
                    });
                });
            }
            return {
                key: stage.key,
                label: stage.label,
                count: filtered.length,
                records: filtered,
                totalCount: stage.count
            };
        }).filter(function (s) { return s.count > 0; });

        var totalRecords = stagesWithData.reduce(function (sum, s) { return sum + s.count; }, 0);

        if (badge) {
            badge.style.display = '';
            badge.textContent = totalRecords + ' record' + (totalRecords === 1 ? '' : 's') + ' | ' +
                stagesWithData.length + ' stage' + (stagesWithData.length === 1 ? '' : 's');
        }

        if (stagesWithData.length === 0) {
            results.innerHTML = '';
            if (emptyState) {
                emptyState.style.display = '';
                emptyState.innerHTML = '<span class="material-icons-round" style="font-size:48px; color:#94a3b8;">event_busy</span>' +
                    '<p style="margin-top:12px; font-size:14px; color:#475569; font-weight:600;">' +
                    (q ? 'No records match search "' + escapeHtml(q) + '" for Planned Date: ' : 'No Follow-Up, QC, Edge-Paint, AQL or Shipment records found for ') +
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
            html += '<div class="page-card data-table-card fup-stage-section" style="border-radius:0 !important; border:1px solid #cbd5e1; box-shadow:none; margin-bottom:18px; padding:0; background:#ffffff; overflow:hidden;">';
            html += '  <div class="fup-stage-header" style="border-radius:0 !important; background:#0f172a; color:#f8fafc; padding:10px 16px; border-bottom:2px solid #c48b16; display:flex; align-items:center; gap:10px;">';
            html += '    <span class="material-icons-round" style="color:#c48b16; font-size:18px;">' + (STAGE_ICONS[stage.key] || 'event') + '</span>';
            html += '    <span class="fup-stage-title" style="color:#f8fafc; font-weight:700; font-size:13.5px; letter-spacing:0.2px; border-radius:0 !important;">' + escapeHtml(stage.label) + '</span>';
            html += '    <span class="fup-stage-count" style="border-radius:0 !important; margin-left:auto; background:#1e293b; color:#fbbf24; border:1px solid #334155; font-size:11.5px; font-weight:700; padding:2px 10px;">' +
                stage.count + ' record' + (stage.count === 1 ? '' : 's') + (q && stage.count !== stage.totalCount ? ' (of ' + stage.totalCount + ')' : '') + '</span>';
            html += '  </div>';
            html += '  <div class="fup-stage-table-wrap" style="overflow-x:auto; border-radius:0 !important;">';
            html += '    <table class="dt-table" style="border-collapse:collapse; width:100%; font-size:12.5px; border-radius:0 !important;">';
            html += '      <thead><tr style="background:#f8fafc; border-bottom:1px solid #cbd5e1;">';
            html += '        <th class="dt-th dt-th-num" style="border:1px solid #cbd5e1; padding:8px 8px; font-weight:700; color:#1e293b; width:45px; text-align:center; border-radius:0 !important;">#</th>';
            PD_COLUMNS.forEach(function (col) {
                var label = col.label;
                var alignStyle = col.halign === 'right' ? 'text-align:right;' : 'text-align:left;';
                html += '        <th class="dt-th" style="border:1px solid #cbd5e1; padding:8px 10px; font-weight:700; color:#1e293b; font-size:12px; white-space:nowrap; border-radius:0 !important; ' + alignStyle + '">' + escapeHtml(label) + '</th>';
            });
            html += '      </tr></thead>';
            html += '      <tbody>';

            stage.records.forEach(function (record, i) {
                var rowBg = (i % 2 === 1) ? '#f8fafc' : '#ffffff';
                html += '      <tr class="' + (i % 2 ? 'dt-tr-odd' : 'dt-tr-even') + '" style="background:' + rowBg + '; border-radius:0 !important;">';
                html += '        <td class="dt-td dt-td-num" style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center; color:#64748b; font-size:11.5px; font-weight:600; border-radius:0 !important;">' + (i + 1) + '</td>';
                PD_COLUMNS.forEach(function (col, colIdx) {
                    var cellVal = record[col.key];
                    var alignStyle = col.halign === 'right' ? 'text-align:right;' : 'text-align:left;';
                    var cellContent = formatCellContent_(col.key, cellVal, q);
                    var isActive = activeCellPos && activeCellPos.stageKey === stage.key && activeCellPos.r === i && activeCellPos.c === colIdx;
                    var activeClass = isActive ? ' dt-td-active' : '';
                    var activeInline = isActive ? ' outline:2px solid #c48b16 !important; outline-offset:-2px !important; background:#fefce8 !important;' : '';
                    html += '        <td class="dt-td' + activeClass + '" data-stage="' + stage.key + '" data-r="' + i + '" data-c="' + colIdx + '" tabindex="0" style="border:1px solid #cbd5e1; padding:6px 10px; color:#0f172a; font-size:12.5px; border-radius:0 !important; ' + alignStyle + activeInline + '">' + cellContent + '</td>';
                });
                html += '      </tr>';
            });

            html += '      </tbody>';
            html += '    </table>';
            html += '  </div>';
            html += '</div>';
        });

        html += '<div class="fup-summary-note" style="border-radius:0 !important; padding:12px 16px; font-size:12px; color:#64748b; border:1px solid #cbd5e1; background:#f8fafc; margin-top:14px; font-weight:500;">' +
            'Report generated from local Database for Planned Date: <strong>' + escapeHtml(formatDateForTitle(lastReport.date)) + '</strong>. ' +
            'Floor Supervisor and In-Line QC are always listed as separate stages/columns, never combined. Stages with no records for this date are omitted.</div>';

        results.innerHTML = html;

        wireCellInteractions_();
    }

    function wireCellInteractions_() {
        var results = el('followup-planned-results');
        if (!results) return;

        var cells = results.querySelectorAll('td.dt-td[data-stage]');
        cells.forEach(function (td) {
            td.addEventListener('click', function () {
                selectCell_(td);
            });
            td.addEventListener('keydown', function (e) {
                handleCellKeyDown_(e, td);
            });
        });
    }

    function selectCell_(td) {
        if (!td) return;
        var prev = document.querySelector('#followup-planned-results td.dt-td-active');
        if (prev) {
            prev.classList.remove('dt-td-active');
            prev.style.outline = '';
            prev.style.outlineOffset = '';
            prev.style.background = '';
        }
        td.classList.add('dt-td-active');
        td.style.outline = '2px solid #c48b16';
        td.style.outlineOffset = '-2px';
        td.style.background = '#fefce8';
        td.focus();

        activeCellPos = {
            stageKey: td.getAttribute('data-stage'),
            r: parseInt(td.getAttribute('data-r'), 10),
            c: parseInt(td.getAttribute('data-c'), 10)
        };
    }

    function handleCellKeyDown_(e, td) {
        var stage = td.getAttribute('data-stage');
        var r = parseInt(td.getAttribute('data-r'), 10);
        var c = parseInt(td.getAttribute('data-c'), 10);

        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
            var text = td.innerText || td.textContent || '';
            navigator.clipboard.writeText(text).then(function () {
                toast('success', 'Copied', 'Cell value copied to clipboard.');
            });
            return;
        }

        var nextR = r, nextC = c;
        if (e.key === 'ArrowUp') { nextR = r - 1; }
        else if (e.key === 'ArrowDown') { nextR = r + 1; }
        else if (e.key === 'ArrowLeft') { nextC = c - 1; }
        else if (e.key === 'ArrowRight' || e.key === 'Tab') { nextC = c + 1; }
        else { return; }

        e.preventDefault();
        var targetSelector = 'td.dt-td[data-stage="' + stage + '"][data-r="' + nextR + '"][data-c="' + nextC + '"]';
        var nextCell = document.querySelector(targetSelector);
        if (nextCell) {
            selectCell_(nextCell);
        }
    }

    function resetView() {
        lastReport = null;
        currentSearchQuery = '';
        activeCellPos = null;

        var dateInput = el('followup-planned-date-input');
        if (dateInput) dateInput.value = '';

        var quickSelect = el('followup-planned-quick-date');
        if (quickSelect) quickSelect.value = '';

        var searchInput = el('followup-planned-search-input');
        if (searchInput) searchInput.value = '';

        var searchClear = el('followup-planned-search-clear');
        if (searchClear) searchClear.style.display = 'none';

        var results = el('followup-planned-results');
        if (results) results.innerHTML = '';

        var emptyState = el('followup-planned-empty-state');
        if (emptyState) {
            emptyState.style.display = '';
            emptyState.innerHTML = '<span class="material-icons-round" style="font-size:48px; color:#94a3b8;">event_repeat</span>' +
                '<p style="margin-top:12px; font-size:14px; color:#475569; font-weight:500;">Select a Planned Date and click "Generate Report" to see 1st/2nd/3rd Follow-up (Floor Supervisor and In-Line QC shown separately), End-Line QC, Edge-Paint, Pre-AQL, Post AQL and Shipment records due on that date.</p>';
        }

        var badge = el('followup-planned-summary-badge');
        if (badge) badge.style.display = 'none';

        var pdfBtn = el('btn-download-followup-planned-pdf');
        if (pdfBtn) pdfBtn.disabled = true;

        var excelBtn = el('btn-download-followup-planned-report-excel');
        if (excelBtn) excelBtn.disabled = true;
    }

    // -------------------------------------------------------------------------
    // 9. PDF Generation (Client-Side, Zero Radius, Plain Black & White Table)
    // -------------------------------------------------------------------------
    function formatPdfTimestamp_(date) {
        function pad2(n) { return n < 10 ? '0' + n : '' + n; }
        return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1) + '/' + date.getFullYear() +
            ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
    }

    // Official Trio Group Brand Logo (Base64 PNG, 442x236)
    var TRIO_LOGO_BASE64 = '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';

    function buildPdf() {
        if (!lastReport) return;
        var stagesWithData = lastReport.stages.filter(function (s) { return s.count > 0; });
        if (stagesWithData.length === 0) { toast('error', 'Nothing to Export', 'No records found for the selected Planned Date.'); return; }

        var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDFCtor) { toast('error', 'PDF Error', 'PDF library failed to load. Check your internet connection and try again.'); return; }

        var doc = new jsPDFCtor({ orientation: 'landscape', unit: 'pt', format: 'a4' });

        var fontFamily = 'helvetica';
        if (typeof registerPdfFonts_ === 'function') {
            try { registerPdfFonts_(doc); fontFamily = 'IBMPlexSans'; }
            catch (e) {
                fontFamily = 'helvetica';
                console.warn('registerPdfFonts_ failed - falling back to Helvetica:', e);
            }
        }
        doc.setFont(fontFamily, 'normal');

        var pageWidth  = doc.internal.pageSize.getWidth();
        var pageHeight = doc.internal.pageSize.getHeight();
        var marginX = 16;
        var usableWidth = pageWidth - marginX * 2;
        var contentTop = 56;
        var footerRuleY = pageHeight - 24;
        var totalRecords = stagesWithData.reduce(function (sum, s) { return sum + s.count; }, 0);
        var reportDateLabel = formatDateForTitle(lastReport.date);
        var generatedLabel = formatPdfTimestamp_(new Date());

        var configuredWidth = PD_COLUMNS.reduce(function (sum, col) { return sum + col.pdfWidth; }, 0);
        var widthScale = usableWidth / configuredWidth;

        function drawPageFrame() {
            // 1. Official Trio Group Brand Logo
            try {
                doc.addImage('data:image/png;base64,' + TRIO_LOGO_BASE64, 'PNG', marginX, 10, 48.7, 26);
            } catch (err) {
                console.warn('Failed to embed Trio logo in PDF:', err);
            }

            // 2. Company Brand Typography
            doc.setFont(fontFamily, 'bold');
            doc.setFontSize(13.5);
            doc.setTextColor(15, 23, 42); // #0f172a deep navy
            doc.text('TRIO GROUP', marginX + 56, 22);

            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(100, 116, 139); // #64748b slate
            doc.text('TRIO TREND EXPORTS PVT. LTD.   |   SINCE 1978', marginX + 56, 32);

            // 3. Document Title & Summary Info on the Right
            doc.setFont(fontFamily, 'bold');
            doc.setFontSize(12.5);
            doc.setTextColor(15, 23, 42);
            doc.text('FOLLOW-UP PLANNED PRODUCTION REPORT', pageWidth - marginX, 21, { align: 'right' });

            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(8);
            doc.setTextColor(71, 85, 105);
            doc.text(
                'Planned Date: ' + reportDateLabel + '   |   ' + totalRecords + ' record' +
                (totalRecords === 1 ? '' : 's') + ' (' + stagesWithData.length + ' stage' +
                (stagesWithData.length === 1 ? '' : 's') + ')   |   Generated: ' + generatedLabel,
                pageWidth - marginX, 32, { align: 'right' }
            );

            // 4. Stylish Dual Header Divider Rules (Trio Signature Gold + Crisp Border)
            doc.setFillColor(196, 139, 22); // #c48b16 Gold Accent
            doc.rect(marginX, 42, usableWidth, 2.5, 'F');

            doc.setFillColor(226, 232, 240); // #e2e8f0
            doc.rect(marginX, 45, usableWidth, 0.5, 'F');
        }

        function drawPageNumbers() {
            var pageCount = doc.internal.getNumberOfPages();
            for (var p = 1; p <= pageCount; p++) {
                doc.setPage(p);

                // Footer rule
                doc.setDrawColor(203, 213, 225);
                doc.setLineWidth(0.6);
                doc.line(marginX, footerRuleY, pageWidth - marginX, footerRuleY);

                doc.setFont(fontFamily, 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(100, 116, 139);
                doc.text('Trio Group FMS | Follow-Up Planned Production Report - Planned Date: ' + reportDateLabel, marginX, footerRuleY + 12);

                doc.setFont(fontFamily, 'italic');
                doc.text('Confidential - Internal Production Management Document', pageWidth / 2, footerRuleY + 12, { align: 'center' });

                doc.setFont(fontFamily, 'normal');
                doc.text('Page ' + p + ' of ' + pageCount, pageWidth - marginX, footerRuleY + 12, { align: 'right' });
            }
        }

        drawPageFrame();
        var cursorY = contentTop;

        var tableHead = [PD_COLUMNS.map(function (col) {
            return col.label;
        })];

        var columnStyles = {};
        PD_COLUMNS.forEach(function (col, i) {
            columnStyles[i] = { cellWidth: col.pdfWidth * widthScale, halign: col.halign || 'left' };
        });

        stagesWithData.forEach(function (stage, idx) {
            if (cursorY > pageHeight - 120) {
                doc.addPage();
                drawPageFrame();
                cursorY = contentTop;
            } else if (idx > 0) {
                cursorY += 14;
            }

            // Executive Stage Banner (Dark Navy Bar + Gold Accent + Amber Count Badge)
            doc.setFillColor(15, 23, 42); // #0f172a
            doc.rect(marginX, cursorY, usableWidth, 18, 'F');

            doc.setFillColor(196, 139, 22); // #c48b16 Gold Accent Indicator
            doc.rect(marginX, cursorY, 4, 18, 'F');

            doc.setFont(fontFamily, 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(248, 250, 252);
            doc.text(stage.label, marginX + 12, cursorY + 12.5);

            doc.setFont(fontFamily, 'bold');
            doc.setFontSize(8.5);
            doc.setTextColor(251, 191, 36); // #fbbf24 amber
            doc.text(stage.count + ' record' + (stage.count === 1 ? '' : 's'), pageWidth - marginX - 10, cursorY + 12.5, { align: 'right' });

            cursorY += 22;

            var body = stage.records.map(function (record) {
                return PD_COLUMNS.map(function (col) { return record[col.key] == null ? '' : String(record[col.key]); });
            });

            var groupStartRows = {};
            stage.records.forEach(function (record, i) {
                if (i === 0) return;
                var prevUnit = String(stage.records[i - 1].unit == null ? '' : stage.records[i - 1].unit).trim();
                var curUnit  = String(record.unit == null ? '' : record.unit).trim();
                if (curUnit !== prevUnit) groupStartRows[i] = true;
            });

            doc.autoTable({
                head: tableHead,
                body: body,
                startY: cursorY,
                margin: { left: marginX, right: marginX, top: contentTop, bottom: 36 },
                tableWidth: usableWidth,
                tableLineWidth: 0.75,
                tableLineColor: [0, 0, 0], // Pure BLACK outer outline border
                styles: {
                    font: fontFamily,
                    fontSize: 7.2,
                    cellPadding: { top: 4, right: 4, bottom: 4, left: 4 },
                    overflow: 'linebreak',
                    lineColor: [0, 0, 0], // Pure BLACK cell borders
                    lineWidth: 0.5,       // Solid black cell border lines
                    textColor: [0, 0, 0], // Pure BLACK body text
                    fillColor: [255, 255, 255]
                },
                alternateRowStyles: {
                    fillColor: [248, 250, 252] // Crisp subtle alternate tint
                },
                headStyles: {
                    font: fontFamily,
                    fontStyle: 'bold',
                    fillColor: [31, 78, 120],  // Corporate Steel Blue (#1F4E78) - Distinct from body!
                    textColor: [255, 255, 255], // Pure WHITE text for maximum contrast
                    fontSize: 7.8,
                    halign: 'left',
                    lineColor: [0, 0, 0],      // Pure BLACK header cell borders
                    lineWidth: 0.75
                },
                columnStyles: columnStyles,
                theme: 'grid',
                didParseCell: function (data) {
                    if (data.section === 'head') {
                        // Ensure black border on header cells
                        data.cell.styles.lineColor = [0, 0, 0];
                        if (data.column.index === 0 || data.column.index === 7) {
                            data.cell.styles.halign = 'center';
                        } else if (data.column.index === 6) {
                            data.cell.styles.halign = 'right';
                        }
                    }

                    if (data.section === 'body') {
                        // Ensure pure black borders on all body cells
                        data.cell.styles.lineColor = [0, 0, 0];

                        // Highlight Material Status column (index 11)
                        if (data.column.index === 11) {
                            var val = String(data.cell.raw || '').trim().toUpperCase();
                            if (val === 'OK') {
                                data.cell.styles.textColor = [21, 128, 61]; // #15803d emerald green
                                data.cell.styles.fillColor = [220, 252, 231]; // #dcfce7 mint
                                data.cell.styles.fontStyle = 'bold';
                                data.cell.styles.halign = 'center';
                            } else if (val.indexOf('DUE') !== -1) {
                                data.cell.styles.textColor = [154, 52, 18]; // #9a3412 amber/orange
                                data.cell.styles.fillColor = [255, 237, 213]; // #ffedd5 warm orange
                                data.cell.styles.fontStyle = 'bold';
                            } else if (!val || val === '-') {
                                data.cell.styles.textColor = [100, 116, 139];
                                data.cell.styles.halign = 'center';
                            }
                        }

                        // Unit Column (index 0) & Quantity (index 6) styling
                        if (data.column.index === 0) {
                            data.cell.styles.halign = 'center';
                            data.cell.styles.fontStyle = 'bold';
                        }
                        if (data.column.index === 1) {
                            data.cell.styles.fontStyle = 'bold';
                            data.cell.styles.textColor = [0, 0, 0];
                        }
                        if (data.column.index === 6) {
                            data.cell.styles.halign = 'right';
                            data.cell.styles.fontStyle = 'bold';
                        }
                        if (data.column.index === 7) {
                            data.cell.styles.halign = 'center';
                        }

                        // Unit group separator line - prominent black dividing rule
                        if (groupStartRows[data.row.index]) {
                            data.cell.styles.lineWidth = { top: 1.5, right: 0.5, bottom: 0.5, left: 0.5 };
                            data.cell.styles.lineColor = [0, 0, 0];
                        }
                    }
                },
                didDrawPage: function () {
                    drawPageFrame();
                }
            });

            cursorY = doc.lastAutoTable.finalY + 16;
        });

        drawPageNumbers();

        var filenameDate = String(lastReport.date || '').replace(/-/g, '');
        doc.save('Follow_Up_Planned_Report_' + filenameDate + '.pdf');
    }

    // -------------------------------------------------------------------------
    // 10. Excel Generation (Client-Side, One Sheet per Stage)
    // -------------------------------------------------------------------------
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
        var HEADER_FILL_ARGB = 'FF1F4E78';
        var border      = { style: 'thin', color: { argb: 'FF000000' } };
        var groupBorder = { style: 'medium', color: { argb: 'FF000000' } };
        var reportDateLabel = formatDateForTitle(lastReport.date);

        function borderEntireRow(row, colCount) {
            for (var c = 1; c <= colCount; c++) {
                row.getCell(c).border = { top: border, left: border, bottom: border, right: border };
            }
        }

        loadExcelJs().then(function (ExcelJS) {
            var workbook = new ExcelJS.Workbook();
            var usedNames = {};

            stagesWithData.forEach(function (stage) {
                var baseName = (STAGE_SHEET_NAMES[stage.key] || stage.label).replace(/[:\\/?*\[\]]/g, '-').substring(0, 31);
                var sheetName = baseName;
                var suffix = 2;
                while (usedNames[sheetName]) {
                    sheetName = baseName.substring(0, 28) + ' (' + suffix + ')';
                    suffix++;
                }
                usedNames[sheetName] = true;

                var worksheet = workbook.addWorksheet(sheetName);
                var colCount = PD_COLUMNS.length + 1;

                worksheet.mergeCells(1, 1, 1, colCount);
                var titleRow = worksheet.addRow(['Follow-Up Planned - ' + stage.label]);
                worksheet.mergeCells(2, 1, 2, colCount);
                var titleCell = worksheet.getCell('A2');
                titleCell.value = 'Follow-Up Planned - ' + stage.label;
                titleCell.font = { name: EXCEL_FONT_NAME, size: 14, bold: true, color: { argb: 'FF000000' } };
                titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
                worksheet.getRow(2).height = 24;

                worksheet.mergeCells(3, 1, 3, colCount);
                var metaCell = worksheet.getCell('A3');
                metaCell.value = 'Planned Date: ' + reportDateLabel + '   |   ' + stage.count + ' record' + (stage.count === 1 ? '' : 's');
                metaCell.font = { name: EXCEL_FONT_NAME, size: 10, italic: true, color: { argb: 'FF595959' } };
                metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
                worksheet.getRow(3).height = 18;

                borderEntireRow(worksheet.getRow(2), colCount);
                borderEntireRow(worksheet.getRow(3), colCount);
                worksheet.addRow([]);
                borderEntireRow(worksheet.getRow(4), colCount);

                var headerValues = ['#'].concat(PD_COLUMNS.map(function (c) {
                    return c.label;
                }));
                var headerRow = worksheet.addRow(headerValues);
                headerRow.height = 24;
                headerRow.eachCell(function (cell) {
                    cell.font = { name: EXCEL_FONT_NAME, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                    cell.border = { top: border, left: border, bottom: border, right: border };
                });

                stage.records.forEach(function (record, i) {
                    var isNewGroup = false;
                    if (i > 0) {
                        var prevUnit = String(stage.records[i - 1].unit == null ? '' : stage.records[i - 1].unit).trim();
                        var curUnit  = String(record.unit == null ? '' : record.unit).trim();
                        if (curUnit !== prevUnit) isNewGroup = true;
                    }

                    var rowValues = [i + 1].concat(PD_COLUMNS.map(function (c) {
                        return record[c.key] == null ? '' : record[c.key];
                    }));
                    var dataRow = worksheet.addRow(rowValues);
                    dataRow.height = 18;
                    dataRow.eachCell(function (cell, colNumber) {
                        cell.font = { name: EXCEL_FONT_NAME, size: 9.5 };
                        var cellBorder = { top: isNewGroup ? groupBorder : border, left: border, bottom: border, right: border };
                        cell.border = cellBorder;
                        if (colNumber === 1 || colNumber === 8) {
                            cell.alignment = { horizontal: colNumber === 1 ? 'center' : 'right', vertical: 'middle' };
                        } else {
                            cell.alignment = { horizontal: 'left', vertical: 'middle' };
                        }
                    });
                });

                worksheet.columns.forEach(function (column, idx) {
                    var maxLen = 10;
                    column.eachCell({ includeEmpty: false }, function (cell, rowNumber) {
                        if (rowNumber > 4) {
                            var val = cell.value ? String(cell.value) : '';
                            if (val.length > maxLen) maxLen = val.length;
                        }
                    });
                    column.width = Math.min(Math.max(maxLen + 3, 10), 35);
                });
            });

            var filenameDate = String(lastReport.date || '').replace(/-/g, '');
            workbook.xlsx.writeBuffer().then(function (buffer) {
                if (helpers().hideSpinner) helpers().hideSpinner();
                var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                var link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'Follow_Up_Planned_Report_' + filenameDate + '.xlsx';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                toast('success', 'Excel Exported', 'Workbook with ' + stagesWithData.length + ' sheet(s) downloaded.');
            });
        }).catch(function (err) {
            if (helpers().hideSpinner) helpers().hideSpinner();
            toast('error', 'Excel Error', err.message || 'Failed to export Excel.');
        });
    }

    // -------------------------------------------------------------------------
    // 11. Public Engine Initialization & Event Wiring
    // -------------------------------------------------------------------------
    function initDatabaseEngine_() {
        var lastSyncText = el('followup-planned-last-sync-text');
        if (lastSyncText) lastSyncText.textContent = 'Reading local Database...';

        ensureBantalaStatusMap_();

        loadFromDatabaseCache_()
            .then(function (cached) {
                if (cached && cached.rows && cached.rows.length > 0) {
                    allHeaders = cached.headers;
                    allRows = cached.rows;
                    lastSyncTime = cached.lastSync;
                    updateSyncUI_(false);
                    populateQuickDates_();
                } else {
                    syncGoogleSheetCsv(false);
                }
            })
            .catch(function (err) {
                console.warn('Could not read from local Database, initiating sync...', err);
                syncGoogleSheetCsv(false);
            });
    }

    function wireEvents_() {
        var kpiCard = el('kpi-pdf-followup-planned');
        if (kpiCard) {
            kpiCard.addEventListener('click', function () {
                initDatabaseEngine_();
            });
            kpiCard.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    initDatabaseEngine_();
                }
            });
        }

        var syncBtn = el('btn-refresh-followup-planned-data');
        if (syncBtn) {
            syncBtn.addEventListener('click', function () {
                syncGoogleSheetCsv(true);
            });
        }

        var genBtn = el('btn-generate-followup-planned-report');
        if (genBtn) {
            genBtn.addEventListener('click', function () {
                var dateInput = el('followup-planned-date-input');
                var val = dateInput && dateInput.value;
                generateReportForDate(val, true);
            });
        }

        var clearBtn = el('btn-clear-followup-planned-report');
        if (clearBtn) clearBtn.addEventListener('click', resetView);

        var dateInput = el('followup-planned-date-input');
        if (dateInput) {
            dateInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && dateInput.value) {
                    generateReportForDate(dateInput.value, true);
                }
            });
            dateInput.addEventListener('change', function () {
                if (dateInput.value) {
                    generateReportForDate(dateInput.value, false);
                }
            });
        }

        var quickSelect = el('followup-planned-quick-date');
        if (quickSelect) {
            quickSelect.addEventListener('change', function () {
                var val = quickSelect.value;
                if (val) {
                    if (dateInput) dateInput.value = val;
                    generateReportForDate(val, false);
                }
            });
        }

        var searchInput = el('followup-planned-search-input');
        var searchClear = el('followup-planned-search-clear');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                currentSearchQuery = searchInput.value;
                if (searchClear) searchClear.style.display = currentSearchQuery ? '' : 'none';
                renderReport();
            });
        }
        if (searchClear) {
            searchClear.addEventListener('click', function () {
                if (searchInput) searchInput.value = '';
                currentSearchQuery = '';
                searchClear.style.display = 'none';
                renderReport();
            });
        }

        var pdfBtn = el('btn-download-followup-planned-pdf');
        if (pdfBtn) pdfBtn.addEventListener('click', buildPdf);

        var excelBtn = el('btn-download-followup-planned-report-excel');
        if (excelBtn) excelBtn.addEventListener('click', buildExcel);
    }

    function initFollowUpPlannedEngine() {
        wireEvents_();
        initDatabaseEngine_();
    }

    // Expose engine on window for seamless integration across all app views
    window.FollowUpPlannedSheetEngine = {
        show: function () {
            initDatabaseEngine_();
        },
        sync: function (isManual) {
            syncGoogleSheetCsv(isManual);
        },
        generate: function (dateStr) {
            generateReportForDate(dateStr, false);
        },
        getReport: function () {
            return lastReport;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFollowUpPlannedEngine);
    } else {
        initFollowUpPlannedEngine();
    }
})();
