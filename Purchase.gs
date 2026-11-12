// =============================================================================
// Purchase.gs - deploy this file as its own Web App, supplied to the Purchase
// Order forms (Domestic Purchase Order Form / Import Purchase Order Form) in
// the FMS UI. This uses a SEPARATE spreadsheet from the main FMS spreadsheet.
// =============================================================================
var PURCHASE_SPREADSHEET_ID = '1cX2svN6KA9srwHgXL7OuAp-p5oQkzbkpKaQ9cYFMk6c';
var PURCHASE_DROPDOWN_SHEET = 'DROPDOWN';
var DOMESTIC_FORM_SHEET = 'Domestic Form Data';
var IMPORT_FORM_SHEET = 'Import Form Data';

var PURCHASE_FORM_HEADERS = [
  'Timestamp', 'Created By', 'PO Order Date', 'PO Number', 'ITB', 'Indent Date',
  'Indent Number', 'Season', 'Supplier Name', 'Category', 'Quantity', 'ETA Date'
];

function doPost(e) {
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var result;
    if (request.action === 'submitDomesticPO') {
      result = submitPurchaseOrder_(DOMESTIC_FORM_SHEET, request.formData || {});
    } else if (request.action === 'submitImportPO') {
      result = submitPurchaseOrder_(IMPORT_FORM_SHEET, request.formData || {});
    } else if (request.action === 'updateDomesticPO') {
      result = updatePurchaseOrder_(DOMESTIC_FORM_SHEET, request.formData || {}, request.originalPoNumber || (request.formData && request.formData.originalPoNumber));
    } else if (request.action === 'updateImportPO') {
      result = updatePurchaseOrder_(IMPORT_FORM_SHEET, request.formData || {}, request.originalPoNumber || (request.formData && request.formData.originalPoNumber));
    } else {
      result = { success: false, error: 'Unknown action.' };
    }
    return purchaseJsonOutput_(result);
  } catch (err) {
    return purchaseJsonOutput_({ success: false, error: String(err) });
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'getPurchaseDropdowns') return purchaseJsonOutput_(getPurchaseDropdowns_());
  if (action === 'getDomesticPurchaseSummary') return purchaseJsonOutput_(getPurchaseSummary_(DOMESTIC_FORM_SHEET));
  if (action === 'getImportPurchaseSummary') return purchaseJsonOutput_(getPurchaseSummary_(IMPORT_FORM_SHEET));
  if (action === 'getLastPurchaseSubmission') {
    var formType = (e && e.parameter && e.parameter.formType) || 'domestic';
    var sheet = (formType === 'import') ? IMPORT_FORM_SHEET : DOMESTIC_FORM_SHEET;
    var user = (e && e.parameter && e.parameter.user) || '';
    return purchaseJsonOutput_(getLastPurchaseSubmission_(sheet, user));
  }
  if (action === 'checkPoNumber') {
    var formType = (e && e.parameter && e.parameter.formType) || '';
    var poNumber = (e && e.parameter && e.parameter.poNumber) || '';
    return purchaseJsonOutput_(checkPurchasePoNumber_(formType, poNumber));
  }
  return purchaseJsonOutput_({ success: true, message: 'Purchase form endpoint is running.' });
}

