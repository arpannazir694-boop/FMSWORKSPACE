// =============================================================================
// DICE_FORMA.gs - deploy this file as the Web App supplied to the FMS FORM UI
// =============================================================================
var DICE_FORMA_SPREADSHEET_ID = '1OhtWmEx1ntqzAv6hMn7Xw5bMBdeKl6SpcaklgTJY4G4';
var DICE_DATA_SHEET = 'DICE FORM DATA';
var FORMA_DATA_SHEET = 'FORMA FORM DATA';
var DICE_ATTACHMENTS_FOLDER = 'DICE FORM ATTACHMENTS';

function doPost(e) {
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var result;
    if (request.action === 'submitDiceForm') {
      result = submitDiceForm_(request.formData || {}, request.attachments || []);
    } else if (request.action === 'submitFormaForm') {
      result = submitFormaForm_(request.formData || {}, request.attachments || []);
    } else {
      result = { success: false, error: 'Unknown action.' };
    }
    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_({ success: false, error: String(err) });
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'getDiceSummary') return jsonOutput_(getSummary_(DICE_DATA_SHEET));
  if (action === 'getFormaSummary') return jsonOutput_(getSummary_(FORMA_DATA_SHEET));
  if (action === 'getAttachmentImages') return jsonOutput_(getAttachmentImages_((e.parameter.ids || '').split(',')));
  return jsonOutput_({ success: true, message: 'DICE & FORMA form endpoint is running.' });
}

function submitDiceForm_(data, attachments) {
  validateRequired_(data, ['poNumber', 'styleNumber', 'diceQuantity', 'receivedDate', 'handoverDate', 'receivingPerson', 'submittedBy']);
  var links = attachments.map(saveAttachment_);
  var sheet = getSheet_(DICE_DATA_SHEET, [
    'Timestamp', 'Submitted By', 'PO Number', 'Style Number', 'Dice Quantity',
    'Dice Attachment', 'Received Date', 'Handover Date', 'Receiving Person'
  ]);
  var row = sheet.getLastRow() + 1;
  sheet.appendRow([
    new Date(), data.submittedBy, data.poNumber, data.styleNumber, Number(data.diceQuantity),
    links.join('\n'), toSheetDate_(data.receivedDate), toSheetDate_(data.handoverDate), data.receivingPerson
  ]);
  sheet.getRange(row, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange(row, 7, 1, 2).setNumberFormat('dd/MM/yyyy');
  return { success: true, message: 'Dice form submitted.', attachmentLinks: links };
}

function submitFormaForm_(data, attachments) {
  validateRequired_(data, ['buyerName', 'sampleMakerName', 'styleNumber', 'formaQuantity', 'poNumber', 'poDate', 'supplierName', 'eta', 'submittedBy']);
  var sheet = getSheet_(FORMA_DATA_SHEET, [
    'Timestamp', 'Submitted By', 'Buyer Name', 'Sample Maker Name', 'Style Number',
    'Forma Quantity (pcs)', 'PO Number', 'PO Date', 'Supplier Name', 'ETA', 'Forma Attachment'
  ]);
  var attachmentLinks = attachments.map(saveAttachment_);
  var attachmentColumn = ensureHeader_(sheet, 'Forma Attachment');
  var row = sheet.getLastRow() + 1;
  var rowData = [
    new Date(), data.submittedBy, data.buyerName, data.sampleMakerName, data.styleNumber,
    Number(data.formaQuantity), data.poNumber, toSheetDate_(data.poDate), data.supplierName, toSheetDate_(data.eta)
  ];
  while (rowData.length < attachmentColumn) rowData.push('');
  rowData[attachmentColumn - 1] = attachmentLinks.join('\n');
  sheet.appendRow(rowData);
  sheet.getRange(row, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange(row, 8).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(row, 10).setNumberFormat('dd/MM/yyyy');
  return { success: true, message: 'Forma form submitted.', attachmentLinks: attachmentLinks };
}

function getSheet_(sheetName, headers) {
  var ss = SpreadsheetApp.openById(DICE_FORMA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureHeader_(sheet, header) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  var index = headers.indexOf(header);
  if (index !== -1) return index + 1;
  sheet.getRange(1, lastColumn + 1).setValue(header).setFontWeight('bold');
  return lastColumn + 1;
}

function getSummary_(sheetName) {
  try {
    var ss = SpreadsheetApp.openById(DICE_FORMA_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() === 0) return { success: true, headers: [], rows: [] };
    var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
    return { success: true, headers: values[0], rows: values.slice(1) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Supplies image bytes only for the XLSX report export. Non-image files remain
// as normal attachment links in the exported sheet.
function getAttachmentImages_(fileIds) {
  try {
    var images = [];
    fileIds.filter(Boolean).slice(0, 30).forEach(function (fileId) {
      try {
        var file = DriveApp.getFileById(fileId);
        var mimeType = file.getMimeType();
        if (mimeType !== 'image/jpeg' && mimeType !== 'image/jpg' && mimeType !== 'image/png') return;
        images.push({
          id: fileId,
          mimeType: mimeType,
          base64: Utilities.base64Encode(file.getBlob().getBytes())
        });
      } catch (ignore) {}
    });
    return { success: true, images: images };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function saveAttachment_(attachment) {
  if (!attachment || !attachment.name || !attachment.base64) throw new Error('An attachment is incomplete.');
  var bytes = Utilities.base64Decode(attachment.base64);
  var blob = Utilities.newBlob(bytes, attachment.mimeType || 'application/octet-stream', attachment.name);
  var file = getAttachmentFolder_().createFile(blob);
  return file.getUrl();
}

function getAttachmentFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('DICE_ATTACHMENTS_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (ignore) {}
  }
  var folder = DriveApp.createFolder(DICE_ATTACHMENTS_FOLDER);
  props.setProperty('DICE_ATTACHMENTS_FOLDER_ID', folder.getId());
  return folder;
}

// Run this once manually from the Apps Script editor before deploying.
// It prompts the project owner to authorize Drive access and creates the
// folder used by the Dice attachment upload process.
function setupDiceAttachmentFolder() {
  var folder = getAttachmentFolder_();
  return 'Dice attachment folder is ready: ' + folder.getUrl();
}

function validateRequired_(data, fields) {
  fields.forEach(function (field) {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === '') {
      throw new Error(field + ' is required.');
    }
  });
  ['diceQuantity', 'formaQuantity'].forEach(function (field) {
    if (data[field] !== undefined && data[field] !== '' && (!isFinite(Number(data[field])) || Number(data[field]) < 0)) {
      throw new Error(field + ' must be a valid non-negative number.');
    }
  });
}

// Converts the HTML date value (YYYY-MM-DD) without UTC timezone shifting.
function toSheetDate_(value) {
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

function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
