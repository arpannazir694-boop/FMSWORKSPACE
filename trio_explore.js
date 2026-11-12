/* =============================================================================
   trio_explore.js — Interactive showcase logic for Trio Group FMS Workspace
   Matches animations & micro-interactions of https://www.triogroup.in/
   ============================================================================= */

(function () {
  'use strict';

  var currentRating = 5;
  var currentCategory = 'Executive Experience';

  var RATING_LABELS = {
    1: 'Needs Critical Refinement',
    2: 'Fair & Functional Workflow',
    3: 'Good & Reliable Standard',
    4: 'High Luxury Craftsmanship',
    5: 'Exceptional Craftsmanship & Precision'
  };

  function openTrioExplorePage() {
    var contentArea = document.querySelector('.content-area');
    if (contentArea) {
      contentArea.classList.remove('page-home-active', 'ai-chat-active', 'prod-live-active');
      contentArea.classList.add('trio-explore-active');
      contentArea.scrollTop = 0;
    }
    document.body.classList.add('trio-explore-active');
    document.documentElement.classList.add('trio-explore-active');

    var pageBatchList = document.getElementById('page-batch-list');
    if (pageBatchList) pageBatchList.classList.remove('prod-live-active');
    if (window.ProductionLiveEngine && typeof window.ProductionLiveEngine.hide === 'function') {
      try { window.ProductionLiveEngine.hide(); } catch (e) {}
    }

    document.querySelectorAll('.page-view').forEach(function (v) {
      v.style.display = 'none';
    });
    var explorePage = document.getElementById('page-explore');
    if (explorePage) {
      explorePage.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      initExploreAnimations();
      initFeedbackForm();
    }
  }

  function closeTrioExplorePage() {
    var explorePage = document.getElementById('page-explore');
    if (explorePage) {
      explorePage.style.display = 'none';
    }
    document.body.classList.remove('trio-explore-active');
    document.documentElement.classList.remove('trio-explore-active');

    var homePage = document.getElementById('page-home');
    if (homePage) {
      homePage.style.display = '';
      var contentArea = document.querySelector('.content-area');
      if (contentArea) {
        contentArea.classList.remove('trio-explore-active');
        contentArea.classList.add('page-home-active');
        contentArea.scrollTop = 0;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (typeof initHomeHero === 'function') {
        try { initHomeHero(); } catch (e) {}
      }
    }
  }

  function launchModule(targetPage) {
    if (targetPage === 'trio' || targetPage === 'trio-ai' || targetPage === 'trio.html') {
      window.location.href = 'trio.html';
      return;
    }
    closeTrioExplorePage();
    var navItem = document.querySelector('.nav-item[data-page="' + targetPage + '"]');
    if (navItem) {
      navItem.click();
    } else {
      document.querySelectorAll('.page-view').forEach(function (v) { v.style.display = 'none'; });
      var target = document.getElementById('page-' + targetPage);
      if (target) target.style.display = '';
    }
  }

  function initExploreAnimations() {
    // 1. Chart Tabs Switcher
    var tabBtns = document.querySelectorAll('.trio-tab-btn');
    var panels = document.querySelectorAll('.trio-chart-panel');

    tabBtns.forEach(function (btn) {
      btn.onclick = function () {
        var targetId = btn.getAttribute('data-trio-target');
        if (!targetId) return;

        tabBtns.forEach(function (b) { b.classList.remove('active'); });
        panels.forEach(function (p) { p.classList.remove('active'); });

        btn.classList.add('active');
        var targetPanel = document.getElementById(targetId);
        if (targetPanel) {
          targetPanel.classList.add('active');
          animateProgressBars(targetPanel);
        }
      };
    });

    // 2. Smooth Anchor Scrolling
    document.querySelectorAll('.trio-nav-item').forEach(function (link) {
      link.onclick = function (e) {
        e.preventDefault();
        var targetId = link.getAttribute('href');
        if (!targetId || targetId.charAt(0) !== '#') return;
        var el = document.querySelector(targetId);
        if (el) {
          document.querySelectorAll('.trio-nav-item').forEach(function (l) { l.classList.remove('active'); });
          link.classList.add('active');
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
    });

    // Scroll spy for navigation highlighting
    if ('IntersectionObserver' in window) {
      var navObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var id = entry.target.getAttribute('id');
            if (id) {
              document.querySelectorAll('.trio-nav-item').forEach(function (l) {
                if (l.getAttribute('href') === '#' + id) {
                  l.classList.add('active');
                } else {
                  l.classList.remove('active');
                }
              });
            }
          }
        });
      }, { threshold: 0.25 });

      document.querySelectorAll('#page-explore section[id]').forEach(function (sec) {
        navObserver.observe(sec);
      });
    }

    // 3. Module Launch Buttons
    document.querySelectorAll('[data-trio-launch]').forEach(function (btn) {
      btn.onclick = function (e) {
        var page = btn.getAttribute('data-trio-launch');
        if (page === 'trio' || page === 'trio-ai' || page === 'trio.html') {
          e.preventDefault();
          window.location.href = 'trio.html';
          return;
        }
        if (page) launchModule(page);
      };
    });

    // 4. Return Buttons
    var btnReturn = document.getElementById('trio-btn-back-workspace');
    if (btnReturn) btnReturn.onclick = closeTrioExplorePage;

    var btnBrand = document.getElementById('trio-brand-home-link');
    if (btnBrand) btnBrand.onclick = closeTrioExplorePage;

    // 5. Stat Counter Animation
    animateCounters();
  }

  function animateProgressBars(container) {
    var bars = container.querySelectorAll('.trio-bar-indicator');
    bars.forEach(function (bar) {
      var targetWidth = bar.getAttribute('data-width');
      if (targetWidth) {
        bar.style.width = '0%';
        setTimeout(function () {
          bar.style.width = targetWidth;
        }, 60);
      }
    });
  }

  function animateCounters() {
    var counters = document.querySelectorAll('.trio-stat-num[data-target]');
    counters.forEach(function (counter) {
      var target = parseFloat(counter.getAttribute('data-target'));
      var suffix = counter.getAttribute('data-suffix') || '';
      var prefix = counter.getAttribute('data-prefix') || '';
      var isFloat = target % 1 !== 0;
      var duration = 1400;
      var startTime = null;

      function step(timestamp) {
        if (!startTime) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / duration, 1);
        var current = progress * target;
        counter.innerHTML = prefix + (isFloat ? current.toFixed(1) : Math.floor(current)) + '<span class="accent">' + suffix + '</span>';
        if (progress < 1) {
          window.requestAnimationFrame(step);
        } else {
          counter.innerHTML = prefix + (isFloat ? target.toFixed(1) : target) + '<span class="accent">' + suffix + '</span>';
        }
      }
      window.requestAnimationFrame(step);
    });
  }

  // ===========================================================================
  // Classy Feedback Form Logic ("Voice of the Atelier")
  // ===========================================================================
  function initFeedbackForm() {
    var starBtns = document.querySelectorAll('.trio-star-btn');
    var captionEl = document.getElementById('trio-rating-caption');
    var catPills = document.querySelectorAll('.trio-cat-pill');
    var messageInput = document.getElementById('trio-fb-message');
    var charCountEl = document.getElementById('trio-fb-char-count');
    var nameInput = document.getElementById('trio-fb-name');
    var submitBtn = document.getElementById('trio-btn-submit-fb');
    var anotherBtn = document.getElementById('trio-btn-another-fb');

    // Pre-fill user name if logged in
    if (nameInput && !nameInput.value) {
      try {
        var rawUser = sessionStorage.getItem('fms_user') || localStorage.getItem('fms_user');
        if (rawUser) {
          try {
            var parsed = JSON.parse(rawUser);
            if (typeof parsed === 'object' && parsed) {
              nameInput.value = parsed.name || parsed.username || '';
            } else if (typeof parsed === 'string') {
              nameInput.value = parsed;
            }
          } catch (e) {
            nameInput.value = rawUser;
          }
        }
      } catch (err) {}
    }

    function renderStars(ratingValue) {
      starBtns.forEach(function (btn) {
        var val = parseInt(btn.getAttribute('data-rating'), 10);
        if (val <= ratingValue) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      if (captionEl) {
        captionEl.innerHTML = '<span class="trio-rating-badge">' + ratingValue.toFixed(1) + ' / 5.0</span> <span class="trio-rating-text">' + (RATING_LABELS[ratingValue] || '') + '</span>';
      }
    }

    // Star Click & Hover handlers
    starBtns.forEach(function (btn) {
      btn.onclick = function () {
        currentRating = parseInt(btn.getAttribute('data-rating'), 10) || 5;
        renderStars(currentRating);
      };
      btn.onmouseenter = function () {
        var hoverVal = parseInt(btn.getAttribute('data-rating'), 10) || 5;
        renderStars(hoverVal);
      };
    });

    var starsRow = document.getElementById('trio-stars-row');
    if (starsRow) {
      starsRow.onmouseleave = function () {
        renderStars(currentRating);
      };
    }

    // Category Pills click
    catPills.forEach(function (pill) {
      pill.onclick = function () {
        catPills.forEach(function (p) { p.classList.remove('active'); });
        pill.classList.add('active');
        currentCategory = pill.getAttribute('data-category') || 'Executive Experience';
      };
    });

    // Live character counter
    if (messageInput && charCountEl) {
      messageInput.oninput = function () {
        charCountEl.textContent = messageInput.value.length + ' / 600';
      };
    }

    // Form submission
    if (submitBtn) {
      submitBtn.onclick = function (e) {
        e.preventDefault();
        var name = (nameInput ? nameInput.value : '').trim();
        var deptEl = document.getElementById('trio-fb-dept');
        var dept = deptEl ? deptEl.value : 'General';
        var emailEl = document.getElementById('trio-fb-email');
        var email = (emailEl ? emailEl.value : '').trim();
        var message = (messageInput ? messageInput.value : '').trim();

        if (!name) {
          alert('Please enter your name before submitting feedback.');
          if (nameInput) nameInput.focus();
          return;
        }

        if (!message) {
          alert('Please enter your observations or feedback message.');
          if (messageInput) messageInput.focus();
          return;
        }

        var feedbackItem = {
          id: 'FB-' + Date.now(),
          timestamp: new Date().toISOString(),
          rating: currentRating,
          category: currentCategory,
          name: name,
          department: dept,
          email: email,
          message: message
        };

        // Save to localStorage
        try {
          var storageKey = 'trio_workspace_feedback';
          var existing = localStorage.getItem(storageKey);
          var feedbackList = existing ? JSON.parse(existing) : [];
          if (!Array.isArray(feedbackList)) feedbackList = [];
          feedbackList.unshift(feedbackItem);
          localStorage.setItem(storageKey, JSON.stringify(feedbackList));
        } catch (err) {
          console.warn('Unable to store feedback in localStorage:', err);
        }

        // Show elegant success state
        var formEl = document.getElementById('trio-feedback-form');
        var ratingWrap = document.querySelector('.trio-rating-wrapper');
        var successEl = document.getElementById('trio-feedback-success');
        var metaEl = document.getElementById('trio-success-meta');

        if (formEl) formEl.style.display = 'none';
        if (ratingWrap) ratingWrap.style.display = 'none';

        if (metaEl) {
          metaEl.innerHTML = '<span class="material-icons-round" style="color:#d4af37; font-size:16px;">grade</span>' +
            '<span>Rating: <strong>' + currentRating + ' / 5.0</strong></span>' +
            '<span style="opacity:0.4;">&bull;</span>' +
            '<span>Focus: <strong>' + currentCategory + '</strong></span>' +
            '<span style="opacity:0.4;">&bull;</span>' +
            '<span>Recorded By: <strong>' + name + '</strong></span>';
        }

        if (successEl) {
          successEl.style.display = 'block';
          successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };
    }

    // Submit Another Observation
    if (anotherBtn) {
      anotherBtn.onclick = function () {
        var formEl = document.getElementById('trio-feedback-form');
        var ratingWrap = document.querySelector('.trio-rating-wrapper');
        var successEl = document.getElementById('trio-feedback-success');

        if (messageInput) {
          messageInput.value = '';
          if (charCountEl) charCountEl.textContent = '0 / 600';
        }

        currentRating = 5;
        renderStars(5);

        if (successEl) successEl.style.display = 'none';
        if (ratingWrap) ratingWrap.style.display = '';
        if (formEl) formEl.style.display = '';
      };
    }
  }

  window.openTrioExplorePage = openTrioExplorePage;
  window.closeTrioExplorePage = closeTrioExplorePage;
  window.launchTrioModule = launchModule;

  document.addEventListener('DOMContentLoaded', function () {
    var exploreBtn = document.getElementById('home-btn-explore');
    if (exploreBtn) {
      exploreBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openTrioExplorePage();
      });
    }
  });
})();
