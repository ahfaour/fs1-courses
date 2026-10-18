/* Light / dark toggle. The page starts with the device's setting; the button switches to the
   other theme and the choice is remembered in this browser. Loaded in <head> without defer so a
   saved choice is applied before the page is drawn. */
(function () {
  'use strict';
  var KEY = 'fs1-theme';
  var root = document.documentElement;
  var deviceDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch {
      return null;
    }
  }

  function current() {
    return root.getAttribute('data-theme') || (deviceDark && deviceDark.matches ? 'dark' : 'light');
  }

  var choice = saved();
  if (choice) root.setAttribute('data-theme', choice);

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('[data-theme-toggle]');
    if (!btn) return;

    var label = function () {
      var dark = current() === 'dark';
      btn.textContent = '';
      var icon = document.createElement('span');
      icon.className = 'icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = dark ? '☀' : '☾';
      btn.append(icon, dark ? ' Light mode' : ' Dark mode');
      btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    };

    label();
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Storage blocked (private mode): the change still applies to this page.
      }
      label();
    });
    // While no choice is saved, follow the device if its setting changes.
    if (deviceDark && deviceDark.addEventListener) deviceDark.addEventListener('change', label);
  });
})();