// Read-only report data for the Reports section. Display values preserve the
// date/number formatting already configured in the source Google Sheet.
function getPurchaseSummary_(sheetName) {
  try {
    var ss = SpreadsheetApp.openById(PURCHASE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() === 0) {
      return { success: true, headers: PURCHASE_FORM_HEADERS, rows: [] };
    }

    var lastColumn = Math.max(sheet.getLastColumn(), PURCHASE_FORM_HEADERS.length);
    var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
    var rows = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, lastColumn).getDisplayValues()
      : [];
    return { success: true, headers: headers, rows: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Submit a Domestic or Import purchase order row, with full audit info
// (who created the record, and when it was created).
// ---------------------------------------------------------------------------
function submitPurchaseOrder_(sheetName, data) {
  validatePurchaseFields_(data);

  var sheet = getPurchaseSheet_(sheetName);

  if (purchasePoNumberExists_(sheet, data.poNumber)) {
    throw new Error('PO Number "' + data.poNumber + '" already exists. Duplicate entries are not allowed.');
  }

  var createdAt = new Date();
  var createdBy = String(data.createdBy || '').trim() || 'Unknown';

  var row = sheet.getLastRow() + 1;
  sheet.appendRow([
    createdAt,
    createdBy,
    toPurchaseSheetDate_(data.poOrderDate),
    data.poNumber,
    data.itb,
    toPurchaseSheetDate_(data.indentDate),
    data.indentNumber,
    data.season,
    data.supplierName,
    data.category,
    Number(data.quantity),
    toPurchaseSheetDate_(data.etaDate)
  ]);

  sheet.getRange(row, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange(row, 3).setNumberFormat('dd/MM/yyyy');   // PO Order Date
  sheet.getRange(row, 6).setNumberFormat('dd/MM/yyyy');   // Indent Date
  sheet.getRange(row, 11).setNumberFormat('0.00');        // Quantity
  sheet.getRange(row, 12).setNumberFormat('dd/MM/yyyy');  // ETA Date

  return {
    success: true,
    message: (sheetName === DOMESTIC_FORM_SHEET ? 'Domestic' : 'Import') + ' purchase order submitted.',
    createdBy: createdBy,
    createdAt: createdAt.toISOString()
  };
}

// ---------------------------------------------------------------------------
// Update an existing Domestic or Import purchase order row by PO Number.
// Preserves existing row position and refreshes audit timestamp.
// ---------------------------------------------------------------------------
function updatePurchaseOrder_(sheetName, data, originalPoNumber) {
  validatePurchaseFields_(data);
  var sheet = getPurchaseSheet_(sheetName);
  var targetPo = String(originalPoNumber || data.poNumber || '').trim().toLowerCase();

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return submitPurchaseOrder_(sheetName, data);
  }

  var PONUMBER_COLUMN = 4; // Column D: PO Number
  var values = sheet.getRange(2, PONUMBER_COLUMN, lastRow - 1, 1).getValues();
  var foundRow = -1;

  // Search from bottom up to find the most recent matching record
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]).trim().toLowerCase() === targetPo) {
      foundRow = i + 2;
      break;
    }
  }

  // Fallback search by new PO number if original was not found
  if (foundRow === -1 && data.poNumber) {
    var altPo = String(data.poNumber).trim().toLowerCase();
    for (var j = values.length - 1; j >= 0; j--) {
      if (String(values[j][0]).trim().toLowerCase() === altPo) {
        foundRow = j + 2;
        break;
      }
    }
  }

  // If still not found, append as a fresh entry
  if (foundRow === -1) {
    return submitPurchaseOrder_(sheetName, data);
  }

  // Check if PO number was changed to one that already belongs to another row
  var newPo = String(data.poNumber || '').trim().toLowerCase();
  if (newPo !== targetPo) {
    for (var k = 0; k < values.length; k++) {
      if ((k + 2) !== foundRow && String(values[k][0]).trim().toLowerCase() === newPo) {
        throw new Error('PO Number "' + data.poNumber + '" already exists in another record.');
      }
    }
  }

  var updatedAt = new Date();
  var updatedBy = String(data.createdBy || '').trim() || 'User';

  sheet.getRange(foundRow, 1, 1, 12).setValues([[
    updatedAt,
    updatedBy,
    toPurchaseSheetDate_(data.poOrderDate),
    data.poNumber,
    data.itb,
    toPurchaseSheetDate_(data.indentDate),
    data.indentNumber,
    data.season,
    data.supplierName,
    data.category,
    Number(data.quantity),
    toPurchaseSheetDate_(data.etaDate)
  ]]);

  sheet.getRange(foundRow, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange(foundRow, 3).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(foundRow, 6).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(foundRow, 11).setNumberFormat('0.00');
  sheet.getRange(foundRow, 12).setNumberFormat('dd/MM/yyyy');

  return {
    success: true,
    message: (sheetName === DOMESTIC_FORM_SHEET ? 'Domestic' : 'Import') + ' purchase order updated successfully.',
    updatedBy: updatedBy,
    updatedAt: updatedAt.toISOString(),
    row: foundRow
  };
}

