// The topic filter on /resources/ (#159).
//
// Progressive enhancement, deliberately: the markup ships with every card
// visible and the filter row carrying `hidden`, so a reader with no JS gets the
// full list rather than a row of buttons that do nothing. This script is the
// only thing that reveals the row.
//
// No storage, no network, no consent surface — it toggles a class on cards that
// are already in the page.
(function () {
  var row = document.querySelector('[data-topic-filter]');
  var grid = document.querySelector('[data-article-grid]');
  if (!row || !grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-topic]'));
  var buttons = Array.prototype.slice.call(row.querySelectorAll('button[data-filter]'));
  var live = document.querySelector('[data-filter-count]');

  function apply(topic) {
    var shown = 0;
    cards.forEach(function (card) {
      var on = !topic || card.getAttribute('data-topic') === topic;
      card.hidden = !on;
      if (on) shown++;
    });
    buttons.forEach(function (b) {
      var on = b.getAttribute('data-filter') === topic;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (live) {
      live.textContent = topic
        ? shown + (shown === 1 ? ' article on ' : ' articles on ') + topic
        : shown + ' articles';
    }
  }

  row.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-filter]') : null;
    if (!b) return;
    apply(b.getAttribute('data-filter'));
  });

  row.hidden = false;
  apply('');
})();
