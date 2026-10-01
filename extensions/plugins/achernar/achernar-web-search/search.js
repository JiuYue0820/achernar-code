'use strict';

const normalized = value => String(value || '').replace(/\s+/g, ' ').trim();

function queryTerms(query) {
  const text = query.replace(/\bsite:\S+/gi, '').toLowerCase();
  const ignored = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'or', 'is', 'what', 'official', 'documentation', 'docs']);
  return [...new Set([...new Intl.Segmenter('zh', { granularity: 'word' }).segment(text)]
    .filter(part => part.isWordLike && !ignored.has(part.segment)).map(part => part.segment))];
}

function relevant(query, item) {
  const site = query.match(/\bsite:([^\s/]+)/i)?.[1]?.toLowerCase();
  const host = new URL(item.url).hostname.toLowerCase();
  if (site && host !== site && !host.endsWith('.' + site)) return false;
  const terms = queryTerms(query);
  const text = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
  return terms.length > 0 && terms.filter(term => text.includes(term)).length >= Math.ceil(terms.length * 0.6);
}

async function searchWeb({ query, count = 5, market, provider = 'auto' }, request, endpoint = 'https://www.bing.com/search', fallbackEndpoint = 'https://www.so.com/s') {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 500) throw new Error('query must contain 2 to 500 characters');
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('count must be from 1 to 10');
  market ||= /[\u3400-\u9fff]/.test(query) ? 'zh-CN' : 'en-US';
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(market)) throw new Error('market must look like zh-CN or en-US');
  if (!['auto', 'bing', '360'].includes(provider)) throw new Error('provider must be auto, bing, or 360');
  query = query.trim();
  const { DOMParser } = await import('linkedom');
  const terms = queryTerms(query);
  const site = query.match(/\bsite:\S+/i)?.[0];
  const phrase = `${JSON.stringify(terms.join(' '))}${site ? ' ' + site : ''}`;
  const queries = provider === '360' ? [] : [...new Set([query, phrase])].map(query => ({ query, provider: 'Bing RSS', endpoint }));
  if (provider !== 'bing' && fallbackEndpoint) queries.push({ query, provider: '360 Search', endpoint: fallbackEndpoint });
  // Long natural-language queries overconstrain RSS search. Relax only after
  // exact attempts failed, retain site restrictions, and disclose the change.
  if (terms.length > 4) {
    const simplified = [...new Set([terms.slice(0, 2).join(' '), terms[0]])];
    for (const short of simplified) if (short.length >= 2) queries.push({
      query: short + (site ? ' ' + site : ''), relaxed: true,
      provider: provider === 'bing' || !fallbackEndpoint ? 'Bing RSS' : '360 Search',
      endpoint: provider === 'bing' || !fallbackEndpoint ? endpoint : fallbackEndpoint,
    });
  }
  const attempts = [];
  for (const attempt of queries) {
    const effectiveQuery = attempt.query;
    const url = new URL(attempt.endpoint);
    url.searchParams.set('q', effectiveQuery);
    if (attempt.provider === 'Bing RSS') {
      url.searchParams.set('format', 'rss');
      url.searchParams.set('mkt', market);
    }
    try {
      const fetched = await request(url, 2 * 1024 * 1024);
      const rss = attempt.provider === 'Bing RSS';
      const document = new DOMParser().parseFromString(fetched.body.toString('utf8'), rss ? 'text/xml' : 'text/html');
      const seen = new Set();
      const results = [];
      for (const item of document.querySelectorAll(rss ? 'item' : '.res-list')) {
        let target;
        const anchor = item.querySelector('.res-title a[data-mdurl], .res-title a[href]');
        try { target = new URL(normalized(rss ? item.querySelector('link')?.textContent : anchor?.getAttribute('data-mdurl') || anchor?.getAttribute('href'))); } catch { continue; }
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || seen.has(target.href)) continue;
        if (!rss && (target.hostname === 'so.com' || target.hostname.endsWith('.so.com'))) continue;
        const description = item.querySelector('description');
        const fragment = new DOMParser().parseFromString(`<body>${description?.textContent || ''}</body>`, 'text/html');
        for (const node of fragment.querySelectorAll('script,style')) node.remove();
        const entry = { title: normalized(rss ? item.querySelector('title')?.textContent : anchor?.textContent) || target.hostname,
          url: target.href, snippet: normalized(rss ? fragment.querySelector('body')?.textContent : item.querySelector('.res-desc,.res-list-summary')?.textContent).slice(0,2000) };
        if (!relevant(attempt.relaxed ? effectiveQuery : query, entry)) continue;
        seen.add(target.href);
        results.push({ rank: results.length + 1, ...entry });
        if (results.length === count) break;
      }
      attempts.push({ provider: attempt.provider, query: effectiveQuery, relaxed: Boolean(attempt.relaxed), resultCount: results.length });
      if (results.length) return { query, effectiveQuery, provider: attempt.provider, endpoint: fetched.url || url.href,
        retrievedAt: new Date().toISOString(), queryRelaxed: Boolean(attempt.relaxed), relevanceCheck: attempt.relaxed ? 'Simplified query; results may not cover all requested details. Read and verify sources.' : 'keyword overlap; verify source content', attempts, results };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      attempts.push({ provider: attempt.provider, query: effectiveQuery, error: error.message, ...(error.cause?.code ? { code: error.cause.code } : {}) });
    }
  }
  const failed = attempts.filter(attempt => attempt.error), summary = failed.length ? failed.map(a => `${a.provider}: ${a.code || a.error}`).join('; ') : 'Providers returned empty or unrelated pages.';
  throw Object.assign(new Error(`Search returned no relevant results. ${summary} Try a shorter query or another source; do not invent results.`), { code: 'WEB_SEARCH_EMPTY', attempts });
}

module.exports = { searchWeb, relevant };
