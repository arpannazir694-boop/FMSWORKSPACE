// Store.gs - standalone Apps Script Web App for the "Store" section.
// Deploy this file as the Web App URL configured in web.js.
//
// Powers two sub-views on the Store page:
//   1. Pre-Production for Store  -> "STORE" sheet,        range B1:K (editable, see updateStoreCell_)
//      2 new columns were inserted in the middle of the range (hence B1:I ->
//      B1:K). The editable Status and Remarks columns are NOT hardcoded to
//      H/I anywhere in this file or in web.js — both this script and web.js
//      always treat them as the LAST and SECOND-TO-LAST columns of whatever
//      range/headers come back, so as long as Status/Remarks remain the
//      right-most two columns in the sheet, no other logic needs to change.
//      Column J (now second-to-last) = In-Stock / Material Removed status (dropdown)
//      Column K (now last)           = free-text remarks column (wide, plain text, user-editable)
//   2. Pre-Production Data       -> "Pre-Prod Data" sheet, range A1:W (read-only)
//
// NOTE: "Pre-Prod Data" is assumed to live in the same spreadsheet as STORE
// (STORE_SPREADSHEET_ID below). If it actually lives in a different Google
// Sheet, just update PREPROD_DATA_SPREADSHEET_ID accordingly.

var STORE_SPREADSHEET_ID = '1t9llK-HxXXdPxTNj5ncHePZ_UKfrQJC0UJAcMwzr1b8';
var STORE_SHEET_NAME = 'STORE';
var STORE_RANGE_FIRST_COLUMN = 2; // Column B

var PREPROD_DATA_SPREADSHEET_ID = STORE_SPREADSHEET_ID; // assumption — change if it's a different workbook
var PREPROD_DATA_SHEET_NAME = 'Pre-Prod Data';
var PREPROD_DATA_RANGE = 'A1:W';

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'getPreProductionForStoreData') return storeJsonOutput_(getPreProductionForStoreData_());
  if (action === 'updateStoreCell') {
    var row = parseInt(e.parameter.row, 10);
    var column = parseInt(e.parameter.column, 10);
    var value = e.parameter.value != null ? e.parameter.value : '';
    return storeJsonOutput_(updateStoreCell_(row, column, value));
  }
  if (action === 'batchUpdateStoreCells') {
    var rawUpdates = (e && e.parameter && e.parameter.updates) || '[]';
    var updates = [];
    try { updates = JSON.parse(rawUpdates); } catch (err) {}
    return storeJsonOutput_(batchUpdateStoreCells_(updates));
  }
  if (action === 'getPreProdData') {
    return storeJsonOutput_(getSheetRangeData_(PREPROD_DATA_SPREADSHEET_ID, PREPROD_DATA_SHEET_NAME, PREPROD_DATA_RANGE));
  }
  return storeJsonOutput_({ success: true, message: 'Store endpoint is running.' });
}

function doPost(e) {
  try {
    var contents = (e && e.postData && e.postData.contents) || '';
    var body = {};
    try {
      body = JSON.parse(contents);
    } catch (err) {
      body = (e && e.parameter) || {};
    }
    var action = body.action || (e && e.parameter && e.parameter.action) || '';

    if (action === 'updateStoreCell') {
      var row = parseInt(body.row, 10);
      var column = parseInt(body.column, 10);
      var value = body.value != null ? body.value : '';
      return storeJsonOutput_(updateStoreCell_(row, column, value));
    }
    if (action === 'batchUpdateStoreCells') {
      var updates = Array.isArray(body.updates) ? body.updates : [];
      return storeJsonOutput_(batchUpdateStoreCells_(updates));
    }
    return storeJsonOutput_({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return storeJsonOutput_({ success: false, error: String(err) });
  }
}

// Reads B1:K. Row 1 is the header; blank rows beneath it are omitted.
// Each returned row is paired with its actual sheet row number (rowNumbers[i])
// so edits made after sorting/filtering/searching on the client still write
// back to the correct row.
function getPreProductionForStoreData_() {
  try {
    var ss = SpreadsheetApp.openById(STORE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(STORE_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Sheet "STORE" was not found.' };

    var lastRow = sheet.getLastRow();
    if (lastRow < 1) return { success: true, headers: [], rows: [], rowNumbers: [] };

    var values = sheet.getRange('B1:K' + lastRow).getDisplayValues();
    var headers = values[0] || [];
    var rows = [];
    var rowNumbers = [];

    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      var hasData = row.some(function (cell) { return String(cell).trim() !== ''; });
      if (hasData) {
        rows.push(row);
        rowNumbers.push(i + 1); // sheet row number (1-based); values[0] is row 1
      }
    }

    return { success: true, headers: headers, rows: rows, rowNumbers: rowNumbers };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Updates a single cell in the STORE sheet with concurrency safety and flush.
// row: 1-based sheet row number (as returned in rowNumbers above).
// column: 0-based index within the B:K range (0 = column B, 1 = column C, ...,
// 8 = column J / status, 9 = column K / remarks).
function updateStoreCell_(row, column, value) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if (!row || isNaN(row) || row < 2) return { success: false, error: 'Invalid row.' };
    if (column == null || isNaN(column) || column < 0) return { success: false, error: 'Invalid column.' };

    var ss = SpreadsheetApp.openById(STORE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(STORE_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Sheet "STORE" was not found.' };

    var sheetColumn = STORE_RANGE_FIRST_COLUMN + column;
    sheet.getRange(row, sheetColumn).setValue(value);
    SpreadsheetApp.flush();
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Batch updates multiple cells in a single sheet open operation
function batchUpdateStoreCells_(updates) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    if (!Array.isArray(updates) || updates.length === 0) return { success: true, count: 0 };

    var ss = SpreadsheetApp.openById(STORE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(STORE_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Sheet "STORE" was not found.' };

    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      var row = parseInt(u.row, 10);
      var col = parseInt(u.column, 10);
      var val = u.value != null ? u.value : '';
      if (row >= 2 && col >= 0) {
        sheet.getRange(row, STORE_RANGE_FIRST_COLUMN + col).setValue(val);
      }
    }
    SpreadsheetApp.flush();
    return { success: true, count: updates.length };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Generic reader for "Pre-Production Data": range A1:W, row 1 is the header.
// Returns { success, headers: [...], rows: [[...]], rowNumbers: [...] } using
// display values so dates/numbers appear formatted exactly as in the sheet.
function getSheetRangeData_(spreadsheetId, sheetName, rangeA1) {
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { success: false, error: 'Sheet "' + sheetName + '" was not found.' };

    var colMatch = rangeA1.match(/^([A-Z]+)(\d+):([A-Z]+)$/i);
    if (!colMatch) return { success: false, error: 'Invalid range configuration: ' + rangeA1 };
    var startCol = colMatch[1], headerRow = parseInt(colMatch[2], 10), endCol = colMatch[3];

    var lastRow = sheet.getLastRow();
    if (lastRow < headerRow) return { success: true, headers: [], rows: [], rowNumbers: [] };

    var values = sheet.getRange(startCol + headerRow + ':' + endCol + lastRow).getDisplayValues();
    var headers = values[0] || [];
    var rows = [];
    var rowNumbers = [];

    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      var hasData = row.some(function (cell) { return String(cell).trim() !== ''; });
      if (hasData) {
        rows.push(row);
        rowNumbers.push(headerRow + i); // actual sheet row number
      }
    }

    return { success: true, headers: headers, rows: rows, rowNumbers: rowNumbers };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function storeJsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}