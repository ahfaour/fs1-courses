/* Colour theme: Auto (follow the device), Light or Dark, remembered in this browser.
   Loaded in <head> without defer so a saved choice is applied before the page is drawn. */
(function () {
  'use strict';
  var KEY = 'fs1-theme';
  var root = document.documentElement;

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch {
      return 'auto';
    }
  }

  function apply(choice) {
    if (choice === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
  }

  apply(saved());

  document.addEventListener('DOMContentLoaded', function () {
    var group = document.querySelector('[data-theme-switch]');
    if (!group) return;
    var buttons = group.querySelectorAll('button[data-theme-choice]');
    var mark = function (choice) {
      buttons.forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-choice') === choice));
      });
    };
    mark(saved());
    group.hidden = false;
    group.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-theme-choice]');
      if (!b) return;
      var choice = b.getAttribute('data-theme-choice');
      try {
        if (choice === 'auto') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, choice);
      } catch {
        // Storage blocked (private mode): the choice still applies to this page.
      }
      apply(choice);
      mark(choice);
    });
  });
})();
