// =============================================================================
// FMS FORM â€” app.js
// =============================================================================

(function () {
'use strict';

// ---------------------------------------------------------------------------
// IMPORTANT: After deploying/redeploying Code.gs, paste the new URL here.
// ---------------------------------------------------------------------------
var GAS_URL = 'https://script.google.com/macros/s/AKfycbx99oNMmHYn-jum8NEtkUFqYmR3nV0reWfL1MYC7GDeRxQJu-BbKJq56KW1KcmUoCjRNA/exec';
var DICE_FORMA_URL = 'https://script.google.com/macros/s/AKfycbxiKzPvhMr1BG22J7q2VvCMunHlav1s3lOgfizUUKbD10q49gZSotRyF2Wd_kvwSzcT/exec';
// Used by fetchTrackerSummary() below for the Domestic/Import purchase report
// (Reports > Submitted Domestic/Import Data â€” same template as Dice/Forma).
// Kept in sync with the PURCHASE_URL declared in main.js â€” that copy lives in a
// separate closure (main.js has its own IIFE) so it isn't visible in here.
var PURCHASE_URL = 'https://script.google.com/macros/s/AKfycbwjHUTJKOh3_P0mXD1Kk1dyeBJ_KuSRMjCjcm-YtJBDH9RMGUnkC_F4ELONFhkGefkI/exec';

// ---------------------------------------------------------------------------
// Session â€” read logged-in user from sessionStorage (set by login.html)
// ---------------------------------------------------------------------------
var SESSION_KEY = 'fms_user';
var ACCESS_KEY  = 'fms_access'; // JSON array of tab names this user is allowed to open (set by login.html)
var KPI_ACCESS_KEY = 'fms_kpi_access'; // JSON array of KPI-card ids this user is allowed to see (set by login.html)
var AI_ACCESS_KEY = 'fms_ai_access'; // JSON array of AI-feature names this user is allowed to open (set by login.html)

function getSession() {
    try { return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
}

function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    try { sessionStorage.removeItem(ACCESS_KEY); } catch (e) {}
    try { localStorage.removeItem(ACCESS_KEY); } catch (e) {}
    try { sessionStorage.removeItem(KPI_ACCESS_KEY); } catch (e) {}
    try { localStorage.removeItem(KPI_ACCESS_KEY); } catch (e) {}
    try { sessionStorage.removeItem(AI_ACCESS_KEY); } catch (e) {}
    try { localStorage.removeItem(AI_ACCESS_KEY); } catch (e) {}
}

// Admin-controlled tab access (USERS sheet, Column I) â€” an array of tab
// names such as ["Dashboard", "Reports", "PDF"]. Returns [] if unset.
function getAccess() {
    try {
        var raw = sessionStorage.getItem(ACCESS_KEY) || localStorage.getItem(ACCESS_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

// Overwrites the stored access list (used by the silent poller below).
// Mirrors it into whichever storage currently holds the session â€” if
// "Remember Me" was used (localStorage has the session), keep both in sync.
function setAccess(access) {
    var json = JSON.stringify(Array.isArray(access) ? access : []);
    try { sessionStorage.setItem(ACCESS_KEY, json); } catch (e) {}
    try {
        if (localStorage.getItem(SESSION_KEY)) localStorage.setItem(ACCESS_KEY, json);
    } catch (e) {}
}

// Admin-controlled KPI-card access (USERS sheet, Column J) â€” an array of
// KPI-card ids such as ["kpi-cutting-details", "kpi-dice-summary"]. An EMPTY
// array means "no restriction" â€” every KPI card inside a tab the user has
// tab-access to stays visible. This keeps existing users unaffected until an
// admin deliberately fills in Column J for someone.
function getKpiAccess() {
    try {
        var raw = sessionStorage.getItem(KPI_ACCESS_KEY) || localStorage.getItem(KPI_ACCESS_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function setKpiAccess(kpiAccess) {
    var json = JSON.stringify(Array.isArray(kpiAccess) ? kpiAccess : []);
    try { sessionStorage.setItem(KPI_ACCESS_KEY, json); } catch (e) {}
    try {
        if (localStorage.getItem(SESSION_KEY)) localStorage.setItem(KPI_ACCESS_KEY, json);
    } catch (e) {}
}

// Admin-controlled per-AI-feature access (USERS sheet, Column K) â€” an array
// of AI-feature names such as ["Pre-Production AI", "Trio AI"]. An EMPTY
// array means "no restriction" â€” same convention as getKpiAccess() above.
function getAiAccess() {
    try {
        var raw = sessionStorage.getItem(AI_ACCESS_KEY) || localStorage.getItem(AI_ACCESS_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function setAiAccess(aiAccess) {
    var json = JSON.stringify(Array.isArray(aiAccess) ? aiAccess : []);
    try { sessionStorage.setItem(AI_ACCESS_KEY, json); } catch (e) {}
    try {
        if (localStorage.getItem(SESSION_KEY)) localStorage.setItem(AI_ACCESS_KEY, json);
    } catch (e) {}
}

function getLoginUrl() {
    var isGAS = (typeof google !== 'undefined' && google.script && google.script.run) ||
                (window.location.hostname && window.location.hostname.indexOf('script.google.com') !== -1);
    if (isGAS) {
        return GAS_URL;
    }
    if (window.location.search && /(?:^|[?&])page=app(?:&|$)/.test(window.location.search)) {
        return window.location.pathname + '?page=login';
    }
    return 'login.html';
}

function enforceLogin() {
    var isGAS = (typeof google !== 'undefined' && google.script && google.script.run) ||
                (window.location.hostname && window.location.hostname.indexOf('script.google.com') !== -1);
    if (isGAS) return;
    var user = getSession();
    if (!user) {
        if (document.documentElement) {
            document.documentElement.style.display = 'none';
        }
        window.location.replace(getLoginUrl());
    } else {
        var un = document.getElementById('topbar-username');
        if (un) un.textContent = user;
    }
}

function logoutUser() {
    clearSession();
    window.location.replace(getLoginUrl());
}

// ---------------------------------------------------------------------------
// Unified Coordinator for Topbar Popovers (Calendar, Notifications, Profile)
// Ensures mutually exclusive display: only one panel can ever be open at a time.
// Moving mouse or clicking between the 3 sections immediately closes any other open panel.
// ---------------------------------------------------------------------------
var topbarPopovers = {
    calendar: {
        isOpen: function () {
            var el = document.getElementById('topbar-calendar');
            return !!(el && !el.hidden);
        },
        close: function () {
            if (topbarPopovers._closeCalendar) topbarPopovers._closeCalendar();
        },
        open: function () {
            if (topbarPopovers._openCalendar) topbarPopovers._openCalendar();
        }
    },
    notification: {
        isOpen: function () {
            var el = document.getElementById('topbar-notif-panel');
            return !!(el && !el.hidden);
        },
        close: function () {
            if (topbarPopovers._closeNotification) topbarPopovers._closeNotification();
        },
        open: function () {
            if (topbarPopovers._openNotification) topbarPopovers._openNotification();
        }
    },
    profile: {
        isOpen: function () {
            var wrap = document.getElementById('topbar-user');
            return !!(wrap && wrap.classList.contains('profile-open'));
        },
        close: function () {
            if (topbarPopovers._closeProfile) topbarPopovers._closeProfile();
        },
        open: function () {
            if (topbarPopovers._openProfile) topbarPopovers._openProfile();
        }
    },
    closeOthers: function (current) {
        if (current !== 'calendar') topbarPopovers.calendar.close();
        if (current !== 'notification') topbarPopovers.notification.close();
        if (current !== 'profile') topbarPopovers.profile.close();
    },
    closeAll: function () {
        topbarPopovers.calendar.close();
        topbarPopovers.notification.close();
        topbarPopovers.profile.close();
    },
    isAnyOpen: function () {
        return topbarPopovers.calendar.isOpen() || topbarPopovers.notification.isOpen() || topbarPopovers.profile.isOpen();
    },
    _closeCalendar: null,
    _openCalendar: null,
    _closeNotification: null,
    _openNotification: null,
    _closeProfile: null,
    _openProfile: null
};

function initProfileMenu() {
    var userWrap = document.getElementById('topbar-user');
    var menu     = document.getElementById('profile-menu');
    if (!userWrap || !menu) return;

    var nameEl = document.getElementById('profile-menu-name');
    var topbarName = document.getElementById('topbar-username');
    var currentUser = getSession() || (topbarName ? topbarName.textContent : '') || 'User';
    if (topbarName) topbarName.textContent = currentUser;
    if (nameEl) nameEl.textContent = currentUser;

    function setOpen(open) {
        if (open) {
            topbarPopovers.closeOthers('profile');
        }
        userWrap.classList.toggle('profile-open', open);
        userWrap.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    topbarPopovers._closeProfile = function () {
        setOpen(false);
    };
    topbarPopovers._openProfile = function () {
        topbarPopovers.closeOthers('profile');
        setOpen(true);
    };

    userWrap.addEventListener('click', function (e) {
        e.stopPropagation();
        var isCurrentlyOpen = userWrap.classList.contains('profile-open');
        if (isCurrentlyOpen) {
            setOpen(false);
        } else {
            topbarPopovers.closeOthers('profile');
            setOpen(true);
        }
    });

    userWrap.addEventListener('mouseenter', function () {
        // If another topbar popover is open (Calendar or Notifications), close it when moving to Profile!
        topbarPopovers.closeOthers('profile');
    });

    userWrap.addEventListener('keydown', function (e) {
        if (e.target !== userWrap) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            var isCurrentlyOpen = userWrap.classList.contains('profile-open');
            if (isCurrentlyOpen) {
                setOpen(false);
            } else {
                topbarPopovers.closeOthers('profile');
                setOpen(true);
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
            userWrap.focus();
        }
    });

    menu.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    document.addEventListener('click', function () {
        setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setOpen(false);
    });

    var profileLogout = document.getElementById('profile-menu-logout');
    if (profileLogout) {
        profileLogout.addEventListener('click', function () {
            logoutUser();
        });
    }
}

// ---------------------------------------------------------------------------
// Profile photo â€” lets a signed-in user upload their own picture, shown in
// the topbar avatar and the profile dropdown. Photos are stored server-side
// (Code.gs: updateUserPhoto / getUserPhoto / removeUserPhoto â€” a Drive file
// per user, referenced from the USERS sheet) and cached locally per-username
// so returning visits don't need a round trip before showing the photo.
// ---------------------------------------------------------------------------
function profilePhotoCacheKey_(username) {
    return 'fms_user_photo_' + String(username || '').trim().toLowerCase();
}

function applyAvatarPhoto_(url) {
    var pairs = [
        [document.getElementById('topbar-avatar-img'), document.getElementById('topbar-avatar-icon')],
        [document.getElementById('profile-menu-avatar-img'), document.getElementById('profile-menu-avatar-icon')]
    ];
    pairs.forEach(function (pair) {
        var img = pair[0], icon = pair[1];
        if (!img) return;
        if (url) {
            img.src = url;
            img.hidden = false;
            if (icon) icon.hidden = true;
        } else {
            img.hidden = true;
            img.removeAttribute('src');
            if (icon) icon.hidden = false;
        }
    });
    var removeBtn = document.getElementById('profile-menu-remove-photo');
    if (removeBtn) removeBtn.hidden = !url;
}

function loadUserPhoto_(username) {
    if (!username) return;
    var cacheKey = profilePhotoCacheKey_(username);
    var cached = null;
    try { cached = localStorage.getItem(cacheKey); } catch (e) {}
    if (cached) applyAvatarPhoto_(cached);

    jsonp({ action: 'getUserPhoto', username: username }, function (err, result) {
        if (err || !result || !result.success) return;
        var url = result.photoUrl || '';
        applyAvatarPhoto_(url);
        try {
            if (url) localStorage.setItem(cacheKey, url);
            else localStorage.removeItem(cacheKey);
        } catch (e) {}
    });
}

function readFileAsBase64_(file) {
    return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '').split(',')[1] || ''); };
        reader.onerror = function () { reject(new Error('Could not read the selected image.')); };
        reader.readAsDataURL(file);
    });
}

function uploadUserPhoto_(file, username) {
    var MAX_BYTES = 3 * 1024 * 1024;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
        showToast('error', 'Unsupported file', 'Please choose a JPG, PNG or WEBP image.');
        return;
    }
    if (file.size > MAX_BYTES) {
        showToast('error', 'Image too large', 'Please choose an image under 3MB.');
        return;
    }

    readFileAsBase64_(file).then(function (base64) {
        return fetch(GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'updateUserPhoto', username: username, base64: base64, mimeType: file.type })
        });
    }).then(function (response) {
        if (!response.ok) throw new Error('The server returned HTTP ' + response.status + '.');
        return response.json();
    }).then(function (result) {
        if (!result || !result.success) throw new Error((result && result.error) || 'Could not update the photo.');
        applyAvatarPhoto_(result.photoUrl);
        try { localStorage.setItem(profilePhotoCacheKey_(username), result.photoUrl); } catch (e) {}
        showToast('success', 'Photo updated', 'Your profile photo has been updated.');
    }).catch(function (err) {
        showToast('error', 'Upload failed', (err && err.message) || 'Please check your internet connection and try again.');
    });
}

function removeUserPhoto_(username) {
    fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'removeUserPhoto', username: username })
    }).then(function (response) {
        if (!response.ok) throw new Error('The server returned HTTP ' + response.status + '.');
        return response.json();
    }).then(function (result) {
        if (!result || !result.success) throw new Error((result && result.error) || 'Could not remove the photo.');
        applyAvatarPhoto_('');
        try { localStorage.removeItem(profilePhotoCacheKey_(username)); } catch (e) {}
        showToast('success', 'Photo removed', 'Your profile photo has been removed.');
    }).catch(function (err) {
        showToast('error', 'Action failed', (err && err.message) || 'Please check your internet connection and try again.');
    });
}

function initProfilePhoto() {
    var currentUser = getSession();
    if (!currentUser) return;

    loadUserPhoto_(currentUser);

    var editBtn    = document.getElementById('profile-avatar-edit-btn');
    var fileInput  = document.getElementById('profile-avatar-file-input');
    var removeBtn  = document.getElementById('profile-menu-remove-photo');

    if (editBtn && fileInput) {
        editBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            fileInput.click();
        });
        fileInput.addEventListener('click', function (e) { e.stopPropagation(); });
        fileInput.addEventListener('change', function () {
            var file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (file) uploadUserPhoto_(file, currentUser);
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            removeUserPhoto_(currentUser);
        });
    }
}

// ---------------------------------------------------------------------------
// Topbar Calendar â€” clean month view popover, opened from the calendar icon
// in the header. Sundays are highlighted; today and any clicked date are
// marked distinctly. Subtle fade/slide animations on open and month change.
// ---------------------------------------------------------------------------
function initTopbarCalendar() {
    var wrap  = document.getElementById('topbar-calendar-wrap');
    var btn   = document.getElementById('topbar-calendar-btn');
    var panel = document.getElementById('topbar-calendar');
    if (!wrap || !btn || !panel) return;

    var periodTrigger = document.getElementById('calendar-period-trigger');
    var periodMenu    = document.getElementById('calendar-period-menu');
    var periodMonth   = document.getElementById('calendar-period-month');
    var periodYear    = document.getElementById('calendar-period-year');
    var pickerYear    = document.getElementById('calendar-picker-year');
    var monthGrid     = document.getElementById('calendar-month-grid');
    var yearPrevBtn   = document.getElementById('calendar-year-prev');
    var yearNextBtn   = document.getElementById('calendar-year-next');
    var daysGrid     = document.getElementById('calendar-days');
    var prevBtn      = document.getElementById('calendar-prev-btn');
    var nextBtn      = document.getElementById('calendar-next-btn');
    var todayBtn     = document.getElementById('calendar-today-btn');
    var selectedLbl  = document.getElementById('calendar-selected-label');

    var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    var WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    var today = new Date();
    var view  = { month: today.getMonth(), year: today.getFullYear() };
    var selected = null; // { day, month, year }

    function formatSelectedLabel() {
        if (selected) {
            var sd = new Date(selected.year, selected.month, selected.day);
            selectedLbl.textContent = WEEKDAY_NAMES[sd.getDay()].slice(0, 3) + ', ' +
                MONTH_NAMES[selected.month].slice(0, 3) + ' ' + selected.day + ', ' + selected.year;
        } else {
            selectedLbl.textContent = 'Today: ' + WEEKDAY_NAMES[today.getDay()].slice(0, 3) + ', ' +
                MONTH_NAMES[today.getMonth()].slice(0, 3) + ' ' + today.getDate() + ', ' + today.getFullYear();
        }
    }

    function setPeriodMenuOpen(isOpen) {
        periodMenu.hidden = !isOpen;
        periodTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    function renderMonthPicker() {
        periodMonth.textContent = MONTH_NAMES[view.month];
        periodYear.textContent = String(view.year);
        pickerYear.textContent = String(view.year);
        monthGrid.innerHTML = '';

        MONTH_NAMES.forEach(function (name, month) {
            var monthBtn = document.createElement('button');
            monthBtn.type = 'button';
            monthBtn.className = 'calendar-month-option';
            monthBtn.textContent = name.slice(0, 3);
            monthBtn.setAttribute('aria-label', name + ' ' + view.year);
            if (month === view.month) monthBtn.classList.add('is-active');
            monthBtn.addEventListener('click', function () {
                view.month = month;
                setPeriodMenuOpen(false);
                render();
            });
            monthGrid.appendChild(monthBtn);
        });
    }

    function render() {
        renderMonthPicker();

        daysGrid.innerHTML = '';
        daysGrid.classList.remove('calendar-days-anim');
        void daysGrid.offsetWidth; // restart the fade-in animation on every render
        daysGrid.classList.add('calendar-days-anim');

        var firstOfMonth  = new Date(view.year, view.month, 1);
        var startWeekday  = firstOfMonth.getDay(); // 0 = Sunday
        var daysInMonth   = new Date(view.year, view.month + 1, 0).getDate();

        for (var i = 0; i < startWeekday; i++) {
            var empty = document.createElement('span');
            empty.className = 'calendar-day is-empty';
            daysGrid.appendChild(empty);
        }

        var _loop = function (day) {
            var dayBtn = document.createElement('button');
            dayBtn.type = 'button';
            dayBtn.className = 'calendar-day';
            dayBtn.textContent = String(day);

            var weekday = new Date(view.year, view.month, day).getDay();
            if (weekday === 0) dayBtn.classList.add('is-sunday');
            if (weekday === 6) dayBtn.classList.add('is-saturday');

            var isToday = (view.year === today.getFullYear() && view.month === today.getMonth() && day === today.getDate());
            if (isToday) dayBtn.classList.add('is-today');

            var isSelected = selected && selected.year === view.year && selected.month === view.month && selected.day === day;
            if (isSelected) dayBtn.classList.add('is-selected');

            dayBtn.addEventListener('click', function () {
                selected = { day: day, month: view.month, year: view.year };
                formatSelectedLabel();
                render();
            });

            daysGrid.appendChild(dayBtn);
        };
        for (var day = 1; day <= daysInMonth; day++) _loop(day);
    }

    function open() {
        topbarPopovers.closeOthers('calendar');
        panel.hidden = false;
        wrap.classList.add('calendar-open');
        btn.setAttribute('aria-expanded', 'true');
        render();
    }

    function close() {
        panel.hidden = true;
        setPeriodMenuOpen(false);
        wrap.classList.remove('calendar-open');
        btn.setAttribute('aria-expanded', 'false');
    }

    topbarPopovers._closeCalendar = close;
    topbarPopovers._openCalendar = function () {
        topbarPopovers.closeOthers('calendar');
        open();
    };

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (panel.hidden) {
            topbarPopovers.closeOthers('calendar');
            open();
        } else {
            close();
        }
    });

    wrap.addEventListener('mouseenter', function () {
        // If another topbar popover is open (Notifications or Profile), close it when moving to Calendar!
        topbarPopovers.closeOthers('calendar');
    });

    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    document.addEventListener('click', function () {
        if (!panel.hidden) close();
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !panel.hidden) close();
    });

    periodTrigger.addEventListener('click', function () {
        setPeriodMenuOpen(periodMenu.hidden);
    });
    yearPrevBtn.addEventListener('click', function () {
        view.year--;
        render();
        setPeriodMenuOpen(true);
    });
    yearNextBtn.addEventListener('click', function () {
        view.year++;
        render();
        setPeriodMenuOpen(true);
    });

    prevBtn.addEventListener('click', function () {
        view.month--;
        if (view.month < 0) { view.month = 11; view.year--; }
        render();
    });
    nextBtn.addEventListener('click', function () {
        view.month++;
        if (view.month > 11) { view.month = 0; view.year++; }
        render();
    });

    todayBtn.addEventListener('click', function () {
        view.month = today.getMonth();
        view.year  = today.getFullYear();
        render();
    });

    formatSelectedLabel();
}

// ---------------------------------------------------------------------------
// Birthday Celebration â€” colorful header + confetti animation shown ONLY to
// the logged-in user whose birthday (USERS sheet, Column G) is today.
// Re-checked periodically so it turns on/off right at the day boundary even
// if the tab is left open across midnight.
// ---------------------------------------------------------------------------
var BIRTHDAY_TOAST_KEY = 'fms_birthday_toast_shown';
var BIRTHDAY_RECHECK_MS = 15 * 60 * 1000; // 15 minutes

var BIRTHDAY_CONFETTI_COLORS = ['#d9b96a', '#e8c4c4', '#a9b8d4', '#b7c9a8', '#e8ddc0'];

function renderBirthdayConfetti(topbar) {
    if (!topbar || topbar.querySelector('.birthday-header-confetti')) return;
    var layer = document.createElement('div');
    layer.className = 'birthday-header-confetti';
    var pieces = 12;
    for (var i = 0; i < pieces; i++) {
        var piece = document.createElement('i');
        var color = BIRTHDAY_CONFETTI_COLORS[i % BIRTHDAY_CONFETTI_COLORS.length];
        var left  = Math.min(98, Math.max(0, Math.round((i / pieces) * 100 + (Math.random() * 4 - 2))));
        var drift = Math.round(Math.random() * 40 - 20) + 'px';
        var delay = (Math.random() * 4.6).toFixed(2) + 's';
        piece.style.left = left + '%';
        piece.style.setProperty('--confetti-color', color);
        piece.style.setProperty('--confetti-drift', drift);
        piece.style.setProperty('--confetti-delay', delay);
        layer.appendChild(piece);
    }
    topbar.appendChild(layer);
}

function renderBirthdayBanner(topbar, displayName) {
    if (!topbar || topbar.querySelector('.birthday-banner')) return;
    var banner = document.createElement('div');
    banner.className = 'birthday-banner';
    banner.innerHTML =
        '<span class="birthday-banner-emoji">ðŸŽ‰</span>' +
        '<span class="birthday-banner-text">Happy Birthday' + (displayName ? ', ' + esc(displayName) : '') + '!</span>' +
        '<span class="birthday-banner-emoji bb-emoji-2">ðŸŽ‚</span>';

    // Insert as a normal flex child right after the title (and before the
    // notification/profile actions) so it never overlaps other header items.
    var actions = topbar.querySelector('.topbar-actions');
    if (actions && actions.parentNode === topbar) {
        topbar.insertBefore(banner, actions);
    } else {
        topbar.appendChild(banner);
    }
}

function applyBirthdayCelebration(displayName) {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;
    topbar.classList.add('birthday-active');
    renderBirthdayConfetti(topbar);
    renderBirthdayBanner(topbar, displayName);

    var alreadyToasted = false;
    try { alreadyToasted = sessionStorage.getItem(BIRTHDAY_TOAST_KEY) === '1'; } catch (e) {}
    if (!alreadyToasted) {
        showToast('success', 'ðŸŽ‰ Happy Birthday' + (displayName ? ', ' + displayName : '') + '!', 'Wishing you a wonderful day ahead.');
        try { sessionStorage.setItem(BIRTHDAY_TOAST_KEY, '1'); } catch (e) {}
    }
}

function removeBirthdayCelebration() {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;
    topbar.classList.remove('birthday-active');
    var layer = topbar.querySelector('.birthday-header-confetti');
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    var banner = topbar.querySelector('.birthday-banner');
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
}

function initBirthdayCelebration() {
    var user = getSession();
    if (!user) return;

    function handleResult(result) {
        if (result && result.success && result.isBirthday) {
            applyBirthdayCelebration(result.username || user);
        } else {
            removeBirthdayCelebration();
        }
    }

    function check() {
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(handleResult)
                .withFailureHandler(function () {})
                .checkUserBirthday(user);
            return;
        }
        jsonp({ action: 'checkUserBirthday', username: user }, function (err, result) {
            if (err) return;
            handleResult(result);
        });
    }

    check();
    setInterval(check, BIRTHDAY_RECHECK_MS);
}

// ---------------------------------------------------------------------------
// Real-time Notifications
// ---------------------------------------------------------------------------
// How it works:
//  - Code.gs's "NOTIFICATIONS" sheet is an append-only log: column A is the
//    message text (typed directly into the sheet â€” nothing else to do),
//    column B is a timestamp the server fills in automatically.
//  - This client polls getNotifications() every NOTIF_POLL_MS.
//  - "Read" is tracked per-username in localStorage as a SET of notification
//    ids (not just a high-water-mark), because it's now explicit: a
//    notification stays unread â€” red dot, red blinking bell badge â€” until
//    the user actually marks it read. Just opening/closing the dropdown does
//    NOT mark anything read anymore.
//  - Two ways to mark read: click the small check on an individual item, or
//    "Mark all as read" in the panel header.
//  - The moment a notification is first spotted in this browser tab, it
//    also pops a toast (real-time push feel) and gives the bell a little
//    shake â€” but only once per notification per page load.
// ---------------------------------------------------------------------------
var NOTIF_POLL_MS = 30000; // 30s sensible notification polling without hammering server
var notifState = { items: [], readIds: {}, notifiedIds: {} };
var NOTIF_MAX_STORED_READ_IDS = 1000; // trim so localStorage never grows unbounded

function notifReadKey_(user) {
    return 'fms_notif_read_' + String(user || '').trim().toLowerCase();
}
function loadReadIds_(user) {
    var map = {};
    try {
        var raw = JSON.parse(localStorage.getItem(notifReadKey_(user)) || '[]');
        // Ignore legacy numeric row IDs. Rows can be deleted and reused, so
        // only a server-generated permanent ID is valid here.
        if (Array.isArray(raw)) raw.forEach(function (id) {
            if (typeof id === 'string' && id.trim()) map[id] = true;
        });
    } catch (e) {}
    return map;
}
function saveReadIds_(user) {
    try {
        var ids = Object.keys(notifState.readIds).sort();
        if (ids.length > NOTIF_MAX_STORED_READ_IDS) ids = ids.slice(ids.length - NOTIF_MAX_STORED_READ_IDS);
        localStorage.setItem(notifReadKey_(user), JSON.stringify(ids));
    } catch (e) {}
}
function isNotifRead_(id) {
    return !!notifState.readIds[id];
}

function getUnreadNotificationCount_() {
    return notifState.items.reduce(function (count, notification) {
        return count + (isNotifRead_(notification.id) ? 0 : 1);
    }, 0);
}

function timeAgo_(isoString) {
    var then = new Date(isoString).getTime();
    if (isNaN(then)) return '';
    var diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (diffSec < 45) return 'Just now';
    var diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
    var diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    var diffDay = Math.round(diffHr / 24);
    if (diffDay < 7) return diffDay + 'd ago';
    var d = new Date(isoString);
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function renderNotificationList_() {
    var list = document.getElementById('notif-list');
    var empty = document.getElementById('notif-empty');
    var markAllBtn = document.getElementById('notif-mark-all-read');
    if (!list) return;

    if (!notifState.items.length) {
        list.innerHTML = '';
        list.appendChild(empty || document.createTextNode('No notifications yet.'));
        if (markAllBtn) markAllBtn.hidden = true;
        return;
    }

    var anyUnread = false;
    list.innerHTML = notifState.items.map(function (n) {
        var unread = !isNotifRead_(n.id);
        if (unread) anyUnread = true;
        return '<div class="notif-item' + (unread ? ' notif-unread' : '') + '" data-id="' + esc(n.id) + '">' +
            '<span class="notif-item-dot" title="' + (unread ? 'Unread' : 'Read') + '"></span>' +
            '<div class="notif-item-body">' +
                '<div class="notif-item-msg">' + esc(n.message) + '</div>' +
                '<div class="notif-item-time">' + esc(timeAgo_(n.timestamp)) + '</div>' +
            '</div>' +
            (unread ? '<button type="button" class="notif-mark-read-btn" data-mark-id="' + esc(n.id) + '" title="Mark as read" aria-label="Mark as read">' +
                '<span class="material-icons-round" style="font-size:15px;">done</span>' +
            '</button>' : '') +
        '</div>';
    }).join('');

    if (markAllBtn) markAllBtn.hidden = !anyUnread;
}

function updateNotifBadge_() {
    var badge = document.getElementById('topbar-notif-badge');
    var markAllBtn = document.getElementById('notif-mark-all-read');
    var bellButton = document.getElementById('topbar-notif-btn');
    var unreadCount = getUnreadNotificationCount_();

    // Both controls reflect the exact same unread count. Keeping this in one
    // function prevents the bell and the panel action from falling out of sync.
    if (badge && unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.hidden = false;
        badge.setAttribute('aria-label', unreadCount + ' unread notifications');
    } else if (badge) {
        badge.hidden = true;
        badge.removeAttribute('aria-label');
    }
    if (markAllBtn) markAllBtn.hidden = unreadCount === 0;
    if (bellButton) bellButton.classList.toggle('has-unread-notifications', unreadCount > 0);
}

function refreshNotificationUi_() {
    renderNotificationList_();
    updateNotifBadge_();
}

function markNotificationRead_(user, id) {
    if (notifState.readIds[id]) return;
    notifState.readIds[id] = true;
    saveReadIds_(user);
    refreshNotificationUi_();
}

function markAllNotificationsRead_(user) {
    var changed = false;
    notifState.items.forEach(function (n) {
        if (!notifState.readIds[n.id]) { notifState.readIds[n.id] = true; changed = true; }
    });
    if (changed) saveReadIds_(user);
    refreshNotificationUi_();
}

function handleNotificationResult_(result, user) {
    if (!result || !result.success || !Array.isArray(result.notifications)) return;
    var seenIds = {};
    var items = result.notifications.filter(function (notification) {
        var id = String(notification && notification.id || '').trim();
        if (!id || seenIds[id]) return false;
        seenIds[id] = true;
        notification.id = id;
        return true;
    });

    // Real-time push: toast + bell shake for anything newer than the last
    // one we've already notified about in THIS page session.
    var hasNewNotification = false;
    items.forEach(function (n) {
        if (!notifState.notifiedIds[n.id]) {
            notifState.notifiedIds[n.id] = true;
            // A notification already marked read in an earlier login must
            // never announce itself again after the user signs back in.
            if (!isNotifRead_(n.id)) {
                if (helpersShowToast_()) helpersShowToast_()('info', 'New Notification', n.message);
                hasNewNotification = true;
            }
        }
    });
    if (hasNewNotification) {
        var btn = document.getElementById('topbar-notif-btn');
        if (btn) {
            btn.classList.remove('notif-bell-ping');
            // restart the animation even if it's already mid-run
            void btn.offsetWidth;
            btn.classList.add('notif-bell-ping');
        }
    }

    notifState.items = items.slice().reverse(); // newest first in the list
    refreshNotificationUi_();
}

function helpersShowToast_() {
    return (typeof showToast === 'function') ? showToast : null;
}

function pollNotifications_(user) {
    function onResult(result) { handleNotificationResult_(result, user); }
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(onResult).withFailureHandler(function () {}).getNotifications();
        return;
    }
    jsonp({ action: 'getNotifications' }, function (err, result) {
        if (!err) onResult(result);
    });
}

function initNotifications() {
    var user = getSession();
    notifState.readIds = loadReadIds_(user);
    notifState.notifiedIds = {}; // page-session-only de-dupe for the toast/shake, unrelated to read state

    var wrap = document.getElementById('topbar-notif-wrap');
    var btn = document.getElementById('topbar-notif-btn');
    var panel = document.getElementById('topbar-notif-panel');
    var list = document.getElementById('notif-list');
    var markAllBtn = document.getElementById('notif-mark-all-read');
    if (!wrap || !btn || !panel) return;

    function open() {
        topbarPopovers.closeOthers('notification');
        panel.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        refreshNotificationUi_();
    }
    function close() {
        if (panel.hidden) return;
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
    }

    topbarPopovers._closeNotification = close;
    topbarPopovers._openNotification = function () {
        topbarPopovers.closeOthers('notification');
        open();
    };

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (panel.hidden) {
            topbarPopovers.closeOthers('notification');
            open();
        } else {
            close();
        }
    });

    wrap.addEventListener('mouseenter', function () {
        // If another topbar popover is open (Calendar or Profile), close it when moving to Notifications!
        topbarPopovers.closeOthers('notification');
    });

    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    btn.addEventListener('animationend', function () { btn.classList.remove('notif-bell-ping'); });

    if (list) {
        list.addEventListener('click', function (e) {
            var markBtn = e.target.closest ? e.target.closest('.notif-mark-read-btn') : null;
            if (markBtn) {
                e.stopPropagation();
                markNotificationRead_(user, markBtn.getAttribute('data-mark-id'));
                return;
            }
            // Clicking anywhere else on an unread item also marks it read.
            var item = e.target.closest ? e.target.closest('.notif-item') : null;
            if (item) markNotificationRead_(user, item.getAttribute('data-id'));
        });
    }
    if (markAllBtn) {
        markAllBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            markAllNotificationsRead_(user);
        });
    }

    pollNotifications_(user);
    setInterval(function () { pollNotifications_(user); }, NOTIF_POLL_MS);
}


var currentCuttingQty = null;   // set when a cutting-details match is found

// ---------------------------------------------------------------------------
// JSONP helper
// ---------------------------------------------------------------------------
function jsonp(params, callback, timeoutMs) {
    var cbName = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    var url = GAS_URL + '?callback=' + cbName;
    Object.keys(params).forEach(function (k) {
    url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]));
    });

    var timeout;
    var script = document.createElement('script');

    window[cbName] = function (data) {
    clearTimeout(timeout);
    cleanup();
    callback(null, data);
    };

    function cleanup() {
    try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
    if (script.parentNode) script.parentNode.removeChild(script);
    }

    script.onerror = function () {
    clearTimeout(timeout);
    cleanup();
    callback(new Error('Network error â€” could not reach the server. Make sure Code.gs is deployed and GAS_URL is correct.'));
    };

    // Default timeout raised from 15s -> 30s. Callers that expect a heavier
    // payload (e.g. large data-table fetches) can pass a longer timeoutMs.
    timeout = setTimeout(function () {
    cleanup();
    callback(new Error('Request timed out.'));
    }, timeoutMs || 30000);

    script.src = url;
    document.head.appendChild(script);
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------
function showSpinner(msg) {
    var el = document.getElementById('spinner-overlay');
    if (!el) return;
    el.classList.remove('hidden');
    var txt = el.querySelector('.spinner-text');
    if (txt) txt.textContent = msg || 'Loadingâ€¦';
}

function hideSpinner() {
    var el = document.getElementById('spinner-overlay');
    if (el) el.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function showToast(type, title, msg) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var icons = {
        success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
        error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.innerHTML =
    '<div class="toast-icon">' + (icons[type] || icons.info) + '</div>' +
    '<div class="toast-body">' +
        '<div class="toast-title">' + esc(title) + '</div>' +
        (msg ? '<div class="toast-msg">' + esc(msg) + '</div>' : '') +
    '</div>';
    container.appendChild(toast);
    setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'opacity .3s, transform .3s';
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 320);
    }, 5000);
}

function esc(str) {
    return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Load dropdown data
// ---------------------------------------------------------------------------
// Populated once fetchDropdowns() succeeds. Declared up front (instead of
// only being created as an implicit global inside fetchDropdowns' success
// handler) so dropdowns can be mounted â€” and made clickable â€” immediately
// at page load, before the server has responded.
var dropdownData = {};

function fetchDropdowns() {
    // 1. ULTRA-FAST INSTANT PATH: Check CuttingDetailsEngine / Local cache
    if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.getDropdownData === 'function') {
        var cachedDD = window.CuttingDetailsEngine.getDropdownData();
        if (cachedDD) {
            dropdownData = Object.assign({}, dropdownData, cachedDD);
            initAllDropdowns();
        }
    }

    var hasCachedBatches = dropdownData.batchIds && dropdownData.batchIds.length > 0;
    var hasOtherDD = dropdownData.cuttingLeatherReceiveUnits && dropdownData.cuttingLeatherReceiveUnits.length > 0;

    // If we have cached data or seed options, NEVER show any full-screen blocking spinner!
    if (hasCachedBatches || hasOtherDD) {
        hideSpinner();
        // Sync in background silently via CuttingDetailsEngine without freezing screen
        if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.syncAll === 'function') {
            window.CuttingDetailsEngine.syncAll();
        }
        return;
    }

    // Only if cache is completely missing on first visit ever:
    showSpinner('Loading dropdown dataâ€¦');

    function applyDropdownResult(result) {
        hideSpinner();
        if (result && result.success && result.data) {
            var incoming = result.data;
            if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.getBatchIds === 'function') {
                var engineBatches = window.CuttingDetailsEngine.getBatchIds();
                if (engineBatches && engineBatches.length > 0) {
                    incoming.batchIds = engineBatches;
                }
            }
            dropdownData = incoming;
            initAllDropdowns();
        } else {
            showToast('error', 'Load Error', (result && result.error) || 'Failed to load dropdown data.');
        }
    }

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(applyDropdownResult)
            .withFailureHandler(function (err) {
                hideSpinner();
                showToast('error', 'Load Error', err.message || 'Failed to load dropdown data.');
            })
            .getDropdownData();
        return;
    }

    jsonp({ action: 'getDropdownData' }, function (err, result) {
        if (err) {
            hideSpinner();
            showToast('error', 'Load Error', err.message);
            return;
        }
        applyDropdownResult(result);
    });
}

function initDropdownRefreshButton() {
    var btn = document.getElementById('btn-refresh-dropdowns');
    if (!btn) return;
    btn.addEventListener('click', function () {
        if (btn.classList.contains('is-refreshing')) return;
        btn.classList.add('is-refreshing');
        btn.disabled = true;

        var syncPromise = (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.syncAll === 'function')
            ? window.CuttingDetailsEngine.syncAll()
            : Promise.resolve(null);

        syncPromise.then(function () {
            if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.getDropdownData === 'function') {
                var dd = window.CuttingDetailsEngine.getDropdownData();
                if (dd) {
                    dropdownData = Object.assign({}, dropdownData, dd);
                    initAllDropdowns();
                }
            }
            btn.classList.remove('is-refreshing');
            btn.disabled = false;
            showToast('success', 'Dropdown Refreshed', 'Dropdown options updated successfully from Google Sheet.');
        }).catch(function (err) {
            btn.classList.remove('is-refreshing');
            btn.disabled = false;
            showToast('error', 'Sync Error', (err && err.message) || 'Could not refresh dropdown data.');
        });
    });
}

// ---------------------------------------------------------------------------
// Searchable Dropdown component
// ---------------------------------------------------------------------------
function mountDropdown(fieldId, options, placeholder) {
    var wrapper = document.querySelector('[data-dropdown="' + fieldId + '"]');
    if (!wrapper) return;

    // Already mounted (this is the server-data-arrived call, after the
    // click-handlers were already attached at page-load time below) â€” just
    // refresh the option list in place, don't re-bind listeners.
    if (wrapper._dd) { wrapper._dd.setOptions(options || []); return; }

    var trigger = wrapper.querySelector('.dropdown-trigger');
    var panel   = wrapper.querySelector('.dropdown-panel');
    var search  = wrapper.querySelector('.dropdown-search');
    var list    = wrapper.querySelector('.dropdown-list');
    var hidden  = document.getElementById('hidden-' + fieldId);
    var current = '';
    // Marks where the panel normally lives in the DOM, so it can be moved
    // back here (instead of onto document.body) when the dropdown closes.
    var panelAnchor = document.createComment('dropdown-panel-anchor-' + fieldId);
    panel.parentNode.insertBefore(panelAnchor, panel);
    options = options || [];

    // The panel is portalled onto document.body while open and positioned
    // with `position: fixed`, so it always renders on top of everything â€”
    // instead of being clipped by an ancestor card's `overflow: hidden`
    // (e.g. .page-card), which cut the list off partway down before.
    function positionPanel() {
    var rect = trigger.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = (rect.bottom + 4) + 'px';
    panel.style.left = rect.left + 'px';
    panel.style.width = rect.width + 'px';
    panel.style.margin = '0';
    }

    function reposition() {
    if (wrapper.classList.contains('open')) positionPanel();
    }
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);

    function render(filter) {
    list.innerHTML = '';
    var items = filter
        ? options.filter(function (o) { return o.toLowerCase().indexOf(filter.toLowerCase()) !== -1; })
        : options;
    if (!items.length) {
        var no = document.createElement('div');
        no.className = 'dropdown-option no-match';
        no.textContent = options.length ? 'No results found' : 'Loading optionsâ€¦';
        list.appendChild(no);
        return;
    }
    items.forEach(function (opt) {
        var d = document.createElement('div');
        d.className = 'dropdown-option' + (current === opt ? ' selected' : '');
        d.textContent = opt;
        d.addEventListener('click', function () {
        current = opt;
        trigger.textContent = opt;
        trigger.classList.remove('placeholder-active');
        if (hidden) { hidden.value = opt; hidden.dispatchEvent(new Event('change')); }
        close();
        clearError(fieldId);
        });
        list.appendChild(d);
    });
    }

    function open() {
    document.querySelectorAll('.dropdown-wrapper.open').forEach(function (w) {
        if (w !== wrapper && w._dd) w._dd.close();
    });
    wrapper.classList.add('open');
    document.body.appendChild(panel);
    panel.style.display = 'block';
    positionPanel();
    search.value = '';
    render('');
    search.focus();
    }

    function close() {
    wrapper.classList.remove('open');
    if (panel.parentNode === document.body) {
        panelAnchor.parentNode.insertBefore(panel, panelAnchor);
        panel.style.position = '';
        panel.style.top = '';
        panel.style.left = '';
        panel.style.width = '';
        panel.style.margin = '';
        panel.style.display = '';
    }
    }

    trigger.addEventListener('click', function (e) {
    e.stopPropagation();
    wrapper.classList.contains('open') ? close() : open();
    });

    search.addEventListener('input', function () { render(search.value); });
    search.addEventListener('click', function (e) { e.stopPropagation(); });

    wrapper._dd = {
    getValue: function () { return current; },
    close: close,
    setValue: function (val) {
        current = val || '';
        if (current) {
            trigger.textContent = current;
            trigger.classList.remove('placeholder-active');
        } else {
            trigger.textContent = placeholder;
            trigger.classList.add('placeholder-active');
        }
        if (hidden) {
            hidden.value = current;
            hidden.dispatchEvent(new Event('change'));
        }
        clearError(fieldId);
    },
    reset: function () {
        current = '';
        trigger.textContent = placeholder;
        trigger.classList.add('placeholder-active');
        if (hidden) hidden.value = '';
    },
    // Lets fetchDropdowns() hand over the real option list once it arrives
    // (possibly seconds after the click-handler was already attached),
    // without ever needing to re-bind the click/search listeners.
    setOptions: function (newOptions) {
        options = newOptions || [];
        if (wrapper.classList.contains('open')) render(search.value);
    }
    };
}

document.addEventListener('click', function () {
    document.querySelectorAll('.dropdown-wrapper.open').forEach(function (w) {
    if (w._dd) w._dd.close(); else w.classList.remove('open');
    });
});

function initAllDropdowns() {
    var cfg = {
    batchId:                   { src: dropdownData.batchIds,                   ph: 'Select Batch ID' },
    cuttingLeatherReceiveUnit: { src: dropdownData.cuttingLeatherReceiveUnits, ph: 'Select Receive Unit' },
    season:                    { src: dropdownData.seasons,                    ph: 'Select Season' },
    floorSupervisorName:       { src: dropdownData.floorSupervisorNames,       ph: 'Select Floor Supervisor Name' },
    inLineQCName:              { src: dropdownData.inLineQCNames,              ph: 'Select In-Line QC Name' }
    };
    Object.keys(cfg).forEach(function (id) {
    mountDropdown(id, cfg[id].src || [], cfg[id].ph);
    });
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------
function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function ddVal(id) { var w = document.querySelector('[data-dropdown="' + id + '"]'); return (w && w._dd) ? w._dd.getValue() : ''; }
function setDropdownVal(id, val) {
    var w = document.querySelector('[data-dropdown="' + id + '"]');
    if (w && w._dd && typeof w._dd.setValue === 'function') {
        w._dd.setValue(val);
    } else {
        var hidden = document.getElementById('hidden-' + id);
        if (hidden) {
            hidden.value = val || '';
            hidden.dispatchEvent(new Event('change'));
        }
        if (w) {
            var trg = w.querySelector('.dropdown-trigger');
            if (trg) {
                trg.textContent = val || 'Select';
                if (val) trg.classList.remove('placeholder-active');
            }
        }
    }
}
window.setDropdownVal = setDropdownVal;

function setError(fieldId, msg) {
    var f = document.querySelector('[data-field="' + fieldId + '"]');
    if (!f) return;
    f.classList.add('has-error');
    var e = f.querySelector('.error-msg');
    if (e) e.textContent = msg || 'This field is required.';
}

function clearError(fieldId) {
    var f = document.querySelector('[data-field="' + fieldId + '"]');
    if (f) f.classList.remove('has-error');
}

// ---------------------------------------------------------------------------
// Batch (Auto) â€” mirrors the selected Batch ID value
// ---------------------------------------------------------------------------
function updateBatchAuto() {
    var id  = document.getElementById('hidden-batchId');
    var out = document.getElementById('batchAuto');
    if (!out) return;
    var combined = (id && id.value) ? id.value : '';
    out.value = combined;
    if (combined) {
        validateAndLookup(combined);
    } else {
        clearCuttingMsg();
        enableFormFields();
        if (window.FmsBaiSuggestions && typeof window.FmsBaiSuggestions.reset === 'function') {
            window.FmsBaiSuggestions.reset();
        }
    }
}

function disableFormFields() {
    document.querySelectorAll('#fms-form-el .field-input').forEach(function (el) {
        if (el.id !== 'batchAuto') el.disabled = true;
    });
    document.querySelectorAll('#fms-form-el .dropdown-wrapper').forEach(function (w) {
        w.classList.add('dd-disabled');
    });
    var btn = document.getElementById('submit-btn');
    if (btn) btn.disabled = true;
}

function enableFormFields() {
    document.querySelectorAll('#fms-form-el .field-input').forEach(function (el) {
        el.disabled = false;
    });
    document.querySelectorAll('#fms-form-el .dropdown-wrapper').forEach(function (w) {
        w.classList.remove('dd-disabled');
    });
    var btn = document.getElementById('submit-btn');
    if (btn) btn.disabled = false;
}

function validateAndLookup(batchAuto) {
    var msgEl = document.getElementById('batch-auto-msg');

    if (window._fmsIsEditingReview && window._fmsEditingOriginalBatchId && String(window._fmsEditingOriginalBatchId).trim().toLowerCase() === String(batchAuto).trim().toLowerCase()) {
        enableFormFields();
        if (msgEl) {
            msgEl.className = 'batch-auto-msg batch-auto-msg--loaded';
            msgEl.textContent = 'Editing previous entry';
        }
        return;
    }

    // 1. ULTRA-FAST INSTANT PATH: Check CuttingDetailsEngine / IndexedDB cache in 0ms!
    if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.isBatchSubmitted === 'function') {
        var exists = window.CuttingDetailsEngine.isBatchSubmitted(batchAuto);
        if (exists) {
            disableFormFields();
            if (msgEl) {
                msgEl.className = 'batch-auto-msg batch-auto-msg--exists';
                msgEl.textContent = 'This Batch already exists. Please click the Reset button to submit a new entry.';
            }
            if (window.FmsBaiSuggestions && typeof window.FmsBaiSuggestions.onBatchExists === 'function') {
                window.FmsBaiSuggestions.onBatchExists(batchAuto);
            }
            return;
        } else {
            // Batch does NOT exist in submitted records -> immediately enable fields and lookup cutting details!
            enableFormFields();
            lookupCuttingDetails(batchAuto);
            return;
        }
    }

    // Fallback if engine is not available
    if (msgEl) {
        msgEl.className = 'batch-auto-msg batch-auto-msg--loading';
        msgEl.textContent = 'Checkingâ€¦';
    }

    function handleExists(result) {
        if (result && result.success && result.exists) {
            disableFormFields();
            if (msgEl) {
                msgEl.className = 'batch-auto-msg batch-auto-msg--exists';
                msgEl.textContent = 'This Batch already exists. Please click the Reset button to submit a new entry.';
            }
            if (window.FmsBaiSuggestions && typeof window.FmsBaiSuggestions.onBatchExists === 'function') {
                window.FmsBaiSuggestions.onBatchExists(batchAuto);
            }
        } else {
            enableFormFields();
            lookupCuttingDetails(batchAuto);
        }
    }

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(handleExists)
            .withFailureHandler(function () { clearCuttingMsg(); enableFormFields(); })
            .checkBatchExists(batchAuto);
        return;
    }

    jsonp({ action: 'checkBatchExists', batchAuto: batchAuto }, function (err, result) {
        if (err) { clearCuttingMsg(); enableFormFields(); return; }
        handleExists(result);
    });
}

function clearCuttingMsg() {
    currentCuttingQty = null;
    var msgEl = document.getElementById('batch-auto-msg');
    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'batch-auto-msg'; }
    clearAutofillWarning();
}

function showAutofillWarning() {
    var el = document.getElementById('autofill-warning');
    if (el) el.classList.add('visible');
}

function clearAutofillWarning() {
    var el = document.getElementById('autofill-warning');
    if (el) el.classList.remove('visible');
    ['brandName', 'category', 'styleNo', 'colour', 'poAsPerBuyer'].forEach(function (id) {
        var inp = document.getElementById(id);
        if (inp) inp.classList.remove('autofilled');
    });
}

function autoFillField(id, value) {
    var inp = document.getElementById(id);
    if (!inp) return;
    var v = String(value || '').trim();
    if (v) {
        inp.value = v;
        inp.classList.add('autofilled');
        clearError(id);
    }
}

function lookupCuttingDetails(batchAuto) {
    var msgEl = document.getElementById('batch-auto-msg');
    if (!msgEl) return;

    function applyFoundRecord(record) {
        currentCuttingQty = record.quantity;
        msgEl.className = 'batch-auto-msg batch-auto-msg--found';
        msgEl.textContent = 'The cutting quantity for this batch is ' + record.quantity + '.';
        // Auto-fill fields from cutting details
        autoFillField('brandName',    record.brandName);
        autoFillField('category',     record.category);
        autoFillField('styleNo',      record.styleNo);
        autoFillField('colour',       record.colour);
        autoFillField('poAsPerBuyer', record.poAsPerBuyer);
        showAutofillWarning();
        // Re-validate quantity field live if already filled
        var qInput = document.getElementById('quantity');
        if (qInput && qInput.value) validateQuantityVsCutting(qInput.value);

        if (window.FmsBaiSuggestions && typeof window.FmsBaiSuggestions.onRecordFound === 'function') {
            window.FmsBaiSuggestions.onRecordFound(record, batchAuto);
        }
    }

    // 1. ULTRA-FAST SYNCHRONOUS PATH (0ms! No "Searchingâ€¦" or waiting!)
    if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.lookupBatchSync === 'function') {
        var syncRec = window.CuttingDetailsEngine.lookupBatchSync(batchAuto);
        if (syncRec) {
            applyFoundRecord(syncRec);
            return;
        }
    }

    // 2. Async check in IndexedDB
    if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.lookupBatch === 'function') {
        window.CuttingDetailsEngine.lookupBatch(batchAuto).then(function (record) {
            if (record) {
                applyFoundRecord(record);
                return;
            }
            fetchRemoteCuttingDetails();
        }).catch(function () {
            fetchRemoteCuttingDetails();
        });
        return;
    }

    fetchRemoteCuttingDetails();

    function fetchRemoteCuttingDetails() {
        msgEl.className = 'batch-auto-msg batch-auto-msg--loading';
        msgEl.textContent = 'Searchingâ€¦';

        function handleResult(result) {
            if (!msgEl) return;
            if (result && result.success && result.found) {
                applyFoundRecord(result);
            } else if (result && result.success && !result.found) {
                currentCuttingQty = null;
                clearAutofillWarning();
                msgEl.className = 'batch-auto-msg batch-auto-msg--not-found';
                msgEl.textContent = 'No matching record found in Cutting Details.';
                if (window.FmsBaiSuggestions && typeof window.FmsBaiSuggestions.onRecordNotFound === 'function') {
                    window.FmsBaiSuggestions.onRecordNotFound(batchAuto);
                }
            } else {
                currentCuttingQty = null;
                clearCuttingMsg();
            }
        }

        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(handleResult)
                .withFailureHandler(function () { clearCuttingMsg(); })
                .getCuttingDetails(batchAuto);
            return;
        }

        jsonp({ action: 'getCuttingDetails', batchAuto: batchAuto }, function (err, result) {
            if (err) { clearCuttingMsg(); return; }
            handleResult(result);
        });
    }
}

function initBatchAuto() {
    var hiddenBatchId = document.getElementById('hidden-batchId');
    if (hiddenBatchId) hiddenBatchId.addEventListener('change', updateBatchAuto);
}

function validateQuantityVsCutting(val) {
    if (currentCuttingQty === null) { clearError('quantity'); return; }
    var entered  = parseInt(String(val).trim(), 10);
    var expected = parseInt(String(currentCuttingQty).trim(), 10);
    if (!isNaN(entered) && !isNaN(expected) && entered <= expected) {
        clearError('quantity');
    } else if (!isNaN(entered)) {
        setError('quantity', 'Quantity must be equal to or less than the cutting quantity of ' + currentCuttingQty + '.');
    }
}

function initQuantity() {
    var input = document.getElementById('quantity');
    if (!input) return;
    input.addEventListener('input', function () {
    input.value = input.value.replace(/[^0-9]/g, '');
    if (!input.value) { clearError('quantity'); return; }
    validateQuantityVsCutting(input.value);
    });
}

// ---------------------------------------------------------------------------
// Production Days â€” numeric-only, optional field
// ---------------------------------------------------------------------------
function initProductionDays() {
    var input = document.getElementById('productionDays');
    if (!input) return;
    input.addEventListener('input', function () {
    input.value = input.value.replace(/[^0-9]/g, '');
    });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validate() {
    var ok = true;

    ['batchId', 'cuttingLeatherReceiveUnit',
    'season',
    'floorSupervisorName', 'inLineQCName'].forEach(function (id) {
    if (!ddVal(id)) { setError(id, 'This field is required.'); ok = false; }
    else clearError(id);
    });

    ['leatherReceivedDate', 'fabricatorName', 'brandName', 'category',
    'sku', 'styleNo', 'colour', 'quantity', 'etd', 'poAsPerBuyer'].forEach(function (id) {
    if (!val(id)) { setError(id, 'This field is required.'); ok = false; }
    else clearError(id);
    });

    // Cutting-quantity match check (quantity must be <= cutting quantity)
    if (currentCuttingQty !== null) {
    var enteredQty  = parseInt(String(val('quantity')).trim(), 10);
    var expectedQty = parseInt(String(currentCuttingQty).trim(), 10);
    if (val('quantity') && (isNaN(enteredQty) || isNaN(expectedQty) || enteredQty > expectedQty)) {
        setError('quantity', 'Quantity must be equal to or less than the cutting quantity of ' + currentCuttingQty + '.');
        ok = false;
    }
    }

    return ok;
}

// ---------------------------------------------------------------------------
// Date format helper â€” converts YYYY-MM-DD â†’ DD/MM/YYYY
// ---------------------------------------------------------------------------
function toDisplayDate(isoStr) {
    if (!isoStr) return '';
    var parts = String(isoStr).trim().split('-');
    if (parts.length !== 3) return isoStr;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
}

// ---------------------------------------------------------------------------
// FMS FAST ENGINE: 0.05s Instant Optimistic Submission & Outbox Queue
// ---------------------------------------------------------------------------
var FMS_FAST_DB_NAME = 'fms_fast_outbox_db';
var FMS_FAST_DB_VERSION = 1;
var FMS_IDB_STORE_QUEUE = 'fms_queue';
var FMS_IDB_STORE_USER_LAST = 'fms_user_last';
var FMS_REVIEW_EXPIRY_MS = 15 * 60 * 1000;
var FMS_QUEUE_LS_KEY = 'fms_submission_queue_ls';
var FMS_USER_LAST_LS_PREFIX = 'fms_user_last_submission_';

function openFmsFastIdb() {
    return new Promise(function (resolve, reject) {
        if (typeof indexedDB === 'undefined') {
            return reject(new Error('IndexedDB not supported'));
        }
        var req = indexedDB.open(FMS_FAST_DB_NAME, FMS_FAST_DB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(FMS_IDB_STORE_QUEUE)) {
                db.createObjectStore(FMS_IDB_STORE_QUEUE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(FMS_IDB_STORE_USER_LAST)) {
                db.createObjectStore(FMS_IDB_STORE_USER_LAST, { keyPath: 'key' });
            }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
    });
}

function enqueueFmsSubmission(item) {
    if (!item || !item.id) return;
    try {
        var queue = JSON.parse(localStorage.getItem(FMS_QUEUE_LS_KEY) || '[]');
        queue.push(item);
        localStorage.setItem(FMS_QUEUE_LS_KEY, JSON.stringify(queue));
    } catch (e) {}

    openFmsFastIdb().then(function (db) {
        var tx = db.transaction(FMS_IDB_STORE_QUEUE, 'readwrite');
        tx.objectStore(FMS_IDB_STORE_QUEUE).put(item);
    }).catch(function (err) {
        console.warn('[FmsFastSync] Enqueue IDB warning:', err);
    });
}

function getPendingFmsFromLs() {
    try {
        var queue = JSON.parse(localStorage.getItem(FMS_QUEUE_LS_KEY) || '[]');
        var valid = [];
        var dirty = false;
        queue.forEach(function (it) {
            if (it && it.action === 'updateFormData') {
                dirty = true; // Auto-purge obsolete update items
            } else if (it && (it.status === 'pending' || it.status === 'failed')) {
                valid.push(it);
            }
        });
        if (dirty) {
            localStorage.setItem(FMS_QUEUE_LS_KEY, JSON.stringify(valid));
        }
        return valid;
    } catch (e) {
        return [];
    }
}

function getPendingFmsSubmissions() {
    return openFmsFastIdb().then(function (db) {
        return new Promise(function (resolve) {
            try {
                var tx = db.transaction(FMS_IDB_STORE_QUEUE, 'readwrite');
                var store = tx.objectStore(FMS_IDB_STORE_QUEUE);
                var req = store.getAll();
                req.onsuccess = function () {
                    var items = [];
                    (req.result || []).forEach(function (it) {
                        if (it && it.action === 'updateFormData') {
                            // Purge obsolete update item from IDB
                            try { store.delete(it.id); } catch(e){}
                        } else if (it && (it.status === 'pending' || it.status === 'failed')) {
                            items.push(it);
                        }
                    });
                    if (items.length > 0) {
                        resolve(items);
                    } else {
                        resolve(getPendingFmsFromLs());
                    }
                };
                req.onerror = function () {
                    resolve(getPendingFmsFromLs());
                };
            } catch (err) {
                resolve(getPendingFmsFromLs());
            }
        });
    }).catch(function () {
        return getPendingFmsFromLs();
    });
}

function markFmsSubmissionSynced(id) {
    try {
        var queue = JSON.parse(localStorage.getItem(FMS_QUEUE_LS_KEY) || '[]');
        queue = queue.filter(function (it) { return it.id !== id; });
        localStorage.setItem(FMS_QUEUE_LS_KEY, JSON.stringify(queue));
    } catch (e) {}

    return openFmsFastIdb().then(function (db) {
        var tx = db.transaction(FMS_IDB_STORE_QUEUE, 'readwrite');
        tx.objectStore(FMS_IDB_STORE_QUEUE).delete(id);
    }).catch(function () {});
}

function markFmsSubmissionFailed(id, errMsg) {
    try {
        var queue = JSON.parse(localStorage.getItem(FMS_QUEUE_LS_KEY) || '[]');
        queue.forEach(function (it) {
            if (it.id === id) {
                it.status = 'failed';
                it.error = errMsg;
            }
        });
        localStorage.setItem(FMS_QUEUE_LS_KEY, JSON.stringify(queue));
    } catch (e) {}

    return openFmsFastIdb().then(function (db) {
        var tx = db.transaction(FMS_IDB_STORE_QUEUE, 'readwrite');
        var store = tx.objectStore(FMS_IDB_STORE_QUEUE);
        var req = store.get(id);
        req.onsuccess = function () {
            var it = req.result;
            if (it) {
                it.status = 'failed';
                it.error = errMsg;
                store.put(it);
            }
        };
    }).catch(function () {});
}

function postFmsSyncItem(item) {
    return new Promise(function (resolve, reject) {
        if (item.action === 'updateFormData') {
            // Obsolete action auto-dismissed so it never blocks or fails
            return resolve({ success: true, bypassed: true });
        }

        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(function (res) {
                    if (res && res.success === false) reject(new Error(res.error || 'Submit failed'));
                    else resolve(res);
                })
                .withFailureHandler(reject)
                .submitFormData(item.formData);
            return;
        }

        var params = {
            action: 'submitFormData',
            formData: JSON.stringify(item.formData)
        };

        jsonp(params, function (err, result) {
            if (err) return reject(err);
            if (result && result.success === false) {
                return reject(new Error(result.error || 'Operation failed'));
            }
            resolve(result);
        });
    });
}

var isSyncingFmsQueue = false;

function processFmsSyncQueue() {
    if (isSyncingFmsQueue) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    isSyncingFmsQueue = true;

    getPendingFmsSubmissions().then(function (items) {
        if (!items || items.length === 0) {
            isSyncingFmsQueue = false;
            return;
        }

        var chain = Promise.resolve();
        items.forEach(function (item) {
            chain = chain.then(function () {
                if (item.action === 'updateFormData') {
                    markFmsSubmissionSynced(item.id);
                    return Promise.resolve();
                }
                return postFmsSyncItem(item)
                    .then(function () {
                        markFmsSubmissionSynced(item.id);
                        console.log('[FmsFastSync] Batch #' + item.batchId + ' synced to Google Sheets in background.');
                        if (typeof fetchFromGoogleSheetGviz === 'function') {
                            setTimeout(function () { fetchFromGoogleSheetGviz(true); }, 1200);
                        }
                    })
                    .catch(function (err) {
                        var errMsg = (err && err.message) || String(err);
                        console.warn('[FmsFastSync] Retrying Batch #' + item.batchId + ' later:', errMsg);
                    });
            });
        });

        return chain.then(function () {
            isSyncingFmsQueue = false;
        });
    }).catch(function () {
        isSyncingFmsQueue = false;
    });
}

function getFmsUserKey(user) {
    var raw = (user || getSession() || 'default_user').toString().trim().toLowerCase();
    return raw.replace(/[^a-z0-9_-]/g, '_') || 'default_user';
}

function saveUserLastFmsSubmission(data) {
    if (!data) return Promise.resolve();
    var currentUser = (getSession() || 'User').trim();
    var uKey = getFmsUserKey(currentUser);
    var recordKey = uKey + '_fms';
    var record = {
        key: recordKey,
        user: currentUser,
        userKey: uKey,
        timestamp: Date.now(),
        submittedAt: new Date().toISOString(),
        data: Object.assign({}, data)
    };

    try {
        localStorage.setItem(FMS_USER_LAST_LS_PREFIX + recordKey, JSON.stringify(record));
    } catch (e) {}

    return openFmsFastIdb().then(function (db) {
        return new Promise(function (resolve) {
            try {
                var tx = db.transaction(FMS_IDB_STORE_USER_LAST, 'readwrite');
                var store = tx.objectStore(FMS_IDB_STORE_USER_LAST);
                store.put(record);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { resolve(false); };
            } catch (err) {
                resolve(false);
            }
        });
    }).catch(function (err) {
        console.warn('[FmsReview] IDB save warning:', err);
    });
}

function applyLocalFmsRowUpdate(originalBatchId, updatedData) {
    var target = String(originalBatchId || (updatedData && updatedData.batchId) || '').trim().toLowerCase();
    if (!target || !updatedData) return;

    // 1. Update in modern SubmittedFmsSheetEngine if available
    if (window.SubmittedFmsSheetEngine && typeof window.SubmittedFmsSheetEngine.updateRow === 'function') {
        try {
            window.SubmittedFmsSheetEngine.updateRow(originalBatchId, updatedData);
        } catch (e) {
            console.warn('[FmsFastEngine] SubmittedFmsSheetEngine update warning:', e);
        }
    }

    // 2. Update in fmsTableData (legacy in-memory table)
    if (typeof fmsTableData !== 'undefined' && Array.isArray(fmsTableData.allRows)) {
        var foundIdx = -1;
        for (var i = 0; i < fmsTableData.allRows.length; i++) {
            var r = fmsTableData.allRows[i];
            if (r && String(r[0]).trim().toLowerCase() === target) {
                foundIdx = i;
                break;
            }
        }

        var createdAt = (foundIdx !== -1 && fmsTableData.allRows[foundIdx][1]) ? fmsTableData.allRows[foundIdx][1] : new Date().toLocaleString('en-GB');
        var createdBy = (updatedData.submittedBy || '').trim() || ((foundIdx !== -1 && fmsTableData.allRows[foundIdx][2]) ? fmsTableData.allRows[foundIdx][2] : 'User');

        var newRow = [
            updatedData.batchId || '',
            createdAt,
            createdBy,
            updatedData.leatherReceivedDate || '',
            updatedData.cuttingLeatherReceiveUnit || '',
            updatedData.fabricatorName || '',
            updatedData.brandName || '',
            updatedData.season || '',
            updatedData.category || '',
            updatedData.sku || '',
            updatedData.styleNo || '',
            updatedData.colour || '',
            updatedData.quantity || '',
            updatedData.etd || '',
            updatedData.poAsPerBuyer || '',
            updatedData.floorSupervisorName || '',
            updatedData.inLineQCName || '',
            updatedData.productionDays || ''
        ];

        if (foundIdx !== -1) {
            fmsTableData.allRows[foundIdx] = newRow;
            // Purge duplicate rows for this batch ID
            fmsTableData.allRows = fmsTableData.allRows.filter(function (row, idx) {
                return idx === foundIdx || !row || String(row[0]).trim().toLowerCase() !== target;
            });
        } else {
            fmsTableData.allRows.unshift(newRow);
        }

        fmsTableData.filteredRows = fmsTableData.allRows.slice();

        if (typeof saveSubmittedFmsToDb === 'function') {
            saveSubmittedFmsToDb(fmsTableData.headers, fmsTableData.allRows, new Date().toISOString()).catch(function () {});
        }
        if (typeof renderFmsTable === 'function') {
            try { renderFmsTable(); } catch (e) {}
        }
    }
}

function toFmsInputDate(val) {
    if (!val) return '';
    var str = String(val).trim();
    var dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
        var day = (dmy[1].length < 2 ? '0' : '') + dmy[1];
        var mon = (dmy[2].length < 2 ? '0' : '') + dmy[2];
        var yr = dmy[3];
        return yr + '-' + mon + '-' + day;
    }
    var ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymd) {
        var yr2 = ymd[1];
        var mon2 = (ymd[2].length < 2 ? '0' : '') + ymd[2];
        var day2 = (ymd[3].length < 2 ? '0' : '') + ymd[3];
        return yr2 + '-' + mon2 + '-' + day2;
    }
    return str;
}

function parseFmsSheetTimestamp(tsStr) {
    if (!tsStr) return Date.now();
    var parts = String(tsStr).trim().split(' ');
    if (parts.length >= 1) {
        var dParts = parts[0].split('/');
        if (dParts.length === 3) {
            var day = parseInt(dParts[0], 10);
            var month = parseInt(dParts[1], 10) - 1;
            var year = parseInt(dParts[2], 10);
            var hours = 0, mins = 0, secs = 0;
            if (parts[1]) {
                var tParts = parts[1].split(':');
                hours = parseInt(tParts[0] || 0, 10);
                mins = parseInt(tParts[1] || 0, 10);
                secs = parseInt(tParts[2] || 0, 10);
            }
            var d = new Date(year, month, day, hours, mins, secs);
            if (!isNaN(d.getTime())) return d.getTime();
        }
    }
    var d2 = new Date(tsStr);
    return isNaN(d2.getTime()) ? Date.now() : d2.getTime();
}

function findLastUserFmsRecord(headers, rows, currentUser) {
    if (!rows || !rows.length) return null;

    currentUser = (currentUser || getSession() || 'User').trim();
    var normUser = currentUser.toLowerCase();

    function colIdx(keywords, fallback) {
        if (!headers || !headers.length) return fallback;
        for (var i = 0; i < headers.length; i++) {
            var h = String(headers[i] || '').trim().toLowerCase();
            for (var k = 0; k < keywords.length; k++) {
                if (h.indexOf(keywords[k].toLowerCase()) !== -1) return i;
            }
        }
        return fallback;
    }

    var batchIdx       = colIdx(['batch id', 'batch'], 0);
    var createdIdx     = colIdx(['created at', 'timestamp', 'time'], 1);
    var userIdx        = colIdx(['created by', 'user', 'submitted by'], 2);
    var leatherDateIdx = colIdx(['leather received date', 'leather date', 'leather'], 3);
    var unitIdx        = colIdx(['receive unit', 'unit'], 4);
    var fabIdx         = colIdx(['fabricator name', 'fabricator'], 5);
    var brandIdx       = colIdx(['brand name', 'brand'], 6);
    var seasonIdx      = colIdx(['season'], 7);
    var catIdx         = colIdx(['category'], 8);
    var skuIdx         = colIdx(['sku'], 9);
    var styleIdx       = colIdx(['style no', 'style'], 10);
    var colrIdx        = colIdx(['colour', 'color'], 11);
    var qtyIdx         = colIdx(['quantity', 'qty'], 12);
    var etdIdx         = colIdx(['etd'], 13);
    var poIdx          = colIdx(['po as per buyer', 'buyer', 'po'], 14);
    var supIdx         = colIdx(['floor supervisor', 'supervisor'], 15);
    var qcIdx          = colIdx(['in-line qc', 'qc'], 16);
    var prodIdx        = colIdx(['production days', 'prod days', 'days'], 17);

    var matchedRow = null;
    if (normUser && normUser !== 'user') {
        for (var i = rows.length - 1; i >= 0; i--) {
            var r = rows[i];
            if (!r) continue;
            var u1 = String(r[userIdx] || '').trim().toLowerCase();
            var u2 = String(r[1] || '').trim().toLowerCase();
            var u3 = String(r[2] || '').trim().toLowerCase();
            if (u1 === normUser || u2 === normUser || u3 === normUser) {
                matchedRow = r;
                break;
            }
        }
    }

    if (!matchedRow && rows.length > 0) {
        matchedRow = rows[rows.length - 1];
    }

    if (!matchedRow) return null;

    var rawCreatedAt = matchedRow[createdIdx] || matchedRow[1] || '';
    var ts = parseFmsSheetTimestamp(rawCreatedAt);
    var uKey = getFmsUserKey(currentUser);
    var recordKey = uKey + '_fms';

    return {
        key: recordKey,
        user: matchedRow[userIdx] || currentUser,
        userKey: uKey,
        timestamp: ts,
        submittedAt: rawCreatedAt,
        source: 'sheet',
        data: {
            batchId:                   matchedRow[batchIdx] !== undefined ? String(matchedRow[batchIdx]).trim() : '',
            leatherReceivedDate:       matchedRow[leatherDateIdx] !== undefined ? String(matchedRow[leatherDateIdx]).trim() : '',
            cuttingLeatherReceiveUnit: matchedRow[unitIdx] !== undefined ? String(matchedRow[unitIdx]).trim() : '',
            fabricatorName:            matchedRow[fabIdx] !== undefined ? String(matchedRow[fabIdx]).trim() : '',
            brandName:                 matchedRow[brandIdx] !== undefined ? String(matchedRow[brandIdx]).trim() : '',
            season:                    matchedRow[seasonIdx] !== undefined ? String(matchedRow[seasonIdx]).trim() : '',
            category:                  matchedRow[catIdx] !== undefined ? String(matchedRow[catIdx]).trim() : '',
            sku:                       matchedRow[skuIdx] !== undefined ? String(matchedRow[skuIdx]).trim() : '',
            styleNo:                   matchedRow[styleIdx] !== undefined ? String(matchedRow[styleIdx]).trim() : '',
            colour:                    matchedRow[colrIdx] !== undefined ? String(matchedRow[colrIdx]).trim() : '',
            quantity:                  matchedRow[qtyIdx] !== undefined ? String(matchedRow[qtyIdx]).trim() : '',
            etd:                       matchedRow[etdIdx] !== undefined ? String(matchedRow[etdIdx]).trim() : '',
            poAsPerBuyer:              matchedRow[poIdx] !== undefined ? String(matchedRow[poIdx]).trim() : '',
            floorSupervisorName:       matchedRow[supIdx] !== undefined ? String(matchedRow[supIdx]).trim() : '',
            inLineQCName:              matchedRow[qcIdx] !== undefined ? String(matchedRow[qcIdx]).trim() : '',
            productionDays:            matchedRow[prodIdx] !== undefined ? String(matchedRow[prodIdx]).trim() : '',
            submittedBy:               matchedRow[userIdx] || currentUser
        }
    };
}

function getUserLastFmsSubmission() {
    var currentUser = (getSession() || 'User').trim();
    var uKey = getFmsUserKey(currentUser);
    var recordKey = uKey + '_fms';

    var localRecord = null;
    try {
        var raw = localStorage.getItem(FMS_USER_LAST_LS_PREFIX + recordKey);
        if (raw) localRecord = JSON.parse(raw);
    } catch (e) {}

    return openFmsFastIdb().then(function (db) {
        return new Promise(function (resolve) {
            try {
                var tx = db.transaction(FMS_IDB_STORE_USER_LAST, 'readonly');
                var store = tx.objectStore(FMS_IDB_STORE_USER_LAST);
                var req = store.get(recordKey);
                req.onsuccess = function () {
                    resolve(req.result || localRecord || null);
                };
                req.onerror = function () {
                    resolve(localRecord || null);
                };
            } catch (err) {
                resolve(localRecord || null);
            }
        });
    }).catch(function () {
        return localRecord || null;
    }).then(function (cachedRec) {
        if (cachedRec && cachedRec.data && cachedRec.data.batchId && (Date.now() - cachedRec.timestamp <= FMS_REVIEW_EXPIRY_MS)) {
            return cachedRec;
        }

        // Check memory table rows
        if (typeof fmsTableData !== 'undefined' && Array.isArray(fmsTableData.allRows) && fmsTableData.allRows.length > 0) {
            var extracted = findLastUserFmsRecord(fmsTableData.headers, fmsTableData.allRows, currentUser);
            if (extracted && extracted.data && extracted.data.batchId) {
                saveUserLastFmsSubmission(extracted.data);
                return extracted;
            }
        }

        // Check IndexedDB submitted_fms store
        if (typeof loadSubmittedFmsFromDb === 'function') {
            return loadSubmittedFmsFromDb().then(function (dbCache) {
                if (dbCache && Array.isArray(dbCache.rows) && dbCache.rows.length > 0) {
                    var dbExtracted = findLastUserFmsRecord(dbCache.headers, dbCache.rows, currentUser);
                    if (dbExtracted && dbExtracted.data && dbExtracted.data.batchId) {
                        saveUserLastFmsSubmission(dbExtracted.data);
                        return dbExtracted;
                    }
                }
                return cachedRec || null;
            }).catch(function () {
                return cachedRec || null;
            });
        }

        return cachedRec || null;
    });
}

// ---------------------------------------------------------------------------
// Pre-Submit Summary Review Modal Controller
// ---------------------------------------------------------------------------
var activeFmsSummaryData = null;

function openFmsSummaryModal(formData) {
    if (!formData) return;
    activeFmsSummaryData = formData;

    var batchEl = document.getElementById('fms-sum-batch-id');
    var qtyEl   = document.getElementById('fms-sum-quantity');
    if (batchEl) batchEl.textContent = formData.batchId || '-';
    if (qtyEl) {
        var numQty = Number(formData.quantity);
        qtyEl.textContent = !isNaN(numQty) && numQty > 0 ? numQty.toLocaleString() : (formData.quantity || '0');
    }

    var mappings = [
        { id: 'fms-sum-brand',        val: formData.brandName },
        { id: 'fms-sum-category',     val: formData.category },
        { id: 'fms-sum-style',        val: formData.styleNo },
        { id: 'fms-sum-colour',       val: formData.colour },
        { id: 'fms-sum-po-buyer',     val: formData.poAsPerBuyer },
        { id: 'fms-sum-etd',          val: formData.etd },
        { id: 'fms-sum-leather-date', val: formData.leatherReceivedDate },
        { id: 'fms-sum-unit',         val: formData.cuttingLeatherReceiveUnit },
        { id: 'fms-sum-fabricator',   val: formData.fabricatorName },
        { id: 'fms-sum-season',       val: formData.season },
        { id: 'fms-sum-sku',          val: formData.sku },
        { id: 'fms-sum-prod-days',    val: formData.productionDays ? (formData.productionDays + ' Days') : '-' },
        { id: 'fms-sum-supervisor',   val: formData.floorSupervisorName },
        { id: 'fms-sum-qc',           val: formData.inLineQCName }
    ];

    mappings.forEach(function (m) {
        var el = document.getElementById(m.id);
        if (el) {
            el.textContent = (m.val !== undefined && m.val !== null && String(m.val).trim()) ? String(m.val).trim() : '-';
        }
    });

    var modal = document.getElementById('fms-summary-modal');
    if (modal) {
        modal.classList.add('active');
        modal.setAttribute('data-visible', 'true');
        modal.style.setProperty('display', 'flex', 'important');
    }
}

function closeFmsSummaryModal() {
    var modal = document.getElementById('fms-summary-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('data-visible', 'false');
        modal.style.setProperty('display', 'none', 'important');
    }
}

function handleFmsFinalSubmit() {
    if (!activeFmsSummaryData) {
        closeFmsSummaryModal();
        return;
    }

    var formData = Object.assign({}, activeFmsSummaryData);
    var finalBtn = document.getElementById('fms-summary-btn-final-submit');
    var origHtml = finalBtn ? finalBtn.innerHTML : '';

    if (finalBtn) {
        finalBtn.disabled = true;
        finalBtn.innerHTML = '<span class="material-icons-round" style="font-size:18px;">autorenew</span> Submitting...';
    }

    // 0.05s INSTANT OPTIMISTIC SUBMIT
    var queueItem = {
        id: 'fms_sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        action: 'submitFormData',
        formData: formData,
        batchId: formData.batchId,
        status: 'pending',
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
        retryCount: 0
    };

    // Save to outbox queue and save user's last submission cache
    enqueueFmsSubmission(queueItem);
    saveUserLastFmsSubmission(formData);

    // Optimistically update memory table immediately
    if (typeof fmsTableData !== 'undefined' && Array.isArray(fmsTableData.allRows)) {
        var newRow = [
            formData.batchId || '',
            new Date().toLocaleString('en-GB'),
            formData.submittedBy || 'User',
            formData.leatherReceivedDate || '',
            formData.cuttingLeatherReceiveUnit || '',
            formData.fabricatorName || '',
            formData.brandName || '',
            formData.season || '',
            formData.category || '',
            formData.sku || '',
            formData.styleNo || '',
            formData.colour || '',
            formData.quantity || '',
            formData.etd || '',
            formData.poAsPerBuyer || '',
            formData.floorSupervisorName || '',
            formData.inLineQCName || '',
            formData.productionDays || ''
        ];
        fmsTableData.allRows.unshift(newRow);
        fmsTableData.filteredRows = fmsTableData.allRows.slice();
        if (typeof renderFmsTable === 'function') {
            try { renderFmsTable(); } catch (e) {}
        }
    }

    // Optimistically update SubmittedFmsSheetEngine
    if (window.SubmittedFmsSheetEngine && typeof window.SubmittedFmsSheetEngine.addRow === 'function') {
        try {
            window.SubmittedFmsSheetEngine.addRow(formData);
        } catch (e) {}
    }

    // Mark batch submitted in CuttingDetailsEngine
    if (formData.batchId && window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.markBatchSubmitted === 'function') {
        window.CuttingDetailsEngine.markBatchSubmitted(formData.batchId);
    }

    // Reset the main form
    resetForm();

    // Visual button feedback
    if (finalBtn) {
        finalBtn.innerHTML = '<span class="material-icons-round" style="font-size:18px;">check_circle</span> Submitted!';
        finalBtn.style.backgroundColor = '#059669';
    }

    setTimeout(function () {
        closeFmsSummaryModal();
        if (finalBtn) {
            finalBtn.disabled = false;
            finalBtn.innerHTML = origHtml;
            finalBtn.style.backgroundColor = '';
        }
    }, 200);

    // Main form button tactile feedback
    var mainBtn = document.getElementById('submit-btn');
    if (mainBtn) {
        var mainOrigHtml = mainBtn.innerHTML;
        mainBtn.disabled = false;
        mainBtn.innerHTML = '<span class="material-icons-round" style="font-size:16px;">check_circle</span> Submitted!';
        mainBtn.style.backgroundColor = '#059669';
        setTimeout(function () {
            mainBtn.innerHTML = mainOrigHtml;
            mainBtn.style.backgroundColor = '';
        }, 1200);
    }

    // Instant confirmation toast
    showToast('success', 'Submitted Instantly!', 'Batch #' + formData.batchId + ' submitted in 0.05s & syncing in background.');

    // Trigger silent background sync
    setTimeout(processFmsSyncQueue, 40);

    // Refresh background tables after 2s
    setTimeout(function () {
        if (typeof fetchFromGoogleSheetGviz === 'function') {
            fetchFromGoogleSheetGviz(true);
        }
    }, 2000);
}

function initFmsSummaryModal() {
    var btnClose = document.getElementById('fms-summary-close-btn');
    if (btnClose && !btnClose._fmsBound) {
        btnClose._fmsBound = true;
        btnClose.addEventListener('click', closeFmsSummaryModal);
    }

    var btnModify = document.getElementById('fms-summary-btn-modify');
    if (btnModify && !btnModify._fmsBound) {
        btnModify._fmsBound = true;
        btnModify.addEventListener('click', closeFmsSummaryModal);
    }

    var backdrop = document.getElementById('fms-summary-backdrop');
    if (backdrop && !backdrop._fmsBound) {
        backdrop._fmsBound = true;
        backdrop.addEventListener('click', closeFmsSummaryModal);
    }

    var btnFinalSubmit = document.getElementById('fms-summary-btn-final-submit');
    if (btnFinalSubmit && !btnFinalSubmit._fmsBound) {
        btnFinalSubmit._fmsBound = true;
        btnFinalSubmit.addEventListener('click', handleFmsFinalSubmit);
    }

    if (!window._fmsSummaryKeyBound) {
        window._fmsSummaryKeyBound = true;
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var modal = document.getElementById('fms-summary-modal');
                if (modal && (modal.classList.contains('active') || modal.getAttribute('data-visible') === 'true' || modal.style.display !== 'none')) {
                    closeFmsSummaryModal();
                }
            }
        });

        window.addEventListener('online', function () {
            console.log('[FmsFastSync] Online detected — syncing queue...');
            processFmsSyncQueue();
        });
        setInterval(processFmsSyncQueue, 25000);
        setTimeout(processFmsSyncQueue, 800);
    }
}
window.initFmsReviewModal = initFmsSummaryModal;

window.FmsFastEngine = {
    enqueue: enqueueFmsSubmission,
    processSyncQueue: processFmsSyncQueue,
    saveUserLast: saveUserLastFmsSubmission,
    getUserLast: getUserLastFmsSubmission,
    openSummaryModal: openFmsSummaryModal,
    closeSummaryModal: closeFmsSummaryModal,
    finalSubmit: handleFmsFinalSubmit,
    init: initFmsSummaryModal,
    getTableData: function () { return fmsTableData; }
};

// ---------------------------------------------------------------------------
// Main Form Submission -> Opens Pre-Submit Summary Review Modal
// ---------------------------------------------------------------------------
function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) {
        showToast('error', 'Validation Error', 'Please fill in all required fields.');
        var first = document.querySelector('.form-field.has-error');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    var submittedBatch = ddVal('batchId') || val('batchAuto');

    var formData = {
        batchId:                   submittedBatch,
        leatherReceivedDate:       toDisplayDate(val('leatherReceivedDate')),
        cuttingLeatherReceiveUnit: ddVal('cuttingLeatherReceiveUnit'),
        fabricatorName:            val('fabricatorName'),
        brandName:                 val('brandName'),
        season:                    ddVal('season'),
        category:                  val('category'),
        sku:                       val('sku'),
        styleNo:                   val('styleNo'),
        colour:                    val('colour'),
        quantity:                  val('quantity'),
        etd:                       toDisplayDate(val('etd')),
        poAsPerBuyer:              val('poAsPerBuyer'),
        floorSupervisorName:       ddVal('floorSupervisorName'),
        inLineQCName:              ddVal('inLineQCName'),
        productionDays:            val('productionDays'),
        submittedBy:               getSession() || ''
    };

    // Open Pre-Submit Summary Modal for user review
    openFmsSummaryModal(formData);
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
function resetForm() {
    window._fmsIsEditingReview = false;
    window._fmsEditingOriginalBatchId = null;
    var submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
        submitBtn.innerHTML = '<span class="material-icons-round" style="font-size:16px;">check_circle</span> Submit';
        submitBtn.style.backgroundColor = '';
    }
    document.getElementById('fms-form-el').reset();
    document.querySelectorAll('[data-dropdown]').forEach(function (w) { if (w._dd) w._dd.reset(); });
    document.querySelectorAll('.form-field.has-error').forEach(function (f) { f.classList.remove('has-error'); });
    var ba = document.getElementById('batchAuto'); if (ba) ba.value = '';
    clearCuttingMsg();
    clearAutofillWarning();
    enableFormFields();
    if (window.FmsBaiSuggestions && typeof window.FmsBaiSuggestions.reset === 'function') {
        window.FmsBaiSuggestions.reset();
    }
}

// ---------------------------------------------------------------------------
// Navigation Control Panel (Slide-out Drawer)
// ---------------------------------------------------------------------------
function openNavPanel() {
    var panel = document.getElementById('sidebar-panel') || document.querySelector('.sidebar');
    var backdrop = document.getElementById('sidebar-backdrop');
    var trigger = document.getElementById('topbar-menu-btn');
    if (panel) panel.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    if (trigger) {
        trigger.setAttribute('aria-expanded', 'true');
        trigger.classList.add('is-active');
    }
    document.body.classList.add('sidebar-panel-open');
}

function closeNavPanel() {
    var panel = document.getElementById('sidebar-panel') || document.querySelector('.sidebar');
    var backdrop = document.getElementById('sidebar-backdrop');
    var trigger = document.getElementById('topbar-menu-btn');
    if (panel) panel.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.classList.remove('is-active');
    }
    document.body.classList.remove('sidebar-panel-open');
}

window.closeNavPanel = closeNavPanel;
window.openNavPanel = openNavPanel;
window.toggleNavPanel = toggleNavPanel;

function toggleNavPanel() {
    var panel = document.getElementById('sidebar-panel') || document.querySelector('.sidebar');
    if (panel && panel.classList.contains('open')) {
        closeNavPanel();
    } else {
        openNavPanel();
    }
}

function initNavPanel() {
    var trigger = document.getElementById('topbar-menu-btn');
    if (trigger) {
        trigger.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            toggleNavPanel();
        });
    }

    var closeBtn = document.getElementById('sidebar-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeNavPanel();
        });
    }

    // Sidebar view toggle (List vs Large Icon Grid)
    var viewToggleBtn = document.getElementById('sidebar-view-toggle-btn');
    var viewToggleIcon = document.getElementById('sidebar-view-toggle-icon');
    var sidebarPanel = document.getElementById('sidebar-panel') || document.querySelector('.sidebar');

    function applySidebarView(viewMode) {
        if (!sidebarPanel) return;
        if (viewMode === 'grid') {
            sidebarPanel.classList.add('sidebar-view-grid');
            if (viewToggleIcon) viewToggleIcon.textContent = 'view_list';
            if (viewToggleBtn) {
                viewToggleBtn.title = 'Switch to List View';
                viewToggleBtn.setAttribute('aria-label', 'Switch to List View');
            }
        } else {
            sidebarPanel.classList.remove('sidebar-view-grid');
            if (viewToggleIcon) viewToggleIcon.textContent = 'grid_view';
            if (viewToggleBtn) {
                viewToggleBtn.title = 'Switch to Grid View';
                viewToggleBtn.setAttribute('aria-label', 'Switch to Grid View');
            }
        }
    }

    var savedView = 'list';
    try {
        savedView = localStorage.getItem('fms_sidebar_view') || 'list';
    } catch (e) {}
    applySidebarView(savedView);

    if (viewToggleBtn) {
        viewToggleBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var isGrid = sidebarPanel && sidebarPanel.classList.contains('sidebar-view-grid');
            var nextMode = isGrid ? 'list' : 'grid';
            applySidebarView(nextMode);
            try {
                localStorage.setItem('fms_sidebar_view', nextMode);
            } catch (err) {}
        });
    }

    var backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', function () {
            closeNavPanel();
        });
    }

    document.querySelectorAll('.nav-ai-kpi-card').forEach(function (card) {
        card.addEventListener('click', function () {
            closeNavPanel();
        });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
            closeNavPanel();
        }
    });
}

// ---------------------------------------------------------------------------
// Navigation menu + page switching
// ---------------------------------------------------------------------------
function initNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(function (item) {
    item.addEventListener('click', function (evt) {
        var page = item.getAttribute('data-page');
        if (!page) return;
        document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
        item.classList.add('active');
        closeNavPanel();
        var contentArea = document.querySelector('.content-area');
        if (contentArea) {
            contentArea.classList.remove('ai-chat-active', 'ai-chat--preprod', 'ai-chat--batch', 'ai-chat--trio', 'prod-live-active');
            if (page === 'home') {
                contentArea.classList.add('page-home-active');
            } else {
                contentArea.classList.remove('page-home-active');
            }
        }
        var pageBatchList = document.getElementById('page-batch-list');
        if (pageBatchList) pageBatchList.classList.remove('prod-live-active');
        if (window.ProductionLiveEngine && typeof window.ProductionLiveEngine.hide === 'function') {
            try { window.ProductionLiveEngine.hide(); } catch (e) {}
        }
        document.querySelectorAll('.page-view').forEach(function (v) { v.style.display = 'none'; });
        var target = document.getElementById('page-' + page);
        if (target) target.style.display = '';
        // Topbar title now permanently shows the version banner (see
        // index.html / style.css) instead of the active page name, so we no
        // longer overwrite its text on nav clicks.

        // Admin-controlled access check â€” if the user isn't permitted on this
        // tab, show the warning card instead of the tab's real content and
        // skip all the below content-loading logic entirely. Some tabs
        // (Warehouse, Machine, OT & Leave, Purchase) have a SECOND click
        // listener bound in main.js that resets them to their own KPI view â€”
        // stopImmediatePropagation() keeps that second listener from
        // re-revealing content underneath the warning card.
        if (!hasPageAccess(page)) {
        if (target) showAccessDeniedCard(target, accessDeniedLabelFor_(page));
        if (evt && evt.stopImmediatePropagation) evt.stopImmediatePropagation();
        return;
        }
        if (target) hideAccessDeniedCard(target);

        // Replay the welcome hero animation each time Home is opened
        if (page === 'home') {
        initHomeHero();
        }
        // Reset reports to KPI view when navigating to Reports
        if (page === 'reports') {
        showReportsKpiView();
        }
        // Reset batch-list to KPI view when navigating to Batch List
        if (page === 'batch-list') {
        showBatchListKpiView();
        }
        // Reset PDF to KPI view when navigating to PDF
        if (page === 'pdf') {
        showPdfKpiView();
        }
        // Reset store to KPI view when navigating to Store
        if (page === 'store') {
        showStoreKpiView();
        }
    });
    });
}

// ---------------------------------------------------------------------------
// Home â€” welcome hero animations (fade-in stagger + typing effect)
// ---------------------------------------------------------------------------
var HOME_WELCOME_MESSAGE = "Welcome back to FMS Workspace. We're glad to have you here. Stay organized, stay informed, and let's achieve excellence together.";
var homeTypeTimer = null;
var homeWorkspaceTimer = null;
var homeWorkspaceStartTimer = null;

function animateHomeWorkspace() {
    var workspaceEl = document.getElementById('home-workspace-text');
    if (!workspaceEl) return;

    var word = 'Workspace';
    var colorIndex = 0;
    workspaceEl.textContent = word;
    workspaceEl.className = 'home-workspace-text';

    function runCycle() {
        if (!workspaceEl.isConnected || workspaceEl.offsetParent === null) {
            homeWorkspaceStartTimer = setTimeout(runCycle, 2500);
            return;
        }
        var index = word.length;
        homeWorkspaceTimer = setInterval(function () {
            index--;
            workspaceEl.textContent = word.slice(0, index);
            if (index === 0) {
                clearInterval(homeWorkspaceTimer);
                homeWorkspaceStartTimer = setTimeout(function () {
                    colorIndex = (colorIndex % 6) + 1;
                    workspaceEl.className = 'home-workspace-text workspace-color-' + colorIndex;
                    homeWorkspaceTimer = setInterval(function () {
                        index++;
                        workspaceEl.textContent = word.slice(0, index);
                        if (index === word.length) {
                            clearInterval(homeWorkspaceTimer);
                            homeWorkspaceTimer = null;
                            homeWorkspaceStartTimer = setTimeout(runCycle, 1800);
                        }
                    }, 105);
                }, 350);
            }
        }, 70);
    }

    // Let the title settle briefly, then continuously erase and retype it.
    homeWorkspaceStartTimer = setTimeout(runCycle, 1200);
}

function typeHomeWelcomeMessage() {
    var textEl = document.getElementById('home-welcome-text');
    var cursor = document.getElementById('home-welcome-cursor');
    if (!textEl) return;
    if (homeTypeTimer) { clearInterval(homeTypeTimer); homeTypeTimer = null; }

    var message = HOME_WELCOME_MESSAGE;
    var i = 0;
    textEl.textContent = '';
    if (cursor) textEl.appendChild(cursor);

    homeTypeTimer = setInterval(function () {
        i++;
        textEl.textContent = message.slice(0, i);
        if (cursor) textEl.appendChild(cursor);
        if (i >= message.length) {
            clearInterval(homeTypeTimer);
            homeTypeTimer = null;
        }
    }, 16);
}

function initHomeHero() {
    var hero = document.getElementById('home-hero');
    if (!hero) return;

    var nameEl = document.getElementById('home-greeting-name');
    if (nameEl) nameEl.textContent = currentSubmitter() || 'there';

    if (homeWorkspaceTimer) { clearInterval(homeWorkspaceTimer); homeWorkspaceTimer = null; }
    if (homeWorkspaceStartTimer) { clearTimeout(homeWorkspaceStartTimer); homeWorkspaceStartTimer = null; }
    animateHomeWorkspace();

    hero.classList.remove('is-active');
    void hero.offsetWidth; // force reflow so the animation can replay
    hero.classList.add('is-active');

    // Ensure hero background image zoom-out animation replays smoothly
    var heroImg = hero.querySelector('.home-hero-bg-img');
    if (heroImg) {
        heroImg.classList.remove('hero-zoom-active');
        void heroImg.offsetWidth;
        heroImg.classList.add('hero-zoom-active');
    }

    // Ensure background video plays smoothly
    var vid = hero.querySelector('.home-hero-video');
    if (vid && vid.paused) { vid.play().catch(function () {}); }

    // Update AI access states for home AI hub
    applyAiAccess();

    // Wire access protection for home AI items if clicked while restricted
    ['home-ai-link-trio', 'home-ai-link-preprod', 'home-ai-link-bai'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && !el._fmsBound) {
            el._fmsBound = true;
            el.addEventListener('click', function (e) {
                var aiKey = id === 'home-ai-link-trio' ? 'ai-trio' : (id === 'home-ai-link-preprod' ? 'ai-preprod' : 'ai-batch-analysis');
                if (!hasAiAccess(aiKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    showToast('error', 'Access Restricted', 'You do not have access to ' + aiAccessDeniedLabelFor_(aiKey) + '. Please contact your administrator.');
                }
            });
        }
    });

    // Wire direct AI ask bar
    var quickInput = document.getElementById('home-ai-quick-input');
    var quickSend = document.getElementById('home-ai-quick-send');
    function submitQuickAi() {
        if (!quickInput) return;
        var q = (quickInput.value || '').trim();
        if (!q) { quickInput.focus(); return; }
        if (!hasAiAccess('ai-trio')) {
            showToast('error', 'Access Restricted', 'You do not have access to Trio AI. Please contact your administrator.');
            return;
        }
        window.location.href = 'trio.html?prompt=' + encodeURIComponent(q);
    }
    if (quickSend && !quickSend._fmsBound) {
        quickSend._fmsBound = true;
        quickSend.addEventListener('click', submitQuickAi);
    }
    if (quickInput && !quickInput._fmsBound) {
        quickInput._fmsBound = true;
        quickInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitQuickAi();
            }
        });
    }

    // Typing effect starts once the welcome card has faded in
    setTimeout(typeHomeWelcomeMessage, 650);
}

// ---------------------------------------------------------------------------
// Sidebar customization â€” every module can be shown or hidden from Settings.
// 6 items are ON by default for new users; the rest start OFF. Choices are
// remembered per-user in localStorage.
// ---------------------------------------------------------------------------
var ALL_NAV_ITEMS = [
    { page: 'dashboard',      label: 'Dashboard',           icon: 'dashboard',                defaultOn: false },
    { page: 'fms-form',       label: 'FMS Form',            icon: 'assignment',               defaultOn: true },
    { page: 'dice-form',      label: 'FORMA & DICE FORM',   icon: 'inventory_2',              defaultOn: true },
    { page: 'batch-list',     label: 'Production Data',     icon: 'list_alt',                 defaultOn: true },
    { page: 'reports',        label: 'Reports',             icon: 'bar_chart',                defaultOn: true },
    { page: 'pdf',            label: 'PDF',                 icon: 'picture_as_pdf',           defaultOn: true },
    { page: 'warehouse',      label: 'Warehouse',           icon: 'warehouse',                defaultOn: false },
    { page: 'machine',        label: 'Machine',             icon: 'precision_manufacturing',  defaultOn: false },
    { page: 'ot-leave',       label: 'Additional Work & Leave', icon: 'event_available',      defaultOn: false },
    { page: 'purchase',       label: 'Purchase',            icon: 'request_quote',            defaultOn: false },
    { page: 'store',          label: 'Store',               icon: 'storefront',               defaultOn: false },
    { page: 'maintenance',    label: 'Maintenance',         icon: 'build',                    defaultOn: false },
    { page: 'ims',            label: 'IMS',                 icon: 'fact_check',               defaultOn: false }
];

function defaultEnabledPages() {
    return ALL_NAV_ITEMS.filter(function (item) { return item.defaultOn; })
                         .map(function (item) { return item.page; });
}

// ---------------------------------------------------------------------------
// Admin-controlled tab access (separate from the personal sidebar prefs
// above). Driven by the USERS sheet Column I dropdown, delivered at login as
// getAccess() (an array of tab NAMES, e.g. "Reports", "PDF"). We match those
// names against ALL_NAV_ITEMS labels (case-insensitive) to know which
// data-page keys the current user is allowed to open. 'home' and 'settings'
// are core pages and are always allowed.
// ---------------------------------------------------------------------------
var ACCESS_LABEL_TO_PAGE = {};
ALL_NAV_ITEMS.forEach(function (item) {
    ACCESS_LABEL_TO_PAGE[item.label.trim().toLowerCase()] = item.page;
});
var ACCESS_ALWAYS_ALLOWED_PAGES = ['home', 'settings', 'explore'];

// Set of page keys the current user is allowed to open, derived from
// getAccess(). Recomputed on demand so it always reflects the latest login.
function getAllowedPageSet_() {
    var set = {};
    getAccess().forEach(function (label) {
        var key = ACCESS_LABEL_TO_PAGE[String(label).trim().toLowerCase()];
        if (key) set[key] = true;
    });
    return set;
}

function hasPageAccess(page) {
    if (ACCESS_ALWAYS_ALLOWED_PAGES.indexOf(page) !== -1) return true;
    // Pages outside ALL_NAV_ITEMS (none currently) are treated as unrestricted.
    var isGated = ALL_NAV_ITEMS.some(function (item) { return item.page === page; });
    if (!isGated) return true;
    return !!getAllowedPageSet_()[page];
}

function accessDeniedLabelFor_(page) {
    var item = ALL_NAV_ITEMS.filter(function (i) { return i.page === page; })[0];
    return item ? item.label : 'this tab';
}

// ---------------------------------------------------------------------------
// Per-KPI-card access (finer-grained than the tab-level access above). Driven
// by USERS sheet Column J, delivered at login/poll as kpiAccess (an array of
// KPI-card ids). Every KPI card in the app (every ".kpi-card" element in
// index.html that has an id) is listed here with a human-readable label â€”
// this list is what the admin's Column J dropdown values are matched against.
//
// IMPORTANT: an EMPTY kpiAccess list means "no restriction" for that user â€”
// this keeps every existing user unaffected until an admin deliberately
// picks specific cards for someone in Column J.
// ---------------------------------------------------------------------------
var ALL_KPI_ITEMS = [
    { id: 'kpi-production-live',                      label: 'Production Live' },
    { id: 'kpi-cutting-details',                     label: 'Batch Cutting Details' },
    { id: 'kpi-bantala-details',                      label: 'Bantala Details' },
    { id: 'kpi-floor-qc-details',                     label: 'Floor Supervisor & In-Line QC Details' },
    { id: 'kpi-fms-production-details',               label: 'FMS-Production Details' },
    { id: 'kpi-edge-paint-details',                   label: 'Edge Paint Details' },
    { id: 'kpi-pre-aql-details',                      label: 'Pre-AQL Details' },
    { id: 'kpi-endline-qc-details',                   label: 'End-Line QC Details' },
    { id: 'kpi-post-aql-details',                     label: 'POST-AQL Details' },
    { id: 'kpi-warehouse-fms-details',                label: 'WAREHOUSE-FMS Details' },
    { id: 'kpi-shipment-details',                     label: 'Shipment Details' },
    { id: 'kpi-product-input-tracking',               label: 'Product Input Tracking' },
    { id: 'kpi-pms-details',                          label: 'PMS' },
    { id: 'kpi-submitted-fms',                        label: 'Submitted FMS Data' },
    { id: 'kpi-dice-summary',                         label: 'Dice Data Summary' },
    { id: 'kpi-forma-summary',                        label: 'Forma Data Summary' },
    { id: 'kpi-submitted-domestic',                   label: 'Submitted Domestic Data' },
    { id: 'kpi-submitted-import',                     label: 'Submitted Import Data' },
    { id: 'kpi-trio-ai-data',                         label: 'Trio-AI Data' },
    { id: 'kpi-checking-details',                     label: 'Checking Details' },
    { id: 'kpi-warehouse-received-details',           label: 'Warehouse Received Details' },
    { id: 'kpi-die-less-knife-cutting-machine-details', label: 'Die-Less Knife Cutting Machine Details' },
    { id: 'kpi-machine-repairing-details',            label: 'Machine & Repairing Details' },
    { id: 'kpi-machine-data',                         label: 'Machine Details' },
    { id: 'kpi-monthly-machine-inactivity-data',      label: 'Monthly Machine Inactivity Details' },
    { id: 'kpi-ot-details',                           label: 'Additional Work Details' },
    { id: 'kpi-leave-details',                        label: 'Leave Details' },
    { id: 'kpi-ot-leave-analysis',                    label: 'Additional Work & Leave Analysis' },
    { id: 'kpi-domestic-po',                          label: 'Domestic Purchase Order Form' },
    { id: 'kpi-import-po',                            label: 'Import Purchase Order Form' },
    { id: 'kpi-store-ai-data',                        label: 'Pre-Production for Store' },
    { id: 'kpi-preprod-data',                         label: 'Pre-Production Data' },
    { id: 'kpi-pdf-floor-supervisor',                 label: 'Floor Supervisor (PDF)' },
    { id: 'kpi-pdf-inline-qc',                        label: 'In-Line QC (PDF)' },
    { id: 'kpi-pdf-endline-qc',                       label: 'End-Line QC (PDF)' },
    { id: 'kpi-pdf-edge-paint',                       label: 'Edge-Paint (PDF)' },
    { id: 'kpi-pdf-followup-planned',                 label: 'Follow-Up Planned (PDF)' },
    { id: 'open-dice-tracker',                        label: 'Dice Tracker Form' },
    { id: 'open-forma-tracker',                       label: 'Forma Tracker Form' }
];

var KPI_ID_TO_LABEL = {};
var KPI_LABEL_TO_ID = {};
ALL_KPI_ITEMS.forEach(function (item) {
    KPI_ID_TO_LABEL[item.id] = item.label;
    KPI_LABEL_TO_ID[item.label.trim().toLowerCase()] = item.id;
});
// Backwards-compatible aliases for legacy labels in Google Sheets Column J
KPI_LABEL_TO_ID['machine data'] = 'kpi-machine-data';
KPI_LABEL_TO_ID['monthly machine inactivity (data)'] = 'kpi-monthly-machine-inactivity-data';
KPI_LABEL_TO_ID['monthly machine inactivity'] = 'kpi-monthly-machine-inactivity-data';

// Column J entries may be typed as either the id (e.g. "kpi-cutting-details")
// or the human-readable label (e.g. "Batch Cutting Details") â€” admins pick
// from a dropdown of labels, so normalize everything to ids here.
function normalizeKpiAccessList_(rawList) {
    return rawList.map(function (entry) {
        var key = String(entry).trim().toLowerCase();
        if (KPI_LABEL_TO_ID.hasOwnProperty(key)) return KPI_LABEL_TO_ID[key];
        return String(entry).trim();
    });
}

// True if the current user may see/open the KPI card with this id. Ids not
// present in ALL_KPI_ITEMS (none expected, but kept safe) are unrestricted.
function hasKpiAccess(kpiId) {
    if (kpiId === 'kpi-production-live') return true;
    if (!kpiId || !KPI_ID_TO_LABEL.hasOwnProperty(kpiId)) return true;
    var list = normalizeKpiAccessList_(getKpiAccess());
    if (!list.length) return true; // no restriction set for this user
    return list.indexOf(kpiId) !== -1;
}

// ---------------------------------------------------------------------------
// Per-AI-feature access (same pattern as the per-KPI-card access above, one
// level up). Driven by USERS sheet Column K, delivered at login/poll as
// aiAccess (an array of AI-feature names). Gates the 3 topbar AI launchers:
//   - Pre-Production AI      (button#topbar-ai-btn,   AI.js)
//   - Batch Analysis with AI (button#topbar-bai-btn,  Bai.js)
//   - Trio AI                (button#topbar-trio-btn, Trio.js)
//
// IMPORTANT: an EMPTY aiAccess list means "no restriction" for that user â€”
// this keeps every existing user unaffected until an admin deliberately
// picks specific AI features for someone in Column K.
// ---------------------------------------------------------------------------
var ALL_AI_ITEMS = [
    { id: 'ai-preprod',         label: 'Pre-Production AI',      wrapId: 'topbar-ai-wrap',  navWrapId: 'nav-ai-wrap-preprod' },
    { id: 'ai-batch-analysis',  label: 'Batch Analysis with AI', wrapId: 'topbar-bai-wrap', navWrapId: 'nav-ai-wrap-bai' },
    { id: 'ai-trio',            label: 'Trio AI',                wrapId: 'topbar-trio-wrap', navWrapId: 'nav-ai-wrap-trio' }
];

var AI_ID_TO_LABEL = {};
var AI_LABEL_TO_ID = {};
ALL_AI_ITEMS.forEach(function (item) {
    AI_ID_TO_LABEL[item.id] = item.label;
    AI_LABEL_TO_ID[item.label.trim().toLowerCase()] = item.id;
});

// Column K entries may be typed as either the id (e.g. "ai-trio") or the
// human-readable label (e.g. "Trio AI") â€” admins pick from a dropdown of
// labels, so normalize everything to ids here (mirrors normalizeKpiAccessList_).
function normalizeAiAccessList_(rawList) {
    return rawList.map(function (entry) {
        var key = String(entry).trim().toLowerCase();
        if (AI_LABEL_TO_ID.hasOwnProperty(key)) return AI_LABEL_TO_ID[key];
        return String(entry).trim();
    });
}

// True if the current user may open the AI feature with this id. Ids not
// present in ALL_AI_ITEMS are unrestricted.
function hasAiAccess(aiId) {
    if (!aiId || !AI_ID_TO_LABEL.hasOwnProperty(aiId)) return true;
    var list = normalizeAiAccessList_(getAiAccess());
    if (!list.length) return true; // no restriction set for this user
    return list.indexOf(aiId) !== -1;
}

function aiAccessDeniedLabelFor_(aiId) {
    return AI_ID_TO_LABEL[aiId] || 'This AI feature';
}

// Shows/hides AI launcher items in the topbar and navigation drawer based on
// the current user's aiAccess list.
function applyAiAccess() {
    var visibleCount = 0;
    ALL_AI_ITEMS.forEach(function (item) {
        var allowed = hasAiAccess(item.id);
        if (allowed) visibleCount++;
        var wrap = document.getElementById(item.wrapId);
        if (wrap) wrap.style.display = allowed ? '' : 'none';
        var navWrap = document.getElementById(item.navWrapId);
        if (navWrap) navWrap.style.display = allowed ? '' : 'none';
    });

    // Update Home Hero AI Hub launcher cards
    var homeItemMap = {
        'ai-preprod':        'home-ai-link-preprod',
        'ai-batch-analysis': 'home-ai-link-bai',
        'ai-trio':           'home-ai-link-trio'
    };
    Object.keys(homeItemMap).forEach(function (aiId) {
        var linkEl = document.getElementById(homeItemMap[aiId]);
        if (linkEl) {
            var allowed = hasAiAccess(aiId);
            linkEl.classList.toggle('home-ai-item-disabled', !allowed);
            if (!allowed) linkEl.setAttribute('title', 'Access restricted by administrator');
            else linkEl.removeAttribute('title');
        }
    });
    var homeStatusText = document.getElementById('home-ai-status-text');
    if (homeStatusText) {
        homeStatusText.innerHTML = visibleCount > 0 ? 'Online &bull; ' + visibleCount + ' Engine' + (visibleCount > 1 ? 's' : '') : 'Offline';
    }

    var aiSection = document.getElementById('sidebar-ai-section');
    if (aiSection) aiSection.style.display = visibleCount > 0 ? '' : 'none';
    var countBadge = document.querySelector('.sidebar-ai-count');
    if (countBadge) countBadge.textContent = String(visibleCount);
}

// Re-checks all 3 AI features against the latest aiAccess list and, if any
// AI page is currently open on screen but access to it was just revoked,
// fires a global event so that AI.js / Bai.js / Trio.js (each a separate
// closure) can close their own page and return to the previous view. Access
// being GRANTED mid-session needs no special handling here â€” applyAiAccess()
// simply un-hides the topbar icon again.
function reEvaluateAiAccess_() {
    ALL_AI_ITEMS.forEach(function (item) {
        if (hasAiAccess(item.id)) return;
        try {
            window.dispatchEvent(new CustomEvent('fms:ai-access-revoked', { detail: { id: item.id } }));
        } catch (e) {}
    });
}

// KPI cards are NEVER hidden for restricted users anymore â€” every card in
// every KPI grid is always visible, side by side with the cards the user
// does have access to. Access is enforced only at open-time (see
// showKpiAccessDeniedView_ / the click & keydown listeners below), which
// shows the same "Access Restricted" warning card used at the tab level,
// in place of that KPI's real content. This function is kept (as a no-op
// beyond undoing any stale display:none left over from an older version of
// this app) so existing calls to applyKpiCardAccess() elsewhere stay safe.
function applyKpiCardAccess() {
    document.querySelectorAll('.kpi-card[id]').forEach(function (card) {
        if (!KPI_ID_TO_LABEL.hasOwnProperty(card.id)) return; // not a gated card
        if (card.getAttribute('data-kpi-prev-display') !== null) {
            card.style.display = card.getAttribute('data-kpi-prev-display') || '';
            card.removeAttribute('data-kpi-prev-display');
        }
    });
}

// ---------------------------------------------------------------------------
// Maps every gated KPI card id to the KPI grid it lives in and the detail
// view it opens, so a restricted click can show the "Access Restricted"
// warning card inside that exact detail view instead of loading real data.
// relocateToPage handles the one KPI (Follow-Up Planned) whose detail
// markup has to be moved into the PDF page first, matching what
// showPdfFollowUpPlannedView() itself does.
// ---------------------------------------------------------------------------
var KPI_ACCESS_TARGETS_ = {
    'kpi-production-live':                       { grid: 'batch-list-kpi-view',       detail: 'batch-list-production-live-view' },
    'kpi-cutting-details':                       { grid: 'batch-list-kpi-view',       detail: 'batch-list-cutting-view' },
    'kpi-bantala-details':                       { grid: 'batch-list-kpi-view',       detail: 'batch-list-bantala-view' },
    'kpi-floor-qc-details':                      { grid: 'batch-list-kpi-view',       detail: 'batch-list-floor-qc-view' },
    'kpi-fms-production-details':                { grid: 'batch-list-kpi-view',       detail: 'batch-list-fms-production-view' },
    'kpi-edge-paint-details':                    { grid: 'batch-list-kpi-view',       detail: 'batch-list-edge-paint-view' },
    'kpi-pre-aql-details':                       { grid: 'batch-list-kpi-view',       detail: 'batch-list-pre-aql-view' },
    'kpi-endline-qc-details':                    { grid: 'batch-list-kpi-view',       detail: 'batch-list-endline-qc-view' },
    'kpi-post-aql-details':                      { grid: 'batch-list-kpi-view',       detail: 'batch-list-post-aql-view' },
    'kpi-warehouse-fms-details':                 { grid: 'batch-list-kpi-view',       detail: 'batch-list-warehouse-fms-view' },
    'kpi-shipment-details':                      { grid: 'batch-list-kpi-view',       detail: 'batch-list-shipment-view' },
    'kpi-product-input-tracking':               { grid: 'batch-list-kpi-view',       detail: 'batch-list-product-input-tracking-view' },
    'kpi-pms-details':                          { grid: 'batch-list-kpi-view',       detail: 'batch-list-pms-view' },
    'kpi-submitted-fms':                         { grid: 'reports-kpi-view',          detail: 'reports-fms-data-view' },
    'kpi-dice-summary':                          { grid: 'reports-kpi-view',          detail: 'reports-dice-summary-view' },
    'kpi-forma-summary':                         { grid: 'reports-kpi-view',          detail: 'reports-forma-summary-view' },
    'kpi-submitted-domestic':                    { grid: 'reports-kpi-view',          detail: 'reports-domestic-purchase-view' },
    'kpi-submitted-import':                      { grid: 'reports-kpi-view',          detail: 'reports-import-purchase-view' },
    'kpi-trio-ai-data':                          { grid: 'reports-kpi-view',          detail: 'reports-trio-ai-data-view' },
    'kpi-checking-details':                      { grid: 'warehouse-section-kpi-view', detail: 'checking-details-view' },
    'kpi-warehouse-received-details':            { grid: 'warehouse-section-kpi-view', detail: 'warehouse-received-details-view' },
    'kpi-die-less-knife-cutting-machine-details':{ grid: 'machine-kpi-view',          detail: 'die-less-knife-cutting-machine-details-view' },
    'kpi-machine-repairing-details':             { grid: 'machine-kpi-view',          detail: 'machine-repairing-details-view' },
    'kpi-machine-data':                          { grid: 'die-less-knife-cutting-machine-details-view', detail: 'machine-data-view' },
    'kpi-monthly-machine-inactivity-data':       { grid: 'die-less-knife-cutting-machine-details-view', detail: 'monthly-machine-inactivity-data-view' },
    'kpi-ot-details':                            { grid: 'ot-leave-kpi-view',         detail: 'ot-details-view' },
    'kpi-leave-details':                         { grid: 'ot-leave-kpi-view',         detail: 'leave-details-view' },
    'kpi-ot-leave-analysis':                     { grid: 'ot-leave-kpi-view',         detail: 'ot-leave-analysis-view' },
    'kpi-domestic-po':                           { grid: 'purchase-kpi-view',         detail: 'domestic-po-view' },
    'kpi-import-po':                             { grid: 'purchase-kpi-view',         detail: 'import-po-view' },
    'kpi-store-ai-data':                         { grid: 'store-kpi-view',            detail: 'store-ai-data-view' },
    'kpi-preprod-data':                          { grid: 'store-kpi-view',            detail: 'preprod-data-view' },
    'kpi-pdf-floor-supervisor':                  { grid: 'pdf-kpi-view',              detail: 'pdf-floor-supervisor-view' },
    'kpi-pdf-inline-qc':                         { grid: 'pdf-kpi-view',              detail: 'pdf-inline-qc-view' },
    'kpi-pdf-endline-qc':                        { grid: 'pdf-kpi-view',              detail: 'pdf-endline-qc-view' },
    'kpi-pdf-edge-paint':                        { grid: 'pdf-kpi-view',              detail: 'pdf-edge-paint-view' },
    'kpi-pdf-followup-planned':                  { grid: 'pdf-kpi-view',              detail: 'batch-list-followup-planned-view', relocateToPage: 'page-pdf' },
    'open-dice-tracker':                         { grid: 'forma-dice-menu',           detail: 'dice-tracker-view' },
    'open-forma-tracker':                        { grid: 'forma-dice-menu',           detail: 'forma-tracker-view' }
};

// Opens the restricted KPI's own detail view (same as a real click would)
// but shows the "Access Restricted" warning card inside it instead of the
// real content â€” so the person sees the same view they'd normally land on,
// just gated. Falls back to a no-op (defense-in-depth block only) if a KPI
// id isn't in the map above.
function showKpiAccessDeniedView_(card) {
    var target = KPI_ACCESS_TARGETS_[card.id];
    if (!target) return;
    var gridEl = document.getElementById(target.grid);
    var detailEl = document.getElementById(target.detail);
    if (!detailEl) return;
    if (target.relocateToPage) {
        var pageEl = document.getElementById(target.relocateToPage);
        if (pageEl && detailEl.parentNode !== pageEl) pageEl.appendChild(detailEl);
    }
    if (gridEl) gridEl.style.display = 'none';
    detailEl.style.display = '';
    showAccessDeniedCard(detailEl, KPI_ID_TO_LABEL[card.id] || 'this section', true);
}

// Defense-in-depth: even if a card is briefly visible (e.g. a race before
// applyKpiCardAccess() runs) or someone re-shows it via devtools, clicking
// or Enter/Space-activating a restricted card is blocked here, in the
// CAPTURING phase on document â€” this runs before the card's own click/
// keydown listener (added directly on the card element in main.js), so
// preventDefault + stopPropagation here stops that listener from firing.
function kpiCardFromEvent_(e) {
    var el = e.target;
    while (el && el !== document) {
        if (el.classList && el.classList.contains('kpi-card') && el.id) return el;
        el = el.parentNode;
    }
    return null;
}

document.addEventListener('click', function (e) {
    var card = kpiCardFromEvent_(e);
    if (!card || hasKpiAccess(card.id)) return;
    e.preventDefault();
    e.stopPropagation();
    showKpiAccessDeniedView_(card);
}, true);

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = kpiCardFromEvent_(e);
    if (!card || hasKpiAccess(card.id)) return;
    e.preventDefault();
    e.stopPropagation();
    showKpiAccessDeniedView_(card);
}, true);

// Shows a "no access" warning card inside the given page-view element,
// hiding whatever real content it contains without altering the DOM
// structure. Each child's PRE-EXISTING display value is remembered (via a
// data attribute) before being overwritten, so hideAccessDeniedCard() below
// can restore it exactly â€” this matters for pages like Forma & Dice Form
// that already toggle their own children's display internally (picker cards
// vs. the chosen sub-form), so we never clobber that state.
function showAccessDeniedCard(pageView, label, preserveTopbar) {
    if (!pageView) return;
    Array.prototype.forEach.call(pageView.children, function (child) {
        if (child.classList.contains('access-denied-card')) return;
        if (preserveTopbar && child.classList.contains('data-view-topbar')) return;
        if (child.getAttribute('data-access-prev-display') === null) {
            child.setAttribute('data-access-prev-display', child.style.display || '');
        }
        child.style.display = 'none';
    });
    var card = pageView.querySelector('.access-denied-card');
    if (!card) {
        card = document.createElement('div');
        card.className = 'access-denied-card';
        card.innerHTML =
            '<div class="access-denied-glow"></div>' +
            '<div class="access-denied-illustration"><img src="https://res.cloudinary.com/dnrgcigsj/image/upload/v1785485708/ChatGPT_Image_Jul_31_2026_01_44_11_PM_mvagd5.png" alt="" /></div>' +
            '<div class="access-denied-title">Access Restricted</div>' +
            '<div class="access-denied-text">You don\'t have access to <strong class="access-denied-tab-name"></strong> yet.</div>' +
            '<div class="access-denied-note"><span class="material-icons-round">support_agent</span><span>Please contact your admin to request access to this tab.</span></div>';
        pageView.appendChild(card);
    }
    var nameEl = card.querySelector('.access-denied-tab-name');
    if (nameEl) nameEl.textContent = label;
    card.style.display = 'flex';
    pageView.setAttribute('data-access-denied', '1');
}

// No-ops on any page-view that was never put into the denied state (the
// common case â€” most nav clicks land on pages the user always had access
// to), so it never touches those pages' own internal show/hide logic.
function hideAccessDeniedCard(pageView) {
    if (!pageView) return;
    if (pageView.getAttribute('data-access-denied') !== '1') return;
    var card = pageView.querySelector('.access-denied-card');
    if (card) card.style.display = 'none';
    Array.prototype.forEach.call(pageView.children, function (child) {
        if (child.classList.contains('access-denied-card')) return;
        var prev = child.getAttribute('data-access-prev-display');
        child.style.display = prev || '';
        child.removeAttribute('data-access-prev-display');
    });
    pageView.removeAttribute('data-access-denied');
}

// Re-runs the same "reset to KPI view" a fresh nav click would trigger, for
// tabs that keep that logic in main.js rather than app.js. Called only when
// access is silently GRANTED mid-session, so the tab lands on its normal
// landing view instead of staying blank.
function resetPageToLandingView_(page) {
    if (page === 'reports' && typeof showReportsKpiView === 'function') showReportsKpiView();
    if (page === 'batch-list' && typeof showBatchListKpiView === 'function') showBatchListKpiView();
    if (page === 'pdf' && typeof showPdfKpiView === 'function') showPdfKpiView();
    if (page === 'store' && typeof showStoreKpiView === 'function') showStoreKpiView();
    if (page === 'warehouse' && typeof showWarehouseSectionKpiView === 'function') showWarehouseSectionKpiView();
    if (page === 'machine' && typeof showMachineKpiView === 'function') showMachineKpiView();
    if (page === 'ot-leave' && typeof showOtLeaveKpiView === 'function') showOtLeaveKpiView();
    if (page === 'purchase' && typeof showPurchaseKpiView === 'function') showPurchaseKpiView();
}

// ---------------------------------------------------------------------------
// IndexedDB & Live Google Sheet Access Control Engine
// ---------------------------------------------------------------------------
// High-performance Access Control Engine:
// 1. Instant 0ms IndexedDB hydration upon page load & refresh.
// 2. Direct, lightweight GVIZ CSV synchronization with the Google Sheet (USERS tab)
//    every 3 seconds (ACCESS_POLL_MS = 3000) and immediately upon tab visibility/focus.
// 3. Admin edits to tab access (Col I), KPI access (Col J), or AI access (Col K)
//    are instantly reflected in the DOM without any page reload or toast interruption.
// 4. Inactive/revoked status is immediately caught and terminated for security.
// 5. Automatic fallback to GAS getUserAccess if GVIZ CSV is temporarily blocked.
// ---------------------------------------------------------------------------
var ACCESS_POLL_MS = 30000;
var FMS_AUTH_DB_NAME = 'FMS_Auth_DB_v1';
var FMS_AUTH_DB_VERSION = 1;
var FMS_AUTH_STORE_NAME = 'users_store';
var USERS_SHEET_PRIMARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E/export?format=csv&gid=1374028578&range=A:K';
var USERS_SHEET_FALLBACK_CSV_URL = 'https://docs.google.com/spreadsheets/d/1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E/gviz/tq?tqx=out:csv&gid=1374028578&range=A:K';
var USERS_SHEET_CSV_URL = USERS_SHEET_PRIMARY_CSV_URL;

var authDbInstance_ = null;
var isAccessSyncInProgress_ = false;

function openAuthDB_() {
    return new Promise(function (resolve, reject) {
        if (authDbInstance_) return resolve(authDbInstance_);
        if (!window.indexedDB) return reject(new Error('IndexedDB not supported'));
        var req = indexedDB.open(FMS_AUTH_DB_NAME, FMS_AUTH_DB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(FMS_AUTH_STORE_NAME)) {
                db.createObjectStore(FMS_AUTH_STORE_NAME, { keyPath: 'usernameLower' });
            }
        };
        req.onsuccess = function (e) {
            authDbInstance_ = e.target.result;
            resolve(authDbInstance_);
        };
        req.onerror = function (e) {
            reject(e.target.error || new Error('Failed to open IndexedDB ' + FMS_AUTH_DB_NAME));
        };
    });
}

function getLocalUserAccess_(username) {
    return openAuthDB_().then(function (db) {
        return new Promise(function (resolve, reject) {
            try {
                var key = String(username).trim().toLowerCase();
                var tx = db.transaction(FMS_AUTH_STORE_NAME, 'readonly');
                var store = tx.objectStore(FMS_AUTH_STORE_NAME);
                var req = store.get(key);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function (e) { reject(e.target.error); };
            } catch (err) {
                resolve(null);
            }
        });
    }).catch(function () { return null; });
}

function saveUsersToIndexedDB_(userList) {
    if (!userList || !userList.length) return Promise.resolve();
    return openAuthDB_().then(function (db) {
        return new Promise(function (resolve, reject) {
            try {
                var tx = db.transaction(FMS_AUTH_STORE_NAME, 'readwrite');
                var store = tx.objectStore(FMS_AUTH_STORE_NAME);
                for (var i = 0; i < userList.length; i++) {
                    store.put(userList[i]);
                }
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function (e) { reject(e.target.error); };
            } catch (err) {
                reject(err);
            }
        });
    }).catch(function (err) {
        console.warn('Failed to cache users in IndexedDB:', err);
    });
}

function parseAccessList_(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return [];
    return text.split(/[,;\n]+/)
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s !== ''; });
}

function parseUsersCsvRows_(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;

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
                if (curRow.length > 0) rows.push(curRow);
                curRow = [];
            } else if (c === '\n') {
                curRow.push(curVal.trim());
                curVal = '';
                if (curRow.length > 0) rows.push(curRow);
                curRow = [];
            } else {
                curVal += c;
            }
        }
    }
    if (curVal || curRow.length) {
        curRow.push(curVal.trim());
        if (curRow.length > 0) rows.push(curRow);
    }
    return rows;
}

function accessListsEqual_(a, b) {
    var sa = (a || []).slice().sort().join('\u0001');
    var sb = (b || []).slice().sort().join('\u0001');
    return sa === sb;
}

// Looks at whichever nav item is currently marked active and, if its access
// status just flipped, silently shows/hides the warning card to match.
function reEvaluateCurrentPageAccess_() {
    var activeItem = document.querySelector('.nav-item.active[data-page]');
    if (!activeItem) return;
    var page = activeItem.getAttribute('data-page');
    if (!page) return;
    var target = document.getElementById('page-' + page);
    if (!target) return;

    var isShowingDenied = target.getAttribute('data-access-denied') === '1';
    var nowAllowed = hasPageAccess(page);

    if (nowAllowed && isShowingDenied) {
        hideAccessDeniedCard(target);
        resetPageToLandingView_(page);
    } else if (!nowAllowed && !isShowingDenied) {
        showAccessDeniedCard(target, accessDeniedLabelFor_(page));
    }
}

// Looks at every gated KPI whose detail view is currently open (loaded into
// the DOM with display !== 'none' â€” regardless of which top-level tab is on
// screen right now, so access changes take effect even for a KPI view left
// open in the background) and, if its access status just flipped, silently
// swaps it between the warning card and its real content â€” same "no reload,
// no interruption" behavior as reEvaluateCurrentPageAccess_() above.
//
// Granting access: hides the warning card, then re-dispatches a click on the
// KPI's own card element. Since hasKpiAccess() now returns true, the
// document-level capturing guard lets it through and the KPI's normal click
// handler (wherever it's defined â€” app.js, main.js, or a web.js closure)
// runs exactly as if the person had just clicked it, loading real data.
//
// Revoking access: reuses showKpiAccessDeniedView_() to swap the real
// content out for the warning card in place, without touching which tab is
// on screen.
function reEvaluateCurrentKpiAccess_() {
    Object.keys(KPI_ACCESS_TARGETS_).forEach(function (kpiId) {
        var target = KPI_ACCESS_TARGETS_[kpiId];
        var detailEl = document.getElementById(target.detail);
        if (!detailEl || detailEl.style.display === 'none') return; // not currently open

        var isShowingDenied = detailEl.getAttribute('data-access-denied') === '1';
        var nowAllowed = hasKpiAccess(kpiId);

        if (nowAllowed && isShowingDenied) {
            hideAccessDeniedCard(detailEl);
            var cardEl = document.getElementById(kpiId);
            if (cardEl) cardEl.click();
        } else if (!nowAllowed && !isShowingDenied) {
            showKpiAccessDeniedView_({ id: kpiId });
        }
    });
}

function applyAccessUpdates_(access, kpiAccess, aiAccess) {
    var tabChanged = Array.isArray(access) && !accessListsEqual_(access, getAccess());
    var kpiChanged = Array.isArray(kpiAccess) && !accessListsEqual_(kpiAccess, getKpiAccess());
    var aiChanged  = Array.isArray(aiAccess) && !accessListsEqual_(aiAccess, getAiAccess());

    if (!tabChanged && !kpiChanged && !aiChanged) return false;

    if (tabChanged) setAccess(access);
    if (kpiChanged) setKpiAccess(kpiAccess);
    if (aiChanged) setAiAccess(aiAccess);

    reEvaluateCurrentPageAccess_();
    applyKpiCardAccess();
    if (kpiChanged) reEvaluateCurrentKpiAccess_();
    if (aiChanged) {
        applyAiAccess();
        reEvaluateAiAccess_();
    }

    try {
        window.dispatchEvent(new CustomEvent('fms:access-updated', {
            detail: { access: access, kpiAccess: kpiAccess, aiAccess: aiAccess }
        }));
    } catch (e) {}

    return true;
}

function handleRevokedUser_() {
    try {
        clearSession();
        alert('Your access permissions have been revoked by the administrator.');
    } catch (e) {}
    window.location.href = getLoginUrl();
}

var lastLiveUsersRawCsv_ = '';

function fetchLiveUsersSheet_() {
    var ts = Date.now();
    var primaryUrl = USERS_SHEET_PRIMARY_CSV_URL + '&_ts=' + ts;
    var fallbackUrl = USERS_SHEET_FALLBACK_CSV_URL + '&_ts=' + ts;
    return fetch(primaryUrl, { cache: 'no-cache' })
        .then(function (res) {
            if (!res.ok) throw new Error('Failed to fetch primary users sheet: ' + res.status);
            return res.text();
        })
        .then(function (csvText) {
            if (!csvText || csvText.length < 20) throw new Error('Primary users sheet empty');
            return csvText;
        })
        .catch(function (err) {
            console.warn('[UsersSync] Primary export failed, falling back to GViz:', err);
            return fetch(fallbackUrl, { cache: 'no-cache' }).then(function (res2) {
                if (!res2.ok) throw new Error('Failed to fetch fallback users sheet: ' + res2.status);
                return res2.text();
            });
        })
        .then(function (csvText) {
            if (csvText === lastLiveUsersRawCsv_) {
                return 'NO_CHANGE';
            }
            lastLiveUsersRawCsv_ = csvText;
            var rows = parseUsersCsvRows_(csvText);
            if (!rows || rows.length < 2) return [];
            var users = [];
            for (var i = 1; i < rows.length; i++) {
                var r = rows[i];
                var uName = (r[0] || '').trim();
                var uPass = (r[1] || '').trim();
                if (!uName) continue;
                users.push({
                    usernameLower: uName.toLowerCase(),
                    username: uName,
                    password: uPass,
                    gender: (r[2] || '').trim(),
                    to: (r[3] || '').trim(),
                    cc: (r[4] || '').trim(),
                    status: (r[5] || '').trim(),
                    access: parseAccessList_(r[8]),
                    kpiAccess: parseAccessList_(r[9]),
                    aiAccess: parseAccessList_(r[10]),
                    updatedAt: Date.now()
                });
            }
            if (users.length > 0) {
                saveUsersToIndexedDB_(users);
            }
            return users;
        });
}

function pollAccessGasFallback_(user) {
    function onResult(result) {
        if (!result || !result.success) return;
        applyAccessUpdates_(result.access, result.kpiAccess, result.aiAccess);
    }
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(onResult).withFailureHandler(function () {}).getUserAccess(user);
        return;
    }
    if (typeof jsonp === 'function') {
        jsonp({ action: 'getUserAccess', username: user }, function (err, result) {
            if (!err) onResult(result);
        });
    }
}

function pollAccess_(user) {
    if (!user || isAccessSyncInProgress_) return;
    var userLower = String(user).trim().toLowerCase();
    isAccessSyncInProgress_ = true;

    fetchLiveUsersSheet_()
        .then(function (users) {
            isAccessSyncInProgress_ = false;
            if (users === 'NO_CHANGE') return; // Sheet has not changed since last check
            if (!users || !users.length) return;
            var matched = null;
            for (var i = 0; i < users.length; i++) {
                if (users[i].usernameLower === userLower) {
                    matched = users[i];
                    break;
                }
            }
            if (!matched) {
                // User was deleted from the USERS sheet
                handleRevokedUser_();
                return;
            }
            if (matched.status && /^(INACTIVE|BLOCKED|DEACTIVATED|DISABLED)$/i.test(matched.status.trim())) {
                // User status changed to INACTIVE/BLOCKED
                handleRevokedUser_();
                return;
            }
            applyAccessUpdates_(matched.access, matched.kpiAccess, matched.aiAccess);
        })
        .catch(function () {
            isAccessSyncInProgress_ = false;
            // Fallback to GAS if network/CORS fails
            pollAccessGasFallback_(user);
        });
}

function initAccessPolling() {
    var user = getSession();
    if (!user) return;

    // Apply immediately on load from current state
    applyKpiCardAccess();
    applyAiAccess();

    // Fast Path: Check local IndexedDB immediately (0-5ms instant access hydration)
    getLocalUserAccess_(user).then(function (cached) {
        if (cached) {
            if (cached.status && /^(INACTIVE|BLOCKED|DEACTIVATED|DISABLED)$/i.test(cached.status.trim())) {
                handleRevokedUser_();
                return;
            }
            applyAccessUpdates_(cached.access, cached.kpiAccess, cached.aiAccess);
        }
    });

    // Live sync from Google Sheet immediately
    pollAccess_(user);

    // Fast background interval polling (every 3 seconds)
    setInterval(function () {
        pollAccess_(user);
    }, ACCESS_POLL_MS);

    // Immediate reactive poll when window tab is focused or becomes visible
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            pollAccess_(user);
        }
    });
    window.addEventListener('focus', function () {
        pollAccess_(user);
    });
}

function sidebarPrefsKey() {
    return 'fms_sidebar_prefs_' + (currentSubmitter() || 'guest');
}

// Returns the saved preference list if the user has ever changed anything;
// otherwise falls back to the built-in defaults (6 core items ON).
function getEffectiveSidebarPrefs() {
    try {
        var raw = localStorage.getItem(sidebarPrefsKey());
        if (raw === null) return defaultEnabledPages();
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : defaultEnabledPages();
    } catch (e) { return defaultEnabledPages(); }
}

function saveSidebarPrefs(pages) {
    try { localStorage.setItem(sidebarPrefsKey(), JSON.stringify(pages)); } catch (e) {}
}

function applySidebarPrefs() {
    var prefs = getEffectiveSidebarPrefs();
    var activeHidden = false;

    document.querySelectorAll('.nav-item-toggle').forEach(function (item) {
        var page = item.getAttribute('data-page');
        var enabled = prefs.indexOf(page) !== -1;
        item.style.display = enabled ? '' : 'none';
        if (!enabled && item.classList.contains('active')) activeHidden = true;
    });

    // If the page currently on screen just got hidden, jump to the first
    // still-visible item (or Settings, as the last resort).
    if (activeHidden) {
        var fallback = Array.prototype.find.call(
            document.querySelectorAll('.nav-item-toggle'),
            function (el) { return el.style.display !== 'none'; }
        );
        if (!fallback) fallback = document.querySelector('.nav-item[data-page="home"]');
        if (!fallback) fallback = document.querySelector('.nav-item[data-page="settings"]');
        if (fallback) fallback.click();
    }
}

function buildSidebarSettingsUI() {
    var grid = document.getElementById('sidebar-toggle-grid');
    if (!grid) return;
    var prefs = getEffectiveSidebarPrefs();

    grid.innerHTML = '';
    ALL_NAV_ITEMS.forEach(function (opt) {
        var isOn = prefs.indexOf(opt.page) !== -1;

        var card = document.createElement('label');
        card.className = 'sidebar-toggle-card' + (isOn ? ' is-on' : '');
        card.setAttribute('for', 'sidebar-toggle-' + opt.page);

        var iconWrap = document.createElement('div');
        iconWrap.className = 'sidebar-toggle-icon';
        iconWrap.innerHTML = '<span class="material-icons-round">' + opt.icon + '</span>';

        var labelSpan = document.createElement('span');
        labelSpan.className = 'sidebar-toggle-label';
        labelSpan.textContent = opt.label;

        if (opt.defaultOn) {
            var badge = document.createElement('span');
            badge.className = 'sidebar-toggle-default-badge';
            badge.textContent = 'Default';
            labelSpan.appendChild(document.createElement('br'));
            labelSpan.appendChild(badge);
        }

        var switchWrap = document.createElement('span');
        switchWrap.className = 'toggle-switch';
        switchWrap.innerHTML =
            '<input type="checkbox" id="sidebar-toggle-' + opt.page + '" data-page="' + opt.page + '"' + (isOn ? ' checked' : '') + '>' +
            '<span class="toggle-switch-track"></span>';

        card.appendChild(iconWrap);
        card.appendChild(labelSpan);
        card.appendChild(switchWrap);
        grid.appendChild(card);
    });

    grid.querySelectorAll('input[type="checkbox"]').forEach(function (checkbox) {
        checkbox.addEventListener('change', function () {
            var page = checkbox.getAttribute('data-page');
            var prefs = getEffectiveSidebarPrefs().slice();
            var idx = prefs.indexOf(page);
            if (checkbox.checked && idx === -1) prefs.push(page);
            if (!checkbox.checked && idx !== -1) prefs.splice(idx, 1);
            saveSidebarPrefs(prefs);
            applySidebarPrefs();
            checkbox.closest('.sidebar-toggle-card').classList.toggle('is-on', checkbox.checked);
        });
    });
}

function initSidebarCustomization() {
    applySidebarPrefs();
    buildSidebarSettingsUI();
}

// ---------------------------------------------------------------------------
// FORMA & DICE tracker forms (stored in the separate DICE/FORMA spreadsheet)
// ---------------------------------------------------------------------------
function currentSubmitter() {
    return getSession() || (document.getElementById('topbar-username') || {}).textContent || 'User';
}
window.currentSubmitter = currentSubmitter;

function clearTrackerErrors(form) {
    if (!form) return;
    form.querySelectorAll('.form-field, .po-field').forEach(function (field) { field.classList.remove('has-error'); });
}

function validateTrackerForm(form) {
    clearTrackerErrors(form);
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
        showToast('error', 'Required fields', 'Please complete all required fields with valid values.');
        return false;
    }
    return true;
}

function fileAsPayload(file) {
    return new Promise(function (resolve, reject) {
        if (file && file.size > 10 * 1024 * 1024) {
            var mb = (file.size / (1024 * 1024)).toFixed(1);
            return reject(new Error('File "' + file.name + '" is ' + mb + ' MB. Maximum allowed attachment size is 10 MB.'));
        }
        var reader = new FileReader();
        reader.onload = function () {
            var content = String(reader.result || '').split(',')[1] || '';
            resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', base64: content });
        };
        reader.onerror = function () { reject(new Error('Could not read "' + file.name + '".')); };
        reader.readAsDataURL(file);
    });
}

function postDiceForma(payload) {
    return fetch(DICE_FORMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    }).then(function (response) {
        if (!response.ok) throw new Error('The form server returned HTTP ' + response.status + '.');
        return response.json();
    }).then(function (result) {
        if (!result || !result.success) throw new Error((result && result.error) || 'The form server did not confirm the submission.');
        return result;
    });
}

function submitTrackerForm(form, type) {
    // 1. FAST ENGINE: 0.05s Instant Optimistic Submission via IndexedDB Outbox
    if (window.DiceFormaFastEngine && typeof window.DiceFormaFastEngine.submit === 'function') {
        window.DiceFormaFastEngine.submit(form, type);
        return;
    }

    // 2. Fallback Traditional Path:
    if (!validateTrackerForm(form)) return;
    var button = form.querySelector('[type="submit"]');
    var original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="material-icons-round">hourglass_top</span>Submitting...';

    var data = {};
    form.querySelectorAll('input:not([type="file"])').forEach(function (input) { data[input.name] = input.value.trim(); });
    data.submittedBy = currentSubmitter().trim();
    var fileInput = form.querySelector('[type="file"]');
    var files = fileInput ? Array.prototype.slice.call(fileInput.files || []) : [];

    Promise.all(files.map(fileAsPayload))
        .then(function (attachments) {
            return postDiceForma({ action: type === 'dice' ? 'submitDiceForm' : 'submitFormaForm', formData: data, attachments: attachments });
        })
        .then(function () {
            form.reset();
            clearTrackerErrors(form);
            showToast('success', 'Submitted', type === 'dice' ? 'Dice details have been submitted successfully.' : 'Forma details have been submitted successfully.');
        })
        .catch(function (err) {
            showToast('error', 'Submission failed', err && err.message ? err.message : 'Please check your internet connection and try again.');
        })
        .then(function () {
            button.disabled = false;
            button.innerHTML = original;
        });
}

function initDiceFormaForms() {
    var menu = document.getElementById('forma-dice-menu');
    var diceView = document.getElementById('dice-tracker-view');
    var formaView = document.getElementById('forma-tracker-view');
    function showView(view) {
        if (menu) menu.style.display = 'none';
        if (diceView) diceView.style.display = view === 'dice' ? '' : 'none';
        if (formaView) formaView.style.display = view === 'forma' ? '' : 'none';
    }
    var diceOpen = document.getElementById('open-dice-tracker');
    var formaOpen = document.getElementById('open-forma-tracker');
    if (diceOpen) diceOpen.addEventListener('click', function () { showView('dice'); });
    if (formaOpen) formaOpen.addEventListener('click', function () { showView('forma'); });
    document.querySelectorAll('[data-form-back]').forEach(function (button) {
        button.addEventListener('click', function () {
            if (menu) menu.style.display = '';
            if (diceView) diceView.style.display = 'none';
            if (formaView) formaView.style.display = 'none';
        });
    });
    var diceForm = document.getElementById('dice-tracker-form');
    var formaForm = document.getElementById('forma-tracker-form');
    if (diceForm) diceForm.addEventListener('submit', function (event) { event.preventDefault(); submitTrackerForm(diceForm, 'dice'); });
    if (formaForm) formaForm.addEventListener('submit', function (event) { event.preventDefault(); submitTrackerForm(formaForm, 'forma'); });
    initAttachmentDropzone('dice-attachment', 'dice-attachment-dropzone', 'dice-attachment-name');
    initAttachmentDropzone('forma-attachment', 'forma-attachment-dropzone', 'forma-attachment-name');
}

function initAttachmentDropzone(inputId, zoneId, nameId) {
    var input = document.getElementById(inputId);
    var zone = document.getElementById(zoneId);
    var name = document.getElementById(nameId);
    if (!input || !zone || !name) return;

    function update(files) {
        var count = files ? files.length : 0;
        name.textContent = count ? count + ' file' + (count > 1 ? 's' : '') + ' selected: ' + Array.prototype.map.call(files, function (file) { return file.name; }).join(', ') : 'No file selected';
        zone.classList.toggle('is-selected', !!count);
    }
    input.addEventListener('change', function () { update(input.files); });
    input.form.addEventListener('reset', function () { setTimeout(function () { update(input.files); }, 0); });
    ['dragenter', 'dragover'].forEach(function (eventName) {
        zone.addEventListener(eventName, function (event) { event.preventDefault(); zone.classList.add('is-dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (eventName) {
        zone.addEventListener(eventName, function (event) { event.preventDefault(); zone.classList.remove('is-dragover'); });
    });
    zone.addEventListener('drop', function (event) {
        if (event.dataTransfer && event.dataTransfer.files) {
            input.files = event.dataTransfer.files;
            update(input.files);
        }
    });
}

// ===========================================================================
// REPORTS â€” Submitted FMS Data
// ===========================================================================

var fmsTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},   // { colIndex: filterString }
    dateFrom:      '',   // YYYY-MM-DD string â€” filters on Created At (Timestamp)
    dateTo:        '',   // YYYY-MM-DD string â€” filters on Created At (Timestamp)
    period:        ''    // '' | 'fy' | 'quarter' | 'pre-quarter'
};

// ---------------------------------------------------------------------------
// Date helpers â€” all filtering is based on the "Timestamp" (Created At) column
// ---------------------------------------------------------------------------

/**
 * Return the column index of the "Timestamp" / "Created At" column.
 * After the virtual "Batch" column is prepended, rawHeaders[0]='Timestamp'
 * maps to fmsTableData.headers[1].
 */
function getCreatedAtColIndex() {
    var idx = -1;
    fmsTableData.headers.forEach(function (h, i) {
    var lh = h.trim().toLowerCase();
    if (lh === 'timestamp' || lh === 'created at' || lh === 'createdat') {
        idx = i;
    }
    });
    return idx;
}

/**
 * Parse a raw cell value from the Timestamp column into a Date object.
 * Handles JavaScript Date objects returned by GAS (already serialised as ISO
 * strings), DD/MM/YYYY, and any format that `new Date()` recognises.
 */
function parseCreatedAt(rawVal) {
    if (rawVal === null || rawVal === undefined || rawVal === '') return null;

    // Already a Date object (GAS returns objects sometimes)
    if (rawVal instanceof Date) {
    return isNaN(rawVal.getTime()) ? null : rawVal;
    }

    var s = String(rawVal).trim();
    if (!s) return null;

    // DD/MM/YYYY or DD/MM/YYYY HH:MM:SS
    var ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (ddmmyyyy) {
    var day   = parseInt(ddmmyyyy[1], 10);
    var mon   = parseInt(ddmmyyyy[2], 10) - 1;
    var yr    = parseInt(ddmmyyyy[3], 10);
    var hr    = parseInt(ddmmyyyy[4] || '0', 10);
    var mi    = parseInt(ddmmyyyy[5] || '0', 10);
    var sc    = parseInt(ddmmyyyy[6] || '0', 10);
    var d2 = new Date(yr, mon, day, hr, mi, sc);
    return isNaN(d2.getTime()) ? null : d2;
    }

    // Try native parse after DD/MM/YYYY so sheet-formatted dates stay correct.
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d;

    return null;
}

/**
 * Financial Year: April 1 (current FY year) â†’ March 31 (following year)
 * If today is Janâ€“Mar, the FY started in the previous calendar year.
 */
function getCurrentFYBounds() {
    var now = new Date();
    var m = now.getMonth(); // 0 = Jan â€¦ 11 = Dec
    var y = now.getFullYear();
    var fyYear = (m >= 3) ? y : y - 1; // April or later â†’ FY starts this year
    return {
    start: new Date(fyYear,     3,  1,  0,  0,  0,   0),   // 1 Apr
    end:   new Date(fyYear + 1, 2, 31, 23, 59, 59, 999)    // 31 Mar
    };
}

/**
 * Quarter for a given Date, based on Indian FY quarters:
 *   Q1 = Apr â€“ Jun
 *   Q2 = Jul â€“ Sep
 *   Q3 = Oct â€“ Dec
 *   Q4 = Jan â€“ Mar
 */
function getQuarterBounds(d) {
    var m = d.getMonth();
    var y = d.getFullYear();
    if (m >= 3 && m <= 5) {   // Q1: Aprâ€“Jun
    return { start: new Date(y, 3, 1, 0, 0, 0, 0), end: new Date(y, 5, 30, 23, 59, 59, 999) };
    }
    if (m >= 6 && m <= 8) {   // Q2: Julâ€“Sep
    return { start: new Date(y, 6, 1, 0, 0, 0, 0), end: new Date(y, 8, 30, 23, 59, 59, 999) };
    }
    if (m >= 9 && m <= 11) {  // Q3: Octâ€“Dec
    return { start: new Date(y, 9, 1, 0, 0, 0, 0), end: new Date(y, 11, 31, 23, 59, 59, 999) };
    }
    // Q4: Janâ€“Mar
    return { start: new Date(y, 0, 1, 0, 0, 0, 0), end: new Date(y, 2, 31, 23, 59, 59, 999) };
}

/**
 * Previous quarter relative to today.
 */
function getPrevQuarterBounds() {
    var now = new Date();
    var m = now.getMonth();
    var y = now.getFullYear();

    if (m >= 3 && m <= 5) {
    // Current: Q1 (Aprâ€“Jun) â†’ Previous: Q4 (Janâ€“Mar same year)
    return { start: new Date(y, 0, 1, 0, 0, 0, 0), end: new Date(y, 2, 31, 23, 59, 59, 999) };
    }
    if (m >= 6 && m <= 8) {
    // Current: Q2 (Julâ€“Sep) â†’ Previous: Q1 (Aprâ€“Jun same year)
    return { start: new Date(y, 3, 1, 0, 0, 0, 0), end: new Date(y, 5, 30, 23, 59, 59, 999) };
    }
    if (m >= 9 && m <= 11) {
    // Current: Q3 (Octâ€“Dec) â†’ Previous: Q2 (Julâ€“Sep same year)
    return { start: new Date(y, 6, 1, 0, 0, 0, 0), end: new Date(y, 8, 30, 23, 59, 59, 999) };
    }
    // Current: Q4 (Janâ€“Mar) â†’ Previous: Q3 (Octâ€“Dec last year)
    return { start: new Date(y - 1, 9, 1, 0, 0, 0, 0), end: new Date(y - 1, 11, 31, 23, 59, 59, 999) };
}

/**
 * Convert a Date object to a YYYY-MM-DD string suitable for
 * assigning to an <input type="date"> .value property.
 * Uses local calendar date (not UTC) so the displayed date matches
 * the bounds shown to the user.
 */
function dateToInputValue(d) {
    var yr  = d.getFullYear();
    var mo  = d.getMonth() + 1;
    var day = d.getDate();
    return yr + '-' + (mo  < 10 ? '0' + mo  : mo)
                + '-' + (day < 10 ? '0' + day : day);
}

/**
 * Return { start, end } bounds for a period key, or null for 'any'.
 * Centralises period â†’ bounds logic so initReports and applyFilters
 * always agree on the exact dates.
 */
function getBoundsForPeriod(periodVal) {
    if (periodVal === 'fy')          return getCurrentFYBounds();
    if (periodVal === 'quarter')     return getQuarterBounds(new Date());
    if (periodVal === 'pre-quarter') return getPrevQuarterBounds();
    return null;
}

// ---------------------------------------------------------------------------
// Show / hide reports sub-views
// ---------------------------------------------------------------------------
function showReportsKpiView() {
    REPORTS_ALL_VIEW_IDS.forEach(function (id) {
        var view = document.getElementById(id);
        if (view) view.style.display = id === 'reports-kpi-view' ? '' : 'none';
    });
    applyKpiCardAccess();
}

function showReportsFmsDataView() {
    // Delegated to SubmittedFmsSheetEngine (submitted_fms_sheet.js)
    if (window.SubmittedFmsSheetEngine && typeof window.SubmittedFmsSheetEngine.show === 'function') {
        window.SubmittedFmsSheetEngine.show();
    }
}

function showDiceSummaryView() {
    // Delegated to DiceDataSheetEngine (dice_data_sheet.js)
    if (window.DiceDataSheetEngine && typeof window.DiceDataSheetEngine.show === 'function') {
        window.DiceDataSheetEngine.show();
    }
}

function showFormaSummaryView() {
    // Delegated to FormaDataSheetEngine (forma_data_sheet.js)
    if (window.FormaDataSheetEngine && typeof window.FormaDataSheetEngine.show === 'function') {
        window.FormaDataSheetEngine.show();
    }
}

function showDomesticFormDataView() {
    // Delegated to DomesticFormDataSheetEngine (domestic_form_data_sheet.js)
    if (window.DomesticFormDataSheetEngine && typeof window.DomesticFormDataSheetEngine.show === 'function') {
        window.DomesticFormDataSheetEngine.show();
    }
}

function showImportFormDataView() {
    // Delegated to ImportFormDataSheetEngine (import_form_data_sheet.js)
    if (window.ImportFormDataSheetEngine && typeof window.ImportFormDataSheetEngine.show === 'function') {
        window.ImportFormDataSheetEngine.show();
    }
}

function showTrioAiDataView() {
    // Delegated to TrioAiDataSheetEngine (trio_ai_data_sheet.js)
    if (window.TrioAiDataSheetEngine && typeof window.TrioAiDataSheetEngine.show === 'function') {
        window.TrioAiDataSheetEngine.show();
    }
}

// ===========================================================================
// Tracker Summaries — Dice Data Summary / Forma Data Summary
//
// Same table structure, layout, filters, sorting, pagination, date range
// filter, and Excel export as the Production Data sub-views (e.g. Batch
// Cutting Details). Data is pulled from the separate DICE_FORMA web app
// instead of google.script.run.
// ===========================================================================

var diceSummaryTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    selectedCells: new Set(),
    activeCol:     null,
    activeOrder:   null,
    pageSize:      50,
    currentPage:   1
};

var formaSummaryTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    selectedCells: new Set(),
    activeCol:     null,
    activeOrder:   null,
    pageSize:      50,
    currentPage:   1
};

var domesticPurchaseSummaryTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    selectedCells: new Set(),
    activeCol:     null,
    activeOrder:   null,
    pageSize:      50,
    currentPage:   1
};

var importPurchaseSummaryTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    selectedCells: new Set(),
    activeCol:     null,
    activeOrder:   null,
    pageSize:      50,
    currentPage:   1
};

function getTrackerSummaryConfig(type) {
    if (type === 'dice')     return { viewId: 'reports-dice-summary-view',       prefix: 'dice-summary',       sheet: 'dice' };
    if (type === 'forma')    return { viewId: 'reports-forma-summary-view',      prefix: 'forma-summary',      sheet: 'forma' };
    if (type === 'domestic') return { viewId: 'reports-domestic-purchase-view', prefix: 'domestic-purchase',  sheet: 'domestic' };
    if (type === 'import')   return { viewId: 'reports-import-purchase-view',   prefix: 'import-purchase',    sheet: 'import' };
    return                          { viewId: 'reports-forma-summary-view',      prefix: 'forma-summary',      sheet: 'forma' };
}

function getTrackerSummaryState(type) {
    if (type === 'dice')     return diceSummaryTableData;
    if (type === 'forma')    return formaSummaryTableData;
    if (type === 'domestic') return domesticPurchaseSummaryTableData;
    if (type === 'import')   return importPurchaseSummaryTableData;
    return formaSummaryTableData;
}

// All report sub-view container ids that live inside the Reports page. Used
// by showReportsKpiView / showReportsFmsDataView / showTrackerSummary to
// keep exactly one sub-view visible at a time.
var REPORTS_ALL_VIEW_IDS = [
    'reports-kpi-view', 'reports-fms-data-view',
    'reports-dice-summary-view', 'reports-forma-summary-view',
    'reports-domestic-purchase-view', 'reports-import-purchase-view',
    'reports-trio-ai-data-view'
];

// Column index 0 ("Timestamp") is the date-filter column for both sheets.
function getTrackerSummaryDateColIndex() { return 0; }

function showTrackerSummary(type) {
    if (type === 'dice') {
        showDiceSummaryView();
        return;
    }
    if (type === 'forma') {
        showFormaSummaryView();
        return;
    }
    if (type === 'domestic') {
        showDomesticFormDataView();
        return;
    }
    if (type === 'import') {
        showImportFormDataView();
        return;
    }
    if (type === 'trio' || type === 'trio-ai') {
        showTrioAiDataView();
        return;
    }
    var config = getTrackerSummaryConfig(type);
    REPORTS_ALL_VIEW_IDS.forEach(function (id) {
        var view = document.getElementById(id);
        if (view) view.style.display = id === config.viewId ? '' : 'none';
    });

    var state = getTrackerSummaryState(type);
    if (state.allRows.length === 0) {
        fetchTrackerSummary(type);
    } else {
        renderTrackerSummaryTable(type);
    }
}

function fetchTrackerSummary(type) {
    var config = getTrackerSummaryConfig(type);
    var prefix = config.prefix;
    var emptyEl  = document.getElementById(prefix + '-empty');
    var tableEl  = document.getElementById(prefix + '-table');
    var footerEl = document.getElementById(prefix + '-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading dataâ€¦'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching ' + config.label + ' dataâ€¦');

    fetch((config.baseUrl || DICE_FORMA_URL) + '?action=' + encodeURIComponent(config.action) + '&_=' + Date.now())
        .then(function (response) {
            if (!response.ok) throw new Error('The form server returned HTTP ' + response.status + '.');
            return response.json();
        })
        .then(function (result) {
            hideSpinner();
            if (!result || !result.success) throw new Error((result && result.error) || 'Could not load data.');
            if (!Array.isArray(result.headers) || !Array.isArray(result.rows)) {
                throw new Error('The web app needs to be redeployed with the latest summary code.');
            }
            onTrackerSummaryLoaded(type, result);
        })
        .catch(function (err) {
            hideSpinner();
            onTrackerSummaryError(type, err.message || 'Could not load data.');
        });
}

function onTrackerSummaryLoaded(type, result) {
    var config = getTrackerSummaryConfig(type);
    var prefix = config.prefix;
    var state  = getTrackerSummaryState(type);

    state.headers       = result.headers || [];
    state.allRows       = result.rows    || [];
    state.filteredRows  = state.allRows.slice();
    state.sortCol       = -1;
    state.sortAsc       = true;
    state.page          = 1;
    state.searchQuery    = '';
    state.columnFilters = {};
    state.dateFrom       = '';
    state.dateTo         = '';

    var searchEl = document.getElementById(prefix + '-search');
    if (searchEl) searchEl.value = '';
    updateTrackerSummarySearchClearBtn(type);

    var dFrom = document.getElementById(prefix + '-date-from');
    var dTo   = document.getElementById(prefix + '-date-to');
    if (dFrom) dFrom.value = '';
    if (dTo)   dTo.value   = '';
    updateTrackerSummaryDateClearBtn(type);

    buildTrackerSummaryTableHeaders(type);
    renderTrackerSummaryTable(type);
}

function onTrackerSummaryError(type, msg) {
    var config = getTrackerSummaryConfig(type);
    var prefix = config.prefix;
    var emptyEl = document.getElementById(prefix + '-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById(prefix + '-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById(prefix + '-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', config.label + ' Data Error', msg);
}

function buildTrackerSummaryTableHeaders(type) {
    var config = getTrackerSummaryConfig(type);
    var prefix = config.prefix;
    var state  = getTrackerSummaryState(type);
    var thead  = document.getElementById(prefix + '-thead');
    if (!thead) return;
    thead.innerHTML = '';

    // Label row
    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    state.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-' + prefix + '-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onTrackerSummarySortColumn(type, i); });
        trHead.appendChild(th);
    });

    // Per-column filter row
    var trFilter    = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);
    state.headers.forEach(function (h, i) {
        var th       = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap     = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input    = document.createElement('input');
        input.type        = 'text';
        input.className   = 'dt-col-filter';
        input.placeholder = 'Filterâ€¦';
        input.value       = state.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className    = 'dt-col-filter-clear';
        clearBtn.title        = 'Clear filter';
        clearBtn.innerHTML    = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            state.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyTrackerSummaryFilters(type);
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            state.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyTrackerSummaryFilters(type);
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onTrackerSummarySortColumn(type, colIndex) {
    var state = getTrackerSummaryState(type);
    if (state.sortCol === colIndex) {
        state.sortAsc = !state.sortAsc;
    } else {
        state.sortCol = colIndex;
        state.sortAsc = true;
    }
    updateTrackerSummarySortIcons(type);
    applyTrackerSummaryFilters(type);
}

function updateTrackerSummarySortIcons(type) {
    var config = getTrackerSummaryConfig(type);
    var state  = getTrackerSummaryState(type);
    document.querySelectorAll('[data-' + config.prefix + '-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-' + config.prefix + '-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === state.sortCol) {
            icon.textContent = state.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function updateTrackerSummaryDateClearBtn(type) {
    var config = getTrackerSummaryConfig(type);
    var state  = getTrackerSummaryState(type);
    var clearBtn = document.getElementById(config.prefix + '-date-clear');
    if (!clearBtn) return;
    clearBtn.style.display = (state.dateFrom || state.dateTo) ? '' : 'none';
}

function applyTrackerSummaryFilters(type) {
    var state      = getTrackerSummaryState(type);
    var query      = state.searchQuery;
    var colFilters = state.columnFilters;
    var dateColIdx = getTrackerSummaryDateColIndex();

    var dateFrom = state.dateFrom ? new Date(state.dateFrom + 'T00:00:00') : null;
    var dateTo   = state.dateTo   ? new Date(state.dateTo   + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    state.filteredRows = state.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0) {
            var rawDate = row[dateColIdx];
            var parsed  = parseCreatedAt(rawDate);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (state.sortCol >= 0) {
        var sc = state.sortCol;
        state.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return state.sortAsc ? cmp : -cmp;
        });
    }
    state.page = 1;
    renderTrackerSummaryTable(type);
}

function applyTrackerSummarySearch(type, query) {
    var state = getTrackerSummaryState(type);
    state.searchQuery = (query || '').trim().toLowerCase();
    applyTrackerSummaryFilters(type);
}

// Renders a cell's value â€” attachment links (URLs) become clickable links,
// everything else is plain text with the active search term highlighted.
function renderTrackerSummaryCellValue(td, cellVal, searchQuery, isAttachmentColumn) {
    if (isAttachmentColumn && /^https?:\/\//i.test(cellVal)) {
        var previews = document.createElement('div');
        previews.className = 'tracker-attachment-previews';
        cellVal.split(/\r?\n/).filter(Boolean).forEach(function (url, linkIndex) {
            var link = document.createElement('a');
            var fileIdMatch = url.match(/\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&#]+)/);
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = 'Open attachment';

            var image = document.createElement('img');
            image.className = 'tracker-attachment-preview';
            image.alt = 'Attachment ' + (linkIndex + 1);
            image.loading = 'lazy';
            image.src = fileIdMatch
                ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileIdMatch[1]) + '&sz=w240'
                : url;
            image.onerror = function () {
                this.style.display = 'none';
                link.classList.add('tracker-attachment-preview-unavailable');
                link.textContent = 'Open attachment';
            };
            link.appendChild(image);
            previews.appendChild(link);
        });
        td.appendChild(previews);
        return;
    }
    if (searchQuery && cellVal.toLowerCase().indexOf(searchQuery) !== -1) {
        td.innerHTML = esc(cellVal).replace(
            new RegExp(escapeRegex(esc(searchQuery)), 'gi'),
            '<mark class="dt-highlight">$&</mark>'
        );
    } else {
        td.textContent = cellVal;
    }
}

function renderTrackerSummaryTable(type) {
    var config = getTrackerSummaryConfig(type);
    var prefix = config.prefix;
    var state  = getTrackerSummaryState(type);

    var tbody      = document.getElementById(prefix + '-tbody');
    var tableEl    = document.getElementById(prefix + '-table');
    var emptyEl    = document.getElementById(prefix + '-empty');
    var footerEl   = document.getElementById(prefix + '-footer');
    var countBadge = document.getElementById(prefix + '-count-badge');
    if (!tbody) return;

    var total      = state.filteredRows.length;
    var pageSize   = state.pageSize;
    var page       = state.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    state.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = state.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', state.headers.length + 1);
        var hasFilter = Object.keys(state.columnFilters).some(function (k) {
            return (state.columnFilters[k] || '').trim() !== '';
        });
        tdEmpty.innerHTML = '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (state.searchQuery || hasFilter
                ? 'No records match the current filter.'
                : (state.allRows.length === 0 ? 'No data found in ' + config.emptyLabel + '.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById(prefix + '-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        state.headers.forEach(function (header, ci) {
            var td  = document.createElement('td');
            var isAttachmentColumn = /attachment/i.test(header);
            td.className = 'dt-td' + (isAttachmentColumn ? ' tracker-attachment-cell' : '');
            var cellVal  = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            renderTrackerSummaryCellValue(td, cellVal, state.searchQuery, isAttachmentColumn);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById(prefix + '-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (state.allRows.length !== total ? ' (filtered from ' + state.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildTrackerSummaryPagination(type, page, totalPages);
}

function buildTrackerSummaryPagination(type, current, total) {
    var config    = getTrackerSummaryConfig(type);
    var state     = getTrackerSummaryState(type);
    var container = document.getElementById(config.prefix + '-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                state.page = page;
                renderTrackerSummaryTable(type);
                var wrap = document.getElementById(config.prefix + '-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === 'â€¦') {
            var el = document.createElement('span');
            el.className   = 'dt-page-ellipsis';
            el.textContent = 'â€¦';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function updateTrackerSummarySearchClearBtn(type) {
    var config   = getTrackerSummaryConfig(type);
    var searchEl = document.getElementById(config.prefix + '-search');
    var clearBtn = document.getElementById(config.prefix + '-search-clear');
    if (!searchEl || !clearBtn) return;
    clearBtn.style.display = searchEl.value ? '' : 'none';
}

var excelJsLoadPromise;

function loadExcelJs() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (excelJsLoadPromise) return excelJsLoadPromise;
    excelJsLoadPromise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        script.onload = function () { window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('Excel export library did not load.')); };
        script.onerror = function () { reject(new Error('Could not load the Excel export library.')); };
        document.head.appendChild(script);
    });
    return excelJsLoadPromise;
}

function getDriveFileId(url) {
    var match = String(url || '').match(/\/d\/([^/?#]+)/) || String(url || '').match(/[?&]id=([^&#]+)/);
    return match ? match[1] : '';
}

function fetchTrackerAttachmentImages(fileIds) {
    if (!fileIds.length) return Promise.resolve({});
    return fetch(DICE_FORMA_URL + '?action=getAttachmentImages&ids=' + encodeURIComponent(fileIds.join(',')))
        .then(function (response) {
            if (!response.ok) throw new Error('Could not fetch attachment images.');
            return response.json();
        })
        .then(function (result) {
            if (!result || !result.success) throw new Error((result && result.error) || 'Could not fetch attachment images.');
            return (result.images || []).reduce(function (images, image) {
                images[image.id] = image;
                return images;
            }, {});
        });
}

// ---------------------------------------------------------------------------
// Shared helper â€” builds a true .xlsx workbook (via ExcelJS) from a headers/
// rows table and triggers the download. Used by every "Download Excel"
// button in the app so all exports are real .xlsx files (not SpreadsheetML
// .xls files renamed with an .xlsx-looking name).
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Hex fill/text colors mirroring the on-screen conditional row-coloring CSS
// (see the dt-tr-flag-*, dt-tr-status-* and dt-tr-machine-* rules in
// style.css). Exported via window.FMS so main.js/web.js can build an
// exportRowsToXlsx({ rowColor: ... }) function that recreates the exact same
// colors inside the downloaded .xlsx.
// ---------------------------------------------------------------------------
var EXCEL_ROW_STATUS_COLORS = {
    'flag-red':           { bg: 'FDE2E1', fg: '7F1D1D' },
    'flag-green':         { bg: 'DCF5E0', fg: '14532D' },
    'status-deep-green':  { bg: '1B5E20', fg: 'FFFFFF' },
    'status-green':       { bg: '2E7D32', fg: 'FFFFFF' },
    'status-light-green': { bg: 'A5D6A7', fg: '1B5E20' },
    'status-yellow':      { bg: 'FFEB3B', fg: '5C4A00' },
    'status-orange':      { bg: 'FF9800', fg: 'FFFFFF' },
    'status-red':         { bg: 'F44336', fg: 'FFFFFF' },
    'machine-major-problem': { bg: 'FFCDD2', fg: '000000' },
    'machine-minor-problem': { bg: 'FFE0B2', fg: '000000' },
    'machine-usual-repair':  { bg: 'FFF9C4', fg: '000000' },
    'machine-audit-purpose': { bg: 'BBDEFB', fg: '000000' },
    'machine-breakdown':     { bg: 'B71C1C', fg: 'FFFFFF' },
    'machine-install':       { bg: 'C8E6C9', fg: '000000' },
    'machine-preventive':    { bg: '9C27B0', fg: 'FFFFFF' }
};
function excelRowColor_(key) {
    return EXCEL_ROW_STATUS_COLORS[key] || null;
}

function exportRowsToXlsx(options) {
    var headers         = options.headers || [];
    var rows            = options.rows || [];
    var sheetName       = options.sheetName || 'Sheet1';
    var filenamePrefix  = options.filenamePrefix || 'Export';
    var headerGroups    = options.headerGroups || [];
    var useFormatCellValue = !!options.useFormatCellValue;
    // Optional: function(row, headers) -> { bg: 'RRGGBB', fg: 'RRGGBB' } | null
    // Lets a caller reproduce the same conditional row-coloring shown on
    // screen (e.g. OT & Leave Analysis flagged rows, Machine service-type
    // colors, Store/Pre-Prod status colors) inside the exported .xlsx.
    var rowColor        = typeof options.rowColor === 'function' ? options.rowColor : null;

    if (!headers.length && !rows.length) { showToast('info', 'No Data', 'There is no data to export.'); return Promise.resolve(); }

    var EXCEL_FONT_NAME  = 'Calibri';
    var HEADER_FILL_ARGB = 'FF1F4E78'; // deep blue
    var border      = { style: 'thin', color: { argb: 'FF000000' } };
    var groupBorder = { style: 'thin', color: { argb: 'FF000000' } };

    return loadExcelJs().then(function (ExcelJS) {
        var workbook  = new ExcelJS.Workbook();
        var worksheet = workbook.addWorksheet(sheetName);

        worksheet.columns = [{ width: 6 }].concat(headers.map(function () { return { width: 20 }; }));

        // Optional merged group-header rows (e.g. Floor Supervisor QC column groups)
        headerGroups.forEach(function (groupRow, rowIndex) {
            var excelRow  = worksheet.addRow([rowIndex === 0 ? '#' : '']);
            excelRow.height = 28;

            var cornerCell = excelRow.getCell(1);
            cornerCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
            cornerCell.border    = { top: groupBorder, left: groupBorder, bottom: groupBorder, right: groupBorder };
            cornerCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
            cornerCell.font      = { name: EXCEL_FONT_NAME, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };

            var col = 2;
            groupRow.forEach(function (group) {
                var span     = Math.max(parseInt(group.colspan, 10) || 1, 1);
                var startCol = col;
                var endCol   = col + span - 1;
                var cell     = excelRow.getCell(startCol);
                cell.value = group.label || '';
                if (span > 1) worksheet.mergeCells(excelRow.number, startCol, excelRow.number, endCol);
                for (var c = startCol; c <= endCol; c++) {
                    var mergedCell = excelRow.getCell(c);
                    mergedCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
                    mergedCell.border    = { top: groupBorder, left: groupBorder, bottom: groupBorder, right: groupBorder };
                    mergedCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
                    mergedCell.font      = { name: EXCEL_FONT_NAME, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                }
                col = endCol + 1;
            });
        });

        // Header row
        var headerRow = worksheet.addRow(['#'].concat(headers));
        headerRow.height = 22;
        headerRow.eachCell(function (cell) {
            cell.font      = { name: EXCEL_FONT_NAME, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
            cell.border    = { top: border, left: border, bottom: border, right: border };
        });

        // Data rows
        rows.forEach(function (row, idx) {
            var exportedRow = [idx + 1].concat(headers.map(function (header, ci) {
                var raw = row[ci];
                return useFormatCellValue ? formatCellValue(header, raw) : String(raw !== undefined && raw !== null ? raw : '');
            }));
            var excelRow  = worksheet.addRow(exportedRow);
            var colorMatch = rowColor ? rowColor(row, headers) : null;
            excelRow.height = 18;
            excelRow.eachCell(function (cell, colNumber) {
                var isRowNumCol = colNumber === 1;
                cell.alignment = { vertical: 'middle', wrapText: false, horizontal: isRowNumCol ? 'center' : undefined };
                cell.border    = { top: border, left: border, bottom: border, right: border };

                if (colorMatch) {
                    // Matches the on-screen conditional-formatting color for
                    // this row (same background across every cell, including
                    // the row-number column, same as the .dt-tr-* CSS rules).
                    cell.font = { name: EXCEL_FONT_NAME, size: 9, color: { argb: 'FF' + colorMatch.fg } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + colorMatch.bg } };
                    if (isRowNumCol) return;
                } else if (isRowNumCol) {
                    cell.font = { name: EXCEL_FONT_NAME, size: 9, color: { argb: 'FF94A3B8' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                    return;
                } else {
                    cell.font = { name: EXCEL_FONT_NAME, size: 9 };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };
                }

                // Batch ID and other zero-padded values must stay text to preserve leading zeros
                var header      = headers[colNumber - 2];
                var h            = (header || '').trim().toLowerCase();
                var forceString  = useFormatCellValue && h === 'batch id';
                var val          = cell.value;
                var num          = Number(val);
                var isNum        = !forceString && val !== '' && val !== null && val !== undefined && !isNaN(num) && isFinite(num);
                if (isNum) cell.value = num;
            });
        });

        return workbook.xlsx.writeBuffer();
    }).then(function (buffer) {
        var now      = new Date();
        var pad      = function (n) { return n < 10 ? '0' + n : '' + n; };
        var filename = filenamePrefix + '_' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '.xlsx';
        var blob     = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var url      = URL.createObjectURL(blob);
        var anchor   = document.createElement('a');
        anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
        document.body.appendChild(anchor); anchor.click();
        setTimeout(function () { URL.revokeObjectURL(url); document.body.removeChild(anchor); }, 300);
        showToast('success', 'Download Started', rows.length + ' row' + (rows.length !== 1 ? 's' : '') + ' exported to ' + filename);
    }).catch(function (err) {
        showToast('error', 'Excel Download Failed', err && err.message ? err.message : 'Could not create the Excel file.');
    });
}

function downloadTrackerSummaryExcel(type) {
    var config  = getTrackerSummaryConfig(type);
    var state   = getTrackerSummaryState(type);
    var headers = state.headers;
    var rows    = state.filteredRows;
    if (!headers.length && !rows.length) { showToast('info', 'No Data', 'There is no data to export.'); return; }
    var attachmentColumns = headers.map(function (header, index) { return /attachment/i.test(header) ? index : -1; }).filter(function (index) { return index >= 0; });
    var fileIds = {};
    rows.forEach(function (row) {
        attachmentColumns.forEach(function (columnIndex) {
            String(row[columnIndex] || '').split(/\r?\n/).forEach(function (url) {
                var fileId = getDriveFileId(url);
                if (fileId) fileIds[fileId] = true;
            });
        });
    });
    showToast('info', 'Preparing Excel', 'Adding attachment images to the workbook...');
    Promise.all([loadExcelJs(), fetchTrackerAttachmentImages(Object.keys(fileIds))])
        .then(function (results) {
            var ExcelJS = results[0];
            var images = results[1];
            var EXCEL_FONT_NAME  = 'Calibri';
            var HEADER_FILL_ARGB = 'FF1F4E78'; // deep blue
            var workbook = new ExcelJS.Workbook();
            var worksheet = workbook.addWorksheet(config.excelSheetName);
            var border = { style: 'thin', color: { argb: 'FF000000' } };
            worksheet.columns = [{ width: 6 }].concat(headers.map(function (header) { return { width: /attachment/i.test(header) ? 38 : 20 }; }));
            worksheet.addRow(['#'].concat(headers));
            worksheet.getRow(1).height = 24;
            worksheet.getRow(1).eachCell(function (cell) {
                cell.font = { name: EXCEL_FONT_NAME, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
                cell.border = { top: border, left: border, bottom: border, right: border };
            });
            rows.forEach(function (row, rowIndex) {
                var exportedRow = [rowIndex + 1].concat(headers.map(function (header, columnIndex) {
                    var value = String(row[columnIndex] !== undefined && row[columnIndex] !== null ? row[columnIndex] : '');
                    return /attachment/i.test(header) ? '' : value;
                }));
                var excelRow = worksheet.addRow(exportedRow);
                var attachmentCount = 0;
                attachmentColumns.forEach(function (columnIndex) {
                    attachmentCount = Math.max(attachmentCount, String(row[columnIndex] || '').split(/\r?\n/).filter(Boolean).length);
                });
                var attachmentImageRows = Math.ceil(attachmentCount / 2);
                excelRow.height = attachmentCount ? attachmentImageRows * 68 + 8 : 20;
                excelRow.eachCell(function (cell) {
                    cell.font = { name: EXCEL_FONT_NAME, size: 9 };
                    cell.alignment = { vertical: 'middle', wrapText: false };
                    cell.border = { top: border, left: border, bottom: border, right: border };
                    if (rowIndex % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                });
                attachmentColumns.forEach(function (columnIndex) {
                    var urls = String(row[columnIndex] || '').split(/\r?\n/).filter(Boolean);
                    var cell = excelRow.getCell(columnIndex + 2);
                    urls.forEach(function (url, imageIndex) {
                        var image = images[getDriveFileId(url)];
                        if (!image) {
                            if (!cell.value) cell.value = { text: 'Open attachment', hyperlink: url };
                            return;
                        }
                        var imageId = workbook.addImage({ base64: image.base64, extension: image.mimeType === 'image/png' ? 'png' : 'jpeg' });
                        worksheet.addImage(imageId, {
                            tl: {
                                col: columnIndex + 1.08 + (imageIndex % 2) * 0.51,
                                row: rowIndex + 1 + (Math.floor(imageIndex / 2) / Math.max(Math.ceil(urls.length / 2), 1))
                            },
                            ext: { width: 112, height: 76 },
                            editAs: 'oneCell'
                        });
                    });
                });
            });
            return workbook.xlsx.writeBuffer();
        })
        .then(function (buffer) {
            var now = new Date();
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            var filename = config.excelFilePrefix + '_' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '.xlsx';
            var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            var url = URL.createObjectURL(blob);
            var anchor = document.createElement('a');
            anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
            document.body.appendChild(anchor); anchor.click();
            setTimeout(function () { URL.revokeObjectURL(url); document.body.removeChild(anchor); }, 300);
            showToast('success', 'Download Started', rows.length + ' row' + (rows.length !== 1 ? 's' : '') + ' exported to ' + filename);
        })
        .catch(function (err) {
            showToast('error', 'Excel Download Failed', err && err.message ? err.message : 'Could not create the Excel file.');
        });
}

// ---------------------------------------------------------------------------
// SUBMITTED FMS DATA â€” INDEXEDDB & FAST GOOGLE SHEETS CSV ENGINE
// Sheet: 'FMS DATA' (gid=1929624562)
// Columns: A to R, with Column C (Batch ID) placed 1st
// ---------------------------------------------------------------------------

var FMS_SUBMITTED_DB_NAME    = 'FMS_Submitted_Data_DB';
var FMS_SUBMITTED_DB_VERSION = 1;
var FMS_SHEET_ID             = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
var FMS_SHEET_GID            = '1929624562';
var FMS_CSV_URL              = 'https://docs.google.com/spreadsheets/d/' + FMS_SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + FMS_SHEET_GID;

// Columns A through R with Column C placed 1st:
// 2(C: Batch ID), 0(A: Created at), 1(B: Created By), 3(D: Leather Received date),
// 4(E: Unit), 5(F: Fabricator Name), 6(G: Brand), 7(H: Season), 8(I: Category),
// 9(J: SKU), 10(K: Style), 11(L: Color), 12(M: Quantity), 13(N: ETD),
// 14(O: PO as per Buyer), 15(P: Floor Supervisor Name), 16(Q: In-Line QC Name), 17(R: Production Days)
var FMS_COL_ORDER = [2, 0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

var fmsSubmittedDbInstance = null;
var isFmsSyncing = false;

function openSubmittedFmsDb() {
    return new Promise(function (resolve, reject) {
        if (fmsSubmittedDbInstance) return resolve(fmsSubmittedDbInstance);
        if (!window.indexedDB) {
            return reject(new Error('IndexedDB is not supported in this browser.'));
        }
        var req = indexedDB.open(FMS_SUBMITTED_DB_NAME, FMS_SUBMITTED_DB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(FMS_SUBMITTED_STORE_NAME)) {
                db.createObjectStore(FMS_SUBMITTED_STORE_NAME);
            }
        };
        req.onsuccess = function (e) {
            fmsSubmittedDbInstance = e.target.result;
            resolve(fmsSubmittedDbInstance);
        };
        req.onerror = function (e) {
            reject(e.target.error || new Error('Failed to open Database'));
        };
    });
}

function saveSubmittedFmsToDb(headers, rows, lastSync) {
    return openSubmittedFmsDb().then(function (db) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(FMS_SUBMITTED_STORE_NAME, 'readwrite');
            var store = tx.objectStore(FMS_SUBMITTED_STORE_NAME);
            store.put(headers, 'headers');
            store.put(rows, 'rows');
            store.put(lastSync || new Date().toISOString(), 'last_sync');
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function (e) { reject(e.target.error); };
        });
    });
}

function loadSubmittedFmsFromDb() {
    return openSubmittedFmsDb().then(function (db) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(FMS_SUBMITTED_STORE_NAME, 'readonly');
            var store = tx.objectStore(FMS_SUBMITTED_STORE_NAME);
            var reqHeaders = store.get('headers');
            var reqRows = store.get('rows');
            var reqSync = store.get('last_sync');

            tx.oncomplete = function () {
                if (reqRows.result && Array.isArray(reqRows.result) && reqRows.result.length > 0) {
                    resolve({
                        headers: reqHeaders.result || [],
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

function parseFmsCsvToRows(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;

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
                if (curRow.length > 0) rows.push(curRow);
                curRow = [];
            } else if (c === '\n') {
                curRow.push(curVal.trim());
                curVal = '';
                if (curRow.length > 0) rows.push(curRow);
                curRow = [];
            } else {
                curVal += c;
            }
        }
    }
    if (curVal || curRow.length) {
        curRow.push(curVal.trim());
        if (curRow.length > 0) rows.push(curRow);
    }
    return rows;
}

function processSubmittedFmsCsv(rawCsvText) {
    var allParsedRows = parseFmsCsvToRows(rawCsvText);
    if (!allParsedRows || allParsedRows.length < 1) {
        throw new Error('No data received from Google Sheet.');
    }

    var rawHeaders = allParsedRows[0] || [];
    var defaultHeaders = [
        'Batch ID', 'Created at', 'Created By', 'Leather Received date',
        'Unit', 'Fabricator Name', 'Brand', 'Season', 'Category',
        'SKU', 'Style', 'Color', 'Quantity', 'ETD',
        'PO as per Buyer', 'Floor Supervisor Name', 'In-Line QC Name', 'Production Days'
    ];

    var headers = FMS_COL_ORDER.map(function (idx, i) {
        var h = (rawHeaders[idx] || '').trim();
        return h || defaultHeaders[i];
    });

    var rows = [];
    for (var i = 1; i < allParsedRows.length; i++) {
        var rawRow = allParsedRows[i];
        if (!rawRow || rawRow.length === 0) continue;

        var batchVal = (rawRow[2] || '').trim();
        var createdAtVal = (rawRow[0] || '').trim();
        if (!batchVal && !createdAtVal) continue;

        var mappedRow = FMS_COL_ORDER.map(function (idx) {
            return (rawRow[idx] !== undefined && rawRow[idx] !== null) ? String(rawRow[idx]).trim() : '';
        });
        rows.push(mappedRow);
    }

    return {
        headers: headers,
        rows: rows
    };
}

function updateFmsDbBadge(isReady, lastSync) {
    var badge = document.getElementById('fms-data-db-badge');
    if (!badge) return;
    if (isReady) {
        badge.style.display = 'inline-flex';
        badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;color:#0284c7;">bolt</span> Database Ready';
        if (lastSync) {
            try {
                badge.title = 'Database synchronized: ' + new Date(lastSync).toLocaleTimeString();
            } catch (e) {}
        }
    } else {
        badge.innerHTML = '<span class="material-icons-round" style="font-size:13px;color:#f59e0b;">sync</span> Syncing Databaseâ€¦';
    }
}

function applyLoadedFmsData(headers, rows, resetFilters) {
    fmsTableData.headers      = headers;
    fmsTableData.allRows      = rows;
    fmsTableData.filteredRows = rows.slice();

    if (resetFilters) {
        fmsTableData.sortCol       = -1;
        fmsTableData.sortAsc       = true;
        fmsTableData.page          = 1;
        fmsTableData.searchQuery   = '';
        fmsTableData.columnFilters = {};
        fmsTableData.dateFrom      = '';
        fmsTableData.dateTo        = '';
        fmsTableData.period        = '';

        var searchEl = document.getElementById('fms-data-search');
        if (searchEl) searchEl.value = '';
        updateSearchClearBtn();

        var dateFromEl = document.getElementById('fms-date-from');
        if (dateFromEl) dateFromEl.value = '';
        var dateToEl = document.getElementById('fms-date-to');
        if (dateToEl) dateToEl.value = '';
        updateDateClearBtn();

        var periodEl = document.getElementById('fms-period-filter');
        if (periodEl) periodEl.value = '';

        buildFmsTableHeaders();
        renderFmsTable();
    } else {
        buildFmsTableHeaders();
        applyFilters();
    }
}

function fetchFmsDataAndRender(isForceRefresh) {
    var emptyEl  = document.getElementById('fms-data-empty');
    var tableEl  = document.getElementById('fms-data-table');
    var footerEl = document.getElementById('fms-data-footer');

    // 1. If data is already in memory and not a forced refresh, render immediately
    if (!isForceRefresh && fmsTableData.allRows.length > 0) {
        renderFmsTable();
        // Silent background check to ensure cache is fresh
        fetchFromGoogleSheetGviz(true);
        return;
    }

    // 2. Try instant 0-wait loading from Database cache first
    if (!isForceRefresh) {
        loadSubmittedFmsFromDb().then(function (cached) {
            if (cached && cached.rows && cached.rows.length > 0) {
                console.log('[Submitted FMS Data] Instant load from Database cache: ' + cached.rows.length + ' rows');
                applyLoadedFmsData(cached.headers, cached.rows, false);
                updateFmsDbBadge(true, cached.lastSync);
                // Background refresh
                fetchFromGoogleSheetGviz(true);
                return;
            }
            // If cache empty, fetch from Google Sheets
            fetchFromGoogleSheetGviz(false);
        }).catch(function (err) {
            console.warn('[Submitted FMS Data] Database read error, fetching from network:', err);
            fetchFromGoogleSheetGviz(false);
        });
        return;
    }

    // 3. Forced refresh requested by user
    fetchFromGoogleSheetGviz(false);
}

function fetchFromGoogleSheetGviz(isBackground) {
    if (isFmsSyncing) return;
    isFmsSyncing = true;

    var emptyEl  = document.getElementById('fms-data-empty');
    var tableEl  = document.getElementById('fms-data-table');
    var footerEl = document.getElementById('fms-data-footer');

    if (!isBackground) {
        if (fmsTableData.allRows.length === 0) {
            if (emptyEl) { emptyEl.querySelector('p').textContent = 'Loading dataâ€¦'; emptyEl.style.display = ''; }
            if (tableEl) tableEl.style.display = 'none';
            if (footerEl) footerEl.style.display = 'none';
            showSpinner('Fetching submitted dataâ€¦');
        } else {
            showToast('info', 'Updating Data', 'Fetching latest data from Google Sheetâ€¦');
        }
    }

    updateFmsDbBadge(false);

    var fetchUrl = FMS_CSV_URL + '&_=' + Date.now();
    fetch(fetchUrl)
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' while fetching Google Sheet CSV');
            return res.text();
        })
        .then(function (csvText) {
            isFmsSyncing = false;
            if (!isBackground) hideSpinner();

            var parsed = processSubmittedFmsCsv(csvText);
            var nowIso = new Date().toISOString();

            // Save in IndexedDB
            saveSubmittedFmsToDb(parsed.headers, parsed.rows, nowIso).catch(function (e) {
                console.warn('[Submitted FMS Data] Could not save to Database cache:', e);
            });

            // Update UI
            applyLoadedFmsData(parsed.headers, parsed.rows, !isBackground);
            updateFmsDbBadge(true, nowIso);

            if (!isBackground) {
                showToast('success', 'Data Refreshed', 'Successfully loaded ' + parsed.rows.length + ' records from Database.');
            }
        })
        .catch(function (err) {
            isFmsSyncing = false;
            if (!isBackground) hideSpinner();
            console.warn('[Submitted FMS Data] GVIZ fetch error:', err);

            // If we already have data in memory, keep showing it
            if (fmsTableData.allRows.length > 0) {
                updateFmsDbBadge(true);
                if (!isBackground) {
                    showToast('warning', 'Cached Data Active', 'Could not reach Google Sheet. Showing ' + fmsTableData.allRows.length + ' saved records.');
                }
                return;
            }

            // Fallback to GAS if GVIZ failed and no cached data
            fallbackGasFetch(isBackground);
        });
}

function fallbackGasFetch(isBackground) {
    if (!isBackground) showSpinner('Connecting to form backendâ€¦');

    function handleGasResult(result) {
        if (!isBackground) hideSpinner();
        if (!result || !result.success) {
            onFmsDataError((result && result.error) || 'Failed to load data.');
            return;
        }

        var rawHeaders = result.headers || [];
        var rawRows    = result.rows    || [];

        var defaultHeaders = [
            'Batch ID', 'Created at', 'Created By', 'Leather Received date',
            'Unit', 'Fabricator Name', 'Brand', 'Season', 'Category',
            'SKU', 'Style', 'Color', 'Quantity', 'ETD',
            'PO as per Buyer', 'Floor Supervisor Name', 'In-Line QC Name', 'Production Days'
        ];

        var headers = FMS_COL_ORDER.map(function (idx, i) {
            return (rawHeaders[idx] || '').trim() || defaultHeaders[i];
        });

        var rows = [];
        rawRows.forEach(function (rawRow) {
            if (!rawRow || rawRow.length === 0) return;
            var mappedRow = FMS_COL_ORDER.map(function (idx) {
                return (rawRow[idx] !== undefined && rawRow[idx] !== null) ? String(rawRow[idx]).trim() : '';
            });
            rows.push(mappedRow);
        });

        var nowIso = new Date().toISOString();
        saveSubmittedFmsToDb(headers, rows, nowIso).catch(function () {});
        applyLoadedFmsData(headers, rows, true);
        updateFmsDbBadge(true, nowIso);
    }

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(handleGasResult)
            .withFailureHandler(function (err) {
                if (!isBackground) hideSpinner();
                onFmsDataError(err.message || 'Failed to load data.');
            })
            .getSubmittedData();
        return;
    }

    jsonp({ action: 'getSubmittedData' }, function (err, result) {
        if (err) {
            if (!isBackground) hideSpinner();
            onFmsDataError(err.message);
            return;
        }
        handleGasResult(result);
    });
}

function preloadSubmittedFmsFromDb() {
    loadSubmittedFmsFromDb().then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
            console.log('[Submitted FMS Data] Preloaded ' + cached.rows.length + ' rows from Database cache.');
            fmsTableData.headers      = cached.headers;
            fmsTableData.allRows      = cached.rows;
            fmsTableData.filteredRows = cached.rows.slice();
            buildFmsTableHeaders();
            updateFmsDbBadge(true, cached.lastSync);
            var countBadge = document.getElementById('fms-data-count-badge');
            if (countBadge) countBadge.textContent = cached.rows.length + ' records';
        }
    }).catch(function () {});
}

function onFmsDataError(msg) {
    var emptyEl = document.getElementById('fms-data-empty');
    if (emptyEl) {
        emptyEl.querySelector('p').textContent = 'Error: ' + msg;
        emptyEl.style.display = '';
    }
    var tableEl = document.getElementById('fms-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('fms-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

// ---------------------------------------------------------------------------
// Build table header row (once per data load)
// ---------------------------------------------------------------------------
function buildFmsTableHeaders() {
    var thead = document.getElementById('fms-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    // â”€â”€ Row 1: Column labels + sort â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var trHead = document.createElement('tr');

    var thNum = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);

    fmsTableData.headers.forEach(function (h, i) {
    var th = document.createElement('th');
    th.className = 'dt-th dt-th-sortable';
    th.setAttribute('data-col-index', i);
    th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
    th.addEventListener('click', function () { onSortColumn(i); });
    trHead.appendChild(th);
    });

    // â”€â”€ Row 1: Per-column filter inputs (above headers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';

    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    fmsTableData.headers.forEach(function (h, i) {
    var th = document.createElement('th');
    th.className = 'dt-filter-cell';

    var wrap = document.createElement('div');
    wrap.className = 'dt-col-filter-wrap';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dt-col-filter';
    input.placeholder = 'Filterâ€¦';
    input.setAttribute('data-col', i);
    input.value = fmsTableData.columnFilters[i] || '';

    var clearBtn = document.createElement('button');
    clearBtn.className = 'dt-col-filter-clear';
    clearBtn.title = 'Clear filter';
    clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
    clearBtn.style.display = input.value ? '' : 'none';

    input.addEventListener('input', function () {
        fmsTableData.columnFilters[i] = input.value;
        clearBtn.style.display = input.value ? '' : 'none';
        applyFilters();
    });

    clearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        input.value = '';
        fmsTableData.columnFilters[i] = '';
        clearBtn.style.display = 'none';
        applyFilters();
        input.focus();
    });

    wrap.appendChild(input);
    wrap.appendChild(clearBtn);
    th.appendChild(wrap);
    trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);

    // â”€â”€ Row 2: Column labels + sort (below filter row) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    thead.appendChild(trHead);
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------
function onSortColumn(colIndex) {
    if (fmsTableData.sortCol === colIndex) {
    fmsTableData.sortAsc = !fmsTableData.sortAsc;
    } else {
    fmsTableData.sortCol = colIndex;
    fmsTableData.sortAsc = true;
    }
    updateSortIcons();
    applyFilters();   // re-filter + re-sort + render
}

function updateSortIcons() {
    document.querySelectorAll('.dt-th-sortable').forEach(function (th) {
    var idx = parseInt(th.getAttribute('data-col-index'), 10);
    var icon = th.querySelector('.dt-sort-icon');
    if (!icon) return;
    if (idx === fmsTableData.sortCol) {
        icon.textContent = fmsTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
        th.classList.add('dt-th-sorted');
    } else {
        icon.textContent = 'unfold_more';
        th.classList.remove('dt-th-sorted');
    }
    });
}

// ---------------------------------------------------------------------------
// Unified filter engine
// Applies: global search + per-column filters + date range + sort
//
// Period selection (FY / Quarter / Pre-Quarter) works by immediately writing
// the computed start/end dates into fmsTableData.dateFrom / .dateTo AND into
// the DOM date inputs â€” so the displayed dates are always the actual filter
// bounds, and a single date-range check here covers all cases.
// ---------------------------------------------------------------------------
function applyFilters() {
    var query      = fmsTableData.searchQuery;
    var colFilters = fmsTableData.columnFilters;
    var tsIdx      = getCreatedAtColIndex(); // index of the Timestamp / Created At column

    // â”€â”€ Date bounds â€” derived entirely from dateFrom / dateTo state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var dateFrom = fmsTableData.dateFrom
    ? new Date(fmsTableData.dateFrom + 'T00:00:00')
    : null;
    var dateTo = fmsTableData.dateTo
    ? new Date(fmsTableData.dateTo + 'T23:59:59')
    : null;

    var anyDateFilter = dateFrom || dateTo;

    fmsTableData.filteredRows = fmsTableData.allRows.filter(function (row) {

    // â”€â”€ Global search bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (query) {
        var rowMatch = row.some(function (cell) {
        return String(cell).toLowerCase().indexOf(query) !== -1;
        });
        if (!rowMatch) return false;
    }

    // â”€â”€ Per-column filters (all must match simultaneously) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var colKeys = Object.keys(colFilters);
    for (var k = 0; k < colKeys.length; k++) {
        var ci = parseInt(colKeys[k], 10);
        var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
        if (!f) continue;
        var rawVal     = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
        var displayVal = formatCellValue(fmsTableData.headers[ci] || '', row[ci]).toLowerCase();
        if (rawVal.indexOf(f) === -1 && displayVal.indexOf(f) === -1) return false;
    }

    // â”€â”€ Date range filter (uses Created At / Timestamp column) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // When a period is selected its exact start/end are already stored in
    // fmsTableData.dateFrom / .dateTo, so no separate period-bounds check
    // is needed here â€” the same code path handles both manual ranges and
    // period-derived ranges identically.
    if (anyDateFilter && tsIdx >= 0) {
        var createdAt = parseCreatedAt(row[tsIdx]);
        if (!createdAt) return false; // no parseable date â€” exclude

        if (dateFrom && createdAt < dateFrom) return false;
        if (dateTo   && createdAt > dateTo)   return false;
    }

    return true;
    });

    // â”€â”€ Sort â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (fmsTableData.sortCol >= 0) {
    var sc = fmsTableData.sortCol;
    fmsTableData.filteredRows.sort(function (a, b) {
        var av = (a[sc] || '').toString().toLowerCase();
        var bv = (b[sc] || '').toString().toLowerCase();
        var numA = parseFloat(av);
        var numB = parseFloat(bv);
        var isNum = !isNaN(numA) && !isNaN(numB);
        var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
        return fmsTableData.sortAsc ? cmp : -cmp;
    });
    }

    fmsTableData.page = 1;
    renderFmsTable();
}

// ---------------------------------------------------------------------------
// Global search bar â€” updates searchQuery then delegates to applyFilters
// ---------------------------------------------------------------------------
function applySearch(query) {
    fmsTableData.searchQuery = (query || '').trim().toLowerCase();
    applyFilters();
}

// ---------------------------------------------------------------------------
// Render table body + pagination
// ---------------------------------------------------------------------------
function renderFmsTable() {
    var tbody    = document.getElementById('fms-data-tbody');
    var tableEl  = document.getElementById('fms-data-table');
    var emptyEl  = document.getElementById('fms-data-empty');
    var footerEl = document.getElementById('fms-data-footer');
    var countBadge = document.getElementById('fms-data-count-badge');

    if (!tbody) return;

    var total     = fmsTableData.filteredRows.length;
    var pageSize  = fmsTableData.pageSize;
    var page      = fmsTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;

    // Clamp page
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    fmsTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = fmsTableData.filteredRows.slice(start, end);

    // Count badge
    if (countBadge) {
    countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    }

    // Always keep the table structure visible
    if (emptyEl) emptyEl.style.display = 'none';
    if (tableEl) tableEl.style.display = '';
    if (footerEl) footerEl.style.display = (total > 0) ? '' : 'none';

    tbody.innerHTML = '';

    if (total === 0) {
    // Show a "no records" row inside the table body so headers stay visible
    var trEmpty = document.createElement('tr');
    var tdEmpty = document.createElement('td');
    tdEmpty.className = 'dt-td-empty-msg';
    tdEmpty.setAttribute('colspan', fmsTableData.headers.length + 1);

    var hasActiveFilter = Object.keys(fmsTableData.columnFilters).some(function (k) {
        return (fmsTableData.columnFilters[k] || '').trim() !== '';
    });
    var hasDateFilter = fmsTableData.dateFrom || fmsTableData.dateTo || fmsTableData.period;

    tdEmpty.innerHTML =
        '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
        (fmsTableData.searchQuery || hasActiveFilter || hasDateFilter
        ? 'No records match the current filter.'
        : (fmsTableData.allRows.length === 0 ? 'No data submitted yet.' : 'No records found.'));
    trEmpty.appendChild(tdEmpty);
    tbody.appendChild(trEmpty);

    var infoEl = document.getElementById('fms-data-info');
    if (infoEl) infoEl.textContent = 'Showing 0 entries';
    return;
    }

    // Build rows
    slice.forEach(function (row, idx) {
    var tr = document.createElement('tr');
    tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';

    // Row number
    var tdNum = document.createElement('td');
    tdNum.className = 'dt-td dt-td-num';
    tdNum.textContent = start + idx + 1;
    tr.appendChild(tdNum);

    fmsTableData.headers.forEach(function (header, ci) {
        var td = document.createElement('td');
        td.className = 'dt-td';
        var cellVal = formatCellValue(header, row[ci]);

        // Highlight search term
        if (fmsTableData.searchQuery && cellVal.toLowerCase().indexOf(fmsTableData.searchQuery) !== -1) {
        td.innerHTML = esc(cellVal).replace(
            new RegExp(escapeRegex(esc(fmsTableData.searchQuery)), 'gi'),
            '<mark class="dt-highlight">$&</mark>'
        );
        } else {
        td.textContent = cellVal;
        }
        tr.appendChild(td);
    });

    tbody.appendChild(tr);
    });

    // Info
    var infoEl = document.getElementById('fms-data-info');
    if (infoEl) {
    infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
        (fmsTableData.allRows.length !== total ? ' (filtered from ' + fmsTableData.allRows.length + ' total)' : '') +
        ' entries';
    }

    buildPagination(page, totalPages);
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// PDF FOLLOW-UP CHECKLISTS â€” Floor Supervisor & In-Line QC
// Recreates the printed checklist layout (title bar, info tables, three
// follow-up sections with fixed check-point templates, signature lines).
// Uses Verdana throughout. Opens the browser print dialog so the user can
// save the result as a PDF.
// ---------------------------------------------------------------------------

var COMPANY_NAME = 'Trio Trend Exports Pvt. Ltd.';

// Fixed checklist templates â€” match the approved reference layouts exactly.
var FS_CHECKLIST = [
    { items: [
        'PP SAMPLE AVAILABLE',
        'CHELA SAMPLE',
        'LEATHER PART RECEVIED',
        'LINING PART RECEVIED',
        'RE-INFORCEMENT PART RECEVIED',
        'ALL FITTINGS RECEIVED',
        'FORMA RECEIVED',
        'JIG RECEIVED ( IF REQUIRED)',
        'SEW IN LABEL',
        'GLUEING'
    ] },
    { items: [
        'EMBOSSING RECEIVED FROM BIMAN',
        'STITCHING MACHINE',
        'DURING PRODUCTION CHECKING EVERY ITEMS(25%)',
        'EDGE INKING PART RECEIVED (EDGE INKING DEPT)',
        'CHECK MANPOWER AVAILABILITY WITH EACH FABRICATOR',
        'FOLLOW UP WITH INLINE QC TO SEE ALL MATERIAL CHECKED/NOT CHECKED',
        '1 PC FOR LOT APPROVAL'
    ] },
    { items: [
        'ASSEMBLE OF LEATHER COMPONENT',
        'FINAL ASSAMBLE',
        'PRODUCTION ONTIME FOLLOW UP',
        '10% W.I.P GOODS QUALITY CHECKING(WHEN PRODUCTION 80% DONE)',
        'CLEANING AND CHECKING/AQL DONE'
    ] }
];

var IQC_CHECKLIST = [
    { items: [
        'PP SAMPLE & YELLOW SEAL SAMPLE AVAILABLE',
        'CHELA SAMPLE',
        'LEATHER COLOUR (25%)',
        'LEATHER QUALITY (25%)',
        'GRAIN MATCHING (25%)',
        'LINING TYPE (10%)',
        'HARDWARE CHECKING (WITH COLOUR ) (10%)',
        'WEBBING CHECKING (10%)'
    ] },
    { items: [
        'LINING ATTACHMENT (10%)',
        'EMBOSSING AS PER MRS/BRANDING',
        'SEW IN LABEL ATTACHMENT (5%)',
        'SCREEN PRINTING /IF ANY (25%)',
        'ASSAMBLE OF LEATHER COMPONENT (25%)',
        'STITCHING LENGTH (SPI) AS REUQUIRED BY BUYER (10%)',
        'PANEL /IF ANY REQUIRED (25%)',
        'PANEL JOINT THICKNESS (25%)',
        'PANEL ATTACHMENT (25%)',
        'GRAB HANDLE (25%)',
        'ATTACHMENT OF REINFORCEMENT (25%)',
        'IF ANY BINDING & PIPING ATTACHMENT (10%)',
        'LOOP ATTACHMENT (25%)',
        'SCREW FIXING (LOCKTITE) (100%)',
        'DECORATIVE STITCH /IF ANY (25%)'
    ] },
    { items: [
        'FINAL STITCHING (25%)',
        'PULLER ATTACHMENT (5%)',
        'FINAL ASSEMBLE (25%)',
        'THREAD TRIMMING (10%)',
        'SHAPE (25%)',
        'EDGE PAINT QUALITY (25%)',
        'CLEANING (25%)',
        'WIP AQL (20%)'
    ] }
];

// ---------------------------------------------------------------------------
// findFieldValue â€” fuzzy-matches a header name against a list of regex
// patterns (in priority order) and returns the value from the same row.
// Sheet header text can vary slightly, so this tries several likely forms.
// ---------------------------------------------------------------------------
function findFieldValue(headers, row, patterns) {
    for (var p = 0; p < patterns.length; p++) {
        for (var i = 0; i < headers.length; i++) {
            if (patterns[p].test(String(headers[i] || '').trim())) {
                var v = row[i];
                return (v !== undefined && v !== null) ? String(v) : '';
            }
        }
    }
    return '';
}

// findHeaderIndex â€” like findFieldValue, but returns the column index
// instead of the value. Returns -1 if no header matches any pattern.
function findHeaderIndex(headers, patterns) {
    for (var p = 0; p < patterns.length; p++) {
        for (var i = 0; i < headers.length; i++) {
            if (patterns[p].test(String(headers[i] || '').trim())) return i;
        }
    }
    return -1;
}

function extractChecklistFields(headers, row, batchIdOverride) {
    // Follow-up dates are read by fixed position rather than header text,
    // since the sheet doesn't reliably label these columns:
    //   1st Follow Up date = 18th column after the PDF icon â†’ row[18]
    //   2nd Follow Up date = 19th column after the PDF icon â†’ row[19]
    //   3rd Follow Up date = 20th column after the PDF icon â†’ row[20]
    // (The PDF icon sits right after the Serial No. column, i.e. row[0],
    // so "N-th column after the icon" = row[N].)
    function colAt(idx) {
        var v = row[idx];
        return (v !== undefined && v !== null) ? String(v) : '';
    }

    return {
        batchId:      (batchIdOverride !== undefined && batchIdOverride !== null && String(batchIdOverride) !== '')
                          ? String(batchIdOverride)
                          : findFieldValue(headers, row, [/batch\s*id/i, /batch\s*no\.?/i]),
        po:           findFieldValue(headers, row, [/po\s*as\s*per\s*buyer/i, /^po$/i, /purchase\s*order/i]),
        unit:         findFieldValue(headers, row, [/^unit$/i, /issue\s*to\s*unit/i]),
        sku:          findFieldValue(headers, row, [/^sku$/i, /sku\s*no\.?/i, /design\s*ref/i]),
        styleNo:      findFieldValue(headers, row, [/style\s*no\.?/i, /^style$/i]),
        colour:       findFieldValue(headers, row, [/colour/i, /color/i]),
        quantity:     findFieldValue(headers, row, [/quantity/i, /^qty$/i]),
        fabricator:   findFieldValue(headers, row, [/fabricator\s*name/i, /fabricator/i]),
        floorSup:     findFieldValue(headers, row, [/floor\s*supervisor\s*name/i, /floor\s*supervisor/i]),
        inLineQc:     findFieldValue(headers, row, [/in.?line\s*qc\s*name/i, /in.?line\s*qc/i]),
        etd:          findFieldValue(headers, row, [/^etd$/i]),
        topDate:      findFieldValue(headers, row, [/^date$/i, /planned\s*date/i, /^timestamp$/i]),
        followUp1:    colAt(18),
        followUp2:    colAt(19),
        followUp3:    colAt(20)
    };
}

function checklistPdfBaseStyles() {
    return (
        ':root{ --fit-scale:1; }' +
        '*{box-sizing:border-box;}' +
        'body{font-family:Verdana,Geneva,sans-serif;padding:14px;color:#0f172a;background:#fff;}' +
        '.doc{max-width:760px;margin:0 auto;}' +
        '.title{text-align:center;font-size:19px;font-weight:bold;color:#12224e;letter-spacing:.5px;margin:0 0 3px;}' +
        '.company{text-align:center;font-size:12.5px;font-weight:bold;color:#12224e;margin:0 0 7px;}' +
        '.date-box-row{display:flex;justify-content:flex-end;margin-bottom:6px;}' +
        '.date-box{border:1.5px solid #12224e;padding:3px 10px;font-size:10.5px;font-weight:bold;color:#12224e;}' +
        '.info-table{width:100%;border-collapse:collapse;margin-bottom:calc(var(--fit-scale,1) * 7px);}' +
        '.info-table th,.info-table td{border:1.5px solid #12224e;padding:calc(var(--fit-scale,1) * 4px) 6px;font-size:9.5px;text-align:center;line-height:1.2;}' +
        '.info-table th{background:#fff;color:#12224e;font-weight:bold;}' +
        '.info-table td{font-weight:bold;color:#0f172a;}' +
        '.fup-banner{background:#fff;color:#12224e;text-align:center;font-weight:bold;font-size:10.5px;padding:calc(var(--fit-scale,1) * 3px) 0;border:1.5px solid #12224e;letter-spacing:.3px;}' +
        '.fup-table{width:100%;border-collapse:collapse;margin-bottom:calc(var(--fit-scale,1) * 7px);}' +
        '.fup-table th{background:#fff;color:#12224e;font-weight:bold;font-size:9px;padding:calc(var(--fit-scale,1) * 3px) 5px;border:1.5px solid #12224e;text-align:center;}' +
        '.fup-table td{border:1.5px solid #12224e;padding:calc(var(--fit-scale,1) * 2.5px) 6px;font-size:8.8px;vertical-align:middle;line-height:1.15;}' +
        '.col-sl{width:36px;text-align:center;color:#334155;}' +
        '.col-check{width:60px;text-align:center;}' +
        '.col-remarks{width:260px;}' +
        '.checkbox{display:inline-block;width:10px;height:10px;border:1.2px solid #12224e;}' +
        '.sign-row{display:flex;justify-content:space-between;margin-top:calc(var(--fit-scale,1) * 14px);flex-wrap:wrap;gap:12px;}' +
        '.sign-cell{font-size:9.5px;font-weight:bold;color:#0f172a;white-space:nowrap;}' +
        '.sign-line{display:inline-block;border-bottom:1px solid #0f172a;width:160px;margin-left:6px;}' +
        '@media print{ body{padding:0;} .doc{max-width:none;} }' +
        '@page{ size:A4; margin:8mm; }'
    );
}

function buildInfoTable(rowsHtml) {
    return '<table class="info-table"><tbody>' + rowsHtml + '</tbody></table>';
}

function buildFupSection(index, dateStr, items) {
    var ord = ['1ST', '2ND', '3RD'][index] || (index + 1) + 'TH';
    var bannerLabel = ord + ' FOLLOW UP' + (dateStr ? ' (' + esc(dateStr) + ')' : '');
    var rows = items.map(function (item, i) {
        return (
            '<tr>' +
                '<td class="col-sl">' + (i + 1) + '</td>' +
                '<td>' + esc(item) + '</td>' +
                '<td class="col-check"><span class="checkbox"></span></td>' +
                '<td class="col-remarks">&nbsp;</td>' +
            '</tr>'
        );
    }).join('');
    return (
        '<div class="fup-banner">' + bannerLabel + '</div>' +
        '<table class="fup-table">' +
            '<thead><tr>' +
                '<th class="col-sl">SL</th>' +
                '<th>CHECK POINTS</th>' +
                '<th class="col-check">CHECK</th>' +
                '<th class="col-remarks">REMARKS</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
        '</table>'
    );
}

function buildFsPdfHtml(headers, row, batchIdOverride) {
    var f = extractChecklistFields(headers, row, batchIdOverride);
    var companyLogoUrl = 'https://res.cloudinary.com/dnrgcigsj/image/upload/v1789365942/trio-dark-logo_ayyhkh.svg';
    var companyName = 'TRIO TREND EXPORTS PVT. LTD.';
    var reportTitle = 'FLOOR SUPERVISOR INSPECTION REPORT';

    var fupSectionsHtml = FS_CHECKLIST.map(function (section, i) {
        var dateVal = i === 0 ? f.followUp1 : (i === 1 ? f.followUp2 : f.followUp3);
        var ordLabel = (i === 0 ? '1ST' : (i === 1 ? '2ND' : '3RD')) + ' FOLLOW UP';

        var rowsHtml = section.items.map(function (item, idx) {
            return (
                '<tr>' +
                '<td class="col-sl">' + (idx + 1) + '</td>' +
                '<td class="col-cp">' + esc(item) + '</td>' +
                '<td class="col-check"><div class="chk-box"></div></td>' +
                '<td class="col-remarks"><div class="remark-line"></div></td>' +
                '</tr>'
            );
        }).join('');

        return (
            '<div class="fup-card">' +
                '<div class="fup-header">' +
                    '<div class="fup-title-wrap">' +
                        '<span class="fup-badge">' + (i + 1) + '</span>' +
                        '<span class="fup-title-text">' + ordLabel + '</span>' +
                    '</div>' +
                    '<div class="fup-date-tag">' +
                        '<span class="fup-date-lbl">PLANNED DATE:</span> ' +
                        '<span class="fup-date-val">' + esc(dateVal || 'Not Scheduled') + '</span>' +
                    '</div>' +
                '</div>' +
                '<table class="fup-table">' +
                    '<thead><tr>' +
                        '<th class="col-sl">#</th>' +
                        '<th class="col-cp">CHECK POINTS &amp; QUALITY PARAMETERS</th>' +
                        '<th class="col-check">STATUS</th>' +
                        '<th class="col-remarks">OBSERVATIONS &amp; REMARKS</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rowsHtml + '</tbody>' +
                '</table>' +
            '</div>'
        );
    }).join('');

    var css =
        '*,*::before,*::after{ box-sizing: border-box; margin: 0; padding: 0; }' +
        'html, body { background: #e2e8f0; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }' +
        '.doc-page { width: 794px; margin: 12px auto; background: #ffffff; padding: 12px 18px 10px 18px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); border: 1.5px solid #000000; box-sizing: border-box; }' +
        '.top-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #000000; padding-bottom: 5px; margin-bottom: 5px; position: relative; }' +
        '.top-header::after { content: ""; position: absolute; bottom: -3px; left: 0; right: 0; height: 1.5px; background: linear-gradient(90deg, #c48b16 0%, #e2b342 50%, #c48b16 100%); }' +
        '.brand-col { display: flex; align-items: center; gap: 12px; }' +
        '.company-logo { height: 40px; width: auto; max-width: 140px; object-fit: contain; }' +
        '.brand-meta { display: flex; flex-direction: column; justify-content: center; }' +
        '.company-title { font-size: 15.5px; font-weight: 900; color: #0f2744; letter-spacing: 0.8px; text-transform: uppercase; line-height: 1.15; }' +
        '.company-sub { font-size: 9.5px; font-weight: 700; color: #475569; letter-spacing: 0.5px; margin-top: 1px; text-transform: uppercase; }' +
        '.report-title-col { text-align: right; }' +
        '.report-badge { display: inline-block; background: #f8fafc; color: #0f2744; border: 1.5px solid #0f2744; font-size: 12.5px; font-weight: 900; letter-spacing: 0.6px; padding: 3px 10px; border-radius: 0; }' +
        '.report-meta-sub { font-size: 10px; color: #1e293b; font-weight: 700; margin-top: 3px; }' +
        '.report-meta-sub strong { color: #000000; }' +
        '.info-card { background: #ffffff; border: 1.5px solid #000000; border-radius: 0; overflow: hidden; margin-bottom: 5px; }' +
        '.info-grid-table { width: 100%; border-collapse: collapse; table-layout: fixed; }' +
        '.info-grid-table th, .info-grid-table td { border: 1px solid #000000; padding: 4.5px 6px; text-align: center; word-wrap: break-word; }' +
        '.info-grid-table th { background: #f1f5f9; color: #000000; font-weight: 900; font-size: 9.5px; letter-spacing: 0.4px; text-transform: uppercase; }' +
        '.info-grid-table td { font-weight: 800; color: #000000; font-size: 12px; line-height: 1.2; }' +
        '.val-highlight { color: #0f2744 !important; font-size: 12.5px !important; font-weight: 900 !important; }' +
        '.fup-card { border: 1.5px solid #000000; border-radius: 0; overflow: hidden; margin-bottom: 5px; background: #ffffff; }' +
        '.fup-header { background: #f1f5f9; color: #0f2744; display: flex; align-items: center; justify-content: space-between; padding: 3.5px 10px; border-bottom: 1.5px solid #000000; }' +
        '.fup-title-wrap { display: flex; align-items: center; gap: 7px; }' +
        '.fup-badge { display: inline-flex; align-items: center; justify-content: center; background: #fef3c7; color: #92400e; border: 1.2px solid #b45309; font-size: 9.5px; font-weight: 900; width: 17px; height: 17px; border-radius: 0; }' +
        '.fup-title-text { font-size: 11px; font-weight: 900; color: #0f2744; letter-spacing: 0.5px; text-transform: uppercase; }' +
        '.fup-date-tag { font-size: 9.5px; color: #334155; font-weight: 700; }' +
        '.fup-date-lbl { color: #64748b; font-weight: 800; }' +
        '.fup-date-val { color: #0f2744; font-weight: 900; background: #ffffff; padding: 1px 7px; border-radius: 0; border: 1.2px solid #0f2744; }' +
        '.fup-table { width: 100%; border-collapse: collapse; }' +
        '.fup-table th, .fup-table td { border: 1px solid #000000; padding: 3px 7px; vertical-align: middle; }' +
        '.fup-table thead tr { background: #f1f5f9; }' +
        '.fup-table th { color: #000000; font-weight: 900; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.4px; padding: 3px 6px; }' +
        '.fup-table tbody tr:nth-child(even) { background: #fbfcfe; }' +
        '.col-sl { width: 28px; text-align: center; font-weight: 900; color: #000000; font-size: 10px; }' +
        '.col-cp { color: #000000; font-weight: 700; font-size: 10.5px; line-height: 1.2; letter-spacing: 0.1px; }' +
        '.col-check { width: 50px; text-align: center; }' +
        '.chk-box { display: inline-block; width: 14px; height: 14px; border: 1.8px solid #000000; border-radius: 0; background: #ffffff; vertical-align: middle; }' +
        '.col-remarks { width: 260px; }' +
        '.remark-line { width: 100%; border-bottom: 1px dotted #475569; height: 13px; }' +
        '.sign-section { display: flex; justify-content: space-between; gap: 14px; margin-top: 6px; }' +
        '.sign-box { flex: 1; border: 1.5px solid #000000; border-radius: 0; padding: 5px 8px; background: #ffffff; text-align: center; }' +
        '.sign-title { font-size: 10px; font-weight: 900; color: #0f2744; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 20px; }' +
        '.sign-line { border-bottom: 1.5px solid #000000; margin: 0 10px 3px 10px; }' +
        '.sign-caption { font-size: 8.5px; color: #334155; font-weight: 700; }' +
        '.footer-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; padding-top: 3px; border-top: 1.5px solid #000000; font-size: 8.5px; color: #334155; font-weight: 700; }' +
        '@media print { body { background: #ffffff !important; padding: 0 !important; margin: 0 !important; } .doc-page { margin: 0 auto !important; padding: 6px 12px !important; box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; } @page { size: A4 portrait; margin: 4mm 5mm; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }';

    return (
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
        '<title>Floor Supervisor Inspection Report' + (f.batchId ? ' - ' + esc(f.batchId) : '') + '</title>' +
        '<style>' + css + '</style>' +
        '</head><body><div class="doc doc-page fs-report-doc">' +
        '<!-- Top Header Bar -->' +
        '<div class="top-header">' +
            '<div class="brand-col">' +
                '<img class="company-logo" src="' + companyLogoUrl + '" alt="Trio Group Logo" />' +
                '<div class="brand-meta">' +
                    '<div class="company-title">' + esc(companyName) + '</div>' +
                    '<div class="company-sub">Quality Assurance &amp; Floor Operations Division</div>' +
                '</div>' +
            '</div>' +
            '<div class="report-title-col">' +
                '<div class="report-badge">' + reportTitle + '</div>' +
                '<div class="report-meta-sub">' +
                    '<strong>DATE:</strong> ' + esc(f.topDate || new Date().toLocaleDateString('en-GB')) + ' &nbsp;|&nbsp; ' +
                    '<strong>BATCH:</strong> ' + esc(f.batchId || 'N/A') +
                '</div>' +
            '</div>' +
        '</div>' +

        '<!-- Batch Information Card -->' +
        '<div class="info-card">' +
            '<table class="info-grid-table">' +
                '<thead><tr>' +
                    '<th style="width:14%;">BATCH ID</th>' +
                    '<th style="width:14%;">PO / BUYER</th>' +
                    '<th style="width:10%;">UNIT</th>' +
                    '<th style="width:16%;">SKU</th>' +
                    '<th style="width:17%;">STYLE NO.</th>' +
                    '<th style="width:14%;">COLOUR</th>' +
                    '<th style="width:15%;">QUANTITY</th>' +
                '</tr></thead>' +
                '<tbody><tr>' +
                    '<td class="val-highlight">' + esc(f.batchId || '-') + '</td>' +
                    '<td>' + esc(f.po || '-') + '</td>' +
                    '<td>' + esc(f.unit || '-') + '</td>' +
                    '<td class="val-highlight">' + esc(f.sku || '-') + '</td>' +
                    '<td>' + esc(f.styleNo || '-') + '</td>' +
                    '<td>' + esc(f.colour || '-') + '</td>' +
                    '<td class="val-highlight">' + esc(f.quantity || '-') + '</td>' +
                '</tr></tbody>' +
            '</table>' +
            '<table class="info-grid-table" style="border-top:none;">' +
                '<thead><tr>' +
                    '<th style="width:25%;">FABRICATOR NAME</th>' +
                    '<th style="width:25%;">FLOOR SUPERVISOR</th>' +
                    '<th style="width:25%;">IN-LINE QC</th>' +
                    '<th style="width:25%;">ETD (EXP. DELIVERY)</th>' +
                '</tr></thead>' +
                '<tbody><tr>' +
                    '<td>' + esc(f.fabricator || '-') + '</td>' +
                    '<td>' + esc(f.floorSup || '-') + '</td>' +
                    '<td>' + esc(f.inLineQc || '-') + '</td>' +
                    '<td class="val-highlight">' + esc(f.etd || '-') + '</td>' +
                '</tr></tbody>' +
            '</table>' +
        '</div>' +

        '<!-- Follow Up Sections -->' +
        fupSectionsHtml +

        '<!-- Signatures -->' +
        '<div class="sign-section">' +
            '<div class="sign-box">' +
                '<div class="sign-title">In-Line QC Inspector</div>' +
                '<div class="sign-line"></div>' +
                '<div class="sign-caption">Authorized Sign &amp; Date Stamp</div>' +
            '</div>' +
            '<div class="sign-box">' +
                '<div class="sign-title">Floor Supervisor</div>' +
                '<div class="sign-line"></div>' +
                '<div class="sign-caption">Authorized Sign &amp; Date Stamp</div>' +
            '</div>' +
            '<div class="sign-box">' +
                '<div class="sign-title">QA / Operations Manager</div>' +
                '<div class="sign-line"></div>' +
                '<div class="sign-caption">Verified &amp; Approved</div>' +
            '</div>' +
        '</div>' +

        '<!-- Footer Security Notice -->' +
        '<div class="footer-bar">' +
            '<span>Trio Trend Exports Pvt. Ltd. &bull; Floor Supervisor Inspection System &bull; Confidential Document</span>' +
            '<span>Form Ref: FMS-FS-01</span>' +
        '</div>' +
        '</div></body></html>'
    );
}

function buildIqcPdfHtml(headers, row, batchIdOverride) {
    var f = extractChecklistFields(headers, row, batchIdOverride);
    if (window.InlineQcSheet && typeof window.InlineQcSheet.buildReportHtml === 'function') {
        return window.InlineQcSheet.buildReportHtml(f);
    }
    var companyLogoUrl = 'https://res.cloudinary.com/dnrgcigsj/image/upload/v1789365942/trio-dark-logo_ayyhkh.svg';
    var companyName = 'TRIO TREND EXPORTS PVT. LTD.';
    var reportTitle = 'IN-LINE QC INSPECTION REPORT';

    var fupSectionsHtml = IQC_CHECKLIST.map(function (section, i) {
        var dateVal = i === 0 ? f.followUp1 : (i === 1 ? f.followUp2 : f.followUp3);
        var ordLabel = (i === 0 ? '1ST' : (i === 1 ? '2ND' : '3RD')) + ' FOLLOW UP';

        var rowsHtml = section.items.map(function (item, idx) {
            return (
                '<tr>' +
                '<td class="col-sl">' + (idx + 1) + '</td>' +
                '<td class="col-cp">' + esc(item) + '</td>' +
                '<td class="col-check"><div class="chk-box"></div></td>' +
                '<td class="col-remarks"><div class="remark-line"></div></td>' +
                '</tr>'
            );
        }).join('');

        return (
            '<div class="fup-card">' +
            '<div class="fup-header">' +
            '<div class="fup-title-wrap">' +
            '<span class="fup-badge">' + (i + 1) + '</span>' +
            '<span class="fup-title-text">' + ordLabel + '</span>' +
            '</div>' +
            '<div class="fup-date-tag">' +
            '<span class="fup-date-lbl">PLANNED DATE:</span> ' +
            '<span class="fup-date-val">' + esc(dateVal || 'Not Scheduled') + '</span>' +
            '</div>' +
            '</div>' +
            '<table class="fup-table">' +
            '<thead><tr>' +
            '<th class="col-sl">#</th>' +
            '<th class="col-cp">CHECK POINTS &amp; QUALITY PARAMETERS</th>' +
            '<th class="col-check">STATUS</th>' +
            '<th class="col-remarks">OBSERVATIONS &amp; REMARKS</th>' +
            '</tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
            '</table>' +
            '</div>'
        );
    }).join('');

    var css =
      '*,*::before,*::after{ box-sizing: border-box; margin: 0; padding: 0; }' +
      'html, body { background: #e2e8f0; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }' +
      '.doc-page { width: 794px; margin: 10px auto; background: #ffffff; padding: 10px 16px 8px 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); border: 1.5px solid #000000; box-sizing: border-box; }' +
      '.top-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #000000; padding-bottom: 4px; margin-bottom: 4px; position: relative; }' +
      '.top-header::after { content: ""; position: absolute; bottom: -3px; left: 0; right: 0; height: 1.5px; background: linear-gradient(90deg, #c48b16 0%, #e2b342 50%, #c48b16 100%); }' +
      '.brand-col { display: flex; align-items: center; gap: 12px; }' +
      '.company-logo { height: 38px; width: auto; max-width: 140px; object-fit: contain; }' +
      '.brand-meta { display: flex; flex-direction: column; justify-content: center; }' +
      '.company-title { font-size: 15px; font-weight: 900; color: #0f2744; letter-spacing: 0.8px; text-transform: uppercase; line-height: 1.15; }' +
      '.company-sub { font-size: 9px; font-weight: 700; color: #475569; letter-spacing: 0.5px; margin-top: 1px; text-transform: uppercase; }' +
      '.report-title-col { text-align: right; }' +
      '.report-badge { display: inline-block; background: #f8fafc; color: #0f2744; border: 1.5px solid #0f2744; font-size: 12px; font-weight: 900; letter-spacing: 0.6px; padding: 3px 9px; border-radius: 0; }' +
      '.report-meta-sub { font-size: 9.5px; color: #1e293b; font-weight: 700; margin-top: 2px; }' +
      '.report-meta-sub strong { color: #000000; }' +
      '.info-card { background: #ffffff; border: 1.5px solid #000000; border-radius: 0; overflow: hidden; margin-bottom: 4px; }' +
      '.info-grid-table { width: 100%; border-collapse: collapse; table-layout: fixed; }' +
      '.info-grid-table th, .info-grid-table td { border: 1px solid #000000; padding: 3.5px 5px; text-align: center; word-wrap: break-word; }' +
      '.info-grid-table th { background: #f1f5f9; color: #000000; font-weight: 900; font-size: 9px; letter-spacing: 0.4px; text-transform: uppercase; }' +
      '.info-grid-table td { font-weight: 800; color: #000000; font-size: 11.5px; line-height: 1.15; }' +
      '.val-highlight { color: #0f2744 !important; font-size: 12px !important; font-weight: 900 !important; }' +
      '.fup-card { border: 1.5px solid #000000; border-radius: 0; overflow: hidden; margin-bottom: 4px; background: #ffffff; }' +
      '.fup-header { background: #f1f5f9; color: #0f2744; display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; border-bottom: 1.5px solid #000000; }' +
      '.fup-title-wrap { display: flex; align-items: center; gap: 6px; }' +
      '.fup-badge { display: inline-flex; align-items: center; justify-content: center; background: #fef3c7; color: #92400e; border: 1.2px solid #b45309; font-size: 9px; font-weight: 900; width: 16px; height: 16px; border-radius: 0; }' +
      '.fup-title-text { font-size: 10.5px; font-weight: 900; color: #0f2744; letter-spacing: 0.5px; text-transform: uppercase; }' +
      '.fup-date-tag { font-size: 9px; color: #334155; font-weight: 700; }' +
      '.fup-date-lbl { color: #64748b; font-weight: 800; }' +
      '.fup-date-val { color: #0f2744; font-weight: 900; background: #ffffff; padding: 1px 6px; border-radius: 0; border: 1.2px solid #0f2744; }' +
      '.fup-table { width: 100%; border-collapse: collapse; }' +
      '.fup-table th, .fup-table td { border: 1px solid #000000; padding: 2px 6px; vertical-align: middle; }' +
      '.fup-table thead tr { background: #f1f5f9; }' +
      '.fup-table th { color: #000000; font-weight: 900; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; padding: 2.5px 5px; }' +
      '.fup-table tbody tr:nth-child(even) { background: #fbfcfe; }' +
      '.col-sl { width: 26px; text-align: center; font-weight: 900; color: #000000; font-size: 9.5px; }' +
      '.col-cp { color: #000000; font-weight: 700; font-size: 9.5px; line-height: 1.15; letter-spacing: 0.1px; }' +
      '.col-check { width: 50px; text-align: center; }' +
      '.chk-box { display: inline-block; width: 13px; height: 13px; border: 1.8px solid #000000; border-radius: 0; background: #ffffff; vertical-align: middle; }' +
      '.col-remarks { width: 260px; }' +
      '.remark-line { width: 100%; border-bottom: 1px dotted #475569; height: 12px; }' +
      '.sign-section { display: flex; justify-content: space-between; gap: 12px; margin-top: 5px; }' +
      '.sign-box { flex: 1; border: 1.5px solid #000000; border-radius: 0; padding: 4px 6px; background: #ffffff; text-align: center; }' +
      '.sign-title { font-size: 9.5px; font-weight: 900; color: #0f2744; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 18px; }' +
      '.sign-line { border-bottom: 1.5px solid #000000; margin: 0 10px 2px 10px; }' +
      '.sign-caption { font-size: 8px; color: #334155; font-weight: 700; }' +
      '.footer-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 2px; border-top: 1.5px solid #000000; font-size: 8px; color: #334155; font-weight: 700; }' +
      '@media print { body { background: #ffffff !important; padding: 0 !important; margin: 0 !important; } .doc-page { margin: 0 auto !important; padding: 4px 10px !important; box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; } @page { size: A4 portrait; margin: 3mm 4mm; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }';

    return (
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<title>In-Line QC Inspection Report - ' + esc(f.batchId || 'Batch') + '</title>' +
      '<style>' + css + '</style>' +
      '</head><body><div class="doc doc-page">' +
      '<!-- Top Header Bar -->' +
      '<div class="top-header">' +
      '<div class="brand-col">' +
      '<img class="company-logo" src="' + companyLogoUrl + '" alt="Trio Group Logo" />' +
      '<div class="brand-meta">' +
      '<div class="company-title">' + esc(companyName) + '</div>' +
      '<div class="company-sub">Quality Assurance &amp; In-Line QC Inspection Division</div>' +
      '</div>' +
      '</div>' +
      '<div class="report-title-col">' +
      '<div class="report-badge">' + reportTitle + '</div>' +
      '<div class="report-meta-sub">' +
      '<strong>DATE:</strong> ' + esc(f.topDate || new Date().toLocaleDateString('en-GB')) + ' &nbsp;|&nbsp; ' +
      '<strong>BATCH:</strong> ' + esc(f.batchId || 'N/A') +
      '</div>' +
      '</div>' +
      '</div>' +

      '<!-- Batch Information Card -->' +
      '<div class="info-card">' +
      '<table class="info-grid-table">' +
      '<thead><tr>' +
      '<th style="width:14%;">BATCH ID</th>' +
      '<th style="width:14%;">PO / BUYER</th>' +
      '<th style="width:10%;">UNIT</th>' +
      '<th style="width:16%;">SKU</th>' +
      '<th style="width:17%;">STYLE NO.</th>' +
      '<th style="width:14%;">COLOUR</th>' +
      '<th style="width:15%;">QUANTITY</th>' +
      '</tr></thead>' +
      '<tbody><tr>' +
      '<td class="val-highlight">' + esc(f.batchId || '-') + '</td>' +
      '<td>' + esc(f.po || '-') + '</td>' +
      '<td>' + esc(f.unit || '-') + '</td>' +
      '<td class="val-highlight">' + esc(f.sku || '-') + '</td>' +
      '<td>' + esc(f.styleNo || '-') + '</td>' +
      '<td>' + esc(f.colour || '-') + '</td>' +
      '<td class="val-highlight">' + esc(f.quantity || '-') + '</td>' +
      '</tr></tbody>' +
      '</table>' +
      '<table class="info-grid-table" style="border-top:none;">' +
      '<thead><tr>' +
      '<th style="width:25%;">FABRICATOR NAME</th>' +
      '<th style="width:25%;">IN-LINE QC</th>' +
      '<th style="width:25%;">FLOOR SUPERVISOR</th>' +
      '<th style="width:25%;">ETD (EXP. DELIVERY)</th>' +
      '</tr></thead>' +
      '<tbody><tr>' +
      '<td>' + esc(f.fabricator || '-') + '</td>' +
      '<td>' + esc(f.inLineQc || '-') + '</td>' +
      '<td>' + esc(f.floorSup || '-') + '</td>' +
      '<td class="val-highlight">' + esc(f.etd || '-') + '</td>' +
      '</tr></tbody>' +
      '</table>' +
      '</div>' +

      '<!-- Follow Up Sections -->' +
      fupSectionsHtml +

      '<!-- Signatures -->' +
      '<div class="sign-section">' +
      '<div class="sign-box">' +
      '<div class="sign-title">In-Line QC Inspector</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Authorized Sign &amp; Date Stamp</div>' +
      '</div>' +
      '<div class="sign-box">' +
      '<div class="sign-title">Floor Supervisor</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Authorized Sign &amp; Date Stamp</div>' +
      '</div>' +
      '<div class="sign-box">' +
      '<div class="sign-title">WIP AQL Officer / QA Manager</div>' +
      '<div class="sign-line"></div>' +
      '<div class="sign-caption">Verified &amp; Approved</div>' +
      '</div>' +
      '</div>' +

      '<!-- Footer Security Notice -->' +
      '<div class="footer-bar">' +
      '<span>Trio Trend Exports Pvt. Ltd. &bull; In-Line QC Inspection System &bull; Confidential Document</span>' +
      '<span>Form Ref: FMS-IQC-01</span>' +
      '</div>' +
      '</div></body></html>'
    );
}

// ---------------------------------------------------------------------------
// EDGE-PAINT INSPECTION REPORT â€” reconstructed to match the approved printed
// form exactly: FORM ID / Generated-at header, batch info grid, remarks box,
// checker name, a fixed 29-row bilingual (Bengali/English) parts checklist
// with Checked Qty / Repair Qty / Overlapping (Yes/No) columns, and the two
// signature lines. The batch info comes from the sheet row; the parts
// checklist itself is fixed (printed blank for manual completion), same
// approach as the FS/IQC follow-up checklists above.
// ---------------------------------------------------------------------------

var EDGE_PAINT_PARTS_CHECKLIST = [
    { bn: 'à¦²à§‡à¦¬à§‡à¦²',                                        en: 'LEBEL' },
    { bn: 'à¦‡à¦¨à¦¸à¦¾à¦‡à¦¡ à¦œà¦¿à¦ª à¦²à§à¦ª',                                en: 'INSIDE ZIP LOOP' },
    { bn: 'à§© à¦¨à¦‚ à¦Ÿà¦¾à¦‡',                                      en: '3 NO. TIE' },
    { bn: 'à§« à¦¨à¦‚ à¦Ÿà¦¾à¦‡',                                      en: '5 NO. TIE' },
    { bn: 'à¦—à§à¦°à§à¦¯à¦¾à¦¸à§‡à¦Ÿ à¦²à§à¦ª',                                  en: 'GRASSET LOOP' },
    { bn: 'à¦—à§à¦°à§à¦¯à¦¾à¦¸à§‡à¦Ÿ',                                      en: 'GRASSET' },
    { bn: 'à¦¹à§à¦¯à¦¾à¦¨à§à¦¡à§‡à¦² à¦²à§à¦ª',                                  en: 'HANDLE LOOP' },
    { bn: 'à¦†à¦ªà¦¾à¦° à¦²à§à¦ª',                                      en: 'UPPER LOOP' },
    { bn: 'à¦¬à¦¾à¦¦à¦¿',                                          en: 'WADI' },
    { bn: 'à¦œà¦¿à¦ª à¦—à¦¾à¦°à§à¦¡',                                      en: 'ZIP GUARD' },
    { bn: 'à¦†à¦ªà¦¾à¦° à¦Ÿà¦ª',                                       en: 'UPPER TOP' },
    { bn: 'à¦†à¦ªà¦¾à¦°',                                          en: 'UPPER' },
    { bn: 'à¦¬à§‹à¦²à¦¾',                                          en: 'BOLA' },
    { bn: 'à¦¡à¦¿-à¦²à§à¦ª',                                        en: 'D-LOOP' },
    { bn: 'à¦®à§à¦¯à¦¾à¦—à¦¨à§‡à¦Ÿ à¦²à§à¦ª',                                    en: 'MAGNET LOOP' },
    { bn: 'à¦¤à¦²à¦¾',                                          en: 'TOLA' },
    { bn: 'à¦«à¦¾à¦‡à¦¨à¦¾à¦² à¦¬à§à¦¯à¦¾à¦—',                                   en: 'FINAL BAG' },
    { bn: 'à¦—à§à¦°à§à¦¯à¦¾à¦¬ à¦¹à§à¦¯à¦¾à¦¨à§à¦¡à§‡à¦² à¦²à§à¦ª',                            en: 'GRAB HANDLE LOOP' },
    { bn: 'à¦—à§à¦°à§à¦¯à¦¾à¦¬ à¦¹à§à¦¯à¦¾à¦¨à§à¦¡à§‡à¦² à¦«à¦¾à¦‡à¦¨à¦¾à¦²',                          en: 'GRAB HANDLE FINAL' },
    { bn: 'à¦¸à§à¦®à¦² à¦¶à§‹à¦²à§à¦¡à¦¾à¦° à¦¹à§à¦¯à¦¾à¦¨à§à¦¡à§‡à¦²',                           en: 'SMALL SHOULDER HANDLE' },
    { bn: 'à¦¬à¦¿à¦— à¦¶à§‹à¦²à§à¦¡à¦¾à¦° à¦¹à§à¦¯à¦¾à¦¨à§à¦¡à§‡à¦²',                            en: 'BIG SHOULDER HANDLE' },
    { bn: 'à¦œà¦¿à¦ªà¦¾à¦° à¦ªà¦Ÿà§à¦Ÿà¦¿ à¦‡à¦¨à¦¸à¦¾à¦‡à¦¡',                              en: 'ZIPPER POTTI INSIDE' },
    { bn: 'à¦œà¦¿à¦ªà¦¾à¦° à¦ªà¦Ÿà§à¦Ÿà¦¿ à¦†à¦‰à¦Ÿà¦¸à¦¾à¦‡à¦¡',                             en: 'ZIPPER POTTI OUTSIDE' },
    { bn: 'à¦¶à§‹à¦²à§à¦¡à¦¾à¦° à¦¹à§à¦¯à¦¾à¦¨à§à¦¡à§‡à¦² à¦²à§à¦ª',                            en: 'SHOULDER HANDLE LOOP' },
    { bn: 'à¦†à¦ªà¦¾à¦° à¦‡à¦¨à¦¸à¦¾à¦‡à¦¡ à¦ªà¦Ÿà§à¦Ÿà¦¿ (à¦«à§à¦°à¦¨à§à¦Ÿ & à¦¬à§à¦¯à¦¾à¦•)',                en: 'UPPER INSIDE POTTI (FRONT & BACK)' },
    { bn: '', en: '' },
    { bn: '', en: '' },
    { bn: '', en: '' },
    { bn: '', en: '' },
    { bn: '', en: '' },
    { bn: '', en: '' },
    { bn: '', en: '' },
    { bn: '', en: '' },
    { bn: '', en: '' },
    { bn: '', en: '' }
];

// extractEdgePaintFields â€” the header fields are read by fixed position
// relative to the PDF download icon rather than by header text, since the
// sheet doesn't reliably label every column. The icon is rendered right
// after the "Batch No./Batch ID" column (anchorIdx below), so:
//   colAt(anchorIdx + N) = value of the N-th column to the right of the icon
function extractEdgePaintFields(headers, row, batchIdOverride) {
    var anchorIdx = findHeaderIndex(headers, [/batch\s*no\.?/i, /batch\s*id/i]);
    if (anchorIdx < 0) anchorIdx = 0;

    function colAt(n) {
        var v = row[anchorIdx + n];
        return (v !== undefined && v !== null) ? String(v) : '';
    }

    return {
        batchId:      (batchIdOverride !== undefined && batchIdOverride !== null && String(batchIdOverride) !== '')
                          ? String(batchIdOverride)
                          : colAt(1),   // 1st column to the right of the PDF icon
        po:           colAt(14),       // 14th column to the right of the PDF icon
        floorNo:      '',              // left blank
        unit:         colAt(4),        // 4th column to the right of the PDF icon
        styleNo:      colAt(10),       // 10th column to the right of the PDF icon
        sku:          colAt(9),        // 9th column to the right of the PDF icon
        fabricator:   colAt(20),       // 20th column to the right of the PDF icon
        colour:       colAt(11),       // 11th column to the right of the PDF icon
        quantity:     colAt(12),       // 12th column to the right of the PDF icon
        etd:          colAt(13),       // 13th column to the right of the PDF icon
        checkingDate: '',              // left blank
        checkerName:  colAt(21),       // 21st column to the right of the PDF icon
        remarks:      findFieldValue(headers, row, [/remarks/i])
    };
}

function generateEdgePaintFormId() {
    var rand = Math.floor(1000 + Math.random() * 9000);
    return 'EDGEINK-' + rand + '-TRIO';
}

function formatEdgePaintGeneratedAt(date) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var pad2   = function (n) { return n < 10 ? '0' + n : '' + n; };
    var h24    = date.getHours();
    var ampm   = h24 >= 12 ? 'pm' : 'am';
    var h12    = h24 % 12; if (h12 === 0) h12 = 12;
    return pad2(date.getDate()) + '-' + months[date.getMonth()] + '-' + date.getFullYear() + ' ' +
        pad2(h12) + ':' + pad2(date.getMinutes()) + ' ' + ampm;
}

function edgePaintInspectionStyles() {
    return (
        '@import url(\'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;700&display=swap\');' +
        '.epi-doc{font-family:Verdana,Geneva,sans-serif;}' +
        '.epi-topbar{display:flex;justify-content:space-between;align-items:center;font-size:9px;font-weight:bold;color:#12224e;margin-bottom:4px;}' +
        '.epi-company-name{font-size:11px;font-weight:bold;color:#12224e;letter-spacing:.3px;}' +
        '.epi-info-block{margin-bottom:7px;}' +
        '.epi-info-row{display:flex;border:1.5px solid #12224e;border-bottom:none;}' +
        '.epi-info-row:last-child{border-bottom:1.5px solid #12224e;}' +
        '.epi-info-cell{flex:1;border-right:1.5px solid #12224e;padding:6px 8px;min-height:26px;display:flex;align-items:baseline;gap:5px;}' +
        '.epi-info-cell:last-child{border-right:none;}' +
        '.epi-info-cell-wide{flex:2;}' +
        '.epi-label{display:inline;font-size:10.5px;font-weight:bold;color:#12224e;letter-spacing:.2px;white-space:nowrap;}' +
        '.epi-value{display:inline;font-size:13px;font-weight:bold;color:#0f172a;}' +
        '.epi-remarks-box{border:1.5px solid #12224e;border-top:none;padding:5px 8px;margin-bottom:7px;display:flex;align-items:center;gap:8px;}' +
        '.epi-remarks-box .epi-label{white-space:nowrap;}' +
        '.epi-remarks-line{flex:1;border-bottom:1px solid #12224e;height:14px;}' +
        '.epi-checker-row{display:flex;align-items:stretch;gap:8px;margin-bottom:8px;}' +
        '.epi-checker-cell{flex:1;border:1.5px solid #12224e;padding:7px 8px;display:flex;align-items:baseline;gap:5px;}' +
        '.epi-legend{flex:2;border:1.5px solid #12224e;padding:4px 8px;font-size:10px;font-weight:bold;color:#12224e;display:flex;align-items:center;}' +
        '.epi-parts-table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:10px;}' +
        '.epi-parts-table th,.epi-parts-table td{border:1.2px solid #12224e;padding:4px;font-size:9px;text-align:center;vertical-align:middle;line-height:1.25;}' +
        '.epi-parts-table th{background:#f1f5f9;color:#12224e;font-weight:bold;}' +
        '.epi-parts-table tbody td{height:32px;}' +
        '.epi-col-sl{width:30px;color:#334155;}' +
        '.epi-col-parts{width:42%;text-align:left;}' +
        '.epi-col-parts .epi-bn{font-family:\'Noto Sans Bengali\',Verdana,sans-serif;font-size:14px;font-weight:bold;color:#0f172a;}' +
        '.epi-col-parts .epi-en{font-size:12px;font-weight:bold;color:#334155;margin-left:5px;}' +
        '.epi-col-qty{width:70px;}' +
        '.epi-col-overlap{width:80px;}' +
        '.epi-col-remarks{width:auto;text-align:left;}' +
        '.epi-doc .sign-row{margin-top:calc(var(--fit-scale,1) * 100px);}'
    );
}

function buildEdgePaintInfoRows(f) {
    return (
        '<div class="epi-info-row">' +
            '<div class="epi-info-cell"><span class="epi-label">BATCH ID:</span><span class="epi-value">' + (esc(f.batchId) || '&nbsp;') + '</span></div>' +
            '<div class="epi-info-cell"><span class="epi-label">PO:</span><span class="epi-value">' + (esc(f.po) || '&nbsp;') + '</span></div>' +
            '<div class="epi-info-cell"><span class="epi-label">FLOOR NO.:</span><span class="epi-value">' + (esc(f.floorNo) || '&nbsp;') + '</span></div>' +
            '<div class="epi-info-cell"><span class="epi-label">UNIT:</span><span class="epi-value">' + (esc(f.unit) || '&nbsp;') + '</span></div>' +
        '</div>' +
        '<div class="epi-info-row">' +
            '<div class="epi-info-cell"><span class="epi-label">STYLE NO.:</span><span class="epi-value">' + (esc(f.styleNo) || '&nbsp;') + '</span></div>' +
            '<div class="epi-info-cell"><span class="epi-label">SKU:</span><span class="epi-value">' + (esc(f.sku) || '&nbsp;') + '</span></div>' +
            '<div class="epi-info-cell epi-info-cell-wide"><span class="epi-label">FABRICATOR NAME/ NO.:</span><span class="epi-value">' + (esc(f.fabricator) || '&nbsp;') + '</span></div>' +
        '</div>' +
        '<div class="epi-info-row">' +
            '<div class="epi-info-cell"><span class="epi-label">COLOUR:</span><span class="epi-value">' + (esc(f.colour) || '&nbsp;') + '</span></div>' +
            '<div class="epi-info-cell epi-info-cell-wide"><span class="epi-label">QTY:</span><span class="epi-value">' + (esc(f.quantity) || '&nbsp;') + '</span></div>' +
        '</div>' +
        '<div class="epi-info-row">' +
            '<div class="epi-info-cell epi-info-cell-wide"><span class="epi-label">ETD:</span><span class="epi-value">' + (esc(f.etd) || '&nbsp;') + '</span></div>' +
            '<div class="epi-info-cell epi-info-cell-wide"><span class="epi-label">CHECKING DATE:</span><span class="epi-value">' + (esc(f.checkingDate) || '&nbsp;') + '</span></div>' +
        '</div>'
    );
}

function buildEdgePaintPartsTable() {
    var TOTAL_ROWS = 30;
    var rows = [];
    for (var i = 0; i < TOTAL_ROWS; i++) {
        var part = EDGE_PAINT_PARTS_CHECKLIST[i];
        var partCell = (part && part.en)
            ? '<span class="epi-bn">' + esc(part.bn) + '</span><span class="epi-en">(' + esc(part.en) + ')</span>'
            : '&nbsp;';
        rows.push(
            '<tr>' +
                '<td class="epi-col-sl">' + (i < 9 ? '0' + (i + 1) : (i + 1)) + '</td>' +
                '<td class="epi-col-parts">' + partCell + '</td>' +
                '<td class="epi-col-qty">&nbsp;</td>' +
                '<td class="epi-col-qty">&nbsp;</td>' +
                '<td class="epi-col-overlap">&nbsp;</td>' +
                '<td class="epi-col-remarks">&nbsp;</td>' +
            '</tr>'
        );
    }

    return (
        '<table class="epi-parts-table">' +
            '<thead>' +
                '<tr>' +
                    '<th class="epi-col-sl">SL.<br>NO.</th>' +
                    '<th class="epi-col-parts">PARTS</th>' +
                    '<th class="epi-col-qty">CHECKED<br>QTY</th>' +
                    '<th class="epi-col-qty">REPAIR<br>QTY</th>' +
                    '<th class="epi-col-overlap">OVERLAPPING<br>(YES/NO)</th>' +
                    '<th class="epi-col-remarks">REMARKS</th>' +
                '</tr>' +
            '</thead>' +
            '<tbody>' + rows.join('') + '</tbody>' +
        '</table>'
    );
}

function buildEdgePaintPdfHtml(headers, row, batchIdOverride) {
    var f = extractEdgePaintFields(headers, row, batchIdOverride);

    var signHtml =
        '<div class="sign-row">' +
            '<div class="sign-cell">Signature of Edge Paint Inspector<span class="sign-line"></span></div>' +
            '<div class="sign-cell">Signature of the Approving Authority<span class="sign-line"></span></div>' +
        '</div>';

    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<title>Edge-Paint Inspection Report' + (f.batchId ? ' - ' + esc(f.batchId) : '') + '</title>' +
        '<style>' + checklistPdfBaseStyles() + edgePaintInspectionStyles() + '</style>' +
        '</head><body><div class="doc epi-doc">' +
            '<div class="epi-topbar">' +
                '<div class="epi-company-name">Trio Trend Exports Pvt. Ltd.</div>' +
                '<div>Generated at : ' + esc(formatEdgePaintGeneratedAt(new Date())) + '</div>' +
            '</div>' +
            '<div class="title">EDGE-PAINT INSPECTION REPORT</div>' +
            '<div class="epi-info-block">' + buildEdgePaintInfoRows(f) + '</div>' +
            '<div class="epi-remarks-box"><span class="epi-label">REMARKS (IF ANY)</span><span class="epi-remarks-line"></span></div>' +
            '<div class="epi-checker-row">' +
                '<div class="epi-checker-cell"><span class="epi-label">EDGE PAINT CHECKER NAME:</span><span class="epi-value">' + (esc(f.checkerName) || '&nbsp;') + '</span></div>' +
                '<div class="epi-legend">OVERLAPPING â€” PLEASE TICK (&#10003;) HERE UNDER YES / NO</div>' +
            '</div>' +
            buildEdgePaintPartsTable() +
            signHtml +
        '</div></body></html>'
    );
}

function fitChecklistToPage(win) {
    // Grows or shrinks row heights / section gaps (via the --fit-scale CSS
    // var) so the checklist fills the printable A4 area with no leftover
    // blank space at the bottom, and never overflows onto a second page.
    var doc  = win.document.querySelector('.doc, .doc-page');
    var root = win.document.documentElement;
    if (!doc || !root) return;

    if (doc.classList.contains('fs-report-doc')) {
        var FS_MAX_H = 1050;
        if (doc.scrollHeight > FS_MAX_H) {
            var ratio = Math.max(0.92, (FS_MAX_H / doc.scrollHeight).toFixed(2));
            doc.style.zoom = ratio;
        }
        return;
    }

    var PAGE_HEIGHT_PX = 1000; // ~A4 height minus 8mm top/bottom margins
    var PAGE_WIDTH_PX  = 718;  // ~A4 width minus 8mm left/right margins
    var TOLERANCE      = 6;
    var MAX_ITER        = 40;
    var scale           = 1;
    var MIN_SCALE       = 0.4;
    var MAX_SCALE       = 3.2;

    for (var i = 0; i < MAX_ITER; i++) {
        var h = doc.scrollHeight;
        if (h > PAGE_HEIGHT_PX + TOLERANCE && scale > MIN_SCALE) {
            scale = Math.max(MIN_SCALE, scale - 0.06);
        } else if (h < PAGE_HEIGHT_PX - TOLERANCE && scale < MAX_SCALE) {
            scale = Math.min(MAX_SCALE, scale + 0.06);
        } else {
            break;
        }
        root.style.setProperty('--fit-scale', scale.toFixed(2));
    }

    // Final safety net: if content still doesn't fit within the page
    // (extreme edge cases), shrink the whole document uniformly.
    var finalHeight = doc.scrollHeight;
    var finalWidth  = doc.scrollWidth;
    var fallback = Math.min(PAGE_HEIGHT_PX / finalHeight, PAGE_WIDTH_PX / finalWidth, 1);
    if (fallback < 0.98) {
        win.document.body.style.zoom = fallback;
    }
}

function openChecklistPrintWindow(html) {
    var win = window.open('', '_blank', 'width=900,height=750');
    if (!win) {
        showToast('error', 'Popup Blocked', 'Please allow popups to download the PDF.');
        return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(function () {
        try { fitChecklistToPage(win); } catch (e) { /* ignore */ }
        try { win.print(); } catch (e) { /* ignore */ }
    }, 300);
}

// ---------------------------------------------------------------------------
// downloadFsRowAsPdf / downloadIqcRowAsPdf â€” entry points used by the
// "PDF File" download-icon column in the Floor Supervisor and In-Line QC
// tables. Each opens a print-ready window styled to match the approved
// checklist layout (Verdana font throughout).
// ---------------------------------------------------------------------------
function downloadFsRowAsPdf(headers, row, batchIdOverride) {
    try {
        openChecklistPrintWindow(buildFsPdfHtml(headers, row, batchIdOverride));
    } catch (err) {
        showToast('error', 'PDF Error', 'Could not generate the PDF: ' + (err.message || err));
    }
}

function downloadIqcRowAsPdf(headers, row, batchIdOverride) {
    try {
        openChecklistPrintWindow(buildIqcPdfHtml(headers, row, batchIdOverride));
    } catch (err) {
        showToast('error', 'PDF Error', 'Could not generate the PDF: ' + (err.message || err));
    }
}

function downloadEdgePaintRowAsPdf(headers, row, batchIdOverride) {
    try {
        openChecklistPrintWindow(buildEdgePaintPdfHtml(headers, row, batchIdOverride));
    } catch (err) {
        showToast('error', 'PDF Error', 'Could not generate the PDF: ' + (err.message || err));
    }
}

// ---------------------------------------------------------------------------
// END-LINE INSPECTION REPORT â€” reconstructed to match the approved printed
// form exactly: title, two side-by-side batch-info blocks, separate quantity
// boxes, a fixed 30-row checklist (SL NO. / REPAIRING REASON), and the two
// "APPROVED BY" / "CHECKED BY" signature lines. The
// batch info fields are read by fixed position relative to the PDF download
// icon, same approach as extractEdgePaintFields above. The icon is rendered
// right after the "Batch No./Batch ID" column (anchorIdx below), so:
//   colAt(anchorIdx + N) = value of the N-th column to the right of the icon
// ---------------------------------------------------------------------------
function extractEndLineQcFields(headers, row, batchIdOverride) {
    var anchorIdx = findHeaderIndex(headers, [/batch\s*no\.?/i, /batch\s*id/i]);
    if (anchorIdx < 0) anchorIdx = 0;

    function colAt(n) {
        var v = row[anchorIdx + n];
        return (v !== undefined && v !== null) ? String(v) : '';
    }

    return {
        batchId:       (batchIdOverride !== undefined && batchIdOverride !== null && String(batchIdOverride) !== '')
                           ? String(batchIdOverride)
                           : colAt(1),    // 1st column to the right of the PDF icon
        po:            colAt(14),        // 14th column to the right of the PDF icon
        floorNo:       '',               // left blank
        unit:          colAt(4),         // 4th column to the right of the PDF icon
        styleNo:       colAt(10),        // 10th column to the right of the PDF icon
        sku:           colAt(9),         // 9th column to the right of the PDF icon
        fabricator:    colAt(5),         // 5th column to the right of the PDF icon
        colour:        colAt(11),        // 11th column to the right of the PDF icon
        quantity:      colAt(12),        // 12th column to the right of the PDF icon
        endLineQcName: colAt(29),        // 29th column to the right of the PDF icon
        etd:           colAt(13),        // 13th column to the right of the PDF icon
        checkingDate:  ''                // left blank
    };
}

function endLineQcInspectionStyles() {
    return (
        '.eqc-doc,.eqc-doc *{font-family:Verdana,Geneva,sans-serif;color:#000;}' +
        '.eqc-topbar{display:flex;justify-content:space-between;align-items:center;margin:0 0 2px;font-size:8px;font-weight:700;}' +
        '.eqc-doc .title{font-family:Verdana,Geneva,sans-serif;color:#000;font-size:22px;letter-spacing:1px;margin:0 0 4px;}' +
        '.eqc-sheet{border:1.5px solid #000;padding:7px;margin-top:0;}' +
        '.eqc-top{display:flex;gap:8px;margin:5px 0 14px;}' +
        '.eqc-left{width:39%;}.eqc-right{width:61%;}' +
        '.eqc-meta{width:100%;border-collapse:collapse;table-layout:fixed;}' +
        '.eqc-meta td{border:1px solid #000;height:25px;padding:3px 5px;font-size:10px;vertical-align:middle;}' +
        '.eqc-meta .eqc-label{font-weight:700;font-size:10px;white-space:nowrap;}' +
        '.eqc-meta .eqc-value{font-size:9px;letter-spacing:.1px;}' +
        '.eqc-meta .eqc-name{font-weight:700;font-size:9px;line-height:1.12;}' +
        '.eqc-bottom{display:flex;gap:8px;margin-bottom:14px;}' +
        '.eqc-summary{width:100%;border-collapse:collapse;table-layout:fixed;}' +
        '.eqc-summary th,.eqc-summary td{border:1px solid #000;text-align:center;padding:3px;font-size:10px;}' +
        '.eqc-summary th{height:20px;font-weight:700;white-space:nowrap;}' +
        '.eqc-summary td{height:46px;}' +
        '.eqc-table{width:100%;border-collapse:collapse;table-layout:fixed;}' +
        '.eqc-table th,.eqc-table td{border:1px solid #000;padding:2px 4px;font-size:10px;text-align:center;vertical-align:middle;line-height:1;}' +
        '.eqc-table th{height:21px;background:#fff;color:#000;font-size:10px;font-weight:700;}' +
        '.eqc-table tbody td{height:22px;}' +
        '.eqc-col-sl{width:72px;color:#000;font-weight:700;}' +
        '.eqc-col-reason{width:auto;text-align:left;}' +
        '.eqc-doc .sign-row{margin:calc(var(--fit-scale,1) * 115px) 0 0;}' +
        '.eqc-doc .sign-cell{color:#000;font-size:9px;text-align:center;width:185px;}' +
        '.eqc-doc .sign-line{display:block;width:100%;height:12px;margin:0 0 3px;border-color:#000;}'
    );
}

function formatEndLineQcGeneratedAt(date) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad2(date.getDate()) + '-' + months[date.getMonth()] + '-' + date.getFullYear() + ' ' +
        pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
}

function buildEndLineQcInfoRows(f) {
    return (
        '<div class="eqc-top">' +
            '<div class="eqc-left"><table class="eqc-meta"><tr><td><span class="eqc-label">BATCH ID&nbsp; :</span>&nbsp; <span class="eqc-value">' + (esc(f.batchId) || '&nbsp;') + '</span></td><td><span class="eqc-label">PO&nbsp; :</span>&nbsp; <span class="eqc-value">' + (esc(f.po) || '&nbsp;') + '</span></td></tr><tr><td><span class="eqc-label">STYLE NO.&nbsp; :</span>&nbsp; <span class="eqc-value">' + (esc(f.styleNo) || '&nbsp;') + '</span></td><td><span class="eqc-label">SKU&nbsp; :</span>&nbsp; <span class="eqc-value">' + (esc(f.sku) || '&nbsp;') + '</span></td></tr><tr><td><span class="eqc-label">COLOUR&nbsp; :</span>&nbsp; <span class="eqc-value">' + (esc(f.colour) || '&nbsp;') + '</span></td><td><span class="eqc-label">QTY&nbsp; :</span>&nbsp; <span class="eqc-value">' + (esc(f.quantity) || '&nbsp;') + '</span></td></tr></table></div>' +
            '<div class="eqc-right"><table class="eqc-meta"><tr><td style="width:67%"><span class="eqc-label">FLOOR NO.&nbsp; :</span>&nbsp; <span class="eqc-value">' + (esc(f.floorNo) || '&nbsp;') + '</span></td><td><span class="eqc-label">UNIT&nbsp; :</span>&nbsp; <span class="eqc-value">' + (esc(f.unit) || '&nbsp;') + '</span></td></tr><tr><td><span class="eqc-label">FABRICATOR NAME/ NO.&nbsp; :</span></td><td><span class="eqc-value">' + (esc(f.fabricator) || '&nbsp;') + '</span></td></tr><tr><td><span class="eqc-label">END-LINE QC NAME&nbsp; :</span></td><td><span class="eqc-value eqc-name">' + (esc(f.endLineQcName) || '&nbsp;') + '</span></td></tr></table></div>' +
        '</div>' +
        '<div class="eqc-bottom">' +
            '<div class="eqc-left"><table class="eqc-meta"><tr><td><span class="eqc-label">ETD&nbsp; :</span>&nbsp; <span class="eqc-value" style="font-weight:700">' + (esc(f.etd) || '&nbsp;') + '</span></td></tr></table></div>' +
            '<div class="eqc-right"><table class="eqc-meta"><tr><td><span class="eqc-label">CHECKING DATE&nbsp; :</span>&nbsp; <span class="eqc-value">' + (esc(f.checkingDate) || '&nbsp;') + '</span></td></tr></table></div>' +
        '</div>'
    );
}

function buildEndLineQcChecklistTable() {
    var TOTAL_ROWS = 30;
    var rows = [];
    for (var i = 0; i < TOTAL_ROWS; i++) {
        rows.push(
            '<tr>' +
                '<td class="eqc-col-sl">' + (i + 1) + '</td>' +
                '<td class="eqc-col-reason">&nbsp;</td>' +
            '</tr>'
        );
    }

    return (
        '<table class="eqc-table">' +
            '<thead>' +
                '<tr>' +
                    '<th class="eqc-col-sl">SL. NO.</th>' +
                    '<th class="eqc-col-reason">REPAIRING REASON</th>' +
                '</tr>' +
            '</thead>' +
            '<tbody>' + rows.join('') + '</tbody>' +
        '</table>'
    );
}

function buildEndLineQcPdfHtml(headers, row, batchIdOverride) {
    var f = extractEndLineQcFields(headers, row, batchIdOverride);
    var generatedAt = formatEndLineQcGeneratedAt(new Date());

    var signHtml =
        '<div class="sign-row">' +
            '<div class="sign-cell"><span class="sign-line"></span>APPROVED BY</div>' +
            '<div class="sign-cell"><span class="sign-line"></span>CHECKED BY</div>' +
        '</div>';

    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<title>End-Line Inspection Report' + (f.batchId ? ' - ' + esc(f.batchId) : '') + '</title>' +
        '<style>' + checklistPdfBaseStyles() + endLineQcInspectionStyles() + '</style>' +
        '</head><body><div class="doc eqc-doc">' +
            '<div class="eqc-topbar"><span>Trio Trens Exports Pvt. Ltd.</span><span>Generated At : ' + esc(generatedAt) + '</span></div>' +
            '<div class="title">END-LINE INSPECTION REPORT</div>' +
            '<div class="eqc-sheet">' +
            buildEndLineQcInfoRows(f) +
            '<div class="eqc-bottom"><div class="eqc-left"><table class="eqc-summary"><thead><tr><th>CHECKED QTY</th></tr></thead><tbody><tr><td>&nbsp;</td></tr></tbody></table></div><div class="eqc-right"><table class="eqc-summary"><thead><tr><th>REPAIR QTY</th><th>QTY SEND TO WAREHOUSE</th></tr></thead><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table></div></div>' +
            buildEndLineQcChecklistTable() +
            '</div>' +
            signHtml +
        '</div></body></html>'
    );
}

function downloadEndLineQcRowAsPdf(headers, row, batchIdOverride) {
    if (window.EndLineQcSheetEngine && typeof window.EndLineQcSheetEngine.downloadRowPdf === 'function') {
        window.EndLineQcSheetEngine.downloadRowPdf(row);
        return;
    }
    try {
        openChecklistPrintWindow(buildEndLineQcPdfHtml(headers, row, batchIdOverride));
    } catch (err) {
        showToast('error', 'PDF Error', 'Could not generate the PDF: ' + (err.message || err));
    }
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
function buildPagination(current, total) {
    var container = document.getElementById('fms-data-pagination');
    if (!container) return;
    container.innerHTML = '';

    function mkBtn(label, page, disabled, active, isIcon) {
    var btn = document.createElement('button');
    btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
    if (isIcon) {
        btn.innerHTML = '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>';
    } else {
        btn.textContent = label;
    }
    btn.disabled = disabled;
    if (!disabled) {
        btn.addEventListener('click', function () {
        fmsTableData.page = page;
        renderFmsTable();
        var wrap = document.getElementById('fms-data-table-wrap');
        if (wrap) wrap.scrollTop = 0;
        });
    }
    return btn;
    }

    container.appendChild(mkBtn('first_page', 1, current <= 1, false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1, false, true));

    var range = paginationRange(current, total);
    range.forEach(function (item) {
    if (item === 'â€¦') {
        var ellipsis = document.createElement('span');
        ellipsis.className = 'dt-page-ellipsis';
        ellipsis.textContent = 'â€¦';
        container.appendChild(ellipsis);
    } else {
        container.appendChild(mkBtn(item, item, false, item === current, false));
    }
    });

    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page', total, current >= total, false, true));
}

function paginationRange(current, total) {
    if (total <= 7) {
    var arr = [];
    for (var i = 1; i <= total; i++) arr.push(i);
    return arr;
    }
    var pages = [1];
    if (current > 3) pages.push('â€¦');
    for (var p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
    }
    if (current < total - 2) pages.push('â€¦');
    pages.push(total);
    return pages;
}

function updateSearchClearBtn() {
    var searchEl = document.getElementById('fms-data-search');
    var clearBtn = document.getElementById('fms-data-search-clear');
    if (!searchEl || !clearBtn) return;
    clearBtn.style.display = searchEl.value ? '' : 'none';
}

function updateDateClearBtn() {
    var clearBtn = document.getElementById('fms-date-clear');
    if (!clearBtn) return;
    var hasDate = fmsTableData.dateFrom || fmsTableData.dateTo;
    clearBtn.style.display = hasDate ? '' : 'none';
}

// ---------------------------------------------------------------------------
// Excel export â€” true .xlsx workbook via ExcelJS (shared exportRowsToXlsx helper)
// Exports only the currently filtered records (respects all active filters)
// ---------------------------------------------------------------------------
function downloadExcel() {
    var headers = fmsTableData.headers;
    var rows    = fmsTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Submitted FMS Data',
        filenamePrefix: 'Submitted_FMS_Data',
        useFormatCellValue: true
    });
}

// ---------------------------------------------------------------------------
// Cell display formatter â€” applies column-specific formatting rules
// ---------------------------------------------------------------------------
function formatCellValue(header, value) {
    var h = (header || '').trim().toLowerCase();
    var v = String(value !== undefined && value !== null ? value : '');

    // Batch ID: zero-pad to 4 digits (only when it's a pure integer 1-9999)
    if (h === 'batch id') {
    var n = parseInt(v, 10);
    if (!isNaN(n) && String(n) === v.trim() && n >= 0) {
        return ('0000' + n).slice(-4);
    }
    }

    return v;
}

// ---------------------------------------------------------------------------
// Reports â€” wire up all interactions
// ---------------------------------------------------------------------------
function initReports() {
    // preloadSubmittedFmsFromDb(); // now handled by SubmittedFmsSheetEngine (submitted_fms_sheet.js)

    // NOTE: preloadSubmittedFmsFromDb() and kpi-submitted-fms click handler
    // are now handled by submitted_fms_sheet.js (SubmittedFmsSheetEngine).
    // The new engine uses capture-phase listeners (true) which take priority.
    // preloadSubmittedFmsFromDb();

    // var kpiCard = document.getElementById('kpi-submitted-fms');  // handled by submitted_fms_sheet.js
    // if (kpiCard) { kpiCard.addEventListener('click', showReportsFmsDataView); }

    [['dice', 'kpi-dice-summary'], ['forma', 'kpi-forma-summary'], ['domestic', 'kpi-submitted-domestic'], ['import', 'kpi-submitted-import'], ['trio', 'kpi-trio-ai-data']].forEach(function (item) {
        var type = item[0];
        var card = document.getElementById(item[1]);
        if (!card) return;
        card.addEventListener('click', function () { showTrackerSummary(type); });
        card.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showTrackerSummary(type); }
        });
    });
    document.querySelectorAll('.tracker-summary-back').forEach(function (button) {
        button.addEventListener('click', showReportsKpiView);
    });

    ['dice', 'forma', 'domestic', 'import'].forEach(function (type) {
        var config = getTrackerSummaryConfig(type);
        var prefix = config.prefix;
        var state  = getTrackerSummaryState(type);

        var refreshBtn = document.getElementById('btn-refresh-' + prefix);
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                state.allRows       = [];
                state.columnFilters = {};
                fetchTrackerSummary(type);
            });
        }

        var excelBtn = document.getElementById('btn-download-' + prefix + '-excel');
        if (excelBtn) excelBtn.addEventListener('click', function () { downloadTrackerSummaryExcel(type); });

        var searchEl = document.getElementById(prefix + '-search');
        if (searchEl) {
            searchEl.addEventListener('input', function () {
                updateTrackerSummarySearchClearBtn(type);
                applyTrackerSummarySearch(type, searchEl.value);
            });
        }
        var clearSearchBtn = document.getElementById(prefix + '-search-clear');
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', function () {
                var s = document.getElementById(prefix + '-search');
                if (s) { s.value = ''; s.focus(); }
                updateTrackerSummarySearchClearBtn(type);
                applyTrackerSummarySearch(type, '');
            });
        }

        var dateFromEl = document.getElementById(prefix + '-date-from');
        if (dateFromEl) {
            dateFromEl.addEventListener('change', function () {
                state.dateFrom = dateFromEl.value;
                updateTrackerSummaryDateClearBtn(type);
                applyTrackerSummaryFilters(type);
            });
        }
        var dateToEl = document.getElementById(prefix + '-date-to');
        if (dateToEl) {
            dateToEl.addEventListener('change', function () {
                state.dateTo = dateToEl.value;
                updateTrackerSummaryDateClearBtn(type);
                applyTrackerSummaryFilters(type);
            });
        }
        var dateClearBtn = document.getElementById(prefix + '-date-clear');
        if (dateClearBtn) {
            dateClearBtn.addEventListener('click', function () {
                state.dateFrom = '';
                state.dateTo   = '';
                var f = document.getElementById(prefix + '-date-from');
                var t = document.getElementById(prefix + '-date-to');
                if (f) f.value = '';
                if (t) t.value = '';
                updateTrackerSummaryDateClearBtn(type);
                applyTrackerSummaryFilters(type);
            });
        }

        var pageSizeEl = document.getElementById(prefix + '-page-size');
        if (pageSizeEl) {
            pageSizeEl.addEventListener('change', function () {
                state.pageSize = parseInt(pageSizeEl.value, 10) || 25;
                state.page = 1;
                renderTrackerSummaryTable(type);
            });
        }
    });

    // NOTE: btn-back-reports, btn-download-excel, btn-refresh-fms-data
    // are now handled by submitted_fms_sheet.js (capture phase, priority).
    // Keeping below as no-ops since elements exist only in FMS data view.
    // var backBtn = document.getElementById('btn-back-reports');  // handled by submitted_fms_sheet.js
    // var excelBtn = document.getElementById('btn-download-excel');  // handled by submitted_fms_sheet.js
    // var refreshBtn = document.getElementById('btn-refresh-fms-data');  // handled by submitted_fms_sheet.js

    // â”€â”€ Global search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var searchEl = document.getElementById('fms-data-search');
    if (searchEl) {
    searchEl.addEventListener('input', function () {
        updateSearchClearBtn();
        applySearch(searchEl.value);
    });
    }

    var clearSearchBtn = document.getElementById('fms-data-search-clear');
    if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', function () {
        var searchEl2 = document.getElementById('fms-data-search');
        if (searchEl2) { searchEl2.value = ''; searchEl2.focus(); }
        updateSearchClearBtn();
        applySearch('');
    });
    }

    // â”€â”€ Date range â€” From â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Manual edit â†’ clear any active period selection so the period dropdown
    // no longer claims ownership of the date range.
    var dateFromEl = document.getElementById('fms-date-from');
    if (dateFromEl) {
    dateFromEl.addEventListener('change', function () {
        fmsTableData.dateFrom = dateFromEl.value;
        // Clear period â€” user is now driving the range manually
        fmsTableData.period = '';
        var periodSel = document.getElementById('fms-period-filter');
        if (periodSel) periodSel.value = '';
        updateDateClearBtn();
        applyFilters();
    });
    }

    // â”€â”€ Date range â€” To â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var dateToEl = document.getElementById('fms-date-to');
    if (dateToEl) {
    dateToEl.addEventListener('change', function () {
        fmsTableData.dateTo = dateToEl.value;
        // Clear period â€” user is now driving the range manually
        fmsTableData.period = '';
        var periodSel = document.getElementById('fms-period-filter');
        if (periodSel) periodSel.value = '';
        updateDateClearBtn();
        applyFilters();
    });
    }

    // â”€â”€ Date clear button â€” resets dates AND period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var dateClearBtn = document.getElementById('fms-date-clear');
    if (dateClearBtn) {
    dateClearBtn.addEventListener('click', function () {
        fmsTableData.dateFrom = '';
        fmsTableData.dateTo   = '';
        fmsTableData.period   = '';
        var df = document.getElementById('fms-date-from');
        var dt = document.getElementById('fms-date-to');
        var ps = document.getElementById('fms-period-filter');
        if (df) df.value = '';
        if (dt) dt.value = '';
        if (ps) ps.value = '';
        updateDateClearBtn();
        applyFilters();
    });
    }

    // â”€â”€ Period filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // When a period is chosen:
    //   â€¢ Compute its exact start/end bounds.
    //   â€¢ Write those dates into the state (dateFrom / dateTo) AND into the
    //     DOM date inputs so the user can see the actual range being used.
    //   â€¢ Show the date-clear button so the user can reset with one click.
    //   â€¢ Delegate filtering to applyFilters() which uses dateFrom / dateTo.
    //
    // When "Any Period" is chosen, clear the date inputs and state.
    var periodEl = document.getElementById('fms-period-filter');
    if (periodEl) {
    periodEl.addEventListener('change', function () {
        var chosen = periodEl.value;
        fmsTableData.period = chosen;

        var df = document.getElementById('fms-date-from');
        var dt = document.getElementById('fms-date-to');

        if (chosen) {
        // Resolve the exact date range for the selected period
        var bounds = getBoundsForPeriod(chosen);
        if (bounds) {
            fmsTableData.dateFrom = dateToInputValue(bounds.start);
            fmsTableData.dateTo   = dateToInputValue(bounds.end);
            if (df) df.value = fmsTableData.dateFrom;
            if (dt) dt.value = fmsTableData.dateTo;
        }
        } else {
        // "Any Period" selected â€” clear the date fields
        fmsTableData.dateFrom = '';
        fmsTableData.dateTo   = '';
        if (df) df.value = '';
        if (dt) dt.value = '';
        }

        updateDateClearBtn();
        applyFilters();
    });
    }

    // â”€â”€ Page size â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var pageSizeEl = document.getElementById('fms-data-page-size');
    if (pageSizeEl) {
    pageSizeEl.addEventListener('change', function () {
        fmsTableData.pageSize = parseInt(pageSizeEl.value, 10) || 25;
        fmsTableData.page = 1;
        renderFmsTable();
    });
    }
}


// ===========================================================================
// BATCH LIST â€” Cutting Details
// ===========================================================================

var cuttingTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',   // YYYY-MM-DD â€” filters on Cutting Date column
    dateTo:        ''    // YYYY-MM-DD â€” filters on Cutting Date column
};

function showBatchListKpiView() {
    var kpiView     = document.getElementById('batch-list-kpi-view');
    var cutView     = document.getElementById('batch-list-cutting-view');
    var bantalaView = document.getElementById('batch-list-bantala-view');
    var floorQcView = document.getElementById('batch-list-floor-qc-view');
    var edgePaintView = document.getElementById('batch-list-edge-paint-view');
    var preAqlView = document.getElementById('batch-list-pre-aql-view');
    var trackingView = document.getElementById('batch-list-product-input-tracking-view');
    var whView      = document.getElementById('batch-list-warehouse-fms-view');
    if (kpiView)     kpiView.style.display     = '';
    if (cutView)     cutView.style.display     = 'none';
    if (bantalaView) bantalaView.style.display = 'none';
    if (floorQcView) floorQcView.style.display = 'none';
    if (edgePaintView) edgePaintView.style.display = 'none';
    if (preAqlView) preAqlView.style.display = 'none';
    if (trackingView) trackingView.style.display = 'none';
    if (whView)      whView.style.display      = 'none';
    // New subviews added in main.js carry the 'batch-list-extra-view' class
    // and get hidden here too, so navigating back to the Production Data KPI
    // grid always resets ALL subviews, including ones defined outside this file.
    document.querySelectorAll('.batch-list-extra-view').forEach(function (v) { v.style.display = 'none'; });
    if (window.ProductionLiveEngine && typeof window.ProductionLiveEngine.hide === 'function') {
        window.ProductionLiveEngine.hide();
    }
    applyKpiCardAccess();
}

function showBatchListProductInputTrackingView() {
    if (window.ProductInputTrackingSheetEngine && typeof window.ProductInputTrackingSheetEngine.show === 'function') {
        window.ProductInputTrackingSheetEngine.show();
        return;
    }
    var kpiView = document.getElementById('batch-list-kpi-view');
    var trackingView = document.getElementById('batch-list-product-input-tracking-view');
    if (kpiView) kpiView.style.display = 'none';
    document.querySelectorAll('.batch-list-extra-view').forEach(function (v) { v.style.display = 'none'; });
    if (trackingView) trackingView.style.display = '';
}

function showBatchListPmsView() {
    if (window.PmsSheetEngine && typeof window.PmsSheetEngine.show === 'function') {
        window.PmsSheetEngine.show();
        return;
    }
    var kpiView = document.getElementById('batch-list-kpi-view');
    var pmsView = document.getElementById('batch-list-pms-view');
    if (kpiView) kpiView.style.display = 'none';
    document.querySelectorAll('.batch-list-extra-view').forEach(function (v) { v.style.display = 'none'; });
    if (pmsView) pmsView.style.display = '';
}

function showBatchListWarehouseFmsView() {
    if (window.WarehouseFmsSheetEngine && typeof window.WarehouseFmsSheetEngine.show === 'function') {
        window.WarehouseFmsSheetEngine.show();
        return;
    }
    var kpiView = document.getElementById('batch-list-kpi-view');
    var whView = document.getElementById('batch-list-warehouse-fms-view');
    if (kpiView) kpiView.style.display = 'none';
    document.querySelectorAll('.batch-list-extra-view').forEach(function (v) { v.style.display = 'none'; });
    if (whView) whView.style.display = '';
}

function showBatchListProductionLiveView() {
    if (window.ProductionLiveEngine && typeof window.ProductionLiveEngine.show === 'function') {
        window.ProductionLiveEngine.show();
        return;
    }
    var kpiView = document.getElementById('batch-list-kpi-view');
    var liveView = document.getElementById('batch-list-production-live-view');
    if (kpiView) kpiView.style.display = 'none';
    document.querySelectorAll('.batch-list-extra-view').forEach(function (v) { v.style.display = 'none'; });
    if (liveView) liveView.style.display = 'block';
}

function showPdfKpiView() {
    var kpiView = document.getElementById('pdf-kpi-view');
    var fsView  = document.getElementById('pdf-floor-supervisor-view');
    var iqcView = document.getElementById('pdf-inline-qc-view');
    var eqcView = document.getElementById('pdf-endline-qc-view');
    var epView  = document.getElementById('pdf-edge-paint-view');
    var followUpView = document.getElementById('batch-list-followup-planned-view');
    if (kpiView) kpiView.style.display = '';
    if (fsView)  fsView.style.display  = 'none';
    if (iqcView) iqcView.style.display = 'none';
    if (eqcView) eqcView.style.display = 'none';
    if (epView)  epView.style.display  = 'none';
    if (followUpView) followUpView.style.display = 'none';
    if (window.FloorSupervisorSheetEngine && typeof window.FloorSupervisorSheetEngine.clearSelection === 'function') {
        window.FloorSupervisorSheetEngine.clearSelection();
    }
    if (window.InLineQcSheetEngine && typeof window.InLineQcSheetEngine.clearSelection === 'function') {
        window.InLineQcSheetEngine.clearSelection();
    }
    if (window.EndLineQcSheetEngine && typeof window.EndLineQcSheetEngine.clearSelection === 'function') {
        window.EndLineQcSheetEngine.clearSelection();
    }
    if (window.EdgePaintSheetEngine && typeof window.EdgePaintSheetEngine.clearSelection === 'function') {
        window.EdgePaintSheetEngine.clearSelection();
    }
    applyKpiCardAccess();
}

function showStoreKpiView() {
    var kpiView    = document.getElementById('store-kpi-view');
    var aiDataView = document.getElementById('store-ai-data-view');
    if (kpiView)    kpiView.style.display    = '';
    if (aiDataView) aiDataView.style.display = 'none';
    applyKpiCardAccess();
}

function showBatchListCuttingView() {
    if (window.BatchCuttingSheetEngine && typeof window.BatchCuttingSheetEngine.show === 'function') {
        window.BatchCuttingSheetEngine.show();
        return;
    }
    var kpiView     = document.getElementById('batch-list-kpi-view');
    var dataView    = document.getElementById('batch-list-cutting-view');
    var bantalaView = document.getElementById('batch-list-bantala-view');
    var floorQcView = document.getElementById('batch-list-floor-qc-view');
    var edgePaintView = document.getElementById('batch-list-edge-paint-view');
    var preAqlView = document.getElementById('batch-list-pre-aql-view');
    if (kpiView)     kpiView.style.display     = 'none';
    if (bantalaView) bantalaView.style.display = 'none';
    if (floorQcView) floorQcView.style.display = 'none';
    if (edgePaintView) edgePaintView.style.display = 'none';
    if (preAqlView) preAqlView.style.display = 'none';
    if (dataView)    dataView.style.display    = '';
    if (cuttingTableData.allRows.length === 0) {
        fetchCuttingDetailsAndRender();
    } else {
        renderCuttingTable();
    }
}

function showBatchListBantalaView() {
    if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.show === 'function') {
        window.BantalaDetailsSheetEngine.show();
        return;
    }
    var kpiView     = document.getElementById('batch-list-kpi-view');
    var cutView     = document.getElementById('batch-list-cutting-view');
    var bantalaView = document.getElementById('batch-list-bantala-view');
    var floorQcView = document.getElementById('batch-list-floor-qc-view');
    var edgePaintView = document.getElementById('batch-list-edge-paint-view');
    var preAqlView = document.getElementById('batch-list-pre-aql-view');
    if (kpiView)     kpiView.style.display     = 'none';
    if (cutView)     cutView.style.display     = 'none';
    if (floorQcView) floorQcView.style.display = 'none';
    if (edgePaintView) edgePaintView.style.display = 'none';
    if (preAqlView) preAqlView.style.display = 'none';
    if (bantalaView) bantalaView.style.display = '';
    if (bantalaTableData.allRows.length === 0) {
        fetchBantalaDetailsAndRender();
    } else {
        renderBantalaTable();
    }
}

function showBatchListFloorQcView() {
    if (window.FloorQcSheetEngine && typeof window.FloorQcSheetEngine.showView === 'function') {
        window.FloorQcSheetEngine.showView();
        return;
    }
    var kpiView     = document.getElementById('batch-list-kpi-view');
    var cutView     = document.getElementById('batch-list-cutting-view');
    var bantalaView = document.getElementById('batch-list-bantala-view');
    var floorQcView = document.getElementById('batch-list-floor-qc-view');
    var edgePaintView = document.getElementById('batch-list-edge-paint-view');
    var preAqlView = document.getElementById('batch-list-pre-aql-view');
    if (kpiView)     kpiView.style.display     = 'none';
    if (cutView)     cutView.style.display     = 'none';
    if (bantalaView) bantalaView.style.display = 'none';
    if (edgePaintView) edgePaintView.style.display = 'none';
    if (preAqlView) preAqlView.style.display = 'none';
    if (floorQcView) floorQcView.style.display = '';
    if (floorQcTableData.allRows.length === 0) {
        fetchFloorQcDetailsAndRender();
    } else {
        renderFloorQcTable();
    }
}

function showBatchListFmsProductionView() {
    if (window.FmsProductionSheetEngine && typeof window.FmsProductionSheetEngine.showView === 'function') {
        window.FmsProductionSheetEngine.showView();
        return;
    }
    var kpiView     = document.getElementById('batch-list-kpi-view');
    var prodView    = document.getElementById('batch-list-fms-production-view');
    if (kpiView)  kpiView.style.display  = 'none';
    if (prodView) prodView.style.display = '';
}

function showBatchListEdgePaintView() {
    var kpiView       = document.getElementById('batch-list-kpi-view');
    var cutView       = document.getElementById('batch-list-cutting-view');
    var bantalaView   = document.getElementById('batch-list-bantala-view');
    var floorQcView   = document.getElementById('batch-list-floor-qc-view');
    var edgePaintView = document.getElementById('batch-list-edge-paint-view');
    var preAqlView    = document.getElementById('batch-list-pre-aql-view');
    if (kpiView)       kpiView.style.display       = 'none';
    if (cutView)       cutView.style.display       = 'none';
    if (bantalaView)   bantalaView.style.display   = 'none';
    if (floorQcView)   floorQcView.style.display   = 'none';
    if (preAqlView)    preAqlView.style.display    = 'none';
    if (edgePaintView) edgePaintView.style.display = '';
    if (edgePaintTableData.allRows.length === 0) {
        fetchEdgePaintDetailsAndRender();
    } else {
        renderEdgePaintTable();
    }
}

function showBatchListPreAqlView() {
    var kpiView       = document.getElementById('batch-list-kpi-view');
    var cutView       = document.getElementById('batch-list-cutting-view');
    var bantalaView   = document.getElementById('batch-list-bantala-view');
    var floorQcView   = document.getElementById('batch-list-floor-qc-view');
    var edgePaintView = document.getElementById('batch-list-edge-paint-view');
    var preAqlView    = document.getElementById('batch-list-pre-aql-view');
    if (kpiView)       kpiView.style.display       = 'none';
    if (cutView)       cutView.style.display       = 'none';
    if (bantalaView)   bantalaView.style.display   = 'none';
    if (floorQcView)   floorQcView.style.display   = 'none';
    if (edgePaintView) edgePaintView.style.display = 'none';
    if (preAqlView)    preAqlView.style.display    = '';
    if (preAqlTableData.allRows.length === 0) {
        fetchPreAqlDetailsAndRender();
    } else {
        renderPreAqlTable();
    }
}

function fetchCuttingDetailsAndRender() {
    var emptyEl  = document.getElementById('cutting-data-empty');
    var tableEl  = document.getElementById('cutting-data-table');
    var footerEl = document.getElementById('cutting-data-footer');

    // 1. FAST PATH: If CuttingDetailsEngine has cached rows in memory/IndexedDB, render instantly!
    if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.getRows === 'function') {
        var cachedRows = window.CuttingDetailsEngine.getRows();
        var cachedHeaders = window.CuttingDetailsEngine.getHeaders();
        if (cachedRows && cachedRows.length > 0) {
            onCuttingDataLoaded({
                success: true,
                headers: cachedHeaders,
                rows: cachedRows
            });
            // Silent sync fresh rows in background
            window.CuttingDetailsEngine.syncFromSheet().then(function (fresh) {
                if (fresh && fresh.rows && fresh.rows.length) {
                    onCuttingDataLoaded({
                        success: true,
                        headers: fresh.headers,
                        rows: fresh.rows
                    });
                }
            });
            return;
        }
    }

    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading dataâ€¦'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching cutting detailsâ€¦');

    // Try sync via CuttingDetailsEngine first
    if (window.CuttingDetailsEngine && typeof window.CuttingDetailsEngine.syncFromSheet === 'function') {
        window.CuttingDetailsEngine.syncFromSheet().then(function (res) {
            if (res && res.rows && res.rows.length) {
                hideSpinner();
                onCuttingDataLoaded({
                    success: true,
                    headers: res.headers,
                    rows: res.rows
                });
                return;
            }
            fallbackFetch();
        }).catch(function () {
            fallbackFetch();
        });
        return;
    }

    fallbackFetch();

    function fallbackFetch() {
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(function (r) { hideSpinner(); onCuttingDataLoaded(r); })
                .withFailureHandler(function (e) { hideSpinner(); onCuttingDataError(e.message || 'Failed to load data.'); })
                .getCuttingDetailsData();
            return;
        }
        jsonp({ action: 'getCuttingDetailsData' }, function (err, result) {
            hideSpinner();
            if (err) { onCuttingDataError(err.message); return; }
            onCuttingDataLoaded(result);
        });
    }
}

function onCuttingDataLoaded(result) {
    if (!result || !result.success) {
        onCuttingDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    cuttingTableData.headers       = result.headers || [];
    cuttingTableData.allRows       = result.rows    || [];
    cuttingTableData.filteredRows  = cuttingTableData.allRows.slice();
    cuttingTableData.sortCol       = -1;
    cuttingTableData.sortAsc       = true;
    cuttingTableData.page          = 1;
    cuttingTableData.searchQuery   = '';
    cuttingTableData.columnFilters = {};
    cuttingTableData.dateFrom      = '';
    cuttingTableData.dateTo        = '';
    var searchEl = document.getElementById('cutting-data-search');
    if (searchEl) searchEl.value = '';
    updateCuttingSearchClearBtn();
    var cdf = document.getElementById('cutting-date-from');
    var cdt = document.getElementById('cutting-date-to');
    if (cdf) cdf.value = '';
    if (cdt) cdt.value = '';
    updateCuttingDateClearBtn();
    buildCuttingTableHeaders();
    renderCuttingTable();
}

function onCuttingDataError(msg) {
    var emptyEl = document.getElementById('cutting-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('cutting-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('cutting-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildCuttingTableHeaders() {
    var thead = document.getElementById('cutting-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    // Label row
    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    cuttingTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-cutting-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onCuttingSortColumn(i); });
        trHead.appendChild(th);
    });

    // Per-column filter row
    var trFilter    = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);
    cuttingTableData.headers.forEach(function (h, i) {
        var th       = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap     = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input    = document.createElement('input');
        input.type        = 'text';
        input.className   = 'dt-col-filter';
        input.placeholder = 'Filterâ€¦';
        input.value       = cuttingTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className    = 'dt-col-filter-clear';
        clearBtn.title        = 'Clear filter';
        clearBtn.innerHTML    = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            cuttingTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyCuttingFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            cuttingTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyCuttingFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onCuttingSortColumn(colIndex) {
    if (cuttingTableData.sortCol === colIndex) {
        cuttingTableData.sortAsc = !cuttingTableData.sortAsc;
    } else {
        cuttingTableData.sortCol = colIndex;
        cuttingTableData.sortAsc = true;
    }
    updateCuttingSortIcons();
    applyCuttingFilters();
}

function updateCuttingSortIcons() {
    document.querySelectorAll('[data-cutting-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-cutting-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === cuttingTableData.sortCol) {
            icon.textContent = cuttingTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function getCuttingDateColIndex() {
    var idx = -1;
    cuttingTableData.headers.forEach(function (h, i) {
        if (h.trim().toLowerCase() === 'cutting date') idx = i;
    });
    return idx;
}

function updateCuttingDateClearBtn() {
    var clearBtn = document.getElementById('cutting-date-clear');
    if (!clearBtn) return;
    clearBtn.style.display = (cuttingTableData.dateFrom || cuttingTableData.dateTo) ? '' : 'none';
}

function applyCuttingFilters() {
    var query      = cuttingTableData.searchQuery;
    var colFilters = cuttingTableData.columnFilters;
    var cdIdx      = getCuttingDateColIndex();

    // Date bounds from state
    var dateFrom = cuttingTableData.dateFrom
        ? new Date(cuttingTableData.dateFrom + 'T00:00:00')
        : null;
    var dateTo = cuttingTableData.dateTo
        ? new Date(cuttingTableData.dateTo + 'T23:59:59')
        : null;
    var anyDateFilter = dateFrom || dateTo;

    cuttingTableData.filteredRows = cuttingTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        // Date range filter on Cutting Date column
        if (anyDateFilter && cdIdx >= 0) {
            var rawDate = row[cdIdx];
            var parsed  = parseCreatedAt(rawDate);   // reuse existing parser (DD/MM/YYYY aware)
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });
    if (cuttingTableData.sortCol >= 0) {
        var sc = cuttingTableData.sortCol;
        cuttingTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return cuttingTableData.sortAsc ? cmp : -cmp;
        });
    }
    cuttingTableData.page = 1;
    renderCuttingTable();
}

function applyCuttingSearch(query) {
    cuttingTableData.searchQuery = (query || '').trim().toLowerCase();
    applyCuttingFilters();
}

function renderCuttingTable() {
    var tbody      = document.getElementById('cutting-data-tbody');
    var tableEl    = document.getElementById('cutting-data-table');
    var emptyEl    = document.getElementById('cutting-data-empty');
    var footerEl   = document.getElementById('cutting-data-footer');
    var countBadge = document.getElementById('cutting-data-count-badge');
    if (!tbody) return;

    var total      = cuttingTableData.filteredRows.length;
    var pageSize   = cuttingTableData.pageSize;
    var page       = cuttingTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    cuttingTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = cuttingTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', cuttingTableData.headers.length + 1);
        var hasFilter = Object.keys(cuttingTableData.columnFilters).some(function (k) {
            return (cuttingTableData.columnFilters[k] || '').trim() !== '';
        });
        tdEmpty.innerHTML = '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (cuttingTableData.searchQuery || hasFilter
                ? 'No records match the current filter.'
                : (cuttingTableData.allRows.length === 0 ? 'No data found in Cutting Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('cutting-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        cuttingTableData.headers.forEach(function (header, ci) {
            var td  = document.createElement('td');
            td.className = 'dt-td';
            var cellVal  = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (cuttingTableData.searchQuery && cellVal.toLowerCase().indexOf(cuttingTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(cuttingTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('cutting-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (cuttingTableData.allRows.length !== total ? ' (filtered from ' + cuttingTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildCuttingPagination(page, totalPages);
}

function buildCuttingPagination(current, total) {
    var container = document.getElementById('cutting-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                cuttingTableData.page = page;
                renderCuttingTable();
                var wrap = document.getElementById('cutting-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === 'â€¦') {
            var el = document.createElement('span');
            el.className   = 'dt-page-ellipsis';
            el.textContent = 'â€¦';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function updateCuttingSearchClearBtn() {
    var searchEl = document.getElementById('cutting-data-search');
    var clearBtn = document.getElementById('cutting-data-search-clear');
    if (!searchEl || !clearBtn) return;
    clearBtn.style.display = searchEl.value ? '' : 'none';
}

function downloadCuttingExcel() {
    var headers = cuttingTableData.headers;
    var rows    = cuttingTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Batch Cutting Details',
        filenamePrefix: 'Batch_Cutting_Details'
    });
}

// ---------------------------------------------------------------------------
// Batch List â€” wire up all interactions
// ---------------------------------------------------------------------------
// ===========================================================================
// BATCH LIST - Floor Supervisor & In-Line QC Details
// ===========================================================================

var floorQcTableData = {
    headers:       [],
    headerGroups:  [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// The Google Sheet table starts at column B, so FMS Upload Timestamp is index 0.
function getFloorQcDateColIndex() { return 0; }

function updateFloorQcDateClearBtn() {
    var btn = document.getElementById('floor-qc-date-clear');
    if (btn) btn.style.display = (floorQcTableData.dateFrom || floorQcTableData.dateTo) ? '' : 'none';
}

function updateFloorQcSearchClearBtn() {
    var s = document.getElementById('floor-qc-data-search');
    var b = document.getElementById('floor-qc-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

// Chunk size for paginated fetches, and a generous per-chunk timeout. Each
// chunk is a small, bounded request, so this stays reliable no matter how
// many total rows the sheet ends up having.
var FLOOR_QC_PAGE_SIZE    = 1500;
var FLOOR_QC_PAGE_TIMEOUT = 60000;

function fetchFloorQcDetailsAndRender() {
    var emptyEl  = document.getElementById('floor-qc-data-empty');
    var tableEl  = document.getElementById('floor-qc-data-table');
    var footerEl = document.getElementById('floor-qc-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching Floor Supervisor & In-Line QC details...');

    var accumulated = { headers: [], headerGroups: [], rows: [] };
    var useGoogleRun = (typeof google !== 'undefined' && google.script && google.script.run);
    var consecutiveEmptyChunks = 0;
    var MAX_CONSECUTIVE_EMPTY_CHUNKS = 2; // safety net â€” stop instead of paging forever

    function requestPage(offset) {
        function handleResult(r) {
            if (!r || !r.success) {
                hideSpinner();
                onFloorQcDataError((r && r.error) || 'Failed to load data.');
                return;
            }

            if (offset === 0) {
                accumulated.headers      = r.headers      || [];
                accumulated.headerGroups = r.headerGroups || [];
            }

            var pageRows = r.rows || [];
            accumulated.rows = accumulated.rows.concat(pageRows);
            consecutiveEmptyChunks = (pageRows.length === 0) ? (consecutiveEmptyChunks + 1) : 0;

            var shouldStop = !r.hasMore || consecutiveEmptyChunks >= MAX_CONSECUTIVE_EMPTY_CHUNKS;

            if (!shouldStop) {
                showSpinner('Fetching Floor Supervisor & In-Line QC detailsâ€¦ (' + accumulated.rows.length + ' rows loaded)');
                requestPage(r.nextOffset);
            } else {
                hideSpinner();
                onFloorQcDataLoaded({
                    success: true,
                    headers: accumulated.headers,
                    headerGroups: accumulated.headerGroups,
                    rows: accumulated.rows
                });
            }
        }

        if (useGoogleRun) {
            google.script.run
                .withSuccessHandler(handleResult)
                .withFailureHandler(function (e) { hideSpinner(); onFloorQcDataError(e.message || 'Failed to load data.'); })
                .getFloorQcDetailsData(offset, FLOOR_QC_PAGE_SIZE);
            return;
        }

        jsonp({ action: 'getFloorQcDetailsData', offset: offset, limit: FLOOR_QC_PAGE_SIZE }, function (err, result) {
            if (err) { hideSpinner(); onFloorQcDataError(err.message); return; }
            handleResult(result);
        }, FLOOR_QC_PAGE_TIMEOUT);
    }

    requestPage(0);
}

function onFloorQcDataLoaded(result) {
    if (!result || !result.success) {
        onFloorQcDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    floorQcTableData.headers       = result.headers      || [];
    floorQcTableData.headerGroups  = result.headerGroups || [];
    floorQcTableData.allRows       = result.rows         || [];
    floorQcTableData.filteredRows  = floorQcTableData.allRows.slice();
    floorQcTableData.sortCol       = -1;
    floorQcTableData.sortAsc       = true;
    floorQcTableData.page          = 1;
    floorQcTableData.searchQuery   = '';
    floorQcTableData.columnFilters = {};
    floorQcTableData.dateFrom      = '';
    floorQcTableData.dateTo        = '';

    var s = document.getElementById('floor-qc-data-search');
    if (s) s.value = '';
    updateFloorQcSearchClearBtn();

    var df = document.getElementById('floor-qc-date-from');
    var dt = document.getElementById('floor-qc-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updateFloorQcDateClearBtn();

    var labelEl = document.getElementById('floor-qc-date-col-label');
    var dateCol = getFloorQcDateColIndex();
    if (labelEl && floorQcTableData.headers[dateCol]) {
        labelEl.textContent = floorQcTableData.headers[dateCol];
    }

    buildFloorQcTableHeaders();
    renderFloorQcTable();
}

function onFloorQcDataError(msg) {
    var emptyEl = document.getElementById('floor-qc-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('floor-qc-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('floor-qc-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildFloorQcTableHeaders() {
    var thead = document.getElementById('floor-qc-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    (floorQcTableData.headerGroups || []).forEach(function (groupRow, rowIndex) {
        var trGroup = document.createElement('tr');
        trGroup.className = 'dt-group-row dt-group-row-' + rowIndex;

        var thGroupNum = document.createElement('th');
        thGroupNum.className = 'dt-group-th dt-group-th-num';
        thGroupNum.textContent = rowIndex === 0 ? '#' : '';
        trGroup.appendChild(thGroupNum);

        groupRow.forEach(function (group) {
            var th = document.createElement('th');
            th.className = 'dt-group-th';
            th.colSpan = Math.max(parseInt(group.colspan, 10) || 1, 1);
            th.textContent = group.label || '';
            trGroup.appendChild(th);
        });

        thead.appendChild(trGroup);
    });

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className   = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    floorQcTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-floor-qc-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onFloorQcSortColumn(i); });
        trHead.appendChild(th);
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    floorQcTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = floorQcTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            floorQcTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyFloorQcFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            floorQcTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyFloorQcFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trHead);
    thead.appendChild(trFilter);
}

function onFloorQcSortColumn(colIndex) {
    if (floorQcTableData.sortCol === colIndex) {
        floorQcTableData.sortAsc = !floorQcTableData.sortAsc;
    } else {
        floorQcTableData.sortCol = colIndex;
        floorQcTableData.sortAsc = true;
    }
    updateFloorQcSortIcons();
    applyFloorQcFilters();
}

function updateFloorQcSortIcons() {
    document.querySelectorAll('[data-floor-qc-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-floor-qc-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === floorQcTableData.sortCol) {
            icon.textContent = floorQcTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyFloorQcFilters() {
    var query      = floorQcTableData.searchQuery;
    var colFilters = floorQcTableData.columnFilters;
    var dateColIdx = getFloorQcDateColIndex();
    var dateFrom = floorQcTableData.dateFrom ? new Date(floorQcTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = floorQcTableData.dateTo ? new Date(floorQcTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    floorQcTableData.filteredRows = floorQcTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (floorQcTableData.sortCol >= 0) {
        var sc = floorQcTableData.sortCol;
        floorQcTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return floorQcTableData.sortAsc ? cmp : -cmp;
        });
    }

    floorQcTableData.page = 1;
    renderFloorQcTable();
}

function applyFloorQcSearch(query) {
    floorQcTableData.searchQuery = (query || '').trim().toLowerCase();
    applyFloorQcFilters();
}

function renderFloorQcTable() {
    var tbody      = document.getElementById('floor-qc-data-tbody');
    var tableEl    = document.getElementById('floor-qc-data-table');
    var emptyEl    = document.getElementById('floor-qc-data-empty');
    var footerEl   = document.getElementById('floor-qc-data-footer');
    var countBadge = document.getElementById('floor-qc-data-count-badge');
    if (!tbody) return;

    var total      = floorQcTableData.filteredRows.length;
    var pageSize   = floorQcTableData.pageSize;
    var page       = floorQcTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    floorQcTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = floorQcTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', floorQcTableData.headers.length + 1);
        var hasFilter = Object.keys(floorQcTableData.columnFilters).some(function (k) {
            return (floorQcTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = floorQcTableData.dateFrom || floorQcTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (floorQcTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (floorQcTableData.allRows.length === 0 ? 'No data found in Floor Supervisor & In-Line QC Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('floor-qc-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        floorQcTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (floorQcTableData.searchQuery && cellVal.toLowerCase().indexOf(floorQcTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(floorQcTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('floor-qc-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (floorQcTableData.allRows.length !== total ? ' (filtered from ' + floorQcTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildFloorQcPagination(page, totalPages);
}

function buildFloorQcPagination(current, total) {
    var container = document.getElementById('floor-qc-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                floorQcTableData.page = page;
                renderFloorQcTable();
                var wrap = document.getElementById('floor-qc-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === 'Ã¢â‚¬Â¦') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadFloorQcExcel() {
    var headers = floorQcTableData.headers;
    var rows    = floorQcTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Floor Supervisor QC',
        filenamePrefix: 'Floor_Supervisor_In_Line_QC_Details',
        headerGroups: floorQcTableData.headerGroups || []
    });
}

// ===========================================================================
// BATCH LIST - Edge Paint Details
// ===========================================================================

var edgePaintTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// The Google Sheet table starts at column B, so FMS Upload Timestamp is index 0.
function getEdgePaintDateColIndex() { return 0; }

function updateEdgePaintDateClearBtn() {
    var btn = document.getElementById('edge-paint-date-clear');
    if (btn) btn.style.display = (edgePaintTableData.dateFrom || edgePaintTableData.dateTo) ? '' : 'none';
}

function updateEdgePaintSearchClearBtn() {
    var s = document.getElementById('edge-paint-data-search');
    var b = document.getElementById('edge-paint-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchEdgePaintDetailsAndRender() {
    var emptyEl  = document.getElementById('edge-paint-data-empty');
    var tableEl  = document.getElementById('edge-paint-data-table');
    var footerEl = document.getElementById('edge-paint-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching Edge Paint details...');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onEdgePaintDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onEdgePaintDataError(e.message || 'Failed to load data.'); })
            .getEdgePaintDetailsData();
        return;
    }
    jsonp({ action: 'getEdgePaintDetailsData' }, function (err, result) {
        hideSpinner();
        if (err) { onEdgePaintDataError(err.message); return; }
        onEdgePaintDataLoaded(result);
    });
}

function onEdgePaintDataLoaded(result) {
    if (!result || !result.success) {
        onEdgePaintDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    edgePaintTableData.headers       = result.headers || [];
    edgePaintTableData.allRows       = result.rows    || [];
    edgePaintTableData.filteredRows  = edgePaintTableData.allRows.slice();
    edgePaintTableData.sortCol       = -1;
    edgePaintTableData.sortAsc       = true;
    edgePaintTableData.page          = 1;
    edgePaintTableData.searchQuery   = '';
    edgePaintTableData.columnFilters = {};
    edgePaintTableData.dateFrom      = '';
    edgePaintTableData.dateTo        = '';

    var s = document.getElementById('edge-paint-data-search');
    if (s) s.value = '';
    updateEdgePaintSearchClearBtn();

    var df = document.getElementById('edge-paint-date-from');
    var dt = document.getElementById('edge-paint-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updateEdgePaintDateClearBtn();

    var labelEl = document.getElementById('edge-paint-date-col-label');
    var dateCol = getEdgePaintDateColIndex();
    if (labelEl && edgePaintTableData.headers[dateCol]) {
        labelEl.textContent = edgePaintTableData.headers[dateCol];
    }

    buildEdgePaintTableHeaders();
    renderEdgePaintTable();
}

function onEdgePaintDataError(msg) {
    var emptyEl = document.getElementById('edge-paint-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('edge-paint-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('edge-paint-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildEdgePaintTableHeaders() {
    var thead = document.getElementById('edge-paint-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    edgePaintTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-edge-paint-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onEdgePaintSortColumn(i); });
        trHead.appendChild(th);
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    edgePaintTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = edgePaintTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            edgePaintTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyEdgePaintFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            edgePaintTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyEdgePaintFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onEdgePaintSortColumn(colIndex) {
    if (edgePaintTableData.sortCol === colIndex) {
        edgePaintTableData.sortAsc = !edgePaintTableData.sortAsc;
    } else {
        edgePaintTableData.sortCol = colIndex;
        edgePaintTableData.sortAsc = true;
    }
    updateEdgePaintSortIcons();
    applyEdgePaintFilters();
}

function updateEdgePaintSortIcons() {
    document.querySelectorAll('[data-edge-paint-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-edge-paint-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === edgePaintTableData.sortCol) {
            icon.textContent = edgePaintTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyEdgePaintFilters() {
    var query      = edgePaintTableData.searchQuery;
    var colFilters = edgePaintTableData.columnFilters;
    var dateColIdx = getEdgePaintDateColIndex();
    var dateFrom = edgePaintTableData.dateFrom ? new Date(edgePaintTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = edgePaintTableData.dateTo ? new Date(edgePaintTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    edgePaintTableData.filteredRows = edgePaintTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (edgePaintTableData.sortCol >= 0) {
        var sc = edgePaintTableData.sortCol;
        edgePaintTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return edgePaintTableData.sortAsc ? cmp : -cmp;
        });
    }

    edgePaintTableData.page = 1;
    renderEdgePaintTable();
}

function applyEdgePaintSearch(query) {
    edgePaintTableData.searchQuery = (query || '').trim().toLowerCase();
    applyEdgePaintFilters();
}

function renderEdgePaintTable() {
    var tbody      = document.getElementById('edge-paint-data-tbody');
    var tableEl    = document.getElementById('edge-paint-data-table');
    var emptyEl    = document.getElementById('edge-paint-data-empty');
    var footerEl   = document.getElementById('edge-paint-data-footer');
    var countBadge = document.getElementById('edge-paint-data-count-badge');
    if (!tbody) return;

    var total      = edgePaintTableData.filteredRows.length;
    var pageSize   = edgePaintTableData.pageSize;
    var page       = edgePaintTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    edgePaintTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = edgePaintTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', edgePaintTableData.headers.length + 1);
        var hasFilter = Object.keys(edgePaintTableData.columnFilters).some(function (k) {
            return (edgePaintTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = edgePaintTableData.dateFrom || edgePaintTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (edgePaintTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (edgePaintTableData.allRows.length === 0 ? 'No data found in Edge Paint Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('edge-paint-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        edgePaintTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (edgePaintTableData.searchQuery && cellVal.toLowerCase().indexOf(edgePaintTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(edgePaintTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('edge-paint-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (edgePaintTableData.allRows.length !== total ? ' (filtered from ' + edgePaintTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildEdgePaintPagination(page, totalPages);
}

function buildEdgePaintPagination(current, total) {
    var container = document.getElementById('edge-paint-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                edgePaintTableData.page = page;
                renderEdgePaintTable();
                var wrap = document.getElementById('edge-paint-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === 'Ã¢â‚¬Â¦') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadEdgePaintExcel() {
    var headers = edgePaintTableData.headers;
    var rows    = edgePaintTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Edge Paint Details',
        filenamePrefix: 'Edge_Paint_Details'
    });
}

// ===========================================================================
// PDF - Edge Paint (same data range as Production Data â†’ Edge Paint Details)
// ===========================================================================

var pdfEdgePaintTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// The Google Sheet table starts at column B, so FMS Upload Timestamp is index 0.
function getPdfEdgePaintDateColIndex() { return 0; }

function updatePdfEdgePaintDateClearBtn() {
    var btn = document.getElementById('pdf-edge-paint-date-clear');
    if (btn) btn.style.display = (pdfEdgePaintTableData.dateFrom || pdfEdgePaintTableData.dateTo) ? '' : 'none';
}

function updatePdfEdgePaintSearchClearBtn() {
    var s = document.getElementById('pdf-edge-paint-data-search');
    var b = document.getElementById('pdf-edge-paint-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchPdfEdgePaintDetailsAndRender() {
    var emptyEl  = document.getElementById('pdf-edge-paint-data-empty');
    var tableEl  = document.getElementById('pdf-edge-paint-data-table');
    var footerEl = document.getElementById('pdf-edge-paint-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching Edge Paint details...');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onPdfEdgePaintDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onPdfEdgePaintDataError(e.message || 'Failed to load data.'); })
            .getEdgePaintDetailsData();
        return;
    }
    jsonp({ action: 'getEdgePaintDetailsData' }, function (err, result) {
        hideSpinner();
        if (err) { onPdfEdgePaintDataError(err.message); return; }
        onPdfEdgePaintDataLoaded(result);
    });
}

function onPdfEdgePaintDataLoaded(result) {
    if (!result || !result.success) {
        onPdfEdgePaintDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    pdfEdgePaintTableData.headers       = result.headers || [];
    pdfEdgePaintTableData.allRows       = result.rows    || [];
    pdfEdgePaintTableData.filteredRows  = pdfEdgePaintTableData.allRows.slice();
    pdfEdgePaintTableData.sortCol       = -1;
    pdfEdgePaintTableData.sortAsc       = true;
    pdfEdgePaintTableData.page          = 1;
    pdfEdgePaintTableData.searchQuery   = '';
    pdfEdgePaintTableData.columnFilters = {};
    pdfEdgePaintTableData.dateFrom      = '';
    pdfEdgePaintTableData.dateTo        = '';

    var s = document.getElementById('pdf-edge-paint-data-search');
    if (s) s.value = '';
    updatePdfEdgePaintSearchClearBtn();

    var df = document.getElementById('pdf-edge-paint-date-from');
    var dt = document.getElementById('pdf-edge-paint-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updatePdfEdgePaintDateClearBtn();

    var labelEl = document.getElementById('pdf-edge-paint-date-col-label');
    var dateCol = getPdfEdgePaintDateColIndex();
    if (labelEl && pdfEdgePaintTableData.headers[dateCol]) {
        labelEl.textContent = pdfEdgePaintTableData.headers[dateCol];
    }

    buildPdfEdgePaintTableHeaders();
    renderPdfEdgePaintTable();
}

function onPdfEdgePaintDataError(msg) {
    var emptyEl = document.getElementById('pdf-edge-paint-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('pdf-edge-paint-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('pdf-edge-paint-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildPdfEdgePaintTableHeaders() {
    var thead = document.getElementById('pdf-edge-paint-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var batchNoIdx = findHeaderIndex(pdfEdgePaintTableData.headers, [/batch\s*no\.?/i, /batch\s*id/i]);
    if (batchNoIdx < 0) batchNoIdx = 0;

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    pdfEdgePaintTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-pdf-edge-paint-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onPdfEdgePaintSortColumn(i); });
        trHead.appendChild(th);
        if (i === batchNoIdx) {
            var thPdf = document.createElement('th');
            thPdf.className = 'dt-th dt-th-pdf';
            thPdf.textContent = 'PDF';
            trHead.appendChild(thPdf);
        }
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    pdfEdgePaintTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = pdfEdgePaintTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            pdfEdgePaintTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyPdfEdgePaintFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            pdfEdgePaintTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyPdfEdgePaintFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
        if (i === batchNoIdx) {
            var thFilterPdf = document.createElement('th');
            thFilterPdf.className = 'dt-filter-cell dt-filter-cell-pdf';
            trFilter.appendChild(thFilterPdf);
        }
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onPdfEdgePaintSortColumn(colIndex) {
    if (pdfEdgePaintTableData.sortCol === colIndex) {
        pdfEdgePaintTableData.sortAsc = !pdfEdgePaintTableData.sortAsc;
    } else {
        pdfEdgePaintTableData.sortCol = colIndex;
        pdfEdgePaintTableData.sortAsc = true;
    }
    updatePdfEdgePaintSortIcons();
    applyPdfEdgePaintFilters();
}

function updatePdfEdgePaintSortIcons() {
    document.querySelectorAll('[data-pdf-edge-paint-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-pdf-edge-paint-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === pdfEdgePaintTableData.sortCol) {
            icon.textContent = pdfEdgePaintTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyPdfEdgePaintFilters() {
    var query      = pdfEdgePaintTableData.searchQuery;
    var colFilters = pdfEdgePaintTableData.columnFilters;
    var dateColIdx = getPdfEdgePaintDateColIndex();
    var dateFrom = pdfEdgePaintTableData.dateFrom ? new Date(pdfEdgePaintTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = pdfEdgePaintTableData.dateTo ? new Date(pdfEdgePaintTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    pdfEdgePaintTableData.filteredRows = pdfEdgePaintTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (pdfEdgePaintTableData.sortCol >= 0) {
        var sc = pdfEdgePaintTableData.sortCol;
        pdfEdgePaintTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return pdfEdgePaintTableData.sortAsc ? cmp : -cmp;
        });
    }

    pdfEdgePaintTableData.page = 1;
    renderPdfEdgePaintTable();
}

function applyPdfEdgePaintSearch(query) {
    pdfEdgePaintTableData.searchQuery = (query || '').trim().toLowerCase();
    applyPdfEdgePaintFilters();
}

function renderPdfEdgePaintTable() {
    var tbody      = document.getElementById('pdf-edge-paint-data-tbody');
    var tableEl    = document.getElementById('pdf-edge-paint-data-table');
    var emptyEl    = document.getElementById('pdf-edge-paint-data-empty');
    var footerEl   = document.getElementById('pdf-edge-paint-data-footer');
    var countBadge = document.getElementById('pdf-edge-paint-data-count-badge');
    if (!tbody) return;

    var total      = pdfEdgePaintTableData.filteredRows.length;
    var pageSize   = pdfEdgePaintTableData.pageSize;
    var page       = pdfEdgePaintTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    pdfEdgePaintTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = pdfEdgePaintTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', pdfEdgePaintTableData.headers.length + 2);
        var hasFilter = Object.keys(pdfEdgePaintTableData.columnFilters).some(function (k) {
            return (pdfEdgePaintTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = pdfEdgePaintTableData.dateFrom || pdfEdgePaintTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (pdfEdgePaintTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (pdfEdgePaintTableData.allRows.length === 0 ? 'No data found in Edge Paint Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('pdf-edge-paint-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    var batchNoIdx = findHeaderIndex(pdfEdgePaintTableData.headers, [/batch\s*no\.?/i, /batch\s*id/i]);
    if (batchNoIdx < 0) batchNoIdx = 0;

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        pdfEdgePaintTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (pdfEdgePaintTableData.searchQuery && cellVal.toLowerCase().indexOf(pdfEdgePaintTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(pdfEdgePaintTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
            if (ci === batchNoIdx) {
                var tdPdf = document.createElement('td');
                tdPdf.className = 'dt-td dt-td-pdf';
                var pdfBtn = document.createElement('button');
                pdfBtn.type = 'button';
                pdfBtn.className = 'dt-pdf-download-btn';
                pdfBtn.title = 'Download PDF';
                pdfBtn.innerHTML = '<span class="material-icons-round">download</span>';
                pdfBtn.addEventListener('click', function () {
                    downloadEdgePaintRowAsPdf(pdfEdgePaintTableData.headers, row);
                });
                tdPdf.appendChild(pdfBtn);
                tr.appendChild(tdPdf);
            }
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('pdf-edge-paint-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (pdfEdgePaintTableData.allRows.length !== total ? ' (filtered from ' + pdfEdgePaintTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildPdfEdgePaintPagination(page, totalPages);
}

function buildPdfEdgePaintPagination(current, total) {
    var container = document.getElementById('pdf-edge-paint-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                pdfEdgePaintTableData.page = page;
                renderPdfEdgePaintTable();
                var wrap = document.getElementById('pdf-edge-paint-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === 'Ã¢â‚¬Â¦') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadPdfEdgePaintExcel() {
    var headers = pdfEdgePaintTableData.headers;
    var rows    = pdfEdgePaintTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Edge Paint Details',
        filenamePrefix: 'PDF_Edge_Paint_Details'
    });
}

// ===========================================================================
// PDF Page - End-Line QC Details
// (reads B7:AE from the "END-LINE QC" sheet, row 7 = header row â€” same
// getEndLineQcDetailsData() backend call used by the Batch List section â€”
// implemented the same way as the PDF Edge-Paint section above.)
// ===========================================================================

var pdfEndLineQcTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// The Google Sheet table starts at column B, so FMS Upload Timestamp is index 0.
function getPdfEndLineQcDateColIndex() { return 0; }

function updatePdfEndLineQcDateClearBtn() {
    var btn = document.getElementById('pdf-endline-qc-date-clear');
    if (btn) btn.style.display = (pdfEndLineQcTableData.dateFrom || pdfEndLineQcTableData.dateTo) ? '' : 'none';
}

function updatePdfEndLineQcSearchClearBtn() {
    var s = document.getElementById('pdf-endline-qc-data-search');
    var b = document.getElementById('pdf-endline-qc-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchPdfEndLineQcDetailsAndRender() {
    var emptyEl  = document.getElementById('pdf-endline-qc-data-empty');
    var tableEl  = document.getElementById('pdf-endline-qc-data-table');
    var footerEl = document.getElementById('pdf-endline-qc-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching End-Line QC details...');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onPdfEndLineQcDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onPdfEndLineQcDataError(e.message || 'Failed to load data.'); })
            .getEndLineQcDetailsData();
        return;
    }
    jsonp({ action: 'getEndLineQcDetailsData' }, function (err, result) {
        hideSpinner();
        if (err) { onPdfEndLineQcDataError(err.message); return; }
        onPdfEndLineQcDataLoaded(result);
    });
}

function onPdfEndLineQcDataLoaded(result) {
    if (!result || !result.success) {
        onPdfEndLineQcDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    pdfEndLineQcTableData.headers       = result.headers || [];
    pdfEndLineQcTableData.allRows       = result.rows    || [];
    pdfEndLineQcTableData.filteredRows  = pdfEndLineQcTableData.allRows.slice();
    pdfEndLineQcTableData.sortCol       = -1;
    pdfEndLineQcTableData.sortAsc       = true;
    pdfEndLineQcTableData.page          = 1;
    pdfEndLineQcTableData.searchQuery   = '';
    pdfEndLineQcTableData.columnFilters = {};
    pdfEndLineQcTableData.dateFrom      = '';
    pdfEndLineQcTableData.dateTo        = '';

    var s = document.getElementById('pdf-endline-qc-data-search');
    if (s) s.value = '';
    updatePdfEndLineQcSearchClearBtn();

    var df = document.getElementById('pdf-endline-qc-date-from');
    var dt = document.getElementById('pdf-endline-qc-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updatePdfEndLineQcDateClearBtn();

    var labelEl = document.getElementById('pdf-endline-qc-date-col-label');
    var dateCol = getPdfEndLineQcDateColIndex();
    if (labelEl && pdfEndLineQcTableData.headers[dateCol]) {
        labelEl.textContent = pdfEndLineQcTableData.headers[dateCol];
    }

    buildPdfEndLineQcTableHeaders();
    renderPdfEndLineQcTable();
}

function onPdfEndLineQcDataError(msg) {
    var emptyEl = document.getElementById('pdf-endline-qc-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('pdf-endline-qc-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('pdf-endline-qc-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildPdfEndLineQcTableHeaders() {
    var thead = document.getElementById('pdf-endline-qc-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var batchNoIdx = findHeaderIndex(pdfEndLineQcTableData.headers, [/batch\s*no\.?/i, /batch\s*id/i]);
    if (batchNoIdx < 0) batchNoIdx = 0;

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    pdfEndLineQcTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-pdf-endline-qc-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onPdfEndLineQcSortColumn(i); });
        trHead.appendChild(th);
        if (i === batchNoIdx) {
            var thPdf = document.createElement('th');
            thPdf.className = 'dt-th dt-th-pdf';
            thPdf.textContent = 'PDF';
            trHead.appendChild(thPdf);
        }
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    pdfEndLineQcTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = pdfEndLineQcTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            pdfEndLineQcTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyPdfEndLineQcFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            pdfEndLineQcTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyPdfEndLineQcFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
        if (i === batchNoIdx) {
            var thFilterPdf = document.createElement('th');
            thFilterPdf.className = 'dt-filter-cell dt-filter-cell-pdf';
            trFilter.appendChild(thFilterPdf);
        }
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onPdfEndLineQcSortColumn(colIndex) {
    if (pdfEndLineQcTableData.sortCol === colIndex) {
        pdfEndLineQcTableData.sortAsc = !pdfEndLineQcTableData.sortAsc;
    } else {
        pdfEndLineQcTableData.sortCol = colIndex;
        pdfEndLineQcTableData.sortAsc = true;
    }
    updatePdfEndLineQcSortIcons();
    applyPdfEndLineQcFilters();
}

function updatePdfEndLineQcSortIcons() {
    document.querySelectorAll('[data-pdf-endline-qc-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-pdf-endline-qc-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === pdfEndLineQcTableData.sortCol) {
            icon.textContent = pdfEndLineQcTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyPdfEndLineQcFilters() {
    var query      = pdfEndLineQcTableData.searchQuery;
    var colFilters = pdfEndLineQcTableData.columnFilters;
    var dateColIdx = getPdfEndLineQcDateColIndex();
    var dateFrom = pdfEndLineQcTableData.dateFrom ? new Date(pdfEndLineQcTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = pdfEndLineQcTableData.dateTo ? new Date(pdfEndLineQcTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    pdfEndLineQcTableData.filteredRows = pdfEndLineQcTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (pdfEndLineQcTableData.sortCol >= 0) {
        var sc = pdfEndLineQcTableData.sortCol;
        pdfEndLineQcTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return pdfEndLineQcTableData.sortAsc ? cmp : -cmp;
        });
    }

    pdfEndLineQcTableData.page = 1;
    renderPdfEndLineQcTable();
}

function applyPdfEndLineQcSearch(query) {
    pdfEndLineQcTableData.searchQuery = (query || '').trim().toLowerCase();
    applyPdfEndLineQcFilters();
}

function renderPdfEndLineQcTable() {
    var tbody      = document.getElementById('pdf-endline-qc-data-tbody');
    var tableEl    = document.getElementById('pdf-endline-qc-data-table');
    var emptyEl    = document.getElementById('pdf-endline-qc-data-empty');
    var footerEl   = document.getElementById('pdf-endline-qc-data-footer');
    var countBadge = document.getElementById('pdf-endline-qc-data-count-badge');
    if (!tbody) return;

    var total      = pdfEndLineQcTableData.filteredRows.length;
    var pageSize   = pdfEndLineQcTableData.pageSize;
    var page       = pdfEndLineQcTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    pdfEndLineQcTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = pdfEndLineQcTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', pdfEndLineQcTableData.headers.length + 2);
        var hasFilter = Object.keys(pdfEndLineQcTableData.columnFilters).some(function (k) {
            return (pdfEndLineQcTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = pdfEndLineQcTableData.dateFrom || pdfEndLineQcTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (pdfEndLineQcTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (pdfEndLineQcTableData.allRows.length === 0 ? 'No data found in End-Line QC Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('pdf-endline-qc-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    var batchNoIdx = findHeaderIndex(pdfEndLineQcTableData.headers, [/batch\s*no\.?/i, /batch\s*id/i]);
    if (batchNoIdx < 0) batchNoIdx = 0;

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        pdfEndLineQcTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (pdfEndLineQcTableData.searchQuery && cellVal.toLowerCase().indexOf(pdfEndLineQcTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(pdfEndLineQcTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
            if (ci === batchNoIdx) {
                var tdPdf = document.createElement('td');
                tdPdf.className = 'dt-td dt-td-pdf';
                var pdfBtn = document.createElement('button');
                pdfBtn.type = 'button';
                pdfBtn.className = 'dt-pdf-download-btn';
                pdfBtn.title = 'Download PDF';
                pdfBtn.innerHTML = '<span class="material-icons-round">download</span>';
                pdfBtn.addEventListener('click', function () {
                    downloadEndLineQcRowAsPdf(pdfEndLineQcTableData.headers, row);
                });
                tdPdf.appendChild(pdfBtn);
                tr.appendChild(tdPdf);
            }
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('pdf-endline-qc-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (pdfEndLineQcTableData.allRows.length !== total ? ' (filtered from ' + pdfEndLineQcTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildPdfEndLineQcPagination(page, totalPages);
}

function buildPdfEndLineQcPagination(current, total) {
    var container = document.getElementById('pdf-endline-qc-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                pdfEndLineQcTableData.page = page;
                renderPdfEndLineQcTable();
                var wrap = document.getElementById('pdf-endline-qc-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === 'Ã¢â‚¬Â¦') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadPdfEndLineQcExcel() {
    var headers = pdfEndLineQcTableData.headers;
    var rows    = pdfEndLineQcTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'End-Line QC Details',
        filenamePrefix: 'PDF_End_Line_QC_Details'
    });
}

// ===========================================================================
// BATCH LIST - Pre-AQL Details
// ===========================================================================

var preAqlTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

// The Google Sheet table starts at column B, so FMS Upload Timestamp is index 0.
function getPreAqlDateColIndex() { return 0; }

function updatePreAqlDateClearBtn() {
    var btn = document.getElementById('pre-aql-date-clear');
    if (btn) btn.style.display = (preAqlTableData.dateFrom || preAqlTableData.dateTo) ? '' : 'none';
}

function updatePreAqlSearchClearBtn() {
    var s = document.getElementById('pre-aql-data-search');
    var b = document.getElementById('pre-aql-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchPreAqlDetailsAndRender() {
    var emptyEl  = document.getElementById('pre-aql-data-empty');
    var tableEl  = document.getElementById('pre-aql-data-table');
    var footerEl = document.getElementById('pre-aql-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading data...'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching Pre-AQL details...');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onPreAqlDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onPreAqlDataError(e.message || 'Failed to load data.'); })
            .getPreAqlDetailsData();
        return;
    }
    jsonp({ action: 'getPreAqlDetailsData' }, function (err, result) {
        hideSpinner();
        if (err) { onPreAqlDataError(err.message); return; }
        onPreAqlDataLoaded(result);
    });
}

function onPreAqlDataLoaded(result) {
    if (!result || !result.success) {
        onPreAqlDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    preAqlTableData.headers       = result.headers || [];
    preAqlTableData.allRows       = result.rows    || [];
    preAqlTableData.filteredRows  = preAqlTableData.allRows.slice();
    preAqlTableData.sortCol       = -1;
    preAqlTableData.sortAsc       = true;
    preAqlTableData.page          = 1;
    preAqlTableData.searchQuery   = '';
    preAqlTableData.columnFilters = {};
    preAqlTableData.dateFrom      = '';
    preAqlTableData.dateTo        = '';

    var s = document.getElementById('pre-aql-data-search');
    if (s) s.value = '';
    updatePreAqlSearchClearBtn();

    var df = document.getElementById('pre-aql-date-from');
    var dt = document.getElementById('pre-aql-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updatePreAqlDateClearBtn();

    var labelEl = document.getElementById('pre-aql-date-col-label');
    var dateCol = getPreAqlDateColIndex();
    if (labelEl && preAqlTableData.headers[dateCol]) {
        labelEl.textContent = preAqlTableData.headers[dateCol];
    }

    buildPreAqlTableHeaders();
    renderPreAqlTable();
}

function onPreAqlDataError(msg) {
    var emptyEl = document.getElementById('pre-aql-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('pre-aql-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('pre-aql-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildPreAqlTableHeaders() {
    var thead = document.getElementById('pre-aql-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    preAqlTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-pre-aql-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onPreAqlSortColumn(i); });
        trHead.appendChild(th);
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    preAqlTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filter...';
        input.value = preAqlTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            preAqlTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyPreAqlFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            preAqlTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyPreAqlFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onPreAqlSortColumn(colIndex) {
    if (preAqlTableData.sortCol === colIndex) {
        preAqlTableData.sortAsc = !preAqlTableData.sortAsc;
    } else {
        preAqlTableData.sortCol = colIndex;
        preAqlTableData.sortAsc = true;
    }
    updatePreAqlSortIcons();
    applyPreAqlFilters();
}

function updatePreAqlSortIcons() {
    document.querySelectorAll('[data-pre-aql-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-pre-aql-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === preAqlTableData.sortCol) {
            icon.textContent = preAqlTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyPreAqlFilters() {
    var query      = preAqlTableData.searchQuery;
    var colFilters = preAqlTableData.columnFilters;
    var dateColIdx = getPreAqlDateColIndex();
    var dateFrom = preAqlTableData.dateFrom ? new Date(preAqlTableData.dateFrom + 'T00:00:00') : null;
    var dateTo = preAqlTableData.dateTo ? new Date(preAqlTableData.dateTo + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    preAqlTableData.filteredRows = preAqlTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (preAqlTableData.sortCol >= 0) {
        var sc = preAqlTableData.sortCol;
        preAqlTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return preAqlTableData.sortAsc ? cmp : -cmp;
        });
    }

    preAqlTableData.page = 1;
    renderPreAqlTable();
}

function applyPreAqlSearch(query) {
    preAqlTableData.searchQuery = (query || '').trim().toLowerCase();
    applyPreAqlFilters();
}

function renderPreAqlTable() {
    var tbody      = document.getElementById('pre-aql-data-tbody');
    var tableEl    = document.getElementById('pre-aql-data-table');
    var emptyEl    = document.getElementById('pre-aql-data-empty');
    var footerEl   = document.getElementById('pre-aql-data-footer');
    var countBadge = document.getElementById('pre-aql-data-count-badge');
    if (!tbody) return;

    var total      = preAqlTableData.filteredRows.length;
    var pageSize   = preAqlTableData.pageSize;
    var page       = preAqlTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    preAqlTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = preAqlTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', preAqlTableData.headers.length + 1);
        var hasFilter = Object.keys(preAqlTableData.columnFilters).some(function (k) {
            return (preAqlTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = preAqlTableData.dateFrom || preAqlTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (preAqlTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (preAqlTableData.allRows.length === 0 ? 'No data found in Pre-AQL Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('pre-aql-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        preAqlTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (preAqlTableData.searchQuery && cellVal.toLowerCase().indexOf(preAqlTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(preAqlTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('pre-aql-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (preAqlTableData.allRows.length !== total ? ' (filtered from ' + preAqlTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildPreAqlPagination(page, totalPages);
}

function buildPreAqlPagination(current, total) {
    var container = document.getElementById('pre-aql-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                preAqlTableData.page = page;
                renderPreAqlTable();
                var wrap = document.getElementById('pre-aql-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === '...' || item === 'Ã¢â‚¬Â¦') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = '...';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadPreAqlExcel() {
    var headers = preAqlTableData.headers;
    var rows    = preAqlTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Pre-AQL Details',
        filenamePrefix: 'Pre_AQL_Details'
    });
}


function initBatchList() {
    // ── Production Live KPI card ───────────────────────────────────────────
    var prodLiveCard = document.getElementById('kpi-production-live');
    if (prodLiveCard) {
        prodLiveCard.addEventListener('click', function () { showBatchListProductionLiveView(); });
        prodLiveCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListProductionLiveView(); }
        });
    }
    var prodLiveBackBtn = document.getElementById('btn-back-production-live');
    if (prodLiveBackBtn) {
        prodLiveBackBtn.addEventListener('click', function () { showBatchListKpiView(); });
    }

    var kpiCard = document.getElementById('kpi-cutting-details');
    if (kpiCard) {
        kpiCard.addEventListener('click', function () { showBatchListCuttingView(); });
        kpiCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListCuttingView(); }
        });
    }
    var backBtn = document.getElementById('btn-back-batch-list');
    if (backBtn) backBtn.addEventListener('click', function () { showBatchListKpiView(); });

    var excelBtn = document.getElementById('btn-download-cutting-excel');
    if (excelBtn) excelBtn.addEventListener('click', function () { downloadCuttingExcel(); });

    var refreshBtn = document.getElementById('btn-refresh-cutting-data');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            cuttingTableData.allRows       = [];
            cuttingTableData.columnFilters = {};
            fetchCuttingDetailsAndRender();
        });
    }

    // â”€â”€ Bantala KPI card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var bantalaCard = document.getElementById('kpi-bantala-details');
    if (bantalaCard) {
        bantalaCard.addEventListener('click', function () { showBatchListBantalaView(); });
        bantalaCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListBantalaView(); }
        });
    }

    var bantalaBackBtn = document.getElementById('btn-back-bantala');
    if (bantalaBackBtn) bantalaBackBtn.addEventListener('click', function () {
        if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.hide === 'function') {
            window.BantalaDetailsSheetEngine.hide();
        } else {
            showBatchListKpiView();
        }
    });

    var bantalaExcelBtn = document.getElementById('btn-download-bantala-excel');
    if (bantalaExcelBtn) bantalaExcelBtn.addEventListener('click', function () {
        if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.exportExcel === 'function') {
            window.BantalaDetailsSheetEngine.exportExcel();
        } else {
            downloadBantalaExcel();
        }
    });

    var bantalaRefreshBtn = document.getElementById('btn-refresh-bantala-data');
    if (bantalaRefreshBtn) {
        bantalaRefreshBtn.addEventListener('click', function () {
            if (window.BantalaDetailsSheetEngine && typeof window.BantalaDetailsSheetEngine.sync === 'function') {
                window.BantalaDetailsSheetEngine.sync();
            } else {
                syncBantalaData_(true);
            }
        });
    }

    // â”€â”€ Product Input Tracking KPI card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var productInputTrackingCard = document.getElementById('kpi-product-input-tracking');
    if (productInputTrackingCard) {
        productInputTrackingCard.addEventListener('click', function () { showBatchListProductInputTrackingView(); });
        productInputTrackingCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListProductInputTrackingView(); }
        });
    }

    var productInputTrackingBackBtn = document.getElementById('btn-back-product-input-tracking');
    if (productInputTrackingBackBtn) productInputTrackingBackBtn.addEventListener('click', function () {
        if (window.ProductInputTrackingSheetEngine && typeof window.ProductInputTrackingSheetEngine.hide === 'function') {
            window.ProductInputTrackingSheetEngine.hide();
        } else {
            showBatchListKpiView();
        }
    });

    var productInputTrackingExcelBtn = document.getElementById('btn-download-product-input-tracking-excel');
    if (productInputTrackingExcelBtn) productInputTrackingExcelBtn.addEventListener('click', function () {
        if (window.ProductInputTrackingSheetEngine && typeof window.ProductInputTrackingSheetEngine.exportExcel === 'function') {
            window.ProductInputTrackingSheetEngine.exportExcel();
        }
    });

    var productInputTrackingRefreshBtn = document.getElementById('btn-refresh-product-input-tracking-data');
    if (productInputTrackingRefreshBtn) {
        productInputTrackingRefreshBtn.addEventListener('click', function () {
            if (window.ProductInputTrackingSheetEngine && typeof window.ProductInputTrackingSheetEngine.sync === 'function') {
                window.ProductInputTrackingSheetEngine.sync();
            }
        });
    }

    // ── PMS Live KPI card ────────────────────────────────────────────────
    var pmsCard = document.getElementById('kpi-pms-details');
    if (pmsCard) {
        pmsCard.addEventListener('click', function () { showBatchListPmsView(); });
        pmsCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListPmsView(); }
        });
    }

    var pmsBackBtn = document.getElementById('btn-back-pms');
    if (pmsBackBtn) pmsBackBtn.addEventListener('click', function () {
        if (window.PmsSheetEngine && typeof window.PmsSheetEngine.hide === 'function') {
            window.PmsSheetEngine.hide();
        } else {
            showBatchListKpiView();
        }
    });

    var pmsExcelBtn = document.getElementById('btn-download-pms-excel');
    if (pmsExcelBtn) pmsExcelBtn.addEventListener('click', function () {
        if (window.PmsSheetEngine && typeof window.PmsSheetEngine.exportExcel === 'function') {
            window.PmsSheetEngine.exportExcel();
        }
    });

    var pmsRefreshBtn = document.getElementById('btn-refresh-pms-data');
    if (pmsRefreshBtn) {
        pmsRefreshBtn.addEventListener('click', function () {
            if (window.PmsSheetEngine && typeof window.PmsSheetEngine.sync === 'function') {
                window.PmsSheetEngine.sync();
            }
        });
    }

    // ── WAREHOUSE-FMS Details KPI card ──────────────────────────────────
    var warehouseFmsCard = document.getElementById('kpi-warehouse-fms-details');
    if (warehouseFmsCard) {
        warehouseFmsCard.addEventListener('click', function () { showBatchListWarehouseFmsView(); });
        warehouseFmsCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListWarehouseFmsView(); }
        });
    }

    var floorQcCard = document.getElementById('kpi-floor-qc-details');
    if (floorQcCard) {
        floorQcCard.addEventListener('click', function () { showBatchListFloorQcView(); });
        floorQcCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListFloorQcView(); }
        });
    }

    var floorQcBackBtn = document.getElementById('btn-back-floor-qc');
    if (floorQcBackBtn) floorQcBackBtn.addEventListener('click', function () {
        if (window.FloorQcSheetEngine && typeof window.FloorQcSheetEngine.hideView === 'function') {
            window.FloorQcSheetEngine.hideView();
        } else {
            showBatchListKpiView();
        }
    });

    var floorQcExcelBtn = document.getElementById('btn-download-floor-qc-excel');
    if (floorQcExcelBtn) floorQcExcelBtn.addEventListener('click', function () {
        if (window.FloorQcSheetEngine && typeof window.FloorQcSheetEngine.exportExcel === 'function') {
            window.FloorQcSheetEngine.exportExcel();
        } else {
            downloadFloorQcExcel();
        }
    });

    var floorQcRefreshBtn = document.getElementById('btn-refresh-floor-qc-data');
    if (floorQcRefreshBtn) {
        floorQcRefreshBtn.addEventListener('click', function () {
            if (window.FloorQcSheetEngine && typeof window.FloorQcSheetEngine.sync === 'function') {
                window.FloorQcSheetEngine.sync();
            } else {
                floorQcTableData.allRows       = [];
                floorQcTableData.columnFilters = {};
                fetchFloorQcDetailsAndRender();
            }
        });
    }

    var fmsProdCard = document.getElementById('kpi-fms-production-details');
    if (fmsProdCard) {
        fmsProdCard.addEventListener('click', function () { showBatchListFmsProductionView(); });
        fmsProdCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListFmsProductionView(); }
        });
    }

    var fmsProdBackBtn = document.getElementById('btn-back-fms-production');
    if (fmsProdBackBtn) fmsProdBackBtn.addEventListener('click', function () {
        if (window.FmsProductionSheetEngine && typeof window.FmsProductionSheetEngine.hideView === 'function') {
            window.FmsProductionSheetEngine.hideView();
        } else {
            showBatchListKpiView();
        }
    });

    var fmsProdExcelBtn = document.getElementById('btn-download-fms-production-excel');
    if (fmsProdExcelBtn) fmsProdExcelBtn.addEventListener('click', function () {
        if (window.FmsProductionSheetEngine && typeof window.FmsProductionSheetEngine.exportExcel === 'function') {
            window.FmsProductionSheetEngine.exportExcel();
        }
    });

    var fmsProdRefreshBtn = document.getElementById('btn-refresh-fms-production-data');
    if (fmsProdRefreshBtn) {
        fmsProdRefreshBtn.addEventListener('click', function () {
            if (window.FmsProductionSheetEngine && typeof window.FmsProductionSheetEngine.sync === 'function') {
                window.FmsProductionSheetEngine.sync();
            }
        });
    }

    var floorQcSearchEl = document.getElementById('floor-qc-data-search');
    if (floorQcSearchEl) {
        floorQcSearchEl.addEventListener('input', function () {
            updateFloorQcSearchClearBtn();
            applyFloorQcSearch(floorQcSearchEl.value);
        });
    }
    var floorQcClearSearch = document.getElementById('floor-qc-data-search-clear');
    if (floorQcClearSearch) {
        floorQcClearSearch.addEventListener('click', function () {
            var s = document.getElementById('floor-qc-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateFloorQcSearchClearBtn();
            applyFloorQcSearch('');
        });
    }

    var floorQcDateFrom = document.getElementById('floor-qc-date-from');
    if (floorQcDateFrom) {
        floorQcDateFrom.addEventListener('change', function () {
            floorQcTableData.dateFrom = floorQcDateFrom.value;
            updateFloorQcDateClearBtn();
            applyFloorQcFilters();
        });
    }
    var floorQcDateTo = document.getElementById('floor-qc-date-to');
    if (floorQcDateTo) {
        floorQcDateTo.addEventListener('change', function () {
            floorQcTableData.dateTo = floorQcDateTo.value;
            updateFloorQcDateClearBtn();
            applyFloorQcFilters();
        });
    }
    var floorQcDateClear = document.getElementById('floor-qc-date-clear');
    if (floorQcDateClear) {
        floorQcDateClear.addEventListener('click', function () {
            floorQcTableData.dateFrom = '';
            floorQcTableData.dateTo   = '';
            var f = document.getElementById('floor-qc-date-from');
            var t = document.getElementById('floor-qc-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateFloorQcDateClearBtn();
            applyFloorQcFilters();
        });
    }

    var floorQcPageSize = document.getElementById('floor-qc-data-page-size');
    if (floorQcPageSize) {
        floorQcPageSize.addEventListener('change', function () {
            floorQcTableData.pageSize = parseInt(floorQcPageSize.value, 10) || 25;
            floorQcTableData.page = 1;
            renderFloorQcTable();
        });
    }

    var edgePaintCard = document.getElementById('kpi-edge-paint-details');
    if (edgePaintCard) {
        edgePaintCard.addEventListener('click', function () { showBatchListEdgePaintView(); });
        edgePaintCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListEdgePaintView(); }
        });
    }

    var edgePaintBackBtn = document.getElementById('btn-back-edge-paint');
    if (edgePaintBackBtn) edgePaintBackBtn.addEventListener('click', function () { showBatchListKpiView(); });

    var edgePaintExcelBtn = document.getElementById('btn-download-edge-paint-excel');
    if (edgePaintExcelBtn) edgePaintExcelBtn.addEventListener('click', function () { downloadEdgePaintExcel(); });

    var edgePaintRefreshBtn = document.getElementById('btn-refresh-edge-paint-data');
    if (edgePaintRefreshBtn) {
        edgePaintRefreshBtn.addEventListener('click', function () {
            edgePaintTableData.allRows       = [];
            edgePaintTableData.columnFilters = {};
            fetchEdgePaintDetailsAndRender();
        });
    }

    var edgePaintSearchEl = document.getElementById('edge-paint-data-search');
    if (edgePaintSearchEl) {
        edgePaintSearchEl.addEventListener('input', function () {
            updateEdgePaintSearchClearBtn();
            applyEdgePaintSearch(edgePaintSearchEl.value);
        });
    }
    var edgePaintClearSearch = document.getElementById('edge-paint-data-search-clear');
    if (edgePaintClearSearch) {
        edgePaintClearSearch.addEventListener('click', function () {
            var s = document.getElementById('edge-paint-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateEdgePaintSearchClearBtn();
            applyEdgePaintSearch('');
        });
    }

    var edgePaintDateFrom = document.getElementById('edge-paint-date-from');
    if (edgePaintDateFrom) {
        edgePaintDateFrom.addEventListener('change', function () {
            edgePaintTableData.dateFrom = edgePaintDateFrom.value;
            updateEdgePaintDateClearBtn();
            applyEdgePaintFilters();
        });
    }
    var edgePaintDateTo = document.getElementById('edge-paint-date-to');
    if (edgePaintDateTo) {
        edgePaintDateTo.addEventListener('change', function () {
            edgePaintTableData.dateTo = edgePaintDateTo.value;
            updateEdgePaintDateClearBtn();
            applyEdgePaintFilters();
        });
    }
    var edgePaintDateClear = document.getElementById('edge-paint-date-clear');
    if (edgePaintDateClear) {
        edgePaintDateClear.addEventListener('click', function () {
            edgePaintTableData.dateFrom = '';
            edgePaintTableData.dateTo   = '';
            var f = document.getElementById('edge-paint-date-from');
            var t = document.getElementById('edge-paint-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateEdgePaintDateClearBtn();
            applyEdgePaintFilters();
        });
    }

    var edgePaintPageSize = document.getElementById('edge-paint-data-page-size');
    if (edgePaintPageSize) {
        edgePaintPageSize.addEventListener('change', function () {
            edgePaintTableData.pageSize = parseInt(edgePaintPageSize.value, 10) || 25;
            edgePaintTableData.page = 1;
            renderEdgePaintTable();
        });
    }

    var preAqlCard = document.getElementById('kpi-pre-aql-details');
    if (preAqlCard) {
        preAqlCard.addEventListener('click', function () { showBatchListPreAqlView(); });
        preAqlCard.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBatchListPreAqlView(); }
        });
    }

    var preAqlBackBtn = document.getElementById('btn-back-pre-aql');
    if (preAqlBackBtn) preAqlBackBtn.addEventListener('click', function () { showBatchListKpiView(); });

    var preAqlExcelBtn = document.getElementById('btn-download-pre-aql-excel');
    if (preAqlExcelBtn) preAqlExcelBtn.addEventListener('click', function () { downloadPreAqlExcel(); });

    var preAqlRefreshBtn = document.getElementById('btn-refresh-pre-aql-data');
    if (preAqlRefreshBtn) {
        preAqlRefreshBtn.addEventListener('click', function () {
            preAqlTableData.allRows       = [];
            preAqlTableData.columnFilters = {};
            fetchPreAqlDetailsAndRender();
        });
    }

    var preAqlSearchEl = document.getElementById('pre-aql-data-search');
    if (preAqlSearchEl) {
        preAqlSearchEl.addEventListener('input', function () {
            updatePreAqlSearchClearBtn();
            applyPreAqlSearch(preAqlSearchEl.value);
        });
    }
    var preAqlClearSearch = document.getElementById('pre-aql-data-search-clear');
    if (preAqlClearSearch) {
        preAqlClearSearch.addEventListener('click', function () {
            var s = document.getElementById('pre-aql-data-search');
            if (s) { s.value = ''; s.focus(); }
            updatePreAqlSearchClearBtn();
            applyPreAqlSearch('');
        });
    }

    var preAqlDateFrom = document.getElementById('pre-aql-date-from');
    if (preAqlDateFrom) {
        preAqlDateFrom.addEventListener('change', function () {
            preAqlTableData.dateFrom = preAqlDateFrom.value;
            updatePreAqlDateClearBtn();
            applyPreAqlFilters();
        });
    }
    var preAqlDateTo = document.getElementById('pre-aql-date-to');
    if (preAqlDateTo) {
        preAqlDateTo.addEventListener('change', function () {
            preAqlTableData.dateTo = preAqlDateTo.value;
            updatePreAqlDateClearBtn();
            applyPreAqlFilters();
        });
    }
    var preAqlDateClear = document.getElementById('pre-aql-date-clear');
    if (preAqlDateClear) {
        preAqlDateClear.addEventListener('click', function () {
            preAqlTableData.dateFrom = '';
            preAqlTableData.dateTo   = '';
            var f = document.getElementById('pre-aql-date-from');
            var t = document.getElementById('pre-aql-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updatePreAqlDateClearBtn();
            applyPreAqlFilters();
        });
    }

    var preAqlPageSize = document.getElementById('pre-aql-data-page-size');
    if (preAqlPageSize) {
        preAqlPageSize.addEventListener('change', function () {
            preAqlTableData.pageSize = parseInt(preAqlPageSize.value, 10) || 25;
            preAqlTableData.page = 1;
            renderPreAqlTable();
        });
    }

    var bantalaSearchEl = document.getElementById('bantala-data-search');
    if (bantalaSearchEl) {
        bantalaSearchEl.addEventListener('input', function () {
            updateBantalaSearchClearBtn();
            applyBantalaSearch(bantalaSearchEl.value);
        });
    }
    var bantalaClearSearch = document.getElementById('bantala-data-search-clear');
    if (bantalaClearSearch) {
        bantalaClearSearch.addEventListener('click', function () {
            var s = document.getElementById('bantala-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateBantalaSearchClearBtn();
            applyBantalaSearch('');
        });
    }

    var bantalaDateFrom = document.getElementById('bantala-date-from');
    if (bantalaDateFrom) {
        bantalaDateFrom.addEventListener('change', function () {
            bantalaTableData.dateFrom = bantalaDateFrom.value;
            updateBantalaDateClearBtn();
            applyBantalaFilters();
        });
    }
    var bantalaDateTo = document.getElementById('bantala-date-to');
    if (bantalaDateTo) {
        bantalaDateTo.addEventListener('change', function () {
            bantalaTableData.dateTo = bantalaDateTo.value;
            updateBantalaDateClearBtn();
            applyBantalaFilters();
        });
    }
    var bantalaDateClear = document.getElementById('bantala-date-clear');
    if (bantalaDateClear) {
        bantalaDateClear.addEventListener('click', function () {
            bantalaTableData.dateFrom = '';
            bantalaTableData.dateTo   = '';
            var f = document.getElementById('bantala-date-from');
            var t = document.getElementById('bantala-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateBantalaDateClearBtn();
            applyBantalaFilters();
        });
    }

    var bantalaPageSize = document.getElementById('bantala-data-page-size');
    if (bantalaPageSize) {
        bantalaPageSize.addEventListener('change', function () {
            bantalaTableData.pageSize = parseInt(bantalaPageSize.value, 10) || 25;
            bantalaTableData.page = 1;
            renderBantalaTable();
        });
    }
    var searchEl = document.getElementById('cutting-data-search');
    if (searchEl) {
        searchEl.addEventListener('input', function () {
            updateCuttingSearchClearBtn();
            applyCuttingSearch(searchEl.value);
        });
    }
    var clearSearchBtn = document.getElementById('cutting-data-search-clear');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function () {
            var s = document.getElementById('cutting-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateCuttingSearchClearBtn();
            applyCuttingSearch('');
        });
    }

    // Date range â€” From
    var cdfEl = document.getElementById('cutting-date-from');
    if (cdfEl) {
        cdfEl.addEventListener('change', function () {
            cuttingTableData.dateFrom = cdfEl.value;
            updateCuttingDateClearBtn();
            applyCuttingFilters();
        });
    }

    // Date range â€” To
    var cdtEl = document.getElementById('cutting-date-to');
    if (cdtEl) {
        cdtEl.addEventListener('change', function () {
            cuttingTableData.dateTo = cdtEl.value;
            updateCuttingDateClearBtn();
            applyCuttingFilters();
        });
    }

    // Date clear
    var cdClearBtn = document.getElementById('cutting-date-clear');
    if (cdClearBtn) {
        cdClearBtn.addEventListener('click', function () {
            cuttingTableData.dateFrom = '';
            cuttingTableData.dateTo   = '';
            var f = document.getElementById('cutting-date-from');
            var t = document.getElementById('cutting-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateCuttingDateClearBtn();
            applyCuttingFilters();
        });
    }

    var pageSizeEl = document.getElementById('cutting-data-page-size');
    if (pageSizeEl) {
        pageSizeEl.addEventListener('change', function () {
            cuttingTableData.pageSize = parseInt(pageSizeEl.value, 10) || 25;
            cuttingTableData.page = 1;
            renderCuttingTable();
        });
    }
}


// ===========================================================================
// BATCH LIST â€” Bantala Details (IndexedDB + Google Sheets GVIZ CSV Live Engine)
// Sheet: BANTALA DETAILS (GID: 1526950534, Range: A:H, 8 Columns)
// ===========================================================================

var BANTALA_SHEET_ID = '1QZ4B2TsrElgQVqUGQwc3dHgODiWRNDrPBGVAiF-td7E';
var BANTALA_GID = '1526950534';
var BANTALA_CSV_URL = 'https://docs.google.com/spreadsheets/d/' + BANTALA_SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + BANTALA_GID + '&range=A:H';

var BANTALA_DB_NAME = 'FMS_Bantala_Details_DB_v1';
var BANTALA_DB_VERSION = 1;
var BANTALA_STORE_NAME = 'bantala_store';

var bantalaDefaultHeaders = [
    'Batch No',
    'Quantity',
    'Sending Date',
    'ERP Issue Date',
    'Material Issue Date',
    'Material Handover To Fabricator Date',
    '100 % Material Received Date',
    'Material Due or OK Status'
];

var bantalaTableData = {
    headers:       bantalaDefaultHeaders.slice(),
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',   // YYYY-MM-DD â€” filters on Column C (date column)
    dateTo:        ''    // YYYY-MM-DD â€” filters on Column C (date column)
};

var bantalaDbInstance_ = null;
var bantalaIsSyncing_ = false;
var bantalaLastSync_ = null;

// IndexedDB Helper
function openBantalaDB_() {
    return new Promise(function (resolve, reject) {
        if (bantalaDbInstance_) return resolve(bantalaDbInstance_);
        if (!window.indexedDB) {
            return reject(new Error('IndexedDB is not supported in this browser.'));
        }
        var req = indexedDB.open(BANTALA_DB_NAME, BANTALA_DB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(BANTALA_STORE_NAME)) {
                db.createObjectStore(BANTALA_STORE_NAME);
            }
        };
        req.onsuccess = function (e) {
            bantalaDbInstance_ = e.target.result;
            resolve(bantalaDbInstance_);
        };
        req.onerror = function (e) {
            reject(e.target.error);
        };
    });
}

function loadBantalaFromIndexedDB_() {
    return openBantalaDB_().then(function (db) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(BANTALA_STORE_NAME, 'readonly');
            var store = tx.objectStore(BANTALA_STORE_NAME);
            var reqH = store.get('headers');
            var reqR = store.get('rows');
            var reqS = store.get('last_sync');
            tx.oncomplete = function () {
                if (reqR.result && Array.isArray(reqR.result) && reqR.result.length > 0) {
                    resolve({
                        headers: reqH.result || bantalaDefaultHeaders.slice(),
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

function saveBantalaToIndexedDB_(headers, rows, lastSync) {
    return openBantalaDB_().then(function (db) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(BANTALA_STORE_NAME, 'readwrite');
            var store = tx.objectStore(BANTALA_STORE_NAME);
            store.put(headers, 'headers');
            store.put(rows, 'rows');
            store.put(lastSync || new Date().toLocaleString(), 'last_sync');
            store.put(rows.length, 'count');
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function (e) { reject(e.target.error); };
        });
    });
}

// RFC-4180 High Performance CSV Stream Parser (8 Columns: A to H)
function parseBantalaCSVStream_(csvText) {
    var rows = [];
    var curRow = [];
    var curVal = '';
    var inQuotes = false;
    var len = csvText.length;
    var isFirstRow = true;
    var headers = bantalaDefaultHeaders.slice();
    var NUM_COLS = 8;

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
                processParsedRow();
            } else if (c === '\n') { curRow.push(curVal.trim()); curVal = ''; processParsedRow(); }
            else { curVal += c; }
        }
    }
    if (curVal || curRow.length) { curRow.push(curVal.trim()); processParsedRow(); }

    function processParsedRow() {
        if (isFirstRow) {
            if (curRow.length > 0 && curRow.some(function (h) { return h.length > 0; })) {
                var parsed = curRow.slice(0, NUM_COLS);
                while (parsed.length < NUM_COLS) parsed.push(bantalaDefaultHeaders[parsed.length] || ('Col ' + (parsed.length + 1)));
                headers = parsed;
            }
            isFirstRow = false;
        } else {
            var hasContent = curRow.some(function (cell) { return cell !== undefined && cell !== null && String(cell).trim() !== ''; });
            if (!hasContent) { curRow = []; return; }
            var normalized = new Array(NUM_COLS);
            for (var j = 0; j < NUM_COLS; j++) {
                normalized[j] = (curRow[j] !== undefined && curRow[j] !== null) ? curRow[j] : '';
            }
            rows.push(normalized);
        }
        curRow = [];
    }

    return { headers: headers, rows: rows };
}

function fetchBantalaCsvFromSheet_() {
    return fetch(BANTALA_CSV_URL + '&_ts=' + Date.now(), { method: 'GET', cache: 'no-cache' })
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching Bantala Details CSV');
            return res.text();
        })
        .then(function (csvText) {
            return parseBantalaCSVStream_(csvText);
        });
}

function updateBantalaBadgeUI_(lastSync, count) {
    var badge = document.getElementById('bantala-sheet-db-badge');
    var syncText = document.getElementById('bantala-sheet-last-sync-text');
    if (badge) badge.style.display = 'inline-flex';
    if (syncText && lastSync) {
        syncText.textContent = 'Synced ' + lastSync + (count !== undefined ? ' (' + count.toLocaleString() + ' records)' : '');
    }
}

function syncBantalaData_(isManual) {
    if (bantalaIsSyncing_) return Promise.resolve();
    bantalaIsSyncing_ = true;

    var refreshBtn = document.getElementById('btn-refresh-bantala-data');
    var refreshIcon = refreshBtn ? refreshBtn.querySelector('.material-icons-round') : null;
    if (refreshIcon) refreshIcon.classList.add('bai-sheet-spin');

    return fetchBantalaCsvFromSheet_()
        .then(function (result) {
            if (!result || !result.rows || result.rows.length === 0) {
                throw new Error('No records returned from Bantala Google Sheet');
            }
            var nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            bantalaLastSync_ = nowStr;
            return saveBantalaToIndexedDB_(result.headers, result.rows, nowStr).then(function () {
                var hasActiveFilters = Boolean(
                    bantalaTableData.searchQuery ||
                    bantalaTableData.dateFrom ||
                    bantalaTableData.dateTo ||
                    Object.keys(bantalaTableData.columnFilters || {}).some(function (k) { return (bantalaTableData.columnFilters[k] || '').trim() !== ''; })
                );
                onBantalaDataLoaded({
                    success: true,
                    headers: result.headers,
                    rows: result.rows
                }, hasActiveFilters && !isManual);
                updateBantalaBadgeUI_(nowStr, result.rows.length);
                if (isManual) {
                    showToast('success', 'Bantala Synced', 'Synced ' + result.rows.length.toLocaleString() + ' records from Google Sheet');
                }
            });
        })
        .catch(function (err) {
            console.warn('Bantala GVIZ sync failed, falling back:', err);
            if (isManual) {
                showToast('error', 'Sync Failed', err.message || 'Check network connection');
            }
            if (bantalaTableData.allRows.length === 0) {
                if (typeof google !== 'undefined' && google.script && google.script.run) {
                    google.script.run
                        .withSuccessHandler(function (r) { onBantalaDataLoaded(r); })
                        .withFailureHandler(function (e) { onBantalaDataError(e.message || 'Failed to load data.'); })
                        .getBantalaDetailsData();
                } else {
                    jsonp({ action: 'getBantalaDetailsData' }, function (gErr, result) {
                        if (gErr) { onBantalaDataError(gErr.message); return; }
                        onBantalaDataLoaded(result);
                    });
                }
            }
        })
        .finally(function () {
            bantalaIsSyncing_ = false;
            if (refreshIcon) refreshIcon.classList.remove('bai-sheet-spin');
        });
}

function initBantalaEngine_() {
    loadBantalaFromIndexedDB_().then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
            bantalaTableData.headers = cached.headers;
            bantalaTableData.allRows = cached.rows;
            bantalaTableData.filteredRows = cached.rows.slice();
            updateBantalaBadgeUI_(cached.lastSync, cached.rows.length);
            var labelEl = document.getElementById('bantala-date-col-label');
            if (labelEl && cached.headers[2]) {
                labelEl.textContent = cached.headers[2];
            }
            buildBantalaTableHeaders();
            // Silent background sync
            setTimeout(function () {
                syncBantalaData_(false);
            }, 1200);
        } else {
            // First time - pre-fetch so it's ready when user navigates
            setTimeout(function () {
                syncBantalaData_(false);
            }, 1500);
        }
    }).catch(function (e) {
        console.warn('initBantalaEngine_ error:', e);
    });
}

// Column C (index 2) is always the date column per the sheet layout
function getBantalaDateColIndex() { return 2; }

function updateBantalaDateClearBtn() {
    var btn = document.getElementById('bantala-date-clear');
    if (btn) btn.style.display = (bantalaTableData.dateFrom || bantalaTableData.dateTo) ? '' : 'none';
}

function updateBantalaSearchClearBtn() {
    var s = document.getElementById('bantala-data-search');
    var b = document.getElementById('bantala-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchBantalaDetailsAndRender(isManual) {
    if (isManual) {
        syncBantalaData_(true);
        return;
    }
    // Instant 0ms render from IndexedDB if in-memory data is empty
    loadBantalaFromIndexedDB_().then(function (cached) {
        if (cached && cached.rows && cached.rows.length > 0) {
            onBantalaDataLoaded({
                success: true,
                headers: cached.headers,
                rows: cached.rows
            });
            updateBantalaBadgeUI_(cached.lastSync, cached.rows.length);
            // Silent background sync to get newest updates
            setTimeout(function () {
                syncBantalaData_(false);
            }, 500);
        } else {
            var emptyEl  = document.getElementById('bantala-data-empty');
            var tableEl  = document.getElementById('bantala-data-table');
            var footerEl = document.getElementById('bantala-data-footer');
            if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Connecting to Google Sheets & building local databaseâ€¦'; emptyEl.style.display = ''; }
            if (tableEl)  tableEl.style.display  = 'none';
            if (footerEl) footerEl.style.display = 'none';
            syncBantalaData_(false);
        }
    }).catch(function () {
        syncBantalaData_(false);
    });
}

window.syncBantalaData = syncBantalaData_;
window.fetchBantalaDetailsAndRender = fetchBantalaDetailsAndRender;
window.initBantalaEngine = initBantalaEngine_;
window.loadBantalaFromIndexedDB = loadBantalaFromIndexedDB_;
window.bantalaTableData = bantalaTableData;

function onBantalaDataLoaded(result, preserveFilters) {
    if (!result || !result.success) {
        onBantalaDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    bantalaTableData.headers       = result.headers || bantalaDefaultHeaders.slice();
    bantalaTableData.allRows       = result.rows    || [];

    var labelEl = document.getElementById('bantala-date-col-label');
    if (labelEl && bantalaTableData.headers[2]) {
        labelEl.textContent = bantalaTableData.headers[2];
    }

    if (!preserveFilters) {
        bantalaTableData.filteredRows  = bantalaTableData.allRows.slice();
        bantalaTableData.sortCol       = -1;
        bantalaTableData.sortAsc       = true;
        bantalaTableData.page          = 1;
        bantalaTableData.searchQuery   = '';
        bantalaTableData.columnFilters = {};
        bantalaTableData.dateFrom      = '';
        bantalaTableData.dateTo        = '';

        var s = document.getElementById('bantala-data-search');
        if (s) s.value = '';
        updateBantalaSearchClearBtn();

        var df = document.getElementById('bantala-date-from');
        var dt = document.getElementById('bantala-date-to');
        if (df) df.value = '';
        if (dt) dt.value = '';
        updateBantalaDateClearBtn();

        buildBantalaTableHeaders();
        renderBantalaTable();
    } else {
        applyBantalaFilters();
    }
}

function onBantalaDataError(msg) {
    var emptyEl = document.getElementById('bantala-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('bantala-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('bantala-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildBantalaTableHeaders() {
    var thead = document.getElementById('bantala-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className   = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    bantalaTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-bantala-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onBantalaSortColumn(i); });
        trHead.appendChild(th);
    });

    var trFilter    = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    bantalaTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text'; input.className = 'dt-col-filter';
        input.placeholder = 'Filterâ€¦';
        input.value = bantalaTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear'; clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            bantalaTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyBantalaFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = ''; bantalaTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none'; applyBantalaFilters(); input.focus();
        });
        wrap.appendChild(input); wrap.appendChild(clearBtn);
        th.appendChild(wrap); trFilter.appendChild(th);
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onBantalaSortColumn(colIndex) {
    if (bantalaTableData.sortCol === colIndex) {
        bantalaTableData.sortAsc = !bantalaTableData.sortAsc;
    } else {
        bantalaTableData.sortCol = colIndex;
        bantalaTableData.sortAsc = true;
    }
    updateBantalaSortIcons();
    applyBantalaFilters();
}

function updateBantalaSortIcons() {
    document.querySelectorAll('[data-bantala-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-bantala-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === bantalaTableData.sortCol) {
            icon.textContent = bantalaTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyBantalaFilters() {
    var query      = bantalaTableData.searchQuery;
    var colFilters = bantalaTableData.columnFilters;
    var dateColIdx = getBantalaDateColIndex(); // Column C = index 2

    var dateFrom = bantalaTableData.dateFrom
        ? new Date(bantalaTableData.dateFrom + 'T00:00:00')
        : null;
    var dateTo = bantalaTableData.dateTo
        ? new Date(bantalaTableData.dateTo + 'T23:59:59')
        : null;
    var anyDateFilter = dateFrom || dateTo;

    bantalaTableData.filteredRows = bantalaTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (bantalaTableData.sortCol >= 0) {
        var sc = bantalaTableData.sortCol;
        bantalaTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return bantalaTableData.sortAsc ? cmp : -cmp;
        });
    }

    bantalaTableData.page = 1;
    renderBantalaTable();
}

function applyBantalaSearch(query) {
    bantalaTableData.searchQuery = (query || '').trim().toLowerCase();
    applyBantalaFilters();
}

function renderBantalaTable() {
    var tbody      = document.getElementById('bantala-data-tbody');
    var tableEl    = document.getElementById('bantala-data-table');
    var emptyEl    = document.getElementById('bantala-data-empty');
    var footerEl   = document.getElementById('bantala-data-footer');
    var countBadge = document.getElementById('bantala-data-count-badge');
    if (!tbody) return;

    var total      = bantalaTableData.filteredRows.length;
    var pageSize   = bantalaTableData.pageSize;
    var page       = bantalaTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    bantalaTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = bantalaTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', bantalaTableData.headers.length + 1);
        var hasFilter = Object.keys(bantalaTableData.columnFilters).some(function (k) {
            return (bantalaTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = bantalaTableData.dateFrom || bantalaTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (bantalaTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (bantalaTableData.allRows.length === 0 ? 'No data found in Bantala Details.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('bantala-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        bantalaTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (bantalaTableData.searchQuery && cellVal.toLowerCase().indexOf(bantalaTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(bantalaTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('bantala-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (bantalaTableData.allRows.length !== total ? ' (filtered from ' + bantalaTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildBantalaPagination(page, totalPages);
}

function buildBantalaPagination(current, total) {
    var container = document.getElementById('bantala-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                bantalaTableData.page = page;
                renderBantalaTable();
                var wrap = document.getElementById('bantala-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === 'â€¦') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis'; el.textContent = 'â€¦';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadBantalaExcel() {
    var headers = bantalaTableData.headers;
    var rows    = bantalaTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Bantala Details',
        filenamePrefix: 'Bantala_Details'
    });
}

// ===========================================================================
// FLOOR SUPERVISOR KPI â€” PLANNED DATE sheet, range starting at A1
// ===========================================================================

var fsTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

function getFsDateColIndex() { return 0; }

function updateFsDateClearBtn() {
    var btn = document.getElementById('fs-date-clear');
    if (btn) btn.style.display = (fsTableData.dateFrom || fsTableData.dateTo) ? '' : 'none';
}

function updateFsSearchClearBtn() {
    var s = document.getElementById('fs-data-search');
    var b = document.getElementById('fs-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchFsDetailsAndRender() {
    if (window.FloorSupervisorSheetEngine && typeof window.FloorSupervisorSheetEngine.sync === 'function') {
        window.FloorSupervisorSheetEngine.sync();
        return;
    }
    var emptyEl  = document.getElementById('fs-data-empty');
    var tableEl  = document.getElementById('fs-data-table');
    var footerEl = document.getElementById('fs-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading dataâ€¦'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { onFsDataLoaded(r); })
            .withFailureHandler(function (e) { onFsDataError(e.message || 'Failed to load data.'); })
            .getFloorSupervisorKpiData();
        return;
    }
    jsonp({ action: 'getFloorSupervisorKpiData' }, function (err, result) {
        if (err) { onFsDataError(err.message); return; }
        onFsDataLoaded(result);
    });
}

function onFsDataLoaded(result) {
    if (!result || !result.success) {
        onFsDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    fsTableData.headers       = result.headers || [];
    fsTableData.allRows       = result.rows    || [];
    fsTableData.filteredRows  = fsTableData.allRows.slice();
    fsTableData.sortCol       = -1;
    fsTableData.sortAsc       = true;
    fsTableData.page          = 1;
    fsTableData.searchQuery   = '';
    fsTableData.columnFilters = {};
    fsTableData.dateFrom      = '';
    fsTableData.dateTo        = '';

    var s = document.getElementById('fs-data-search');
    if (s) s.value = '';
    updateFsSearchClearBtn();

    var df = document.getElementById('fs-date-from');
    var dt = document.getElementById('fs-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updateFsDateClearBtn();

    var labelEl = document.getElementById('fs-date-col-label');
    if (labelEl && fsTableData.headers[getFsDateColIndex()]) {
        labelEl.textContent = fsTableData.headers[getFsDateColIndex()];
    }

    buildFsTableHeaders();
    renderFsTable();
}

function onFsDataError(msg) {
    var emptyEl = document.getElementById('fs-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('fs-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('fs-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildFsTableHeaders() {
    var thead = document.getElementById('fs-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    fsTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-fs-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onFsSortColumn(i); });
        trHead.appendChild(th);
        if (i === 0) {
            var thPdf = document.createElement('th');
            thPdf.className = 'dt-th dt-th-pdf';
            thPdf.textContent = 'PDF File';
            trHead.appendChild(thPdf);
        }
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    fsTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filterâ€¦';
        input.value = fsTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            fsTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyFsFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            fsTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyFsFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
        if (i === 0) {
            var thFilterPdf = document.createElement('th');
            thFilterPdf.className = 'dt-filter-cell dt-filter-cell-pdf';
            trFilter.appendChild(thFilterPdf);
        }
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onFsSortColumn(colIndex) {
    if (fsTableData.sortCol === colIndex) {
        fsTableData.sortAsc = !fsTableData.sortAsc;
    } else {
        fsTableData.sortCol = colIndex;
        fsTableData.sortAsc = true;
    }
    updateFsSortIcons();
    applyFsFilters();
}

function updateFsSortIcons() {
    document.querySelectorAll('[data-fs-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-fs-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === fsTableData.sortCol) {
            icon.textContent = fsTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyFsFilters() {
    var query      = fsTableData.searchQuery;
    var colFilters = fsTableData.columnFilters;
    var dateColIdx = getFsDateColIndex();
    var dateFrom   = fsTableData.dateFrom ? new Date(fsTableData.dateFrom + 'T00:00:00') : null;
    var dateTo     = fsTableData.dateTo   ? new Date(fsTableData.dateTo   + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    fsTableData.filteredRows = fsTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (fsTableData.sortCol >= 0) {
        var sc = fsTableData.sortCol;
        fsTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return fsTableData.sortAsc ? cmp : -cmp;
        });
    }

    fsTableData.page = 1;
    renderFsTable();
}

function applyFsSearch(query) {
    fsTableData.searchQuery = (query || '').trim().toLowerCase();
    applyFsFilters();
}

function renderFsTable() {
    var tbody      = document.getElementById('fs-data-tbody');
    var tableEl    = document.getElementById('fs-data-table');
    var emptyEl    = document.getElementById('fs-data-empty');
    var footerEl   = document.getElementById('fs-data-footer');
    var countBadge = document.getElementById('fs-data-count-badge');
    if (!tbody) return;

    var total      = fsTableData.filteredRows.length;
    var pageSize   = fsTableData.pageSize;
    var page       = fsTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    fsTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = fsTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', fsTableData.headers.length + 2);
        var hasFilter = Object.keys(fsTableData.columnFilters).some(function (k) {
            return (fsTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = fsTableData.dateFrom || fsTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (fsTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (fsTableData.allRows.length === 0 ? 'No data found in Floor Supervisor sheet.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('fs-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        fsTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (fsTableData.searchQuery && cellVal.toLowerCase().indexOf(fsTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(fsTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
            if (ci === 0) {
                var tdPdf = document.createElement('td');
                tdPdf.className = 'dt-td dt-td-pdf';
                var pdfBtn = document.createElement('button');
                pdfBtn.type = 'button';
                pdfBtn.className = 'dt-pdf-download-btn';
                pdfBtn.title = 'Download PDF';
                pdfBtn.innerHTML = '<span class="material-icons-round">download</span>';
                pdfBtn.addEventListener('click', function () {
                    downloadFsRowAsPdf(fsTableData.headers, row, row[1]);
                });
                tdPdf.appendChild(pdfBtn);
                tr.appendChild(tdPdf);
            }
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('fs-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (fsTableData.allRows.length !== total ? ' (filtered from ' + fsTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildFsPagination(page, totalPages);
}

function buildFsPagination(current, total) {
    var container = document.getElementById('fs-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                fsTableData.page = page;
                renderFsTable();
                var wrap = document.getElementById('fs-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === 'â€¦') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = 'â€¦';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadFsExcel() {
    var headers = fsTableData.headers;
    var rows    = fsTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'Floor Supervisor',
        filenamePrefix: 'Floor_Supervisor'
    });
}


// ===========================================================================
// IN-LINE QC KPI â€” PLANNED DATE sheet, ranges A1 + V1 combined
// ===========================================================================

var iqcTableData = {
    headers:       [],
    allRows:       [],
    filteredRows:  [],
    sortCol:       -1,
    sortAsc:       true,
    page:          1,
    pageSize:      25,
    searchQuery:   '',
    columnFilters: {},
    dateFrom:      '',
    dateTo:        ''
};

function getIqcDateColIndex() { return 0; }

function updateIqcDateClearBtn() {
    var btn = document.getElementById('iqc-date-clear');
    if (btn) btn.style.display = (iqcTableData.dateFrom || iqcTableData.dateTo) ? '' : 'none';
}

function updateIqcSearchClearBtn() {
    var s = document.getElementById('iqc-data-search');
    var b = document.getElementById('iqc-data-search-clear');
    if (s && b) b.style.display = s.value ? '' : 'none';
}

function fetchIqcDetailsAndRender() {
    if (window.InLineQcSheetEngine && typeof window.InLineQcSheetEngine.sync === 'function') {
        window.InLineQcSheetEngine.sync();
        return;
    }
    var emptyEl  = document.getElementById('iqc-data-empty');
    var tableEl  = document.getElementById('iqc-data-table');
    var footerEl = document.getElementById('iqc-data-footer');
    if (emptyEl)  { emptyEl.querySelector('p').textContent = 'Loading dataâ€¦'; emptyEl.style.display = ''; }
    if (tableEl)  tableEl.style.display  = 'none';
    if (footerEl) footerEl.style.display = 'none';
    showSpinner('Fetching In-Line QC dataâ€¦');
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function (r) { hideSpinner(); onIqcDataLoaded(r); })
            .withFailureHandler(function (e) { hideSpinner(); onIqcDataError(e.message || 'Failed to load data.'); })
            .getInLineQcKpiData();
        return;
    }
    jsonp({ action: 'getInLineQcKpiData' }, function (err, result) {
        hideSpinner();
        if (err) { onIqcDataError(err.message); return; }
        onIqcDataLoaded(result);
    });
}

function onIqcDataLoaded(result) {
    if (!result || !result.success) {
        onIqcDataError((result && result.error) || 'Failed to load data.');
        return;
    }
    iqcTableData.headers       = result.headers || [];
    iqcTableData.allRows       = result.rows    || [];
    iqcTableData.filteredRows  = iqcTableData.allRows.slice();
    iqcTableData.sortCol       = -1;
    iqcTableData.sortAsc       = true;
    iqcTableData.page          = 1;
    iqcTableData.searchQuery   = '';
    iqcTableData.columnFilters = {};
    iqcTableData.dateFrom      = '';
    iqcTableData.dateTo        = '';

    var s = document.getElementById('iqc-data-search');
    if (s) s.value = '';
    updateIqcSearchClearBtn();

    var df = document.getElementById('iqc-date-from');
    var dt = document.getElementById('iqc-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    updateIqcDateClearBtn();

    var labelEl = document.getElementById('iqc-date-col-label');
    if (labelEl && iqcTableData.headers[getIqcDateColIndex()]) {
        labelEl.textContent = iqcTableData.headers[getIqcDateColIndex()];
    }

    buildIqcTableHeaders();
    renderIqcTable();
}

function onIqcDataError(msg) {
    var emptyEl = document.getElementById('iqc-data-empty');
    if (emptyEl) { emptyEl.querySelector('p').textContent = 'Error: ' + msg; emptyEl.style.display = ''; }
    var tableEl = document.getElementById('iqc-data-table');
    if (tableEl) tableEl.style.display = 'none';
    var footerEl = document.getElementById('iqc-data-footer');
    if (footerEl) footerEl.style.display = 'none';
    showToast('error', 'Data Error', msg);
}

function buildIqcTableHeaders() {
    var thead = document.getElementById('iqc-data-thead');
    if (!thead) return;
    thead.innerHTML = '';

    var trHead = document.createElement('tr');
    var thNum  = document.createElement('th');
    thNum.className = 'dt-th dt-th-num';
    thNum.textContent = '#';
    trHead.appendChild(thNum);
    iqcTableData.headers.forEach(function (h, i) {
        var th = document.createElement('th');
        th.className = 'dt-th dt-th-sortable';
        th.setAttribute('data-iqc-col', i);
        th.innerHTML = esc(h) + '<span class="dt-sort-icon material-icons-round">unfold_more</span>';
        th.addEventListener('click', function () { onIqcSortColumn(i); });
        trHead.appendChild(th);
        if (i === 0) {
            var thPdf = document.createElement('th');
            thPdf.className = 'dt-th dt-th-pdf';
            thPdf.textContent = 'PDF File';
            trHead.appendChild(thPdf);
        }
    });

    var trFilter = document.createElement('tr');
    trFilter.className = 'dt-filter-row';
    var thFilterNum = document.createElement('th');
    thFilterNum.className = 'dt-filter-cell dt-filter-cell-num';
    thFilterNum.innerHTML = '<span class="material-icons-round" style="font-size:12px;opacity:.45;color:#94a3b8;">filter_list</span>';
    trFilter.appendChild(thFilterNum);

    iqcTableData.headers.forEach(function (h, i) {
        var th    = document.createElement('th');
        th.className = 'dt-filter-cell';
        var wrap  = document.createElement('div');
        wrap.className = 'dt-col-filter-wrap';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'dt-col-filter';
        input.placeholder = 'Filterâ€¦';
        input.value = iqcTableData.columnFilters[i] || '';
        var clearBtn = document.createElement('button');
        clearBtn.className = 'dt-col-filter-clear';
        clearBtn.title = 'Clear filter';
        clearBtn.innerHTML = '<span class="material-icons-round">close</span>';
        clearBtn.style.display = input.value ? '' : 'none';
        input.addEventListener('input', function () {
            iqcTableData.columnFilters[i] = input.value;
            clearBtn.style.display = input.value ? '' : 'none';
            applyIqcFilters();
        });
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = '';
            iqcTableData.columnFilters[i] = '';
            clearBtn.style.display = 'none';
            applyIqcFilters();
            input.focus();
        });
        wrap.appendChild(input);
        wrap.appendChild(clearBtn);
        th.appendChild(wrap);
        trFilter.appendChild(th);
        if (i === 0) {
            var thFilterPdf = document.createElement('th');
            thFilterPdf.className = 'dt-filter-cell dt-filter-cell-pdf';
            trFilter.appendChild(thFilterPdf);
        }
    });

    thead.appendChild(trFilter);
    thead.appendChild(trHead);
}

function onIqcSortColumn(colIndex) {
    if (iqcTableData.sortCol === colIndex) {
        iqcTableData.sortAsc = !iqcTableData.sortAsc;
    } else {
        iqcTableData.sortCol = colIndex;
        iqcTableData.sortAsc = true;
    }
    updateIqcSortIcons();
    applyIqcFilters();
}

function updateIqcSortIcons() {
    document.querySelectorAll('[data-iqc-col]').forEach(function (th) {
        var idx  = parseInt(th.getAttribute('data-iqc-col'), 10);
        var icon = th.querySelector('.dt-sort-icon');
        if (!icon) return;
        if (idx === iqcTableData.sortCol) {
            icon.textContent = iqcTableData.sortAsc ? 'arrow_upward' : 'arrow_downward';
            th.classList.add('dt-th-sorted');
        } else {
            icon.textContent = 'unfold_more';
            th.classList.remove('dt-th-sorted');
        }
    });
}

function applyIqcFilters() {
    var query      = iqcTableData.searchQuery;
    var colFilters = iqcTableData.columnFilters;
    var dateColIdx = getIqcDateColIndex();
    var dateFrom   = iqcTableData.dateFrom ? new Date(iqcTableData.dateFrom + 'T00:00:00') : null;
    var dateTo     = iqcTableData.dateTo   ? new Date(iqcTableData.dateTo   + 'T23:59:59') : null;
    var anyDateFilter = dateFrom || dateTo;

    iqcTableData.filteredRows = iqcTableData.allRows.filter(function (row) {
        if (query) {
            var rowMatch = row.some(function (cell) {
                return String(cell).toLowerCase().indexOf(query) !== -1;
            });
            if (!rowMatch) return false;
        }
        var colKeys = Object.keys(colFilters);
        for (var k = 0; k < colKeys.length; k++) {
            var ci = parseInt(colKeys[k], 10);
            var f  = (colFilters[colKeys[k]] || '').trim().toLowerCase();
            if (!f) continue;
            var cellVal = String(row[ci] !== undefined ? row[ci] : '').toLowerCase();
            if (cellVal.indexOf(f) === -1) return false;
        }
        if (anyDateFilter && dateColIdx >= 0 && dateColIdx < row.length) {
            var parsed = parseCreatedAt(row[dateColIdx]);
            if (!parsed) return false;
            if (dateFrom && parsed < dateFrom) return false;
            if (dateTo   && parsed > dateTo)   return false;
        }
        return true;
    });

    if (iqcTableData.sortCol >= 0) {
        var sc = iqcTableData.sortCol;
        iqcTableData.filteredRows.sort(function (a, b) {
            var av = (a[sc] || '').toString().toLowerCase();
            var bv = (b[sc] || '').toString().toLowerCase();
            var numA = parseFloat(av), numB = parseFloat(bv);
            var isNum = !isNaN(numA) && !isNaN(numB);
            var cmp = isNum ? (numA - numB) : av.localeCompare(bv);
            return iqcTableData.sortAsc ? cmp : -cmp;
        });
    }

    iqcTableData.page = 1;
    renderIqcTable();
}

function applyIqcSearch(query) {
    iqcTableData.searchQuery = (query || '').trim().toLowerCase();
    applyIqcFilters();
}

function renderIqcTable() {
    var tbody      = document.getElementById('iqc-data-tbody');
    var tableEl    = document.getElementById('iqc-data-table');
    var emptyEl    = document.getElementById('iqc-data-empty');
    var footerEl   = document.getElementById('iqc-data-footer');
    var countBadge = document.getElementById('iqc-data-count-badge');
    if (!tbody) return;

    var total      = iqcTableData.filteredRows.length;
    var pageSize   = iqcTableData.pageSize;
    var page       = iqcTableData.page;
    var totalPages = Math.ceil(total / pageSize) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    iqcTableData.page = page;

    var start = (page - 1) * pageSize;
    var end   = Math.min(start + pageSize, total);
    var slice = iqcTableData.filteredRows.slice(start, end);

    if (countBadge) countBadge.textContent = total + ' record' + (total !== 1 ? 's' : '');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';
    if (footerEl) footerEl.style.display = total > 0 ? '' : 'none';
    tbody.innerHTML = '';

    if (total === 0) {
        var trEmpty = document.createElement('tr');
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'dt-td-empty-msg';
        tdEmpty.setAttribute('colspan', iqcTableData.headers.length + 2);
        var hasFilter = Object.keys(iqcTableData.columnFilters).some(function (k) {
            return (iqcTableData.columnFilters[k] || '').trim() !== '';
        });
        var hasDate = iqcTableData.dateFrom || iqcTableData.dateTo;
        tdEmpty.innerHTML =
            '<span class="material-icons-round" style="vertical-align:middle;margin-right:6px;font-size:18px;color:#64748b;">search_off</span>' +
            (iqcTableData.searchQuery || hasFilter || hasDate
                ? 'No records match the current filter.'
                : (iqcTableData.allRows.length === 0 ? 'No data found in In-Line QC sheet.' : 'No records found.'));
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        var infoEl2 = document.getElementById('iqc-data-info');
        if (infoEl2) infoEl2.textContent = 'Showing 0 entries';
        return;
    }

    slice.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.className = (start + idx) % 2 === 0 ? 'dt-tr-even' : 'dt-tr-odd';
        var tdNum = document.createElement('td');
        tdNum.className = 'dt-td dt-td-num';
        tdNum.textContent = start + idx + 1;
        tr.appendChild(tdNum);
        iqcTableData.headers.forEach(function (header, ci) {
            var td = document.createElement('td');
            td.className = 'dt-td';
            var cellVal = String(row[ci] !== undefined && row[ci] !== null ? row[ci] : '');
            if (iqcTableData.searchQuery && cellVal.toLowerCase().indexOf(iqcTableData.searchQuery) !== -1) {
                td.innerHTML = esc(cellVal).replace(
                    new RegExp(escapeRegex(esc(iqcTableData.searchQuery)), 'gi'),
                    '<mark class="dt-highlight">$&</mark>'
                );
            } else {
                td.textContent = cellVal;
            }
            tr.appendChild(td);
            if (ci === 0) {
                var tdPdf = document.createElement('td');
                tdPdf.className = 'dt-td dt-td-pdf';
                var pdfBtn = document.createElement('button');
                pdfBtn.type = 'button';
                pdfBtn.className = 'dt-pdf-download-btn';
                pdfBtn.title = 'Download PDF';
                pdfBtn.innerHTML = '<span class="material-icons-round">download</span>';
                pdfBtn.addEventListener('click', function () {
                    downloadIqcRowAsPdf(iqcTableData.headers, row, row[1]);
                });
                tdPdf.appendChild(pdfBtn);
                tr.appendChild(tdPdf);
            }
        });
        tbody.appendChild(tr);
    });

    var infoEl = document.getElementById('iqc-data-info');
    if (infoEl) {
        infoEl.textContent = 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total +
            (iqcTableData.allRows.length !== total ? ' (filtered from ' + iqcTableData.allRows.length + ' total)' : '') +
            ' entries';
    }
    buildIqcPagination(page, totalPages);
}

function buildIqcPagination(current, total) {
    var container = document.getElementById('iqc-data-pagination');
    if (!container) return;
    container.innerHTML = '';
    function mkBtn(label, page, disabled, active, isIcon) {
        var btn = document.createElement('button');
        btn.className = 'dt-page-btn' + (active ? ' dt-page-btn-active' : '') + (disabled ? ' dt-page-btn-disabled' : '');
        btn.innerHTML = isIcon ? '<span class="material-icons-round" style="font-size:16px;">' + label + '</span>' : label;
        btn.disabled  = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () {
                iqcTableData.page = page;
                renderIqcTable();
                var wrap = document.getElementById('iqc-data-table-wrap');
                if (wrap) wrap.scrollTop = 0;
            });
        }
        return btn;
    }
    container.appendChild(mkBtn('first_page',   1,           current <= 1,      false, true));
    container.appendChild(mkBtn('chevron_left', current - 1, current <= 1,      false, true));
    paginationRange(current, total).forEach(function (item) {
        if (item === 'â€¦') {
            var el = document.createElement('span');
            el.className = 'dt-page-ellipsis';
            el.textContent = 'â€¦';
            container.appendChild(el);
        } else {
            container.appendChild(mkBtn(item, item, false, item === current, false));
        }
    });
    container.appendChild(mkBtn('chevron_right', current + 1, current >= total, false, true));
    container.appendChild(mkBtn('last_page',     total,       current >= total, false, true));
}

function downloadIqcExcel() {
    var headers = iqcTableData.headers;
    var rows    = iqcTableData.filteredRows;
    exportRowsToXlsx({
        headers: headers,
        rows: rows,
        sheetName: 'In-Line QC',
        filenamePrefix: 'InLine_QC'
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
    enforceLogin();
    initProfileMenu();
    initProfilePhoto();
    initTopbarCalendar();
    initNotifications();
    initBirthdayCelebration();
    initNavPanel();
    initNav();
    initAccessPolling();
    initSidebarCustomization();
    initHomeHero();
    initDiceFormaForms();
    initQuantity();
    initProductionDays();
    initBatchAuto();
    initReports();
    initBatchList();

    var form = document.getElementById('fms-form-el');
    if (form) form.addEventListener('submit', handleSubmit);

    var resetBtn = document.getElementById('reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', function (e) { e.preventDefault(); resetForm(); });

    initAllDropdowns();
    initDropdownRefreshButton();
    fetchDropdowns();
    initPdfPage();
    initPdfEdgePaintTable();
    initPdfEndLineQcTable();
    initFloorSupervisor();
    initInlineQc();
    initFmsSummaryModal();
    hideSpinner();
}
// ---------------------------------------------------------------------------
// PDF Page â€” KPI card navigation + back buttons
// ---------------------------------------------------------------------------
function showPdfFollowUpPlannedView() {
    var kpiView = document.getElementById('pdf-kpi-view');
    var detailView = document.getElementById('batch-list-followup-planned-view');
    var pdfPage = document.getElementById('page-pdf');

    // The Follow-Up Planned markup originated in Production Data. Relocate it
    // before displaying it, otherwise it remains inside the hidden page.
    if (detailView && pdfPage && detailView.parentNode !== pdfPage) {
        pdfPage.appendChild(detailView);
    }

    showPdfKpiView();
    if (kpiView) kpiView.style.display = 'none';
    if (detailView) detailView.style.display = '';

    if (window.FollowUpPlannedSheetEngine && typeof window.FollowUpPlannedSheetEngine.show === 'function') {
        window.FollowUpPlannedSheetEngine.show();
    }
}

function initPdfPage() {
    var kpiFs = document.getElementById('kpi-pdf-floor-supervisor');
    if (kpiFs) {
        kpiFs.addEventListener('click', function () {
            if (window.FloorSupervisorSheetEngine && window.FloorSupervisorSheetEngine.show) {
                window.FloorSupervisorSheetEngine.show();
            } else {
                var kpi = document.getElementById('pdf-kpi-view');
                var fsv = document.getElementById('pdf-floor-supervisor-view');
                if (kpi) kpi.style.display = 'none';
                if (fsv) fsv.style.display = '';
                if (fsTableData.allRows.length === 0) { fetchFsDetailsAndRender(); }
                else { renderFsTable(); }
            }
        });
        kpiFs.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kpiFs.click(); }
        });
    }

    var kpiIqc = document.getElementById('kpi-pdf-inline-qc');
    if (kpiIqc) {
        kpiIqc.addEventListener('click', function () {
            if (window.InLineQcSheetEngine && window.InLineQcSheetEngine.show) {
                window.InLineQcSheetEngine.show();
            } else {
                var kpi = document.getElementById('pdf-kpi-view');
                var iqv = document.getElementById('pdf-inline-qc-view');
                if (kpi) kpi.style.display = 'none';
                if (iqv) iqv.style.display = '';
                if (iqcTableData.allRows.length === 0) { fetchIqcDetailsAndRender(); }
                else { renderIqcTable(); }
            }
        });
        kpiIqc.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kpiIqc.click(); }
        });
    }

    var kpiFollowUp = document.getElementById('kpi-pdf-followup-planned');
    if (kpiFollowUp) {
        kpiFollowUp.addEventListener('click', showPdfFollowUpPlannedView);
        kpiFollowUp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showPdfFollowUpPlannedView();
            }
        });
    }

    var backFollowUp = document.getElementById('btn-back-followup-planned');
    if (backFollowUp) backFollowUp.addEventListener('click', showPdfKpiView);

    var backFs = document.getElementById('btn-back-pdf-fs');
    if (backFs) {
        backFs.addEventListener('click', function () { showPdfKpiView(); });
    }

    var backIqc = document.getElementById('btn-back-pdf-iqc');
    if (backIqc) {
        backIqc.addEventListener('click', function () { showPdfKpiView(); });
    }

    var kpiEqc = document.getElementById('kpi-pdf-endline-qc');
    if (kpiEqc) {
        kpiEqc.addEventListener('click', function () {
            if (window.EndLineQcSheetEngine && window.EndLineQcSheetEngine.show) {
                window.EndLineQcSheetEngine.show();
            } else {
                var kpi = document.getElementById('pdf-kpi-view');
                var eqv = document.getElementById('pdf-endline-qc-view');
                if (kpi) kpi.style.display = 'none';
                if (eqv) eqv.style.display = '';
                if (pdfEndLineQcTableData.allRows.length === 0) { fetchPdfEndLineQcDetailsAndRender(); }
                else { renderPdfEndLineQcTable(); }
            }
        });
        kpiEqc.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kpiEqc.click(); }
        });
    }

    var backEqc = document.getElementById('btn-back-pdf-endline-qc');
    if (backEqc) {
        backEqc.addEventListener('click', function () { showPdfKpiView(); });
    }

    var kpiEp = document.getElementById('kpi-pdf-edge-paint');
    if (kpiEp) {
        kpiEp.addEventListener('click', function () {
            if (window.EdgePaintSheetEngine && window.EdgePaintSheetEngine.show) {
                window.EdgePaintSheetEngine.show();
            } else {
                var kpi = document.getElementById('pdf-kpi-view');
                var epv = document.getElementById('pdf-edge-paint-view');
                if (kpi) kpi.style.display = 'none';
                if (epv) epv.style.display = '';
                if (pdfEdgePaintTableData.allRows.length === 0) { fetchPdfEdgePaintDetailsAndRender(); }
                else { renderPdfEdgePaintTable(); }
            }
        });
        kpiEp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kpiEp.click(); }
        });
    }

    var backEp = document.getElementById('btn-back-pdf-edge-paint');
    if (backEp) {
        backEp.addEventListener('click', function () { showPdfKpiView(); });
    }
}

// ---------------------------------------------------------------------------
// PDF Page â€” Edge-Paint sub-view wiring (search, date filter, refresh, excel)
// ---------------------------------------------------------------------------
function initPdfEdgePaintTable() {
    var edgePaintExcelBtn = document.getElementById('btn-download-pdf-edge-paint-excel');
    if (edgePaintExcelBtn) edgePaintExcelBtn.addEventListener('click', function () { downloadPdfEdgePaintExcel(); });

    var edgePaintRefreshBtn = document.getElementById('btn-refresh-pdf-edge-paint-data');
    if (edgePaintRefreshBtn) {
        edgePaintRefreshBtn.addEventListener('click', function () {
            pdfEdgePaintTableData.allRows       = [];
            pdfEdgePaintTableData.columnFilters = {};
            fetchPdfEdgePaintDetailsAndRender();
        });
    }

    var edgePaintSearchEl = document.getElementById('pdf-edge-paint-data-search');
    if (edgePaintSearchEl) {
        edgePaintSearchEl.addEventListener('input', function () {
            updatePdfEdgePaintSearchClearBtn();
            applyPdfEdgePaintSearch(edgePaintSearchEl.value);
        });
    }
    var edgePaintClearSearch = document.getElementById('pdf-edge-paint-data-search-clear');
    if (edgePaintClearSearch) {
        edgePaintClearSearch.addEventListener('click', function () {
            var s = document.getElementById('pdf-edge-paint-data-search');
            if (s) { s.value = ''; s.focus(); }
            updatePdfEdgePaintSearchClearBtn();
            applyPdfEdgePaintSearch('');
        });
    }

    var edgePaintDateFrom = document.getElementById('pdf-edge-paint-date-from');
    if (edgePaintDateFrom) {
        edgePaintDateFrom.addEventListener('change', function () {
            pdfEdgePaintTableData.dateFrom = edgePaintDateFrom.value;
            updatePdfEdgePaintDateClearBtn();
            applyPdfEdgePaintFilters();
        });
    }
    var edgePaintDateTo = document.getElementById('pdf-edge-paint-date-to');
    if (edgePaintDateTo) {
        edgePaintDateTo.addEventListener('change', function () {
            pdfEdgePaintTableData.dateTo = edgePaintDateTo.value;
            updatePdfEdgePaintDateClearBtn();
            applyPdfEdgePaintFilters();
        });
    }
    var edgePaintDateClear = document.getElementById('pdf-edge-paint-date-clear');
    if (edgePaintDateClear) {
        edgePaintDateClear.addEventListener('click', function () {
            pdfEdgePaintTableData.dateFrom = '';
            pdfEdgePaintTableData.dateTo   = '';
            var f = document.getElementById('pdf-edge-paint-date-from');
            var t = document.getElementById('pdf-edge-paint-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updatePdfEdgePaintDateClearBtn();
            applyPdfEdgePaintFilters();
        });
    }

    var edgePaintPageSize = document.getElementById('pdf-edge-paint-data-page-size');
    if (edgePaintPageSize) {
        edgePaintPageSize.addEventListener('change', function () {
            pdfEdgePaintTableData.pageSize = parseInt(edgePaintPageSize.value, 10) || 25;
            pdfEdgePaintTableData.page = 1;
            renderPdfEdgePaintTable();
        });
    }
}

// ---------------------------------------------------------------------------
// PDF Page â€” End-Line QC sub-view wiring (search, date filter, refresh, excel)
// implemented the same way as initPdfEdgePaintTable() above.
// ---------------------------------------------------------------------------
function initPdfEndLineQcTable() {
    var endLineQcExcelBtn = document.getElementById('btn-download-pdf-endline-qc-excel');
    if (endLineQcExcelBtn) endLineQcExcelBtn.addEventListener('click', function () { downloadPdfEndLineQcExcel(); });

    var endLineQcRefreshBtn = document.getElementById('btn-refresh-pdf-endline-qc-data');
    if (endLineQcRefreshBtn) {
        endLineQcRefreshBtn.addEventListener('click', function () {
            pdfEndLineQcTableData.allRows       = [];
            pdfEndLineQcTableData.columnFilters = {};
            fetchPdfEndLineQcDetailsAndRender();
        });
    }

    var endLineQcSearchEl = document.getElementById('pdf-endline-qc-data-search');
    if (endLineQcSearchEl) {
        endLineQcSearchEl.addEventListener('input', function () {
            updatePdfEndLineQcSearchClearBtn();
            applyPdfEndLineQcSearch(endLineQcSearchEl.value);
        });
    }
    var endLineQcClearSearch = document.getElementById('pdf-endline-qc-data-search-clear');
    if (endLineQcClearSearch) {
        endLineQcClearSearch.addEventListener('click', function () {
            var s = document.getElementById('pdf-endline-qc-data-search');
            if (s) { s.value = ''; s.focus(); }
            updatePdfEndLineQcSearchClearBtn();
            applyPdfEndLineQcSearch('');
        });
    }

    var endLineQcDateFrom = document.getElementById('pdf-endline-qc-date-from');
    if (endLineQcDateFrom) {
        endLineQcDateFrom.addEventListener('change', function () {
            pdfEndLineQcTableData.dateFrom = endLineQcDateFrom.value;
            updatePdfEndLineQcDateClearBtn();
            applyPdfEndLineQcFilters();
        });
    }
    var endLineQcDateTo = document.getElementById('pdf-endline-qc-date-to');
    if (endLineQcDateTo) {
        endLineQcDateTo.addEventListener('change', function () {
            pdfEndLineQcTableData.dateTo = endLineQcDateTo.value;
            updatePdfEndLineQcDateClearBtn();
            applyPdfEndLineQcFilters();
        });
    }
    var endLineQcDateClear = document.getElementById('pdf-endline-qc-date-clear');
    if (endLineQcDateClear) {
        endLineQcDateClear.addEventListener('click', function () {
            pdfEndLineQcTableData.dateFrom = '';
            pdfEndLineQcTableData.dateTo   = '';
            var f = document.getElementById('pdf-endline-qc-date-from');
            var t = document.getElementById('pdf-endline-qc-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updatePdfEndLineQcDateClearBtn();
            applyPdfEndLineQcFilters();
        });
    }

    var endLineQcPageSize = document.getElementById('pdf-endline-qc-data-page-size');
    if (endLineQcPageSize) {
        endLineQcPageSize.addEventListener('change', function () {
            pdfEndLineQcTableData.pageSize = parseInt(endLineQcPageSize.value, 10) || 25;
            pdfEndLineQcTableData.page = 1;
            renderPdfEndLineQcTable();
        });
    }
}

// ---------------------------------------------------------------------------
// Floor Supervisor â€” event wiring
// ---------------------------------------------------------------------------
function initFloorSupervisor() {
    var fsRefreshBtn = document.getElementById('btn-refresh-fs-data');
    if (fsRefreshBtn) {
        fsRefreshBtn.addEventListener('click', function () {
            if (window.FloorSupervisorSheetEngine) return;
            fsTableData.allRows       = [];
            fsTableData.columnFilters = {};
            fetchFsDetailsAndRender();
        });
    }

    var fsExcelBtn = document.getElementById('btn-download-fs-excel');
    if (fsExcelBtn) {
        fsExcelBtn.addEventListener('click', function () {
            if (window.FloorSupervisorSheetEngine) return;
            downloadFsExcel();
        });
    }

    var fsSearchEl = document.getElementById('fs-data-search');
    if (fsSearchEl) {
        fsSearchEl.addEventListener('input', function () {
            updateFsSearchClearBtn();
            applyFsSearch(fsSearchEl.value);
        });
    }
    var fsClearSearch = document.getElementById('fs-data-search-clear');
    if (fsClearSearch) {
        fsClearSearch.addEventListener('click', function () {
            var s = document.getElementById('fs-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateFsSearchClearBtn();
            applyFsSearch('');
        });
    }

    var fsDateFrom = document.getElementById('fs-date-from');
    if (fsDateFrom) {
        fsDateFrom.addEventListener('change', function () {
            fsTableData.dateFrom = fsDateFrom.value;
            updateFsDateClearBtn();
            applyFsFilters();
        });
    }
    var fsDateTo = document.getElementById('fs-date-to');
    if (fsDateTo) {
        fsDateTo.addEventListener('change', function () {
            fsTableData.dateTo = fsDateTo.value;
            updateFsDateClearBtn();
            applyFsFilters();
        });
    }
    var fsDateClear = document.getElementById('fs-date-clear');
    if (fsDateClear) {
        fsDateClear.addEventListener('click', function () {
            fsTableData.dateFrom = '';
            fsTableData.dateTo   = '';
            var f = document.getElementById('fs-date-from');
            var t = document.getElementById('fs-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateFsDateClearBtn();
            applyFsFilters();
        });
    }

    var fsPageSize = document.getElementById('fs-data-page-size');
    if (fsPageSize) {
        fsPageSize.addEventListener('change', function () {
            fsTableData.pageSize = parseInt(fsPageSize.value, 10) || 25;
            fsTableData.page = 1;
            renderFsTable();
        });
    }
}

// ---------------------------------------------------------------------------
// In-Line QC â€” event wiring
// ---------------------------------------------------------------------------
function initInlineQc() {
    if (window.InLineQcSheetEngine) return;
    var iqcRefreshBtn = document.getElementById('btn-refresh-iqc-data');
    if (iqcRefreshBtn) {
        iqcRefreshBtn.addEventListener('click', function () {
            iqcTableData.allRows       = [];
            iqcTableData.columnFilters = {};
            fetchIqcDetailsAndRender();
        });
    }

    var iqcExcelBtn = document.getElementById('btn-download-iqc-excel');
    if (iqcExcelBtn) iqcExcelBtn.addEventListener('click', function () { downloadIqcExcel(); });

    var iqcSearchEl = document.getElementById('iqc-data-search');
    if (iqcSearchEl) {
        iqcSearchEl.addEventListener('input', function () {
            updateIqcSearchClearBtn();
            applyIqcSearch(iqcSearchEl.value);
        });
    }
    var iqcClearSearch = document.getElementById('iqc-data-search-clear');
    if (iqcClearSearch) {
        iqcClearSearch.addEventListener('click', function () {
            var s = document.getElementById('iqc-data-search');
            if (s) { s.value = ''; s.focus(); }
            updateIqcSearchClearBtn();
            applyIqcSearch('');
        });
    }

    var iqcDateFrom = document.getElementById('iqc-date-from');
    if (iqcDateFrom) {
        iqcDateFrom.addEventListener('change', function () {
            iqcTableData.dateFrom = iqcDateFrom.value;
            updateIqcDateClearBtn();
            applyIqcFilters();
        });
    }
    var iqcDateTo = document.getElementById('iqc-date-to');
    if (iqcDateTo) {
        iqcDateTo.addEventListener('change', function () {
            iqcTableData.dateTo = iqcDateTo.value;
            updateIqcDateClearBtn();
            applyIqcFilters();
        });
    }
    var iqcDateClear = document.getElementById('iqc-date-clear');
    if (iqcDateClear) {
        iqcDateClear.addEventListener('click', function () {
            iqcTableData.dateFrom = '';
            iqcTableData.dateTo   = '';
            var f = document.getElementById('iqc-date-from');
            var t = document.getElementById('iqc-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            updateIqcDateClearBtn();
            applyIqcFilters();
        });
    }

    var iqcPageSize = document.getElementById('iqc-data-page-size');
    if (iqcPageSize) {
        iqcPageSize.addEventListener('change', function () {
            iqcTableData.pageSize = parseInt(iqcPageSize.value, 10) || 25;
            iqcTableData.page = 1;
            renderIqcTable();
        });
    }

    if (typeof initBantalaEngine_ === 'function') {
        initBantalaEngine_();
    }
}


if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ---------------------------------------------------------------------------
// Shared helpers exposed for main.js (all new feature code lives there â€”
// see main.js). Nothing else in this file changes behavior.
// ---------------------------------------------------------------------------
window.FMS = {
    jsonp:            jsonp,
    showSpinner:      showSpinner,
    hideSpinner:      hideSpinner,
    showToast:        showToast,
    esc:              esc,
    escapeRegex:      escapeRegex,
    parseCreatedAt:   parseCreatedAt,
    paginationRange:  paginationRange,
    exportRowsToXlsx: exportRowsToXlsx,
    excelRowColor_:   excelRowColor_,
    loadExcelJs:      loadExcelJs,
    showBatchListKpiView: showBatchListKpiView,
    applyKpiCardAccess: applyKpiCardAccess,
    closeNavPanel:      closeNavPanel,
    hasAiAccess:         hasAiAccess,
    aiAccessDeniedLabelFor: aiAccessDeniedLabelFor_,
    syncBantalaData:    syncBantalaData_
};

})();
