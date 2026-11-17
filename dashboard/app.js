// The Token Radar dashboard: a static page, no framework and no network. It reads window.RADAR
// (written beside dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol view that shows the model's own arithmetic and the plan to farm it, the records the
// launch screen set aside, the token-bearing protocols the model was fitted on, and the evidence
// behind the fit. It re-derives every implied value from the row's own figures, so the page and
// board.json can be seen to agree.
(function () {
  'use strict';

  var R = window.RADAR;
  if (!R) {
    document.getElementById('view').textContent = 'no data: data.js was not found beside the page';
    return;
  }
  var C = R.calibration;
  var CV = C.cv;

  // ---------------------------------------------------------------- small helpers
  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
    return n;
  }
  function append(n, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(n, c); });
    else n.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  function usd(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) { return v === null || v === undefined ? 'n/a' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function age(v) {
    if (v === null || v === undefined) return 'no listing day';
    if (v >= 730) return (v / 365).toFixed(1) + 'y';
    if (v >= 60) return Math.round(v / 30.4) + 'mo';
    return v + 'd';
  }
  function mult(v) { return v >= 1 ? v.toFixed(2) + 'x' : v.toFixed(3) + 'x'; }
  function nums(v) { return Math.round(v).toLocaleString('en-US'); }
  function cls(node, name) { node.className = (node.className ? node.className + ' ' : '') + name; return node; }

  // The model, re-derived in the browser from the row's own figures and the published weights: the
  // same arithmetic main.ts ran, which the page prints beside the number board.json carries.
  var W = C.weights;
  function offsetOf(cat) {
    var i = C.categories.indexOf(cat === null ? 'Uncategorized' : cat);
    return i < 0 ? 0 : C.category_offsets[i];
  }
  function baseMultiple(row) {
    var a = row.age_days === null ? 365 : row.age_days;
    var g = (row.change_7d === null ? 0 : Math.max(-50, Math.min(150, row.change_7d))) / 100;
    var z = W[0] + W[1] * Math.log10(Math.max(1, row.tvl_usd)) + W[2] * (Math.log10(a + 1) - C.ageMean) + W[3] * g + offsetOf(row.category);
    return Math.pow(10, Math.max(-3, Math.min(1.5, z)));
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * baseMultiple(row) * row.growth_tilt * row.patience_tilt));
  }
  function agrees(row) { return impliedOf(row) === row.implied_value_usd; }

  // ---------------------------------------------------------------- state
  var params = new URLSearchParams(location.search);
  var state = {
    tab: params.get('tab') || (params.get('slug') ? 'detail' : 'board'),
    q: (params.get('q') || '').toLowerCase(),
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    sort: params.get('sort') || 'implied',
    dir: params.get('dir') || 'desc',
    watchOnly: params.get('tier') === 'watchlist',
    beyondOnly: params.get('tier') === 'beyond',
    open: {},
    slug: params.get('slug') || null
  };
  if (!state.slug) state.tab = state.tab === 'detail' ? 'board' : state.tab;

  var TABS = [
    { id: 'board', label: 'Ranked board', count: R.rows.length },
    { id: 'screened', label: 'Screened out of the board', count: R.screened.length },
    { id: 'live', label: 'Already trading', count: R.live.length },
    { id: 'method', label: 'Method and evidence', count: null }
  ];

  // ---------------------------------------------------------------- header
  function header() {
    var facts = document.getElementById('facts');
    var items = [
      ['snapshot', R.as_of, 'DefiLlama\'s own fetch'],
      ['protocols', String(R.protocols), 'at or above $5M TVL'],
      ['no token in the record', String(R.no_token_records), R.watchlist_size + ' pass the house floor'],
      ['ranked', String(R.rows.length), R.screened.length + ' screened out'],
      ['token-bearing', String(R.live.length), 'the model\'s yardstick']
    ];
    items.forEach(function (it) {
      append(facts, el('div', null, el('dt', { text: it[0] }), el('dd', null, it[1], el('small', { text: it[2] }))));
    });
    document.getElementById('sub').textContent =
      R.no_token_records + ' protocols in the snapshot carry no token in their record; the board ranks the ' +
      R.rows.length + ' that a launch screen passes, by what a launch would be worth, and prices the farm of each.';
  }

  // ---------------------------------------------------------------- the model strip
  function modelStrip() {
    var eq = document.getElementById('formula');
    append(eq, el('div', { class: 'eq', html:
      'implied value = <b>TVL</b> &times; 10<sup>(w</sup>&#8320;<sup> + w</sup>&#8321;<sup>&middot;log</sup>&#8321;&#8320;<sup>TVL + w</sup>&#8322;<sup>&middot;log</sup>&#8321;&#8320;<sup>age + w</sup>&#8323;<sup>&middot;growth + <i>category</i>)</sup> &times; <i>growth tilt</i> &times; <i>patience tilt</i>' }));
    append(eq, el('div', { class: 'eq', html:
      'w = <b>' + W[0].toFixed(3) + '</b>, <b>' + W[1].toFixed(3) + '</b>, <b>' + W[2].toFixed(3) + '</b>, <b>' + W[3].toFixed(3) +
      '</b> &nbsp; fitted on this snapshot\'s own ' + C.fitted_on + ' token-bearing records (ridge, &lambda;=' + C.lambda + ', Huber re-weighted) &nbsp;·&nbsp; ' + C.categories.length + ' category offsets &nbsp;·&nbsp; tilts bounded at +&#8722;20% and +&#8722;15%' }));
    append(eq, el('p', { text:
      'The multiple is not a house constant: it is fitted on the other half of this same snapshot -- the protocols whose market cap and ' +
      'TVL it does carry -- and it falls as TVL rises.' }));

    var tiles = [
      ['fitted on', C.fitted_on + ' records', 'market cap / TVL, this snapshot'],
      ['cross-validated error', (Math.pow(10, CV.median_log10_error)).toFixed(1) + 'x', 'median 5-fold error of the typical row'],
      ['for the same data, one global multiple', (Math.pow(10, CV.baseline_median_log10_error)).toFixed(1) + 'x', 'the baseline the fit beats'],
      ['within 4x', Math.round(CV.within_4x * 100) + '%', 'against ' + Math.round(CV.baseline_within_4x * 100) + '% for the baseline'],
      ['band on every row', 'x' + Math.pow(10, CV.band_lo).toFixed(2) + ' to x' + Math.pow(10, CV.band_hi).toFixed(2), 'middle half of the cross-validated error']
    ];
    var box = document.getElementById('evidence');
    tiles.forEach(function (t, i) {
      append(box, el('div', { class: 'tile' + (i === 3 ? ' good' : '') },
        el('div', { class: 'k', text: t[0] }), el('div', { class: 'v', text: t[1] }), el('div', { class: 'n', text: t[2] })));
    });
  }

  // ---------------------------------------------------------------- tabs and controls
  function renderTabs() {
    var bar = document.getElementById('tabs');
    bar.innerHTML = '';
    TABS.forEach(function (t) {
      append(bar, el('button', {
        class: 'tab', type: 'button', 'aria-selected': state.tab === t.id ? 'true' : 'false',
        onclick: function () { state.tab = t.id; state.slug = null; render(); }
      }, t.label, t.count === null ? null : el('span', { class: 'c', text: String(t.count) })));
    });
  }

  function categories() {
    var seen = {};
    R.rows.forEach(function (r) { seen[r.category === null ? 'Uncategorized' : r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    R.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }
  function select(span, value, options, onpick) {
    var s = el('select', { onchange: function (e) { onpick(e.target.value); } });
    append(s, el('option', { value: 'all', text: 'all' }));
    options.forEach(function (o) { append(s, el('option', { value: o, text: o, selected: o === value ? 'selected' : null })); });
    if (value !== 'all' && options.indexOf(value) < 0) s.value = 'all';
    return el('label', { class: 'field' }, el('span', { text: span }), s);
  }

  var SORTS = [
    ['implied', 'implied value'], ['farm', 'what the farm earns'], ['tvl', 'TVL'], ['growth', '7-day change'],
    ['age', 'time with no token'], ['multiple', 'implied value per TVL'], ['name', 'name']
  ];
  function renderControls() {
    var box = document.getElementById('controls');
    box.innerHTML = '';
    if (state.tab === 'detail' || state.tab === 'method') { cls(box, 'hidden'); return; }
    box.className = 'controls';
    var onBoard = state.tab === 'board';
    append(box, el('label', { class: 'field' }, el('span', { text: 'search' }),
      el('input', { type: 'search', value: state.q, placeholder: 'name, slug, category, chain', oninput: function (e) { state.q = e.target.value.toLowerCase(); renderView(); } })));
    if (onBoard) {
      append(box, select('category', state.category, categories(), function (v) { state.category = v; renderView(); }));
      append(box, select('chain', state.chain, chains(), function (v) { state.chain = v; renderView(); }));
    }
    if (state.tab === 'board' || state.tab === 'screened' || state.tab === 'live') {
      append(box, el('label', { class: 'field' }, el('span', { text: 'sort' }),
        (function () {
          var s = el('select', { onchange: function (e) { state.sort = e.target.value; renderView(); } });
          SORTS.forEach(function (o) {
            if (state.tab === 'live' && (o[0] === 'farm' || o[0] === 'implied' || o[0] === 'multiple' || o[0] === 'age')) return;
            if (state.tab === 'screened' && o[0] === 'farm') return;
            append(s, el('option', { value: o[0], text: o[1], selected: o[0] === state.sort ? 'selected' : null }));
          });
          return s;
        })()));
    }
    if (state.tab === 'board') {
      append(box, el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: state.watchOnly ? 'checked' : null, onchange: function (e) { state.watchOnly = e.target.checked; renderView(); } }),
        'the ' + R.watchlist_size + ' on the house watchlist only'));
      append(box, el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: state.beyondOnly ? 'checked' : null, onchange: function (e) { state.beyondOnly = e.target.checked; renderView(); } }),
        'the radar\'s own finds above the floor (' + R.rows.filter(function (r) { return r.beyond_floor; }).length + ')'));
    }
    append(box, el('div', { class: 'spacer' }));
    append(box, el('div', { class: 'count', id: 'count' }));
  }

  // ---------------------------------------------------------------- filtering
  function filtered() {
    var out = R.rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.beyondOnly && !r.beyond_floor) return false;
      if (state.category !== 'all' && (r.category === null ? 'Uncategorized' : r.category) !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(state.q) < 0) return false;
      }
      return true;
    });
    var dir = state.dir === 'asc' ? 1 : -1;
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      farm: function (r) { return r.farm.net_usd; },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
      multiple: function (r) { return r.multiple; },
      name: function (r) { return 0; }
    }[state.sort] || function (r) { return r.implied_value_usd; };
    out.sort(function (a, b) {
      if (state.sort === 'name') return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      return (key(a) - key(b)) * dir || a.rank - b.rank;
    });
    return out;
  }

  // ---------------------------------------------------------------- the board
  function th(label, sortKey, right) {
    var sorted = state.sort === sortKey;
    return el('th', {
      class: (right ? 'r ' : '') + 'sortable',
      onclick: function () {
        if (state.sort === sortKey) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.sort = sortKey; state.dir = sortKey === 'name' || sortKey === 'age' ? 'asc' : 'desc'; }
        renderView(); renderControls();
      }
    }, label, sorted ? el('span', { class: 'arrow', text: state.dir === 'asc' ? ' ▲' : ' ▼' }) : null);
  }

  function expansion(r) {
    var li = r.farm_steps.map(function (s) {
      var at = s.indexOf(';');
      var head = at > 0 && at < 120 ? s.slice(0, at + 1) : s;
      var rest = s.slice(head.length);
      return el('li', null, el('b', { text: head }), rest);
    });
    return el('tr', { class: 'expansion' }, el('td', { colspan: '9' },
      el('ol', null, li),
      el('p', { class: 'note', html:
        'Farm figures for one wallet of ' + usd(r.farm.budget_usd) + ' held ' + r.farm.days_held + ' days: gross ' + usd(r.farm.gross_usd) +
        ', cost ' + usd(r.farm.cost_usd) + ' on ' + r.farm.chain + ', net ' + usd(r.farm.net_usd) + '. ' +
        '<a href="?slug=' + r.slug + '">the full view of ' + r.name + '</a>' })));
  }

  function board() {
    var rows = filtered();
    var table = el('table');
    append(table, el('thead', null, el('tr', null,
      th('#', 'implied', false), el('th', { text: 'protocol' }), el('th', { text: 'category' }),
      th('TVL', 'tvl', true), th('7d', 'growth', true), th('implied / TVL', 'multiple', true),
      th('implied value', 'implied', true), el('th', { class: 'r', text: 'likely range' }),
      th('farm, $5K / 60d', 'farm', true))));
    var body = el('tbody');
    rows.forEach(function (r) {
      var open = state.open[r.slug];
      var tr = el('tr', {
        class: open ? 'open' : null,
        onclick: function () { state.open[r.slug] = !state.open[r.slug]; renderView(); }
      },
        el('td', { class: 'rank' }, el('b', { text: String(r.rank) })),
        el('td', { class: 'name' },
          el('b', { text: r.name }), r.on_watchlist ? el('span', { class: 'pill wl', text: 'watchlist' }) : null,
          r.beyond_floor ? el('span', { class: 'pill ev', text: 'beyond the floor' }) : null,
          r.ev_rank <= 5 ? el('span', { class: 'pill', text: 'best farm #' + r.ev_rank }) : null,
          el('div', { class: 'slug', text: r.slug }),
          el('div', { class: 'chains', text: r.chains.slice(0, 4).join(' · ') + (r.chains.length > 4 ? ' +' + (r.chains.length - 4) : '') })),
        el('td', { class: 'mut', text: (r.category || '—') + (r.age_days === null ? '' : ' · ' + age(r.age_days)) }),
        el('td', { class: 'r mono', text: usd(r.tvl_usd) }),
        el('td', { class: 'r ' + (r.change_7d !== null && r.change_7d < 0 ? 'mut' : 'mono'), text: pct(r.change_7d) }),
        el('td', { class: 'r mono', text: mult(r.multiple) }),
        el('td', { class: 'r val', text: usd(r.implied_value_usd) }),
        el('td', { class: 'r band', text: usd(r.band_lo_usd) + ' – ' + usd(r.band_hi_usd) }),
        el('td', { class: 'r mono ' + (r.farm.net_usd > 0 ? '' : 'mut'), text: usd(r.farm.net_usd) }));
      append(body, tr);
      if (open) append(body, expansion(r));
    });
    append(table, body);
    var view = el('div', { class: 'view' }, table,
      el('div', { class: 'legend', html:
        'Sorted by <b>' + state.sort + '</b> ' + (state.dir === 'asc' ? 'ascending' : 'descending') +
        '; the # column keeps each row\'s rank by <b>implied value</b>, which is a different order. The ' +
        R.rows.filter(function (r) { return r.beyond_floor; }).length + ' rows marked <b>beyond the floor</b> are above the house\'s own ' +
        'floor of ' + usd(R.floor_usd) + ' but not on its watchlist: the radar\'s own finds, which the list is a floor under and never a ceiling over. ' +
        'Click a row for its farm plan and the arithmetic behind its value. <b>implied value</b> is this board\'s own claim, from the snapshot\'s figures and no other ' +
        'source; <b>likely range</b> is the middle half of the model\'s cross-validated error, so roughly one row in four falls outside it. ' +
        '<b>farm</b> is one wallet of ' + usd(R.farm_assumption.budget_usd) + ' held ' + R.farm_assumption.days_held +
        ' days against a ' + R.farm_assumption.campaign_days + '-day campaign worth ' +
        Math.round(R.farm_assumption.allocation_of_implied * 100) + '% of the implied value and split by deposit-days, net of gas.' }));
    return view;
  }

  // ---------------------------------------------------------------- a protocol's own view
  function detail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) r = R.rows[i];
    if (!r) return el('div', { class: 'empty' }, 'no ranked protocol with that slug. The records the screen set aside are on their own tab.');
    var cat = r.category === null ? 'Uncategorized' : r.category;
    var table = null;
    C.category_table.forEach(function (t) { if (t.category === cat) table = t; });
    // The yardstick: this category's own token-bearing records first, then the records nearest this one
    // in TVL, up to six, each row naming its category.
    var own = R.live.filter(function (l) { return (l.category === null ? 'Uncategorized' : l.category) === cat; })
      .sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    var peers = own.slice(0, 6);
    if (peers.length < 6) {
      var near = R.live.slice().sort(function (a, b) {
        return Math.abs(Math.log10(a.tvl_usd / Math.max(1, r.tvl_usd))) - Math.abs(Math.log10(b.tvl_usd / Math.max(1, r.tvl_usd)));
      });
      for (var pi = 0; pi < near.length && peers.length < 6; pi++) {
        if (peers.indexOf(near[pi]) < 0 && peers.length < 6) peers.push(near[pi]);
      }
    }
    var peerHead = own.length === 0
      ? 'the token-bearing records nearest this one in TVL'
      : own.length + ' ' + cat + ' token' + (own.length === 1 ? '' : 's') + (peers.length > own.length ? ', and the records nearest in TVL' : '');

    var computed = impliedOf(r);
    var work = el('div', { class: 'work' },
      el('div', null, el('em', { text: 'TVL' }), el('span', { text: '$' + nums(r.tvl_usd) })),
      el('div', null, el('em', { text: 'fitted multiple of TVL (' + (r.category || 'no category') + ')' }), el('span', { text: mult(r.base_multiple) })),
      el('div', null, el('em', { text: 'seven-day growth ' + pct(r.change_7d) + ' → tilt' }), el('span', { text: 'x' + r.growth_tilt.toFixed(3) })),
      el('div', null, el('em', { text: age(r.age_days) + ' with no token → tilt' }), el('span', { text: 'x' + r.patience_tilt.toFixed(3) })),
      el('div', null, el('em', { text: 'implied value' }), el('span', { text: usd(r.implied_value_usd) })),
      el('div', null, el('em', { text: 'the page recomputes it from these figures' }), el('span', { text: (agrees(r) ? 'same: ' : 'differs: ') + usd(computed) })));

    var peerTable = el('table', { class: 'peers' });
    append(peerTable, el('thead', null, el('tr', null,
      el('th', { text: peerHead }), el('th', { text: 'category' }), el('th', { class: 'r', text: 'TVL' }),
      el('th', { class: 'r', text: 'market cap' }), el('th', { class: 'r', text: 'mcap / TVL' }))));
    var pb = el('tbody');
    peers.forEach(function (l) {
      append(pb, el('tr', null, el('td', { text: l.name }), el('td', { class: 'mut', text: l.category || '—' }),
        el('td', { class: 'r', text: usd(l.tvl_usd) }),
        el('td', { class: 'r', text: usd(l.mcap_usd) }), el('td', { class: 'r', text: mult(l.multiple) })));
    });
    if (peers.length === 0) append(pb, el('tr', null, el('td', { colspan: '5', class: 'mut', text: 'the snapshot carries no token-bearing record to compare with' })));
    append(peerTable, pb);

    var steps = el('ol', { class: 'steps' });
    r.farm_steps.forEach(function (s, i) {
      var head = i === 0 ? 'The record' : i === r.farm_steps.length - 1 ? 'The exit' : i === 1 ? 'Funding' : i === 2 ? 'The position' : i === 3 ? 'Holding it' : 'The dilution';
      append(steps, el('li', null, el('h3', { text: head }), el('p', { text: s })));
    });

    return el('div', { class: 'detail' },
      el('div', { class: 'dhead' },
        el('div', { class: 'who' },
          el('h3', null, r.name, r.on_watchlist ? el('span', { class: 'pill wl', text: 'house watchlist' }) : null),
          el('p', { class: 'meta', html:
            cat + ' · ' + r.chains.join(', ') + ' · <span class="mono">' + r.slug + '</span> · ' +
            (r.age_days === null ? 'no listing day in the record' : age(r.age_days) + ' in the record with no token') +
            ' · rank <b>' + r.rank + '</b> of ' + R.rows.length +
            ' by implied value, <b>' + r.ev_rank + '</b> by what the farm earns' })),
        el('button', { class: 'tab', type: 'button', onclick: function () { state.tab = 'board'; state.slug = null; render(); } }, '← the board')),
      el('div', { class: 'stats' },
        el('div', { class: 'tile' }, el('div', { class: 'k', text: 'TVL in the snapshot' }), el('div', { class: 'v', text: usd(r.tvl_usd) }), el('div', { class: 'n', text: pct(r.change_7d) + ' over seven days' })),
        el('div', { class: 'tile' }, el('div', { class: 'k', text: 'implied value, rank ' + r.rank }), el('div', { class: 'v', text: usd(r.implied_value_usd) }),
          el('div', { class: 'n', text: 'likely ' + usd(r.band_lo_usd) + ' – ' + usd(r.band_hi_usd) })),
        el('div', { class: 'tile' }, el('div', { class: 'k', text: 'one wallet of ' + usd(r.farm.budget_usd) + ', ' + r.farm.days_held + ' days' }),
          el('div', { class: 'v', text: usd(r.farm.net_usd) }), el('div', { class: 'n', text: 'net of ' + usd(r.farm.cost_usd) + ' of gas on ' + r.farm.chain }))),
      el('div', { class: 'cols' },
        el('div', null,
          el('div', { class: 'card' }, el('h2', { text: 'the arithmetic' }), el('h3', { text: 'where ' + usd(r.implied_value_usd) + ' comes from' }), work,
            el('p', { class: 'note', html:
              'The fit prices a ' + (r.category || 'category-less') + ' protocol at this TVL; ' + (r.age_days === null ? 'the record carries no listing day, so it takes the neutral tilt' : age(r.age_days) + ' with no token moves it by x' + r.patience_tilt.toFixed(3)) +
              '. A wider band, the tenth to ninetieth percentile of the same cross-validated error, is ' + usd(Math.round(r.implied_value_usd * Math.pow(10, CV.wide_lo))) + ' to ' + usd(Math.round(r.implied_value_usd * Math.pow(10, CV.wide_hi))) + '.' })),
          el('div', { class: 'card' }, el('h2', { text: 'the fit\'s own evidence' }), el('h3', { text: 'what this category\'s tokens trade at' }),
            peerTable,
            el('p', { class: 'note', html: table === undefined || table === null
              ? 'Too few of this snapshot\'s token-bearing records are in this category for an offset of its own, so the fit\'s base curve alone prices it.'
              : 'This snapshot carries <b>' + table.n + '</b> ' + cat + ' protocols whose token trades; their market cap over TVL has a median of <b>' + mult(table.median) +
                '</b>, a middle half from ' + mult(table.p25) + ' to ' + mult(table.p75) + ', and the fit gives the category an offset of ' + table.offset.toFixed(3) +
                ' on a log10 scale. The median of every category together is ' + mult(C.global_median_multiple) + '.' })),
          el('div', { class: 'card' }, el('h2', { text: 'what would change it' }), el('h3', { text: 'the row, read' }),
            el('ul', { class: 'note-list wide' },
              el('li', { html: 'TVL moves the number most: on this record\'s own curve a 10% fall in TVL is about a ' + Math.abs((Math.pow(0.9, 1 + W[1]) - 1) * 100).toFixed(0) + '% lower implied value, and a 10% rise about as much the other way.' }),
              el('li', { html: 'The fit\'s median error is <b>x' + Math.pow(10, CV.median_log10_error).toFixed(1) + '</b> on the snapshot\'s own token-bearing records, and about a quarter of them fall outside the range shown: the rank is the claim, the number is a range.' }),
              el('li', { html: 'The record says this protocol carries no token; it is not proof that none exists.' }),
              el('li', { html: 'The farm expects ' + Math.round(R.farm_assumption.allocation_of_implied * 100) + '% of the implied value split by deposit-days, so it falls as TVL rises and as the campaign runs long.' }))),
        ),
        el('div', null,
          el('div', { class: 'card' }, el('h2', { text: 'how to farm it' }), el('h3', { text: 'six steps, with what they cost' }), steps))));
  }

  // ---------------------------------------------------------------- the records the screen set aside
  function screened() {
    var rows = R.screened.filter(function (s) {
      if (!state.q) return true;
      return (s.name + ' ' + s.slug + ' ' + (s.category || '') + ' ' + s.reason).toLowerCase().indexOf(state.q) >= 0;
    });
    var table = el('table', { class: 'matrix' });
    append(table, el('thead', null, el('tr', null, el('th', { text: 'protocol' }), el('th', { text: 'category' }),
      el('th', { class: 'r', text: 'TVL' }), el('th', { class: 'r', text: '7d' }), el('th', { class: 'r', text: 'its value if it were a launch' }), el('th', { text: 'why it is not on the board' }))));
    var body = el('tbody');
    rows.forEach(function (s) {
      append(body, el('tr', null, el('td', null, el('b', { text: s.name }), el('div', { class: 'slug mono', text: s.slug })),
        el('td', { class: 'mut', text: s.category || '—' }), el('td', { class: 'r', text: usd(s.tvl_usd) }),
        el('td', { class: 'r', text: pct(s.change_7d) }), el('td', { class: 'r', text: usd(s.implied_value_usd) }),
        el('td', { class: 'mut', text: s.reason })));
    });
    append(table, body);
    return el('div', { class: 'view' }, table, el('div', { class: 'legend', text: R.screen_note }));
  }

  // ---------------------------------------------------------------- token-bearing protocols
  function live() {
    var rows = R.live.filter(function (l) {
      if (!state.q) return true;
      return (l.name + ' ' + l.slug + ' ' + (l.category || '')).toLowerCase().indexOf(state.q) >= 0;
    });
    if (state.sort === 'tvl') rows = rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === 'name') rows = rows.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    else rows = rows.slice().sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
    var table = el('table', { class: 'matrix' });
    append(table, el('thead', null, el('tr', null, el('th', { text: 'protocol' }), el('th', { text: 'category' }),
      el('th', { class: 'r', text: 'TVL' }), el('th', { class: 'r', text: 'market cap' }), el('th', { class: 'r', text: 'mcap / TVL' }), el('th', { class: 'r', text: 'in the record since' }))));
    var body = el('tbody');
    rows.forEach(function (l) {
      append(body, el('tr', null, el('td', null, el('b', { text: l.name }), el('div', { class: 'slug mono', text: l.slug })),
        el('td', { class: 'mut', text: l.category || '—' }), el('td', { class: 'r', text: usd(l.tvl_usd) }),
        el('td', { class: 'r', text: usd(l.mcap_usd) }), el('td', { class: 'r', text: mult(l.multiple) }),
        el('td', { class: 'r mut', text: age(l.age_days) })));
    });
    append(table, body);
    return el('div', { class: 'view' }, table, el('div', { class: 'legend', html:
      'These ' + R.live.length + ' protocols carry a token in the snapshot\'s record, so they are no launch: they are the yardstick. ' +
      'The fit above runs on the ' + C.fitted_on + ' of them whose market cap and TVL both read as usable, and the board\'s own rows are ranked against that fit. ' +
      'A protocol whose token already trades is never ranked on the board, and a protocol on the board is never claimed to have no token -- only that the snapshot\'s record carries none.' }));
  }

  // ---------------------------------------------------------------- method and evidence
  function method() {
    var wtable = el('table', { class: 'matrix' });
    append(wtable, el('thead', null, el('tr', null, el('th', { text: 'term' }), el('th', { class: 'r', text: 'weight' }), el('th', { text: 'how it reads' }))));
    var readings = [
      'the level: a protocol of $1 of TVL would be priced at 10^' + W[0].toFixed(3),
      'log10 TVL: ' + W[1].toFixed(3) + ', so the multiple falls as TVL rises -- a dollar of TVL is worth less in a big protocol',
      'log10 age: ' + W[2].toFixed(3) + ' per decade. Measured, age carries almost no signal in this snapshot, so the fit leaves it out of the level; the patience tilt carries it instead.',
      'seven-day growth: ' + W[3].toFixed(3) + ' per 100% of change. Also nearly flat, so growth moves a row through its tilt, not through the fit.'
    ];
    var wb = el('tbody');
    ['intercept', 'log10 TVL', 'log10 age', 'growth 7d'].forEach(function (t, i) {
      append(wb, el('tr', null, el('td', { text: t }), el('td', { class: 'r', text: W[i].toFixed(4) }), el('td', { class: 'mut', text: readings[i] })));
    });
    C.category_table.forEach(function (t) {
      append(wb, el('tr', null, el('td', { text: 'category: ' + t.category }), el('td', { class: 'r', text: t.offset.toFixed(4) }),
        el('td', { class: 'mut', text: t.n + ' token-bearing records in the snapshot: median ' + mult(t.median) + ', middle half ' + mult(t.p25) + ' to ' + mult(t.p75) })));
    });
    append(wtable, wb);

    var cvtable = el('table', { class: 'matrix' });
    append(cvtable, el('thead', null, el('tr', null, el('th', { text: 'test: ' + CV.folds + '-fold cross-validation on the snapshot\'s own token-bearing records' }),
      el('th', { class: 'r', text: 'median error' }), el('th', { class: 'r', text: 'within 2x' }), el('th', { class: 'r', text: 'within 3x' }), el('th', { class: 'r', text: 'within 4x' }))));
    var cb = el('tbody');
    append(cb, el('tr', null, el('td', { text: 'this board\'s fitted model' }),
      el('td', { class: 'r', text: 'x' + Math.pow(10, CV.median_log10_error).toFixed(2) }),
      el('td', { class: 'r', text: Math.round(CV.within_2x * 100) + '%' }), el('td', { class: 'r', text: Math.round(CV.within_3x * 100) + '%' }), el('td', { class: 'r', text: Math.round(CV.within_4x * 100) + '%' })));
    append(cb, el('tr', null, el('td', { text: 'baseline: one global multiple for every protocol (median ' + mult(C.global_median_multiple) + ')' }),
      el('td', { class: 'r', text: 'x' + Math.pow(10, CV.baseline_median_log10_error).toFixed(2) }),
      el('td', { class: 'r', text: Math.round(CV.baseline_within_2x * 100) + '%' }), el('td', { class: 'r', text: Math.round(CV.baseline_within_3x * 100) + '%' }), el('td', { class: 'r', text: Math.round(CV.baseline_within_4x * 100) + '%' })));
    append(cvtable, cb);

    var assumptions = el('ul', { class: 'note-list' },
      el('li', { html: '<b>The model.</b> The multiple of TVL is not a house constant: it is fitted on the other half of this same snapshot -- the protocols whose market cap and TVL it does carry -- and it falls as TVL rises. A category offset is added for the ' + C.categories.length + ' categories with enough of those records. The two tilts at the end of the formula are stated, not fitted: seven-day growth (bounded at +30% and &#8722;10%) and time with no token (bounded at +15% and &#8722;15%), which together move a row by at most about half. Measured on these records, neither has a usable effect on the ratio itself, so the fit gives them almost no weight and the page says so rather than hiding it.' }),
      el('li', { html: '<b>Calibration.</b> The fit is ridge-regularised least squares (&lambda;=' + C.lambda + ') in log space, Huber re-weighted, with the target winsorised at its 10th and 90th percentile, on the ' + C.fitted_on + ' token-bearing records whose MCap/TVL ratio is between 0.0005 and 100. Cross-validation is 5-fold and deterministic.' }),
      el('li', { html: '<b>The board.</b> A record carries no token when the snapshot gives it no CoinGecko id and no symbol. The screen sets a record aside when its category is a bridge, a canonical bridge, a liquid staking, liquid restaking or restaked-BTC product or a CEX, when its name carries a version marker, a whole word wrapped, staked or staking, or an exchange\'s own name. Each of those is a product of a token that already trades, so it is no launch of its own; the ' + R.screened.length + ' records it sets aside are listed with their figures on their own tab. The house\'s watchlist drew the same lines above its own floor.' }),
      el('li', { html: '<b>Farm value.</b> ' + R.farm_note }),
      el('li', { html: '<b>What the record does not say.</b> The snapshot names no ranking, no implied value and no airdrop flag; every number on this page is derived from its figures, and a protocol that records no token may still have one this snapshot does not carry.' }),
      el('li', { html: '<b>Coverage.</b> All ' + R.watchlist_size + ' protocols on the house watchlist are ranked; the board carries ' + R.rows.length + ' rows, ' + (R.rows.length - R.rows.filter(function (r) { return r.on_watchlist; }).length) + ' of them outside it. Nothing the snapshot lists is invented and nothing is dropped silently: every record it holds is on one of these tabs.' }));
    return el('div', { class: 'view' },
      el('div', { class: 'detail' },
        el('div', { class: 'cols' },
          el('div', null,
            el('div', { class: 'card' }, el('h2', { text: 'the fit' }), el('h3', { text: 'every term, and its reading' }), wtable),
            el('div', { class: 'card' }, el('h2', { text: 'the test' }), el('h3', { text: 'the model against one number for everything' }), cvtable,
              el('p', { class: 'note', html: 'The band on each row is the middle half of the cross-validated residual: x' + Math.pow(10, CV.band_lo).toFixed(2) + ' to x' + Math.pow(10, CV.band_hi).toFixed(2) + ' of the point estimate. The tenth-to-ninetieth percentile range is x' + Math.pow(10, CV.wide_lo).toFixed(2) + ' to x' + Math.pow(10, CV.wide_hi).toFixed(2) + ', the honest width of a claim like this one.' })),
          el('div', null,
            el('div', { class: 'card' }, el('h2', { text: 'assumptions and limits' }), el('h3', { text: 'what a reader should hold against every number here' }), assumptions))))));
  }

  // ---------------------------------------------------------------- render
  function renderView() {
    var host = document.getElementById('view');
    host.innerHTML = '';
    var node = state.tab === 'board' ? board() : state.tab === 'screened' ? screened() : state.tab === 'live' ? live() : state.tab === 'method' ? method() : detail(state.slug);
    host.appendChild(node);
    var count = document.getElementById('count');
    if (count) {
      count.textContent = state.tab === 'board'
        ? (state.watchOnly ? R.watchlist_size + ' on the watchlist (all of them)'
          : state.beyondOnly ? filtered().length + ' of the ' + R.rows.filter(function (r) { return r.beyond_floor; }).length + ' beyond the floor'
          : filtered().length + ' of ' + R.rows.length + ' rows shown')
        : state.tab === 'screened' ? R.screened.length + ' records' : state.tab === 'live' ? R.live.length + ' protocols' : '';
    }
  }
  function render() { renderTabs(); renderControls(); renderStrip(); renderView(); }

  function renderStrip() {
    var strip = document.getElementById('model');
    // The strip explains the board; a protocol's own view shows its arithmetic instead, and the method
    // tab carries the whole fit, so the strip stands on the three list views alone.
    strip.className = state.tab === 'board' || state.tab === 'screened' || state.tab === 'live' ? 'model' : 'model hidden';
  }

  header();
  modelStrip();
  document.getElementById('foot').innerHTML =
    '<div>Snapshot <span class="mono">' + R.as_of + '</span> · ' + R.protocols + ' protocols · floor ' + usd(R.floor_usd) +
    ' · source ' + R.source.replace(/</g, '&lt;') + '</div>' +
    '<div class="r">Implied value is this entry\'s own claim from the snapshot\'s figures, never a promise, and no part of the snapshot says a launch will come.</div>';
  render();
})();
