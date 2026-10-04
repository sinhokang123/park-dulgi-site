// Language toggle. The inline <head> snippet already picked a language before first paint; this file wires the
// buttons, keeps the choice in the URL hash (#ko / #en, the anchors the app links to) and remembers it per browser.
(function () {
  var root = document.documentElement;
  var KEY = 'pd-lang';
  var LANGS = ['ko', 'en'];

  function fromHash() {
    var m = /(?:^|-)(ko|en)$/.exec(decodeURIComponent(location.hash.slice(1)));
    return m ? m[1] : null;
  }

  function apply(lang) {
    if (LANGS.indexOf(lang) < 0) return;
    root.setAttribute('data-lang', lang);
    root.lang = lang;
    var title = root.getAttribute('data-title-' + lang);
    if (title) document.title = title;
    var buttons = document.querySelectorAll('.lang-toggle button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-set-lang') === lang));
    }
    var links = document.querySelectorAll('a[data-keep-lang]');
    for (var j = 0; j < links.length; j++) {
      links[j].setAttribute('href', links[j].getAttribute('href').split('#')[0] + '#' + lang);
    }
  }

  function remember(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) { /* private mode: the hash still carries the choice */ }
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('.lang-toggle button');
    if (!button) return;
    var lang = button.getAttribute('data-set-lang');
    apply(lang);
    remember(lang);
    if (history.replaceState) history.replaceState(null, '', '#' + lang);
  });

  window.addEventListener('hashchange', function () {
    var lang = fromHash();
    if (lang) { apply(lang); remember(lang); }
  });

  apply(root.getAttribute('data-lang') || 'ko');
})();
