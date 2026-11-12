/**
 * =============================================================================
 * Dice & Forma Fast Engine: IndexedDB Queue & 0.05s Instant Submissions
 * =============================================================================
 * - Database: IndexedDB 'FMS_Dice_Forma_Fast_DB'
 * - 0.05-second instant optimistic form submission (immediate UI reset & tactile feedback)
 * - File attachments read to base64 & enqueued into persistent IndexedDB outbox
 * - Silent background sync worker with retry and offline outbox queue
 * - Real-time notification to AI Assistants & optimistic update to Summary tables
 * =============================================================================
 */

(function (root) {
  'use strict';

  var FAST_IDB_NAME = 'FMS_Dice_Forma_Fast_DB';
  var FAST_IDB_VERSION = 1;
  var FAST_IDB_STORE_QUEUE = 'submission_queue';
  var FAST_LS_QUEUE_KEY = 'fms_dice_forma_pending_queue';
  var DICE_FORMA_URL = 'https://script.google.com/macros/s/AKfycbxiKzPvhMr1BG22J7q2VvCMunHlav1s3lOgfizUUKbD10q49gZSotRyF2Wd_kvwSzcT/exec';

  var isSyncing = false;

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Helper
  // ---------------------------------------------------------------------------
  function openFastIdb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        return reject(new Error('IndexedDB not supported'));
      }
      var req = indexedDB.open(FAST_IDB_NAME, FAST_IDB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(FAST_IDB_STORE_QUEUE)) {
          db.createObjectStore(FAST_IDB_STORE_QUEUE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) {
        resolve(e.target.result);
      };
      req.onerror = function (e) {
        reject(e.target.error || new Error('Failed to open ' + FAST_IDB_NAME));
      };
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Queue Operations
  // ---------------------------------------------------------------------------
  function enqueueSubmission(item) {
    if (!item || !item.id) return Promise.resolve();

    // 1. Sync to localStorage queue
    try {
      var queue = JSON.parse(localStorage.getItem(FAST_LS_QUEUE_KEY) || '[]');
      queue.push(item);
      localStorage.setItem(FAST_LS_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {}

    // 2. Persistent save to IndexedDB queue
    return openFastIdb().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(FAST_IDB_STORE_QUEUE, 'readwrite');
          tx.objectStore(FAST_IDB_STORE_QUEUE).put(item);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (err) {
          resolve(false);
        }
      });
    }).catch(function (err) {
      console.warn('[DiceFormaFast] Enqueue warning:', err);
    });
  }

  var MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB maximum file size

  function getPendingFromLs() {
    try {
      var q = JSON.parse(localStorage.getItem(FAST_LS_QUEUE_KEY) || '[]');
      return q.filter(function (it) {
        if (!it || (it.status !== 'pending' && it.status !== 'failed')) return false;
        if (it.attachments && Array.isArray(it.attachments)) {
          var isOversized = it.attachments.some(function (a) {
            return a && a.base64 && a.base64.length > 14 * 1024 * 1024;
          });
          if (isOversized) return false;
        }
        return true;
      });
    } catch (e) {
      return [];
    }
  }

  function getPendingSubmissions() {
    return openFastIdb().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(FAST_IDB_STORE_QUEUE, 'readwrite');
          var store = tx.objectStore(FAST_IDB_STORE_QUEUE);
          var items = [];
          var req = store.openCursor();
          req.onsuccess = function (e) {
            var cursor = e.target.result;
            if (cursor) {
              var it = cursor.value;
              var isOversized = false;
              if (it && it.attachments && Array.isArray(it.attachments)) {
                it.attachments.forEach(function (att) {
                  if (att && att.base64 && att.base64.length > 14 * 1024 * 1024) {
                    isOversized = true;
                  }
                });
              }
              if (isOversized) {
                console.warn('[DiceFormaFast] Purged oversized queue item (>10MB):', it.id);
                cursor.delete();
              } else if (it && (it.status === 'pending' || it.status === 'failed')) {
                if ((it.retryCount || 0) < 5) {
                  items.push(it);
                } else {
                  console.warn('[DiceFormaFast] Dropping stale failed item after 5 retries:', it.id);
                  cursor.delete();
                }
              }
              cursor.continue();
            } else {
              resolve(items.length > 0 ? items : getPendingFromLs());
            }
          };
          req.onerror = function () { resolve(getPendingFromLs()); };
        } catch (err) {
          resolve(getPendingFromLs());
        }
      });
    }).catch(function () {
      return getPendingFromLs();
    });
  }

  function markSubmissionSynced(id) {
    // 1. Remove from localStorage
    try {
      var q = JSON.parse(localStorage.getItem(FAST_LS_QUEUE_KEY) || '[]');
      q = q.filter(function (it) { return it.id !== id; });
      localStorage.setItem(FAST_LS_QUEUE_KEY, JSON.stringify(q));
    } catch (e) {}

    // 2. Remove from IndexedDB
    return openFastIdb().then(function (db) {
      var tx = db.transaction(FAST_IDB_STORE_QUEUE, 'readwrite');
      tx.objectStore(FAST_IDB_STORE_QUEUE).delete(id);
    }).catch(function () {});
  }

  function markSubmissionFailed(id, errMsg) {
    try {
      var q = JSON.parse(localStorage.getItem(FAST_LS_QUEUE_KEY) || '[]');
      q.forEach(function (it) {
        if (it.id === id) {
          it.status = 'failed';
          it.error = errMsg;
          it.retryCount = (it.retryCount || 0) + 1;
        }
      });
      localStorage.setItem(FAST_LS_QUEUE_KEY, JSON.stringify(q));
    } catch (e) {}

    return openFastIdb().then(function (db) {
      var tx = db.transaction(FAST_IDB_STORE_QUEUE, 'readwrite');
      var store = tx.objectStore(FAST_IDB_STORE_QUEUE);
      var req = store.get(id);
      req.onsuccess = function () {
        var it = req.result;
        if (it) {
          it.status = 'failed';
          it.error = errMsg;
          it.retryCount = (it.retryCount || 0) + 1;
          store.put(it);
        }
      };
    }).catch(function () {});
  }

  // ---------------------------------------------------------------------------
  // 3. File Conversion
  // ---------------------------------------------------------------------------
  function fileAsPayload(file) {
    return new Promise(function (resolve, reject) {
      if (file && file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        var mb = (file.size / (1024 * 1024)).toFixed(1);
        return reject(new Error('File "' + file.name + '" is ' + mb + ' MB. Maximum allowed attachment size is 10 MB.'));
      }
      var reader = new FileReader();
      reader.onload = function () {
        var content = String(reader.result || '').split(',')[1] || '';
        resolve({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64: content
        });
      };
      reader.onerror = function () {
        reject(new Error('Could not read "' + file.name + '".'));
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Background Sync Worker
  // ---------------------------------------------------------------------------
  function postDiceFormaPayload(payload) {
    return fetch(DICE_FORMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (result) {
      if (!result || !result.success) throw new Error((result && result.error) || 'Server did not confirm.');
      return result;
    });
  }

  function processSyncQueue() {
    if (isSyncing || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) {
      return;
    }
    isSyncing = true;

    getPendingSubmissions().then(function (items) {
      if (!items || items.length === 0) {
        isSyncing = false;
        return;
      }

      var chain = Promise.resolve();
      items.forEach(function (item) {
        chain = chain.then(function () {
          var payload = {
            action: item.action,
            formData: item.formData,
            attachments: item.attachments || []
          };
          return postDiceFormaPayload(payload)
            .then(function () {
              return markSubmissionSynced(item.id);
            })
            .catch(function (err) {
              console.warn('[DiceFormaSync] Failed for ' + item.id + ', will retry:', err);
              return markSubmissionFailed(item.id, err && err.message ? err.message : 'Network error');
            });
        });
      });

      return chain;
    }).catch(function (err) {
      console.warn('[DiceFormaSync] Queue processing error:', err);
    }).then(function () {
      isSyncing = false;
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Form Validation & Fast Submit Orchestrator
  // ---------------------------------------------------------------------------
  function clearErrors(form) {
    if (!form) return;
    form.querySelectorAll('.form-field, .po-field').forEach(function (f) {
      f.classList.remove('has-error');
    });
  }

  function validateForm(form) {
    clearErrors(form);
    var firstInvalid = null;
    form.querySelectorAll('[required]').forEach(function (input) {
      if (!input.checkValidity() || !String(input.value || '').trim()) {
        var field = input.closest('.form-field') || input.closest('.po-field');
        if (field) field.classList.add('has-error');
        if (!firstInvalid) firstInvalid = input;
      }
    });

    if (firstInvalid) {
      firstInvalid.focus();
      if (typeof root.showToast === 'function') {
        root.showToast('error', 'Required fields', 'Please complete all required fields with valid values.');
      }
      return false;
    }
    return true;
  }

  function submit(form, type) {
    if (!form || !validateForm(form)) return;

    var isDice = (type === 'dice');
    var submitBtn = form.querySelector('[type="submit"]');
    var origBtnHtml = submitBtn ? submitBtn.innerHTML : '';

    // Collect field data
    var data = {};
    form.querySelectorAll('input:not([type="file"]), select, textarea').forEach(function (el) {
      if (el.name) data[el.name] = (el.value || '').trim();
    });

    var submitter = 'User';
    if (typeof root.currentSubmitter === 'function') {
      submitter = root.currentSubmitter();
    } else {
      try {
        var u = sessionStorage.getItem('fms_user') || localStorage.getItem('fms_user');
        if (u && u.trim()) submitter = u.trim();
      } catch (e) {}
    }
    data.submittedBy = submitter;

    // Collect attachments
    var fileInput = form.querySelector('[type="file"]');
    var files = fileInput && fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];

    for (var fi = 0; fi < files.length; fi++) {
      if (files[fi].size > MAX_ATTACHMENT_SIZE_BYTES) {
        var mb = (files[fi].size / (1024 * 1024)).toFixed(1);
        if (typeof root.showToast === 'function') {
          root.showToast('error', 'File Too Large', 'File "' + files[fi].name + '" is ' + mb + ' MB. Maximum allowed attachment size is 10 MB.');
        }
        if (fileInput) fileInput.value = '';
        return;
      }
    }

    // Read files as base64 (almost instantaneous for local files)
    var filePromise = files.length > 0
      ? Promise.all(files.map(fileAsPayload))
      : Promise.resolve([]);

    filePromise.then(function (attachments) {
      // 0.05s INSTANT OPTIMISTIC SUBMIT
      var queueItem = {
        id: (isDice ? 'dice_' : 'forma_') + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        type: type,
        action: isDice ? 'submitDiceForm' : 'submitFormaForm',
        formData: data,
        attachments: attachments,
        status: 'pending',
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
        retryCount: 0
      };

      // 1. Enqueue in background outbox
      enqueueSubmission(queueItem);

      // 2. Instant Form Reset & Dropzone reset
      form.reset();
      clearErrors(form);
      var nameLabel = document.getElementById(isDice ? 'dice-attachment-name' : 'forma-attachment-name');
      if (nameLabel) nameLabel.textContent = 'No file selected';
      var dropzone = document.getElementById(isDice ? 'dice-attachment-dropzone' : 'forma-attachment-dropzone');
      if (dropzone) dropzone.classList.remove('is-selected', 'is-dragover');

      // 3. Tactile Submit Button Feedback
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="material-icons-round">check_circle</span> Submitted!';
        submitBtn.style.backgroundColor = isDice ? '#1d4ed8' : '#6d28d9';
        setTimeout(function () {
          submitBtn.innerHTML = origBtnHtml;
          submitBtn.style.backgroundColor = '';
        }, 1200);
      }

      // 4. Instant Optimistic Toast
      if (typeof root.showToast === 'function') {
        root.showToast(
          'success',
          'Submitted Instantly!',
          (isDice ? 'Dice' : 'Forma') + ' details saved in 0.05s & syncing in background.'
        );
      }

      // 5. Notify Active AI Assistant
      if (root.DiceFormaAI && typeof root.DiceFormaAI.notifySubmitSuccess === 'function') {
        root.DiceFormaAI.notifySubmitSuccess(type, data);
      }

      // 6. Trigger silent background sync worker
      setTimeout(processSyncQueue, 40);
    }).catch(function (err) {
      console.warn('[DiceFormaFast] Submit error:', err);
      if (typeof root.showToast === 'function') {
        root.showToast('error', 'File Read Error', err && err.message ? err.message : 'Could not read attached files.');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Online Auto-Sync & Initialization
  // ---------------------------------------------------------------------------
  window.addEventListener('online', function () {
    console.log('[DiceFormaFast] Online detected -- syncing pending outbox...');
    processSyncQueue();
  });

  // Check sync queue shortly after page load
  setTimeout(processSyncQueue, 3000);

  root.DiceFormaFastEngine = {
    submit: submit,
    validateForm: validateForm,
    clearErrors: clearErrors,
    processSyncQueue: processSyncQueue,
    getPendingSubmissions: getPendingSubmissions
  };

})(window);
