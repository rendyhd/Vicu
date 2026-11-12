// The guide: the contents button on small screens, search over the pages (from guide-index.js, built
// by site/tools/guide.mjs) and the current heading in "On this page". Makes no requests.
(function () {
  var body = document.body;
  var root = body.getAttribute('data-guide-root') || './';

  // Contents button (small screens).
  var toggle = document.querySelector('.g-menu-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = !body.classList.contains('g-menu-open');
      body.classList.toggle('g-menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        var input = document.getElementById('g-search-input');
        if (input) input.focus();
      }
    });
  }

  // Search: every word must appear in the page or one of its headings; title matches rank first.
  var pages = window.VICU_GUIDE || [];
  var input = document.getElementById('g-search-input');
  var results = document.getElementById('g-search-results');
  function norm(s) {
    return (s || '').toLowerCase();
  }
  function href(slug, id) {
    return root + (slug ? slug + '/' : '') + (id ? '#' + id : '');
  }
  function search(q) {
    var words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var hits = [];
    pages.forEach(function (p) {
      var all = norm(p.t + ' ' + p.d + ' ' + p.x + ' ' + p.h.map(function (h) { return h[1]; }).join(' '));
      if (!words.every(function (w) { return all.indexOf(w) >= 0; })) return;
      var score = 0;
      var t = norm(p.t);
      words.forEach(function (w) {
        if (t.indexOf(w) >= 0) score += 10;
        if (norm(p.d).indexOf(w) >= 0) score += 3;
      });
      // The best heading: the one with most of the words.
      var best = null;
      var bestCount = 0;
      p.h.forEach(function (h) {
        var text = norm(h[1]);
        var count = words.filter(function (w) { return text.indexOf(w) >= 0; }).length;
        if (count > bestCount) {
          best = h;
          bestCount = count;
        }
      });
      score += bestCount * 4;
      hits.push({ p: p, h: best, score: score });
    });
    hits.sort(function (a, b) {
      return b.score - a.score;
    });
    return hits.slice(0, 8);
  }
  function render(q) {
    if (!results) return;
    results.textContent = '';
    if (!q.trim()) {
      results.hidden = true;
      return;
    }
    var hits = search(q);
    results.hidden = false;
    if (!hits.length) {
      var li = document.createElement('li');
      li.className = 'g-empty';
      li.textContent = 'No page mentions that. Try another word.';
      results.appendChild(li);
      return;
    }
    hits.forEach(function (hit) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = href(hit.p.s, hit.h ? hit.h[0] : '');
      a.textContent = hit.p.t;
      var small = document.createElement('small');
      small.textContent = hit.h ? hit.h[1] : hit.p.d;
      a.appendChild(small);
      li.appendChild(a);
      results.appendChild(li);
    });
  }
  if (input) {
    input.addEventListener('input', function () {
      render(input.value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = results && results.querySelector('a');
        if (first) window.location.href = first.href;
      } else if (e.key === 'Escape') {
        input.value = '';
        render('');
      } else if (e.key === 'ArrowDown') {
        var link = results && results.querySelector('a');
        if (link) {
          e.preventDefault();
          link.focus();
        }
      }
    });
  }
  if (results) {
    results.addEventListener('keydown', function (e) {
      var links = Array.prototype.slice.call(results.querySelectorAll('a'));
      var i = links.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === 'ArrowDown' && links[i + 1]) {
        e.preventDefault();
        links[i + 1].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        (links[i - 1] || input).focus();
      }
    });
  }
  // "/" focuses the search box, as on most documentation sites.
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!input) return;
    e.preventDefault();
    if (window.matchMedia('(max-width: 900px)').matches && toggle && !body.classList.contains('g-menu-open')) toggle.click();
    input.focus();
  });

  // On this page: mark the heading being read.
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.g-toc a'));
  if (!tocLinks.length || !('IntersectionObserver' in window)) return;
  var byId = {};
  tocLinks.forEach(function (a) {
    byId[a.getAttribute('href').slice(1)] = a;
  });
  var visible = {};
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        visible[e.target.id] = e.isIntersecting;
      });
      var current = null;
      tocLinks.some(function (a) {
        var id = a.getAttribute('href').slice(1);
        if (visible[id]) {
          current = id;
          return true;
        }
        return false;
      });
      if (!current) return;
      tocLinks.forEach(function (a) {
        a.classList.toggle('is-current', a.getAttribute('href').slice(1) === current);
      });
    },
    { rootMargin: '-70px 0px -65% 0px' },
  );
  Object.keys(byId).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) io.observe(el);
  });
})();
