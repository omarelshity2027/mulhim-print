// "1-3,7" -> zero-based page indexes
const rng = (s, n) => {
  s = (s || '').trim();
  if (!s) return [...Array(n).keys()];
  const o = [];
  s.split(',').forEach(p => {
    const [a, b] = p.split('-').map(x => parseInt(x));
    if (a) for (let i = a; i <= (b || a) && i <= n; i++) o.push(i - 1);
  });
  return o;
};
// final page list: range + odd/even + reverse
const pages = (range, total, subset, reverse) => {
  let r = rng(range, total);
  if (subset === 'odd') r = r.filter(i => i % 2 === 0);
  if (subset === 'even') r = r.filter(i => i % 2 === 1);
  return reverse ? r.reverse() : r;
};
// split n copies across machines [{id,weight}] by weight
const dist = (n, ms) => {
  const r = {}, W = ms.reduce((a, m) => a + (+m.weight || 1), 0);
  ms.forEach(m => r[m.id] = 0);
  if (!W || n <= 0) return r;
  let left = n;
  ms.forEach(m => { const v = Math.floor(n * (+m.weight || 1) / W); r[m.id] = v; left -= v; });
  const o = [...ms].sort((a, b) => (+b.weight || 1) - (+a.weight || 1));
  for (let i = 0; left > 0; i++, left--) r[o[i % o.length].id]++;
  return r;
};
// booklet imposition order (null = blank pad page)
const bookletOrder = n => {
  const m = Math.ceil(n / 4) * 4, o = [];
  for (let i = 0; i < m / 4; i++) o.push(m - 1 - 2 * i, 2 * i, 2 * i + 1, m - 2 - 2 * i);
  return o.map(i => i < n ? i : null);
};
if (typeof module !== 'undefined') module.exports = { rng, pages, dist, bookletOrder };