// ---------------------------------------------------------------------------
// Retrieves the last submitted purchase order record from Google Sheets.
// Filters by user if specified, or returns the most recent record overall.
// ---------------------------------------------------------------------------
function getLastPurchaseSubmission_(sheetName, user) {
  try {
    var ss = SpreadsheetApp.openById(PURCHASE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, record: null };
    }

    var lastRow = sheet.getLastRow();
    var lastCol = Math.max(sheet.getLastColumn(), 12);
    var rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    var targetUser = String(user || '').trim().toLowerCase();

    var matchedRow = null;
    if (targetUser && targetUser !== 'user') {
      for (var i = rows.length - 1; i >= 0; i--) {
        var rowUser = String(rows[i][1] || '').trim().toLowerCase();
        if (rowUser === targetUser) {
          matchedRow = rows[i];
          break;
        }
      }
    }

    if (!matchedRow && rows.length > 0) {
      matchedRow = rows[rows.length - 1]; // latest overall
    }

    if (!matchedRow) {
      return { success: true, record: null };
    }

    return {
      success: true,
      record: {
        timestamp: matchedRow[0],
        createdBy: matchedRow[1],
        poOrderDate: matchedRow[2],
        poNumber: matchedRow[3],
        itb: matchedRow[4],
        indentDate: matchedRow[5],
        indentNumber: matchedRow[6],
        season: matchedRow[7],
        supplierName: matchedRow[8],
        category: matchedRow[9],
        quantity: matchedRow[10],
        etaDate: matchedRow[11]
      }
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function validatePurchaseFields_(data) {
  var requiredFields = [
    'poOrderDate', 'poNumber', 'itb', 'indentDate', 'indentNumber',
    'season', 'supplierName', 'category', 'quantity', 'etaDate', 'createdBy'
  ];
  requiredFields.forEach(function (field) {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === '') {
      throw new Error(field + ' is required.');
    }
  });
  if (!isFinite(Number(data.quantity)) || Number(data.quantity) < 0) {
    throw new Error('Quantity must be a valid non-negative number (decimals allowed).');
  }
}

// ---------------------------------------------------------------------------
// PO Number duplicate check — searches the "PO Number" column (column D) of
// the given sheet for a case-insensitive, whitespace-trimmed match. Used by
// both the live client-side check (checkPurchasePoNumber_) and the
// server-side guard inside submitPurchaseOrder_ above.
// ---------------------------------------------------------------------------
function purchasePoNumberExists_(sheet, poNumber) {
  var target = String(poNumber || '').trim().toLowerCase();
  if (!target) return false;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var PONUMBER_COLUMN = 4; // 'PO Number' — see PURCHASE_FORM_HEADERS
  var values = sheet.getRange(2, PONUMBER_COLUMN, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === target) return true;
  }
  return false;
}

// formType is 'domestic' or 'import' and selects which sheet to search.
function checkPurchasePoNumber_(formType, poNumber) {
  try {
    if (!poNumber || !String(poNumber).trim()) {
      return { success: true, exists: false };
    }
    var sheetName = (formType === 'import') ? IMPORT_FORM_SHEET : DOMESTIC_FORM_SHEET;
    var sheet = getPurchaseSheet_(sheetName);
    return { success: true, exists: purchasePoNumberExists_(sheet, poNumber) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function getPurchaseSheet_(sheetName) {
  var ss = SpreadsheetApp.openById(PURCHASE_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, PURCHASE_FORM_HEADERS.length).setValues([PURCHASE_FORM_HEADERS]);
    sheet.getRange(1, 1, 1, PURCHASE_FORM_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// Season (column A2:A) and Category (column B2:B) dropdown values, read from
// the "DROPDOWN" sheet in the Purchase spreadsheet.
// ---------------------------------------------------------------------------
function getPurchaseDropdowns_() {
  try {
    var ss = SpreadsheetApp.openById(PURCHASE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PURCHASE_DROPDOWN_SHEET);
    if (!sheet) return { success: false, error: 'Sheet "' + PURCHASE_DROPDOWN_SHEET + '" not found.' };

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, data: { seasons: [], categories: [] } };

    var numRows = lastRow - 1;
    var seasons = uniqueColumnValues_(sheet.getRange(2, 1, numRows, 1).getValues());
    var categories = uniqueColumnValues_(sheet.getRange(2, 2, numRows, 1).getValues());

    return { success: true, data: { seasons: seasons, categories: categories } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function uniqueColumnValues_(values) {
  var seen = {};
  var out = [];
  values.forEach(function (row) {
    var v = String(row[0]).trim();
    if (v !== '' && v !== 'null' && v !== 'undefined' && !seen[v]) {
      seen[v] = true;
      out.push(v);
    }
  });
  return out;
}

// Converts the HTML date value (YYYY-MM-DD) without UTC timezone shifting.
function toPurchaseSheetDate_(value) {
  var parts = String(value || '').split('-');
  if (parts.length !== 3) throw new Error('Invalid date value.');
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var day = Number(parts[2]);
  var date = new Date(year, month - 1, day);
  if (isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('Invalid date value.');
  }
  return date;
}

function purchaseJsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
