/* Progressive enhancement only. Every page works without this file: live search, form dialogs,
   copy-to-clipboard, two-click delete and double-submit protection are extras. */
(function () {
  'use strict';

  /* ---------- copy email ---------- */
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    var target = document.querySelector(btn.getAttribute('data-copy'));
    if (!target) return;
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var text = target.textContent.trim();
      var done = function () {
        btn.textContent = 'Copied';
        setTimeout(function () {
          btn.textContent = 'Copy';
        }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          selectText(target);
        });
      } else selectText(target);
    });
  });

  function selectText(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ---------- live search ---------- */
  var input = document.querySelector('input[data-live-search]');
  var results = document.getElementById('results');
  if (input && results && window.fetch && window.DOMParser) {
    var homeSections = document.getElementById('home-sections');
    var onSearchPage = location.pathname === '/search';
    var timer = null;
    var controller = null;

    var run = function () {
      var q = input.value.trim().slice(0, 100);
      if (onSearchPage) {
        history.replaceState(null, '', q ? '/search?q=' + encodeURIComponent(q) : '/search');
      }
      if (controller) controller.abort();
      if (!q) {
        results.replaceChildren();
        if (homeSections) homeSections.hidden = false;
        return;
      }
      controller = new AbortController();
      fetch('/search?partial=1&q=' + encodeURIComponent(q), { signal: controller.signal })
        .then(function (res) {
          return res.ok ? res.text() : Promise.reject(new Error('search failed'));
        })
        .then(function (html) {
          var fresh = new DOMParser().parseFromString(html, 'text/html').getElementById('results');
          if (!fresh) return;
          results.replaceChildren.apply(
            results,
            Array.prototype.map.call(fresh.childNodes, function (n) {
              return document.importNode(n, true);
            }),
          );
          if (homeSections) homeSections.hidden = true;
        })
        .catch(function () {
          /* keep the current results; Enter still submits the form */
        });
    };

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, 180);
    });
  }

  /* ---------- admin forms in a <dialog> ---------- */
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[data-dialog]');
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof HTMLDialogElement !== 'function' || !window.fetch) return;
    e.preventDefault();
    var href = link.href;
    fetch(href, { credentials: 'same-origin' })
      .then(function (res) {
        // Signed out (redirected to login) or an error page: just navigate there.
        if (!res.ok || new URL(res.url).pathname !== new URL(href).pathname) throw new Error('nav');
        return res.text();
      })
      .then(function (html) {
        var card = new DOMParser().parseFromString(html, 'text/html').querySelector('.formcard');
        if (!card) throw new Error('nav');
        openDialog(document.importNode(card, true), link);
      })
      .catch(function () {
        location.href = href;
      });
  });

  function openDialog(card, opener) {
    var dlg = document.createElement('dialog');
    dlg.className = 'modal';
    var heading = card.querySelector('h1');
    if (heading) {
      heading.id = 'dialog-title';
      dlg.setAttribute('aria-labelledby', 'dialog-title');
    }
    dlg.appendChild(card);
    document.body.appendChild(dlg);
    card.querySelectorAll('[data-close]').forEach(function (c) {
      c.addEventListener('click', function (ev) {
        ev.preventDefault();
        dlg.close();
      });
    });
    dlg.addEventListener('close', function () {
      dlg.remove();
      if (opener && opener.isConnected) opener.focus();
    });
    dlg.showModal();
    var first = card.querySelector('input:not([type=hidden]), textarea, select');
    if (first) first.focus();
  }

  /* ---------- submit: two-click delete, upload size check, no double submit ---------- */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var submit = form.querySelector('button[type=submit]');

    if (form.hasAttribute('data-confirm') && submit) {
      if (!form.dataset.armed) {
        e.preventDefault();
        var saved = Array.prototype.slice.call(submit.childNodes);
        form.dataset.armed = '1';
        submit.setAttribute('data-armed', '');
        submit.textContent = 'Confirm delete';
        setTimeout(function () {
          if (!form.isConnected || form.dataset.submitting) return;
          delete form.dataset.armed;
          submit.removeAttribute('data-armed');
          submit.replaceChildren.apply(submit, saved);
        }, 3500);
        return;
      }
      var confirmed = form.querySelector('input[name=confirmed]');
      if (confirmed) confirmed.value = '1';
    }

    var file = form.querySelector('input[type=file][data-max-mb]');
    if (file && file.files && file.files[0]) {
      var mb = Number(file.getAttribute('data-max-mb'));
      if (file.files[0].size > mb * 1024 * 1024) {
        e.preventDefault();
        showError(
          form,
          'That file is over the ' + mb + ' MB limit. Share it through a link instead.',
        );
        return;
      }
    }

    if (form.method.toLowerCase() !== 'post') return;
    if (form.dataset.submitting) {
      e.preventDefault();
      return;
    }
    form.dataset.submitting = '1';
    setTimeout(function () {
      form.querySelectorAll('button[type=submit]').forEach(function (b) {
        b.disabled = true;
        if (file && file.files && file.files[0]) b.textContent = 'Uploading…';
      });
    }, 0);
  });

  function showError(form, message) {
    var err = form.querySelector('.err');
    if (!err) {
      err = document.createElement('p');
      err.className = 'err';
      err.setAttribute('role', 'alert');
      var actions = form.querySelector('.actions');
      form.insertBefore(err, actions);
    }
    err.textContent = message;
  }

  // Coming back with the Back button: re-enable forms that were mid-submit.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    document.querySelectorAll('form[data-submitting]').forEach(function (form) {
      delete form.dataset.submitting;
      form.querySelectorAll('button[type=submit]').forEach(function (b) {
        b.disabled = false;
      });
    });
  });
})();
