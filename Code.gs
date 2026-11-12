// =============================================================================
// FMS FORM - Google Apps Script Backend
// =============================================================================
// IMPORTANT: Replace SPREADSHEET_ID below with your actual Google Sheet ID.
// The Sheet ID is the long string in your Google Sheets URL:
// https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
// =============================================================================

var SPREADSHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
var DROPDOWN_SHEET = 'DROPDOWN';
var DATA_SHEET     = 'FMS DATA';
var USERS_SHEET    = 'USERS';
var NOTIFICATIONS_SHEET = 'NOTIFICATIONS';

// ---------------------------------------------------------------------------
// doGet — serves HTML OR responds to JSONP data / login requests
// ---------------------------------------------------------------------------
function doGet(e) {
  var params   = (e && e.parameter) ? e.parameter : {};
  var callback = params.callback;
  var action   = params.action;

  // ── JSONP data / login / submit request ──────────────────────────────────
  if (callback) {
    var result;
    if (action === 'getDropdownData') {
      result = getDropdownData();
    } else if (action === 'validateLogin') {
      result = validateLogin(params.username, params.password);
    } else if (action === 'checkUserBirthday') {
      result = checkUserBirthday(params.username);
    } else if (action === 'getUserPhoto') {
      result = getUserPhoto(params.username);
    } else if (action === 'submitFormData') {
      try {
        var fd = JSON.parse(params.formData || '{}');
        result = submitFormData(fd);
      } catch (parseErr) {
        result = { success: false, error: 'Invalid form data: ' + parseErr.toString() };
      }
    } else if (action === 'updateFormData') {
      try {
        var fd = JSON.parse(params.formData || '{}');
        result = updateFormData(fd, params.originalBatchId || fd.originalBatchId);
      } catch (parseErr) {
        result = { success: false, error: 'Invalid form data: ' + parseErr.toString() };
      }
    } else if (action === 'getSubmittedData') {
      result = getSubmittedData();
    } else if (action === 'getCuttingDetailsData') {
      result = getCuttingDetailsData();
    } else if (action === 'getBantalaDetailsData') {
      result = getBantalaDetailsData();
    } else if (action === 'getFloorQcDetailsData') {
      result = getFloorQcDetailsData(params.offset, params.limit);
    } else if (action === 'getEdgePaintDetailsData') {
      result = getEdgePaintDetailsData();
    } else if (action === 'getPreAqlDetailsData') {
      result = getPreAqlDetailsData();
    } else if (action === 'getEndLineQcDetailsData') {
      result = getEndLineQcDetailsData();
    } else if (action === 'getPostAqlDetailsData') {
      result = getPostAqlDetailsData();
    } else if (action === 'getWarehouseFmsDetailsData') {
      result = getWarehouseFmsDetailsData();
    } else if (action === 'getShipmentDetailsData') {
      result = getShipmentDetailsData();
    } else if (action === 'getFloorSupervisorKpiData') {
      result = getFloorSupervisorKpiData();
    } else if (action === 'getInLineQcKpiData') {
      result = getInLineQcKpiData();
    } else if (action === 'checkBatchExists') {
      result = checkBatchExists(params.batchAuto);
    } else if (action === 'getCuttingDetails') {
      result = getCuttingDetails(params.batchAuto);
    } else if (action === 'getNotifications') {
      result = getNotifications();
    } else if (action === 'getUserAccess') {
      result = getUserAccess(params.username);
    } else if (action === 'getBatchDetailsData') {
      result = getBatchDetailsData();
    } else if (action === 'getBatchAnalysisData') {
      result = getBatchAnalysisData();
    } else {
      result = { success: false, error: 'Unknown action: ' + action };
    }
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(result) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // ── Plain JSON request (no callback) ─────────────────────────────────────
  if (action === 'getDropdownData') {
    return ContentService
      .createTextOutput(JSON.stringify(getDropdownData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getSubmittedData') {
    return ContentService
      .createTextOutput(JSON.stringify(getSubmittedData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getUserPhoto') {
    return ContentService
      .createTextOutput(JSON.stringify(getUserPhoto(params.username)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getUserAccess') {
    return ContentService
      .createTextOutput(JSON.stringify(getUserAccess(params.username)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getFloorQcDetailsData') {
    return ContentService
      .createTextOutput(JSON.stringify(getFloorQcDetailsData(params.offset, params.limit)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getEdgePaintDetailsData') {
    return ContentService
      .createTextOutput(JSON.stringify(getEdgePaintDetailsData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getPreAqlDetailsData') {
    return ContentService
      .createTextOutput(JSON.stringify(getPreAqlDetailsData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getEndLineQcDetailsData') {
    return ContentService
      .createTextOutput(JSON.stringify(getEndLineQcDetailsData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getPostAqlDetailsData') {
    return ContentService
      .createTextOutput(JSON.stringify(getPostAqlDetailsData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getWarehouseFmsDetailsData') {
    return ContentService
      .createTextOutput(JSON.stringify(getWarehouseFmsDetailsData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getShipmentDetailsData') {
    return ContentService
      .createTextOutput(JSON.stringify(getShipmentDetailsData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getFloorSupervisorKpiData') {
    return ContentService
      .createTextOutput(JSON.stringify(getFloorSupervisorKpiData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getInLineQcKpiData') {
    return ContentService
      .createTextOutput(JSON.stringify(getInLineQcKpiData()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getNotifications') {
    return ContentService
      .createTextOutput(JSON.stringify(getNotifications()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── Serve the Login page by default (pass ?page=app for the main app) ─────
  var page = params.page || 'login';
  if (page === 'app') {
    return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('FMS Form')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  }

  return HtmlService.createTemplateFromFile('login')
    .evaluate()
    .setTitle('FMS Form — Sign In')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// ---------------------------------------------------------------------------
// doPost — handles form submission
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;
    var result;

    if (action === 'submitFormData') {
      result = submitFormData(body.formData);
    } else if (action === 'updateFormData') {
      result = updateFormData(body.formData, body.originalBatchId || (body.formData && body.formData.originalBatchId));
    } else if (action === 'updateUserPhoto') {
      result = updateUserPhoto(body.username, body.base64, body.mimeType);
    } else if (action === 'removeUserPhoto') {
      result = removeUserPhoto(body.username);
    } else if (action === 'saveBatchDetailsData') {
      result = saveBatchDetailsData(body.filename, body.headers, body.rows, body.sourceFileBase64, body.sourceFileMime);
    } else if (action === 'saveBatchAnalysisData') {
      result = saveBatchAnalysisData(body.filename, body.headers, body.rows, body.sourceFileBase64, body.sourceFileMime);
    } else if (action === 'beginBatchAnalysisUpload') {
      result = beginBatchAnalysisUpload(body.filename, body.headers, body.sourceFileBase64, body.sourceFileMime);
    } else if (action === 'appendBatchAnalysisChunk') {
      result = appendBatchAnalysisChunk(body.uploadId, body.chunkIndex, body.rowsChunk);
    } else if (action === 'finalizeBatchAnalysisUpload') {
      result = finalizeBatchAnalysisUpload(body.uploadId, body.totalChunks);
    } else if (action === 'clearBatchAnalysisData') {
      result = clearBatchAnalysisData();
    } else {
      result = { success: false, error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ---------------------------------------------------------------------------
// Include helper — for HtmlService templates
// ---------------------------------------------------------------------------
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

// ---------------------------------------------------------------------------
// Notifications — "NOTIFICATIONS" sheet.
//   Column A = the message text. This is the ONLY thing anyone needs to
//              type — just write a new notification in the next empty row
//              of column A and every logged-in user gets it automatically
//              on their next poll (no deploy, no button, nothing else to do).
//   Column B = sent-at timestamp. Auto-filled the FIRST time any client polls
//              a row that doesn't have one yet, so nobody has to type a date.
//
// IMPORTANT — always add new notifications at the BOTTOM of the sheet
// (append, don't insert in the middle). Each row's own sheet row number is
// used as its permanent id, both for ordering and for the client's
// "seen/unseen" tracking (stored per-user in the browser). Inserting a row
// in the middle would shift the ids of every row below it and could make
// already-read notifications reappear as unread.
//
// Row 1 is always treated as a header row and skipped, so put labels like
// "Message" / "Sent At" there if you want them — it's optional, purely
// cosmetic, the code never reads it.
// ---------------------------------------------------------------------------
function getNotifications() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(NOTIFICATIONS_SHEET);
    if (!sheet) return { success: true, notifications: [] };

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, notifications: [] };

    // A = message, B = timestamp, C = an automatic permanent notification ID.
    // Users only need to write messages in column A; B and C are managed here.
    var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues(); // A:C
    var now = new Date();
    var notifications = [];

    for (var i = 0; i < values.length; i++) {
      var message = String(values[i][0] == null ? '' : values[i][0]).trim();
      if (!message) continue; // skip blank rows

      var rowNum = i + 2;
      var ts = values[i][1];
      if (!(ts instanceof Date) || isNaN(ts.getTime())) {
        ts = now;
        sheet.getRange(rowNum, 2).setValue(ts); // backfill once, first time it's ever read
      }

      var notificationId = String(values[i][2] == null ? '' : values[i][2]).trim();
      if (!notificationId) {
        notificationId = Utilities.getUuid();
        sheet.getRange(rowNum, 3).setValue(notificationId);
      }

      notifications.push({ id: notificationId, message: message, timestamp: ts.toISOString() });
    }

    return { success: true, notifications: notifications };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}


function validateLogin(username, password) {
  try {
    if (!username || !password) {
      return { success: false, error: 'Username and password are required.' };
    }

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(USERS_SHEET);

    if (!sheet) {
      return { success: false, error: 'USERS sheet not found. Please create it with usernames in column A and passwords in column B.' };
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: false, error: 'No users configured. Add users to the USERS sheet.' };
    }

    // Read through column K (AI Access) as well, even if the sheet
    // currently has fewer columns filled in — Math.max keeps this safe.
    var lastCol = Math.max(sheet.getLastColumn(), 11);
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var uName = String(username).trim().toLowerCase();
    var uPass = String(password).trim();

    for (var i = 0; i < data.length; i++) {
      var rowUser = String(data[i][0]).trim().toLowerCase();
      var rowPass = String(data[i][1]).trim();
      if (rowUser === uName && rowPass === uPass) {
        return {
          success: true,
          username: String(data[i][0]).trim(),
          // Column I (index 8) — the tab-access multi-select dropdown.
          access: parseAccessList_(data[i][8]),
          // Column J (index 9) — the per-KPI-card multi-select dropdown.
          // Empty means "no restriction" (all KPI cards in accessible tabs
          // are visible) — see parseKpiAccessList_ below.
          kpiAccess: parseAccessList_(data[i][9]),
          // Column K (index 10) — the per-AI-feature multi-select dropdown
          // (Pre-Production AI / Batch Analysis with AI / Trio AI). Empty
          // means "no restriction" — same convention as Column J.
          aiAccess: parseAccessList_(data[i][10])
        };
      }
    }

    return { success: false, error: 'Invalid username or password. Please try again.' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getUserAccess — lightweight lookup used by the client's silent access
// poller (no password needed; the user is already logged in). Looks up the
// username in the USERS sheet and returns its Column I (tab) access list,
// Column J (per-KPI-card) access list, and Column K (per-AI-feature) access
// list, so the client can silently pick up access changes an admin makes
// mid-session.
// ---------------------------------------------------------------------------
function getUserAccess(username) {
  try {
    if (!username) return { success: false, error: 'Username is required.' };

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(USERS_SHEET);
    if (!sheet) return { success: false, error: 'USERS sheet not found.' };

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, access: [], kpiAccess: [], aiAccess: [] };

    var lastCol = Math.max(sheet.getLastColumn(), 11);
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var uName = String(username).trim().toLowerCase();

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() === uName) {
        return {
          success: true,
          access: parseAccessList_(data[i][8]),
          kpiAccess: parseAccessList_(data[i][9]),
          aiAccess: parseAccessList_(data[i][10])
        };
      }
    }

    return { success: false, error: 'User not found.' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// parseAccessList_ — turns a USERS sheet multi-select dropdown cell value
// into a clean array of names. Shared by three columns:
//   Column I ("Access")     — tab names,      e.g. "Dashboard, Reports, PDF"
//   Column J ("KPI Access") — KPI-card ids,   e.g. "kpi-cutting-details, kpi-dice-summary"
//   Column K ("AI Access")  — AI-feature names, e.g. "Pre-Production AI, Trio AI"
// All three are multi-select dropdowns, so the raw value is normally several
// names separated by commas (and/or line breaks, depending on the dropdown
// add-on used). An empty cell means:
//   - Column I empty -> no access to any access-controlled tab.
//   - Column J empty -> NO per-card restriction (every KPI card inside a
//     tab the user already has access to stays visible). This keeps every
//     existing user unaffected until an admin deliberately fills in
//     Column J for someone.
//   - Column K empty -> NO restriction on any of the 3 AI features
//     (Pre-Production AI / Batch Analysis with AI / Trio AI) — same
//     "unaffected until an admin opts a user in" convention as Column J.
// ---------------------------------------------------------------------------
function parseAccessList_(raw) {
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return [];
  return text.split(/[,;\n]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

// ---------------------------------------------------------------------------
// checkUserBirthday — checks USERS sheet Column G (Birthday) for the given
// username and reports whether today's date matches (month + day only).
// Used to show the birthday header/animation for ONLY the logged-in user
// whose birthday is today — never for any other user.
// ---------------------------------------------------------------------------
function checkUserBirthday(username) {
  try {
    if (!username) {
      return { success: false, error: 'Username is required.' };
    }

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(USERS_SHEET);

    if (!sheet) {
      return { success: false, error: 'USERS sheet not found.' };
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, isBirthday: false };
    }

    // Columns A–G: A=Username ... G=Birthday
    var data  = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    var uName = String(username).trim().toLowerCase();
    var tz    = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
    var todayMD = Utilities.formatDate(new Date(), tz, 'MM-dd');

    for (var i = 0; i < data.length; i++) {
      var rowUser = String(data[i][0]).trim().toLowerCase();
      if (rowUser !== uName) continue;

      var matchedUsername = String(data[i][0]).trim();
      var bday = data[i][6]; // Column G

      if (!bday) {
        return { success: true, isBirthday: false, username: matchedUsername };
      }

      var bDate = (bday instanceof Date) ? bday : new Date(bday);
      if (isNaN(bDate.getTime())) {
        return { success: true, isBirthday: false, username: matchedUsername };
      }

      var bMD = Utilities.formatDate(bDate, tz, 'MM-dd');
      return { success: true, isBirthday: (bMD === todayMD), username: matchedUsername };
    }

    return { success: false, error: 'User not found.' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// User profile photos — stored as files in a dedicated Drive folder, with
// the Drive file ID kept in the USERS sheet, Column H ("Photo File ID").
// Column H is used only by these three functions; it doesn't need a header
// or any other setup — it's written to on first upload automatically.
//
//   getUserPhoto(username)     -> { success, photoUrl }  (photoUrl is '' if none)
//   updateUserPhoto(u, b64, m) -> { success, photoUrl }  (uploads/replaces)
//   removeUserPhoto(username)  -> { success }            (deletes current photo)
//
// Photo files are shared "Anyone with link — Viewer" so they can be shown
// directly via Google's thumbnail proxy (https://drive.google.com/thumbnail?id=...),
// which works as a plain <img src> with no extra auth/CORS handling needed
// on the client.
// ---------------------------------------------------------------------------
var USER_PHOTOS_FOLDER_NAME = 'FMS USER PHOTOS';
var USER_PHOTO_COLUMN       = 8; // Column H
var USER_PHOTO_ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
var USER_PHOTO_MAX_BYTES    = 3 * 1024 * 1024; // 3 MB

function getUserPhotoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('USER_PHOTOS_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (ignore) {}
  }
  var folder = DriveApp.createFolder(USER_PHOTOS_FOLDER_NAME);
  props.setProperty('USER_PHOTOS_FOLDER_ID', folder.getId());
  return folder;
}

function userPhotoThumbnailUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w200';
}

// Finds the 1-based sheet row for a username in the USERS sheet, or -1.
function findUserRow_(sheet, username) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var uName = String(username || '').trim().toLowerCase();
  if (!uName) return -1;
  var usernames = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < usernames.length; i++) {
    if (String(usernames[i][0]).trim().toLowerCase() === uName) return i + 2;
  }
  return -1;
}

function getUserPhoto(username) {
  try {
    if (!username) return { success: false, error: 'Username is required.' };
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(USERS_SHEET);
    if (!sheet) return { success: false, error: 'USERS sheet not found.' };

    var row = findUserRow_(sheet, username);
    if (row === -1) return { success: true, photoUrl: '' };

    var fileId = String(sheet.getRange(row, USER_PHOTO_COLUMN).getValue() || '').trim();
    if (!fileId) return { success: true, photoUrl: '' };

    return { success: true, photoUrl: userPhotoThumbnailUrl_(fileId) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function updateUserPhoto(username, base64, mimeType) {
  try {
    if (!username) return { success: false, error: 'Username is required.' };
    if (!base64) return { success: false, error: 'No image data was received.' };

    mimeType = mimeType || 'image/jpeg';
    if (USER_PHOTO_ALLOWED_MIME.indexOf(mimeType) === -1) {
      return { success: false, error: 'Only JPG, PNG or WEBP images are allowed.' };
    }

    var bytes = Utilities.base64Decode(base64);
    if (bytes.length > USER_PHOTO_MAX_BYTES) {
      return { success: false, error: 'Image is too large. Please choose an image under 3MB.' };
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(USERS_SHEET);
    if (!sheet) return { success: false, error: 'USERS sheet not found.' };

    var row = findUserRow_(sheet, username);
    if (row === -1) return { success: false, error: 'User not found.' };

    // Trash the previous photo file (if any) so old uploads don't pile up.
    var oldFileId = String(sheet.getRange(row, USER_PHOTO_COLUMN).getValue() || '').trim();
    if (oldFileId) {
      try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (ignore) {}
    }

    var ext = mimeType === 'image/png' ? 'png' : (mimeType === 'image/webp' ? 'webp' : 'jpg');
    var blob = Utilities.newBlob(bytes, mimeType, String(username).trim() + '_photo.' + ext);
    var file = getUserPhotoFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    sheet.getRange(row, USER_PHOTO_COLUMN).setValue(file.getId());

    return { success: true, photoUrl: userPhotoThumbnailUrl_(file.getId()) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function removeUserPhoto(username) {
  try {
    if (!username) return { success: false, error: 'Username is required.' };

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(USERS_SHEET);
    if (!sheet) return { success: false, error: 'USERS sheet not found.' };

    var row = findUserRow_(sheet, username);
    if (row === -1) return { success: false, error: 'User not found.' };

    var fileId = String(sheet.getRange(row, USER_PHOTO_COLUMN).getValue() || '').trim();
    if (fileId) {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignore) {}
    }
    sheet.getRange(row, USER_PHOTO_COLUMN).setValue('');

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Run this once manually from the Apps Script editor (optional) — it just
// pre-creates the Drive folder used for profile photos so the first upload
// doesn't have to do it inline.
function setupUserPhotosFolder() {
  var folder = getUserPhotoFolder_();
  return 'User photos folder is ready: ' + folder.getUrl();
}

// ---------------------------------------------------------------------------
// getBatchIdOptions — reads Batch ID options from Column M of "CUTTING
// DETAILS" sheet (M2:M), de-duplicated and blank-filtered.
// ---------------------------------------------------------------------------
function getBatchIdOptions() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('CUTTING DETAILS');
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 13, lastRow - 1, 1).getValues(); // Column M = 13
  var seen   = {};
  var out    = [];

  values.forEach(function (row) {
    var v = String(row[0]).trim();
    if (v !== '' && v !== 'null' && v !== 'undefined' && !seen[v]) {
      seen[v] = true;
      out.push(v);
    }
  });

  return out;
}

// ---------------------------------------------------------------------------
// getDropdownData — reads 8 dropdown columns from DROPDOWN sheet
// (Column D / Fabricator Name removed — now a free-text field in the UI)
// ---------------------------------------------------------------------------
function getDropdownData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(DROPDOWN_SHEET);

    if (!sheet) {
      return { success: false, error: 'Sheet "' + DROPDOWN_SHEET + '" not found.' };
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return {
        success: true,
        data: {
          batchIds: [],
          cuttingLeatherReceiveUnits: [],
          brandNames: [], seasons: [], categories: [],
          floorSupervisorNames: [], inLineQCNames: []
        }
      };
    }

    var numRows = lastRow - 1;

    function getCol(colIndex) {
      return sheet.getRange(2, colIndex, numRows, 1)
        .getValues()
        .flat()
        .map(function (v) { return String(v).trim(); })
        .filter(function (v) { return v !== '' && v !== 'null' && v !== 'undefined'; });
    }

    return {
      success: true,
      data: {
        batchIds:                   getBatchIdOptions(),  // CUTTING DETAILS!M2:M
        cuttingLeatherReceiveUnits: getCol(3),  // C — Issue to Unit
        // Column D (Fabricator Name) skipped — now a free-text field
        brandNames:                 getCol(5),  // E — Brand Name
        seasons:                    getCol(6),  // F — Season
        categories:                 getCol(7),  // G — Category
        floorSupervisorNames:       getCol(8),  // H — Floor Supervisor Name
        inLineQCNames:              getCol(9)   // I — In-Line QC Name
      }
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// submitFormData — writes a row after the last occupied row in Column A
// ---------------------------------------------------------------------------
function submitFormData(formData) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(DATA_SHEET);

    if (!sheet) {
      sheet = ss.insertSheet(DATA_SHEET);
      var headers = [
        'Timestamp', 'Submitted By', 'Batch ID',
        'Leather Received Date', 'Issue to Unit',
        'Fabricator Name', 'Brand Name', 'Season', 'Category',
        'SKU', 'Style No', 'Colour', 'Quantity', 'ETD',
        'PO as per Buyer', 'Floor Supervisor Name', 'In-Line QC Name',
        'Production Days'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#1a73e8')
        .setFontColor('#ffffff');
    }

    // Find the last row that has data in Column A, then write to the row below it.
    // This avoids appendRow() jumping past blank rows that may exist in the sheet.
    var maxRows    = sheet.getMaxRows();
    var colAVals   = sheet.getRange(1, 1, maxRows, 1).getValues();
    var lastDataRow = 0;
    for (var i = colAVals.length - 1; i >= 0; i--) {
      if (String(colAVals[i][0]).trim() !== '') {
        lastDataRow = i + 1; // convert to 1-based row number
        break;
      }
    }
    // If the sheet is completely empty (no header yet), start at row 1
    var targetRow = lastDataRow + 1;

    var rowData = [
      new Date(),
      formData.submittedBy               || '',
      formData.batchId                   || '',
      formData.leatherReceivedDate       || '',
      formData.cuttingLeatherReceiveUnit || '',
      formData.fabricatorName            || '',
      formData.brandName                 || '',
      formData.season                    || '',
      formData.category                  || '',
      formData.sku                       || '',
      formData.styleNo                   || '',
      formData.colour                    || '',
      formData.quantity                  || '',
      formData.etd                       || '',
      formData.poAsPerBuyer              || '',
      formData.floorSupervisorName       || '',
      formData.inLineQCName              || '',
      formData.productionDays            || ''
    ];

    // Expand the sheet if targetRow exceeds current row count
    if (targetRow > maxRows) {
      sheet.insertRowAfter(maxRows);
    }

    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);

    return { success: true, message: 'Form submitted successfully!' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// updateFormData — updates the existing row in FMS DATA matching originalBatchId
// ---------------------------------------------------------------------------
function updateFormData(formData, originalBatchId) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(DATA_SHEET);
    if (!sheet) {
      return { success: false, error: 'Sheet not found: ' + DATA_SHEET };
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: false, error: 'No data rows found in ' + DATA_SHEET + ' to update.' };
    }

    var targetBatch = String(originalBatchId || formData.batchId || '').trim().toLowerCase();
    if (!targetBatch) {
      return { success: false, error: 'Batch ID is required for update.' };
    }

    var BATCH_COL = 3; // Column C: Batch ID
    var values = sheet.getRange(2, BATCH_COL, lastRow - 1, 1).getValues();
    var matchingRows = [];

    // Search for all rows matching targetBatch
    for (var i = 0; i < values.length; i++) {
      var cellVal = String(values[i][0]).trim().toLowerCase();
      if (cellVal === targetBatch) {
        matchingRows.push(i + 2); // 1-based row number
      }
    }

    // Fallback: search by new batch ID if original wasn't found
    if (matchingRows.length === 0 && formData.batchId) {
      var altBatch = String(formData.batchId).trim().toLowerCase();
      for (var j = 0; j < values.length; j++) {
        var altVal = String(values[j][0]).trim().toLowerCase();
        if (altVal === altBatch) {
          matchingRows.push(j + 2);
        }
      }
    }

    if (matchingRows.length === 0) {
      return { success: false, error: 'No existing row found matching Batch ID: ' + (originalBatchId || formData.batchId) };
    }

    var targetRow = matchingRows[0]; // Overwrite the original row

    var rowData = [
      new Date(),
      formData.submittedBy               || '',
      formData.batchId                   || '',
      formData.leatherReceivedDate       || '',
      formData.cuttingLeatherReceiveUnit || '',
      formData.fabricatorName            || '',
      formData.brandName                 || '',
      formData.season                    || '',
      formData.category                  || '',
      formData.sku                       || '',
      formData.styleNo                   || '',
      formData.colour                    || '',
      formData.quantity                  || '',
      formData.etd                       || '',
      formData.poAsPerBuyer              || '',
      formData.floorSupervisorName       || '',
      formData.inLineQCName              || '',
      formData.productionDays            || ''
    ];

    // Overwrite the existing row in place
    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);

    // If duplicate rows were previously created for this batch, delete them so only 1 row remains
    if (matchingRows.length > 1) {
      for (var k = matchingRows.length - 1; k >= 1; k--) {
        sheet.deleteRow(matchingRows[k]);
      }
    }

    return {
      success: true,
      message: 'FMS Form updated successfully! Old row ' + targetRow + ' overwritten in place.',
      row: targetRow,
      duplicatesRemoved: matchingRows.length - 1
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getSubmittedData — returns all rows from FMS DATA sheet (cols A–Z)
// ---------------------------------------------------------------------------
function getSubmittedData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(DATA_SHEET);

    if (!sheet) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow < 1 || lastCol < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    // Cap at column Z (26)
    var colCount = Math.min(lastCol, 26);

    // Read header row
    var headerRange = sheet.getRange(1, 1, 1, colCount).getValues();
    var headers = headerRange[0].map(function (h) { return String(h).trim(); });

    if (lastRow < 2) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    // Read all data rows
    var dataRange = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
    var rows = dataRange.map(function (row) {
      return row.map(function (cell) {
        if (cell instanceof Date) {
          // Format date as DD/MM/YYYY HH:MM
          var d = cell;
          var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
          return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
                 ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        }
        return String(cell === null || cell === undefined ? '' : cell);
      });
    });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}


// ---------------------------------------------------------------------------
// checkBatchExists — searches Column C (Batch ID) of "FMS DATA" sheet for a matching
// batch value. Returns { exists: true } if found, { exists: false } if not.
// ---------------------------------------------------------------------------
function checkBatchExists(batchAuto) {
  try {
    if (!batchAuto) return { success: false, error: 'No batch value provided.' };

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(DATA_SHEET);   // 'FMS DATA'

    if (!sheet) return { success: true, exists: false };

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, exists: false };

    // Column C = 3 (Batch ID)
    var colC   = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
    var target = String(batchAuto).trim();

    for (var i = 0; i < colC.length; i++) {
      if (String(colC[i][0]).trim() === target) {
        return { success: true, exists: true };
      }
    }

    return { success: true, exists: false };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
// ---------------------------------------------------------------------------
// getCuttingDetails — searches Column M of "CUTTING DETAILS" sheet for a
// matching batch value and returns:
//   Column H (8)  → cutting quantity
//   Column C (3)  → Brand Name
//   Column D (4)  → PO as per Buyer
//   Column E (5)  → Style No
//   Column G (7)  → Colour
//   Column L (12) → Category
// ---------------------------------------------------------------------------
function getCuttingDetails(batchAuto) {
  try {
    if (!batchAuto) return { success: false, error: 'No batch value provided.' };

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('CUTTING DETAILS');

    if (!sheet) {
      return { success: false, error: 'Sheet "CUTTING DETAILS" not found.' };
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, found: false };
    }

    var numRows = lastRow - 1;
    // Fetch all needed columns in one batch read (cols 3–13)
    var data = sheet.getRange(2, 3, numRows, 11).getValues();
    // data[i][0]  = col C  (Brand Name)
    // data[i][2]  = col E  (Style No)
    // data[i][4]  = col G  (Colour)
    // data[i][5]  = col H  (Cutting Quantity)
    // data[i][9]  = col L  (Category)
    // data[i][10] = col M  (Batch ID — lookup key)

    var target = String(batchAuto).trim();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][10]).trim() === target) {
        return {
          success:      true,
          found:        true,
          quantity:     data[i][5],
          brandName:    String(data[i][0]),
          poAsPerBuyer: String(data[i][1]),
          styleNo:      String(data[i][2]),
          colour:       String(data[i][4]),
          category:     String(data[i][9])
        };
      }
    }

    return { success: true, found: false };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getCuttingDetailsData — reads A1:M from "CUTTING DETAILS" sheet.
// Row 1 is the header row; remaining rows are data.
// ---------------------------------------------------------------------------
function getCuttingDetailsData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('CUTTING DETAILS');

    if (!sheet) {
      return { success: false, error: 'Sheet "CUTTING DETAILS" not found.' };
    }

    var lastRow = sheet.getLastRow();
    var lastCol = Math.min(sheet.getLastColumn(), 13); // cap at column M

    if (lastRow < 1 || lastCol < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    // Row 1 = headers
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (lastRow < 2) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var rows = dataRange.map(function (row) {
      return row.map(function (cell) {
        if (cell instanceof Date) {
          var d   = cell;
          var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
          return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
        }
        return String(cell === null || cell === undefined ? '' : cell);
      });
    });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getBantalaDetailsData — reads A1:H from "BANTALA DETAILS" sheet.
// Row 1 is the header row; remaining rows are data.
// ---------------------------------------------------------------------------
function getBantalaDetailsData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('BANTALA DETAILS');

    if (!sheet) {
      return { success: false, error: 'Sheet "BANTALA DETAILS" not found.' };
    }

    var lastRow = sheet.getLastRow();
    var lastCol = Math.min(sheet.getLastColumn(), 8); // cap at column H

    if (lastRow < 1 || lastCol < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    // Row 1 = headers
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (lastRow < 2) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var rows = dataRange.map(function (row) {
      return row.map(function (cell) {
        if (cell instanceof Date) {
          var d   = cell;
          var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
          return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
        }
        return String(cell === null || cell === undefined ? '' : cell);
      });
    });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getFloorQcDetailsData - reads B7:BT from "Floor Supervisor & In-Line QC".
// Row 7 is the visible table header; row 8 onward contains data.
//
// PAGINATED: accepts an optional (offset, limit) so the client can pull the
// sheet down in bounded chunks instead of one giant request. This keeps each
// individual call fast — regardless of how many rows the sheet grows to —
// and avoids the client-side request timing out while Apps Script is still
// working through a very large range. The client is expected to keep calling
// with the returned `nextOffset` while `hasMore` is true.
// ---------------------------------------------------------------------------
function getFloorQcDetailsData(offset, limit) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Floor Supervisor & In-Line QC');

    if (!sheet) {
      return { success: false, error: 'Sheet "Floor Supervisor & In-Line QC" not found.' };
    }

    var headerRow = 7;
    var startCol  = 2;  // B
    var maxCol    = 72; // BT
    var lastRow   = sheet.getLastRow();
    var lastCol   = Math.min(sheet.getLastColumn(), maxCol);
    var colCount  = lastCol - startCol + 1;

    var headerGroups = [
      [
        { label: 'Floor Supervisor & In-Line QC Part', colspan: 17 },
        { label: '1ST FOLLOW UP', colspan: 18 },
        { label: '2ND FOLLOW UP', colspan: 18 },
        { label: '3RD FOLLOW UP', colspan: 18 }
      ],
      [
        { label: 'FMS UPLOAD DETAILS', colspan: 17 },
        { label: 'WHEN 20% PRODUCTION TIME COMPLETE', colspan: 9 },
        { label: 'WHEN 20% PRODUCTION TIME COMPLETE', colspan: 9 },
        { label: 'WHEN 45% PRODUCTION TIME COMPLETE', colspan: 9 },
        { label: 'WHEN 60% PRODUCTION TIME COMPLETE', colspan: 9 },
        { label: 'WHEN 75% PRODUCTION TIME COMPLETE', colspan: 9 },
        { label: 'WHEN 80% PRODUCTION TIME COMPLETE', colspan: 9 }
      ],
      [
        { label: 'FMS UPLOAD DETAILS', colspan: 17 },
        { label: '1ST FOLLOW UP - FLOOR SUPERVISOR', colspan: 9 },
        { label: '1ST FOLLOW UP - IN LINE QC', colspan: 9 },
        { label: '2ND FOLLOW UP - FLOOR SUPERVISOR', colspan: 9 },
        { label: '2ND FOLLOW UP - IN LINE QC', colspan: 9 },
        { label: '3RD FOLLOW UP - FLOOR SUPERVISOR', colspan: 9 },
        { label: '3RD FOLLOW UP - IN LINE QC', colspan: 9 }
      ]
    ];

    if (lastRow < headerRow || colCount < 1) {
      return { success: true, headers: [], headerGroups: headerGroups, rows: [], total: 0, hasMore: false, nextOffset: 0 };
    }

    var headers = sheet.getRange(headerRow, startCol, 1, colCount).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    var totalDataRows = lastRow - headerRow; // number of rows below the header row

    if (totalDataRows < 1) {
      return { success: true, headers: headers, headerGroups: headerGroups, rows: [], total: 0, hasMore: false, nextOffset: 0 };
    }

    // ---- Pagination bounds -------------------------------------------------
    var CHUNK_SIZE = 1500; // rows per request — fast & well under the timeout
    var off = parseInt(offset, 10);
    if (isNaN(off) || off < 0) off = 0;
    var lim = parseInt(limit, 10);
    if (isNaN(lim) || lim <= 0) lim = CHUNK_SIZE;

    var startRow = headerRow + 1 + off;

    if (off >= totalDataRows || startRow > lastRow) {
      return { success: true, headers: headers, headerGroups: headerGroups, rows: [], total: 0, hasMore: false, nextOffset: totalDataRows };
    }

    var rowsToFetch = Math.min(lim, lastRow - startRow + 1);
    var dataRange   = sheet.getRange(startRow, startCol, rowsToFetch, colCount).getValues();

    var rows = dataRange
      .filter(function (row) {
        return row.some(function (cell) {
          return cell !== null && cell !== undefined && String(cell).trim() !== '';
        });
      })
      .map(function (row) {
        return row.map(function (cell) {
          if (cell instanceof Date) {
            var d   = cell;
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
          }
          return String(cell === null || cell === undefined ? '' : cell);
        });
      });

    var nextOffset = off + rowsToFetch;
    var hasMore     = nextOffset < totalDataRows;

    return {
      success: true,
      headers: headers,
      headerGroups: headerGroups,
      rows: rows,
      total: rows.length,
      hasMore: hasMore,
      nextOffset: nextOffset,
      totalRowsInSheet: totalDataRows
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getEdgePaintDetailsData - reads B7:AF from "EDGE-PAINT PART".
// Row 7 is the visible table header; row 8 onward contains data.
// ---------------------------------------------------------------------------
function getEdgePaintDetailsData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('EDGE-PAINT PART');

    if (!sheet) {
      return { success: false, error: 'Sheet "EDGE-PAINT PART" not found.' };
    }

    var headerRow = 7;
    var startCol  = 2;  // B
    var maxCol    = 32; // AF
    var lastRow   = sheet.getLastRow();
    var lastCol   = Math.min(sheet.getLastColumn(), maxCol);
    var colCount  = lastCol - startCol + 1;

    if (lastRow < headerRow || colCount < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    var headers = sheet.getRange(headerRow, startCol, 1, colCount).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (lastRow < headerRow + 1) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    var dataRange = sheet.getRange(headerRow + 1, startCol, lastRow - headerRow, colCount).getValues();
    var rows = dataRange
      .filter(function (row) {
        return row.some(function (cell) {
          return cell !== null && cell !== undefined && String(cell).trim() !== '';
        });
      })
      .map(function (row) {
        return row.map(function (cell) {
          if (cell instanceof Date) {
            var d   = cell;
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
          }
          return String(cell === null || cell === undefined ? '' : cell);
        });
      });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getPreAqlDetailsData - reads B7:AE from "PRE-AQL PART".
// Row 7 is the visible table header; row 8 onward contains data.
// ---------------------------------------------------------------------------
function getPreAqlDetailsData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('PRE-AQL PART');

    if (!sheet) {
      return { success: false, error: 'Sheet "PRE-AQL PART" not found.' };
    }

    var headerRow = 7;
    var startCol  = 2;  // B
    var maxCol    = 31; // AE
    var lastRow   = sheet.getLastRow();
    var lastCol   = Math.min(sheet.getLastColumn(), maxCol);
    var colCount  = lastCol - startCol + 1;

    if (lastRow < headerRow || colCount < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    var headers = sheet.getRange(headerRow, startCol, 1, colCount).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (lastRow < headerRow + 1) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    var dataRange = sheet.getRange(headerRow + 1, startCol, lastRow - headerRow, colCount).getValues();
    var rows = dataRange
      .filter(function (row) {
        return row.some(function (cell) {
          return cell !== null && cell !== undefined && String(cell).trim() !== '';
        });
      })
      .map(function (row) {
        return row.map(function (cell) {
          if (cell instanceof Date) {
            var d   = cell;
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
          }
          return String(cell === null || cell === undefined ? '' : cell);
        });
      });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getEndLineQcDetailsData - reads B7:AE from "END-LINE QC".
// Row 7 is the visible table header; row 8 onward contains data.
// ---------------------------------------------------------------------------
function getEndLineQcDetailsData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('END-LINE QC');

    if (!sheet) {
      return { success: false, error: 'Sheet "END-LINE QC" not found.' };
    }

    var headerRow = 7;
    var startCol  = 2;  // B
    var maxCol    = 31; // AE
    var lastRow   = sheet.getLastRow();
    var lastCol   = Math.min(sheet.getLastColumn(), maxCol);
    var colCount  = lastCol - startCol + 1;

    if (lastRow < headerRow || colCount < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    var headers = sheet.getRange(headerRow, startCol, 1, colCount).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (lastRow < headerRow + 1) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    var dataRange = sheet.getRange(headerRow + 1, startCol, lastRow - headerRow, colCount).getValues();
    var rows = dataRange
      .filter(function (row) {
        return row.some(function (cell) {
          return cell !== null && cell !== undefined && String(cell).trim() !== '';
        });
      })
      .map(function (row) {
        return row.map(function (cell) {
          if (cell instanceof Date) {
            var d   = cell;
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
          }
          return String(cell === null || cell === undefined ? '' : cell);
        });
      });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getPostAqlDetailsData - reads B7:AF from "POST AQL".
// Row 7 is the visible table header; row 8 onward contains data.
// ---------------------------------------------------------------------------
function getPostAqlDetailsData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('POST AQL');

    if (!sheet) {
      return { success: false, error: 'Sheet "POST AQL" not found.' };
    }

    var headerRow = 7;
    var startCol  = 2;  // B
    var maxCol    = 32; // AF
    var lastRow   = sheet.getLastRow();
    var lastCol   = Math.min(sheet.getLastColumn(), maxCol);
    var colCount  = lastCol - startCol + 1;

    if (lastRow < headerRow || colCount < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    var headers = sheet.getRange(headerRow, startCol, 1, colCount).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (lastRow < headerRow + 1) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    var dataRange = sheet.getRange(headerRow + 1, startCol, lastRow - headerRow, colCount).getValues();
    var rows = dataRange
      .filter(function (row) {
        return row.some(function (cell) {
          return cell !== null && cell !== undefined && String(cell).trim() !== '';
        });
      })
      .map(function (row) {
        return row.map(function (cell) {
          if (cell instanceof Date) {
            var d   = cell;
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
          }
          return String(cell === null || cell === undefined ? '' : cell);
        });
      });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getWarehouseFmsDetailsData - reads B7:AB from "WAREHOUSE PART".
// Row 7 is the visible table header; row 8 onward contains data.
// ---------------------------------------------------------------------------
function getWarehouseFmsDetailsData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('WAREHOUSE PART');

    if (!sheet) {
      return { success: false, error: 'Sheet "WAREHOUSE PART" not found.' };
    }

    var headerRow = 7;
    var startCol  = 2;  // B
    var maxCol    = 28; // AB
    var lastRow   = sheet.getLastRow();
    var lastCol   = Math.min(sheet.getLastColumn(), maxCol);
    var colCount  = lastCol - startCol + 1;

    if (lastRow < headerRow || colCount < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    var headers = sheet.getRange(headerRow, startCol, 1, colCount).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (lastRow < headerRow + 1) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    var dataRange = sheet.getRange(headerRow + 1, startCol, lastRow - headerRow, colCount).getValues();
    var rows = dataRange
      .filter(function (row) {
        return row.some(function (cell) {
          return cell !== null && cell !== undefined && String(cell).trim() !== '';
        });
      })
      .map(function (row) {
        return row.map(function (cell) {
          if (cell instanceof Date) {
            var d   = cell;
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
          }
          return String(cell === null || cell === undefined ? '' : cell);
        });
      });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getShipmentDetailsData - reads B7:W from "SHIPMENT".
// Row 7 is the visible table header; row 8 onward contains data.
// ---------------------------------------------------------------------------
function getShipmentDetailsData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('SHIPMENT');

    if (!sheet) {
      return { success: false, error: 'Sheet "SHIPMENT" not found.' };
    }

    var headerRow = 7;
    var startCol  = 2;  // B
    var maxCol    = 23; // W
    var lastRow   = sheet.getLastRow();
    var lastCol   = Math.min(sheet.getLastColumn(), maxCol);
    var colCount  = lastCol - startCol + 1;

    if (lastRow < headerRow || colCount < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    var headers = sheet.getRange(headerRow, startCol, 1, colCount).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (lastRow < headerRow + 1) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    var dataRange = sheet.getRange(headerRow + 1, startCol, lastRow - headerRow, colCount).getValues();
    var rows = dataRange
      .filter(function (row) {
        return row.some(function (cell) {
          return cell !== null && cell !== undefined && String(cell).trim() !== '';
        });
      })
      .map(function (row) {
        return row.map(function (cell) {
          if (cell instanceof Date) {
            var d   = cell;
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
          }
          return String(cell === null || cell === undefined ? '' : cell);
        });
      });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getFloorSupervisorKpiData — reads A1:U from "PLANNED DATE" sheet.
// Columns A–U (1–21), Row 1 = header row, rows 2+ = data.
// ---------------------------------------------------------------------------
function getFloorSupervisorKpiData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('PLANNED DATE');

    if (!sheet) {
      return { success: false, error: 'Sheet "PLANNED DATE" not found.' };
    }

    var lastRow  = sheet.getLastRow();
    var lastCol  = sheet.getLastColumn();
    var colCount = Math.min(lastCol, 21); // A:U = columns 1–21

    if (lastRow < 1 || colCount < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    // Row 1 = headers (A1:U1)
    var headers = sheet.getRange(1, 1, 1, colCount).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (lastRow < 2) {
      return { success: true, headers: headers, rows: [], total: 0 };
    }

    // Data rows: A2:U<lastRow>
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var dataRange = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
    var rows = dataRange
      .filter(function (row) {
        return row.some(function (cell) {
          return cell !== null && cell !== undefined && String(cell).trim() !== '';
        });
      })
      .map(function (row) {
        return row.map(function (cell) {
          if (cell instanceof Date) {
            return pad(cell.getDate()) + '/' + pad(cell.getMonth() + 1) + '/' + cell.getFullYear();
          }
          return String(cell === null || cell === undefined ? '' : cell);
        });
      });

    return { success: true, headers: headers, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// getInLineQcKpiData — reads from "PLANNED DATE" sheet using two fixed ranges:
//   Range 1: A1:R  — columns A–R  (1–18, 18 cols)
//   Range 2: V1:X  — columns V–X  (22–24, 3 cols)
// Row 1 = header row; rows 2+ = data. Both sets are merged left-to-right.
// ---------------------------------------------------------------------------
function getInLineQcKpiData() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('PLANNED DATE');

    if (!sheet) {
      return { success: false, error: 'Sheet "PLANNED DATE" not found.' };
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow < 1 || lastCol < 1) {
      return { success: true, headers: [], rows: [], total: 0 };
    }

    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    function formatCell(cell) {
      if (cell instanceof Date) {
        return pad(cell.getDate()) + '/' + pad(cell.getMonth() + 1) + '/' + cell.getFullYear();
      }
      return String(cell === null || cell === undefined ? '' : cell);
    }

    // Range 1: A:R — columns 1–18 (cap at lastCol)
    var r1Start    = 1;
    var r1ColCount = Math.min(lastCol, 18); // A–R

    // Range 2: V:X — columns 22–24 (3 cols), only if sheet reaches col 22)
    var r2Start    = 22; // V
    var r2ColCount = Math.min(Math.max(lastCol - r2Start + 1, 0), 3); // V–X, max 3

    var headers1 = sheet.getRange(1, r1Start, 1, r1ColCount).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var headers2 = r2ColCount > 0
      ? sheet.getRange(1, r2Start, 1, r2ColCount).getValues()[0]
          .map(function (h) { return String(h).trim(); })
      : [];
    var combinedHeaders = headers1.concat(headers2);

    if (lastRow < 2) {
      return { success: true, headers: combinedHeaders, rows: [], total: 0 };
    }

    var data1 = sheet.getRange(2, r1Start, lastRow - 1, r1ColCount).getValues();
    var data2 = r2ColCount > 0
      ? sheet.getRange(2, r2Start, lastRow - 1, r2ColCount).getValues()
      : null;

    var rows = [];
    for (var i = 0; i < data1.length; i++) {
      var row1    = data1[i].map(formatCell);
      var row2    = data2 && data2[i] ? data2[i].map(formatCell) : [];
      var combined = row1.concat(row2);
      if (combined.some(function (v) { return v.trim() !== ''; })) {
        rows.push(combined);
      }
    }

    return { success: true, headers: combinedHeaders, rows: rows, total: rows.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ---------------------------------------------------------------------------
// Save Batch Details Excel Data to Google Drive
//
// The uploaded workbook is parsed in the browser, then its report data is
// stored as one JSON file in Drive. This avoids the slow cell-by-cell Google
// Sheets write/read path while keeping one shared dataset for every user.
// ---------------------------------------------------------------------------
var BATCH_DETAILS_DRIVE_FOLDER_NAME = 'FMS Batch Analysis Storage';
var BATCH_DETAILS_DRIVE_FOLDER_PROP = 'BATCH_DETAILS_DRIVE_FOLDER_ID';
var BATCH_DETAILS_DRIVE_FILE_PROP   = 'BATCH_DETAILS_DRIVE_FILE_ID';
var BATCH_DETAILS_SOURCE_FILE_PROP  = 'BATCH_DETAILS_SOURCE_FILE_ID';

function getBatchDetailsDriveFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(BATCH_DETAILS_DRIVE_FOLDER_PROP);
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (ignore) {}
  }

  var folder = DriveApp.createFolder(BATCH_DETAILS_DRIVE_FOLDER_NAME);
  props.setProperty(BATCH_DETAILS_DRIVE_FOLDER_PROP, folder.getId());
  return folder;
}

function saveBatchDetailsData(filename, headers, rows, sourceFileBase64, sourceFileMime) {
  try {
    if (!headers || !Array.isArray(headers) || !rows || !Array.isArray(rows)) {
      return { success: false, error: 'Invalid headers or rows payload.' };
    }

    var props = PropertiesService.getScriptProperties();
    var payload = JSON.stringify({
      version: 1,
      filename: filename || 'Batch_Data.xlsx',
      headers: headers,
      rows: rows
    });
    var folder = getBatchDetailsDriveFolder_();
    var oldFileId = props.getProperty(BATCH_DETAILS_DRIVE_FILE_PROP);
    var oldSourceFileId = props.getProperty(BATCH_DETAILS_SOURCE_FILE_PROP);
    var jsonFile = folder.createFile(Utilities.newBlob(
      payload,
      'application/json',
      'batch_details_data.json'
    ));
    // The web app can be opened by different Google accounts. Link-view
    // access ensures the shared dataset is readable even when the app is
    // deployed to execute as the visiting user instead of the owner.
    jsonFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty(BATCH_DETAILS_DRIVE_FILE_PROP, jsonFile.getId());

    // Preserve the original workbook as well, so the exact uploaded Excel
    // file is visible in Drive and can be downloaded later if needed.
    if (sourceFileBase64) {
      var sourceBlob = Utilities.newBlob(
        Utilities.base64Decode(sourceFileBase64),
        sourceFileMime || 'application/octet-stream',
        filename || 'Batch_Data.xlsx'
      );
      var sourceFile = folder.createFile(sourceBlob);
      sourceFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      props.setProperty(BATCH_DETAILS_SOURCE_FILE_PROP, sourceFile.getId());
    }
    if (oldFileId) {
      try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (ignore) {}
    }
    if (oldSourceFileId) {
      try { DriveApp.getFileById(oldSourceFileId).setTrashed(true); } catch (ignore) {}
    }

    var meta = {
      filename: filename || 'Batch_Data.xlsx',
      uploadTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      totalRows: rows.length,
      totalCols: headers.length
    };
    props.setProperty('BATCH_DETAILS_META', JSON.stringify(meta));

    return { success: true, count: rows.length, message: 'Saved to shared Google Drive storage.' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Get Batch Details Excel Data from Google Drive
// ---------------------------------------------------------------------------
function getBatchDetailsData() {
  try {
    var props = PropertiesService.getScriptProperties();
    var fileId = props.getProperty(BATCH_DETAILS_DRIVE_FILE_PROP);
    if (!fileId) return { success: true, headers: [], rows: [], totalRows: 0 };

    var stored = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8'));
    var headers = Array.isArray(stored.headers) ? stored.headers : [];
    var rows = Array.isArray(stored.rows) ? stored.rows : [];
    var metaStr = props.getProperty('BATCH_DETAILS_META');
    var meta = metaStr ? JSON.parse(metaStr) : { filename: 'Batch_Data.xlsx', uploadTime: 'Recent' };

    return {
      success: true,
      filename: meta.filename,
      uploadTime: meta.uploadTime,
      headers: headers,
      rows: rows,
      totalRows: rows.length
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Save Batch Analysis Excel Data to Google Drive
//
// The uploaded workbook is parsed in the browser (SheetJS), then its data is
// stored as one JSON file in Drive so every user sees the same shared
// dataset instantly, without a slow Sheets write/read round trip. The
// original uploaded workbook is also kept in Drive for reference/download.
// ---------------------------------------------------------------------------
var BATCH_ANALYSIS_DRIVE_FOLDER_NAME = 'FMS Batch Analysis Data';
var BATCH_ANALYSIS_DRIVE_FOLDER_PROP = 'BATCH_ANALYSIS_DRIVE_FOLDER_ID';
var BATCH_ANALYSIS_DRIVE_FILE_PROP   = 'BATCH_ANALYSIS_DRIVE_FILE_ID';
var BATCH_ANALYSIS_SOURCE_FILE_PROP  = 'BATCH_ANALYSIS_SOURCE_FILE_ID';

// Chunked-upload session state (used for large files, 100k+ rows) — avoids
// sending the whole dataset in a single oversized google.script.run call,
// which was silently hanging forever on big Excel files.
var BATCH_ANALYSIS_CHUNK_FOLDER_PROP    = 'BATCH_ANALYSIS_CHUNK_FOLDER_ID';
var BATCH_ANALYSIS_UPLOAD_ID_PROP       = 'BATCH_ANALYSIS_UPLOAD_ID';
var BATCH_ANALYSIS_UPLOAD_FILENAME_PROP = 'BATCH_ANALYSIS_UPLOAD_FILENAME';
var BATCH_ANALYSIS_UPLOAD_HEADERS_PROP  = 'BATCH_ANALYSIS_UPLOAD_HEADERS';

function getBatchAnalysisDriveFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(BATCH_ANALYSIS_DRIVE_FOLDER_PROP);
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (ignore) {}
  }

  var folder = DriveApp.createFolder(BATCH_ANALYSIS_DRIVE_FOLDER_NAME);
  props.setProperty(BATCH_ANALYSIS_DRIVE_FOLDER_PROP, folder.getId());
  return folder;
}

function saveBatchAnalysisData(filename, headers, rows, sourceFileBase64, sourceFileMime) {
  try {
    if (!headers || !Array.isArray(headers) || !rows || !Array.isArray(rows)) {
      return { success: false, error: 'Invalid headers or rows payload.' };
    }

    var props = PropertiesService.getScriptProperties();
    var payload = JSON.stringify({
      version: 1,
      filename: filename || 'Batch_Analysis.xlsx',
      headers: headers,
      rows: rows
    });
    var folder = getBatchAnalysisDriveFolder_();
    var oldFileId = props.getProperty(BATCH_ANALYSIS_DRIVE_FILE_PROP);
    var oldSourceFileId = props.getProperty(BATCH_ANALYSIS_SOURCE_FILE_PROP);
    var jsonFile = folder.createFile(Utilities.newBlob(
      payload,
      'application/json',
      'batch_analysis_data.json'
    ));
    // The web app can be opened by different Google accounts. Link-view
    // access ensures the shared dataset is readable even when the app is
    // deployed to execute as the visiting user instead of the owner.
    jsonFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty(BATCH_ANALYSIS_DRIVE_FILE_PROP, jsonFile.getId());

    // Preserve the original uploaded workbook too, so the exact Excel file
    // is visible in Drive and can be downloaded later if needed.
    if (sourceFileBase64) {
      var sourceBlob = Utilities.newBlob(
        Utilities.base64Decode(sourceFileBase64),
        sourceFileMime || 'application/octet-stream',
        filename || 'Batch_Analysis.xlsx'
      );
      var sourceFile = folder.createFile(sourceBlob);
      sourceFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      props.setProperty(BATCH_ANALYSIS_SOURCE_FILE_PROP, sourceFile.getId());
    }
    if (oldFileId) {
      try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (ignore) {}
    }
    if (oldSourceFileId) {
      try { DriveApp.getFileById(oldSourceFileId).setTrashed(true); } catch (ignore) {}
    }

    var meta = {
      filename: filename || 'Batch_Analysis.xlsx',
      uploadTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      totalRows: rows.length,
      totalCols: headers.length
    };
    props.setProperty('BATCH_ANALYSIS_META', JSON.stringify(meta));

    return { success: true, count: rows.length, message: 'Saved to shared Google Drive storage.' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Chunked Save (used for large workbooks, e.g. 100,000+ rows)
//
// Sending the entire dataset (as an array of {header: value} objects) plus
// the whole workbook as one base64 string in a single google.script.run call
// was hanging indefinitely on big files — the payload was simply too large
// for the Apps Script bridge to complete in one shot, and no success/failure
// handler ever fired. The fix: upload the source workbook once, then stream
// the row data in small compact chunks, then combine everything server-side.
// ---------------------------------------------------------------------------
function getBatchAnalysisChunkFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(BATCH_ANALYSIS_CHUNK_FOLDER_PROP);
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (ignore) {}
  }
  var parent = getBatchAnalysisDriveFolder_();
  var folder = parent.createFolder('Upload Tmp');
  props.setProperty(BATCH_ANALYSIS_CHUNK_FOLDER_PROP, folder.getId());
  return folder;
}

function clearBatchAnalysisChunkFiles_(folder) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    try { files.next().setTrashed(true); } catch (ignore) {}
  }
}

// Step 1 — start a fresh upload session: wipes any stale temp chunks from a
// previous failed attempt, stores headers/filename, and saves the original
// workbook once (it is NOT resent with every row chunk).
function beginBatchAnalysisUpload(filename, headers, sourceFileBase64, sourceFileMime) {
  try {
    if (!headers || !Array.isArray(headers)) {
      return { success: false, error: 'Invalid headers payload.' };
    }
    var props = PropertiesService.getScriptProperties();
    var folder = getBatchAnalysisChunkFolder_();
    clearBatchAnalysisChunkFiles_(folder);

    var uploadId = 'u' + Date.now();
    props.setProperty(BATCH_ANALYSIS_UPLOAD_ID_PROP, uploadId);
    props.setProperty(BATCH_ANALYSIS_UPLOAD_FILENAME_PROP, filename || 'Batch_Analysis.xlsx');
    props.setProperty(BATCH_ANALYSIS_UPLOAD_HEADERS_PROP, JSON.stringify(headers));

    if (sourceFileBase64) {
      var mainFolder = getBatchAnalysisDriveFolder_();
      var oldSourceFileId = props.getProperty(BATCH_ANALYSIS_SOURCE_FILE_PROP);
      var sourceBlob = Utilities.newBlob(
        Utilities.base64Decode(sourceFileBase64),
        sourceFileMime || 'application/octet-stream',
        filename || 'Batch_Analysis.xlsx'
      );
      var sourceFile = mainFolder.createFile(sourceBlob);
      sourceFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      props.setProperty(BATCH_ANALYSIS_SOURCE_FILE_PROP, sourceFile.getId());
      if (oldSourceFileId) { try { DriveApp.getFileById(oldSourceFileId).setTrashed(true); } catch (ignore) {} }
    }

    return { success: true, uploadId: uploadId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Step 2 — append one compact chunk of rows. Each row is a plain array of
// values (matching the headers order), NOT an object — this alone shrinks
// the payload dramatically versus repeating every header name per row.
function appendBatchAnalysisChunk(uploadId, chunkIndex, rowsChunk) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(BATCH_ANALYSIS_UPLOAD_ID_PROP) !== uploadId) {
      return { success: false, error: 'Upload session expired or was replaced by a newer save. Please try saving again.' };
    }
    if (!rowsChunk || !Array.isArray(rowsChunk)) {
      return { success: false, error: 'Invalid chunk payload.' };
    }
    var folder = getBatchAnalysisChunkFolder_();
    var idxStr = Utilities.formatString('%06d', chunkIndex);
    folder.createFile(Utilities.newBlob(
      JSON.stringify(rowsChunk),
      'application/json',
      'chunk_' + uploadId + '_' + idxStr + '.json'
    ));
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Step 3 — combine every uploaded chunk (in order) back into the same
// shared dataset file format the rest of the app already expects.
function finalizeBatchAnalysisUpload(uploadId, totalChunks) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(BATCH_ANALYSIS_UPLOAD_ID_PROP) !== uploadId) {
      return { success: false, error: 'Upload session expired or was replaced by a newer save. Please try saving again.' };
    }
    var filename = props.getProperty(BATCH_ANALYSIS_UPLOAD_FILENAME_PROP) || 'Batch_Analysis.xlsx';
    var headers = JSON.parse(props.getProperty(BATCH_ANALYSIS_UPLOAD_HEADERS_PROP) || '[]');
    var folder = getBatchAnalysisChunkFolder_();

    var chunkFiles = [];
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().indexOf('chunk_' + uploadId + '_') === 0) chunkFiles.push(f);
    }
    if (!chunkFiles.length) {
      return { success: false, error: 'No data chunks were received. Please try saving again.' };
    }
    chunkFiles.sort(function (a, b) { return a.getName() < b.getName() ? -1 : (a.getName() > b.getName() ? 1 : 0); });

    var rows = [];
    for (var i = 0; i < chunkFiles.length; i++) {
      var arr = JSON.parse(chunkFiles[i].getBlob().getDataAsString('UTF-8'));
      for (var r = 0; r < arr.length; r++) {
        var obj = {};
        var vals = arr[r];
        for (var c = 0; c < headers.length; c++) obj[headers[c]] = vals[c];
        rows.push(obj);
      }
    }

    var payload = JSON.stringify({ version: 1, filename: filename, headers: headers, rows: rows });
    var mainFolder = getBatchAnalysisDriveFolder_();
    var oldFileId = props.getProperty(BATCH_ANALYSIS_DRIVE_FILE_PROP);
    var jsonFile = mainFolder.createFile(Utilities.newBlob(payload, 'application/json', 'batch_analysis_data.json'));
    jsonFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty(BATCH_ANALYSIS_DRIVE_FILE_PROP, jsonFile.getId());
    if (oldFileId) { try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (ignore) {} }

    var meta = {
      filename: filename,
      uploadTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      totalRows: rows.length,
      totalCols: headers.length
    };
    props.setProperty('BATCH_ANALYSIS_META', JSON.stringify(meta));

    // Clean up temp chunk files + upload session now that we're done.
    clearBatchAnalysisChunkFiles_(folder);
    props.deleteProperty(BATCH_ANALYSIS_UPLOAD_ID_PROP);
    props.deleteProperty(BATCH_ANALYSIS_UPLOAD_FILENAME_PROP);
    props.deleteProperty(BATCH_ANALYSIS_UPLOAD_HEADERS_PROP);

    return { success: true, count: rows.length, message: 'Saved to shared Google Drive storage.' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Get Batch Analysis Excel Data from Google Drive
// ---------------------------------------------------------------------------
function getBatchAnalysisData() {
  try {
    var props = PropertiesService.getScriptProperties();
    var fileId = props.getProperty(BATCH_ANALYSIS_DRIVE_FILE_PROP);
    if (!fileId) return { success: true, headers: [], rows: [], totalRows: 0 };

    var stored = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8'));
    var headers = Array.isArray(stored.headers) ? stored.headers : [];
    var rows = Array.isArray(stored.rows) ? stored.rows : [];
    var metaStr = props.getProperty('BATCH_ANALYSIS_META');
    var meta = metaStr ? JSON.parse(metaStr) : { filename: 'Batch_Analysis.xlsx', uploadTime: 'Recent' };

    return {
      success: true,
      filename: meta.filename,
      uploadTime: meta.uploadTime,
      headers: headers,
      rows: rows,
      totalRows: rows.length
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Clear the shared Batch Analysis dataset from Google Drive
// ---------------------------------------------------------------------------
function clearBatchAnalysisData() {
  try {
    var props = PropertiesService.getScriptProperties();
    var fileId = props.getProperty(BATCH_ANALYSIS_DRIVE_FILE_PROP);
    var sourceFileId = props.getProperty(BATCH_ANALYSIS_SOURCE_FILE_PROP);
    if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignore) {} }
    if (sourceFileId) { try { DriveApp.getFileById(sourceFileId).setTrashed(true); } catch (ignore) {} }
    props.deleteProperty(BATCH_ANALYSIS_DRIVE_FILE_PROP);
    props.deleteProperty(BATCH_ANALYSIS_SOURCE_FILE_PROP);
    props.deleteProperty('BATCH_ANALYSIS_META');
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}