/**
 * fetch-journals.mjs
 * Runs on GitHub Actions runner (Node.js 20+) to fetch all journal articles.
 * No CORS restrictions — CNKI RSS can be fetched directly without proxies.
 *
 * Output: data/journals.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { XMLParser } from 'fast-xml-parser';

// ── Paths ──────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const OUTPUT = join(DATA_DIR, 'journals.json');

// ── Constants ──────────────────────────────────────────────────────
const CROSSREF_API = 'https://api.crossref.org/journals/';
const FETCH_ROWS = 25;
const FETCH_TIMEOUT_MS = 15000;

// ── Journal Configs (mirrors index.html) ───────────────────────────

const CROSSREF_TF = [
  { id: 'perspectives',        name: 'Perspectives',                              pub: 'Taylor & Francis', issn: '0907-676X', siteUrl: 'https://www.tandfonline.com/journals/rmps20' },
  { id: 'itt',                 name: 'The Interpreter and Translator Trainer',    pub: 'Taylor & Francis', issn: '1750-399X', siteUrl: 'https://www.tandfonline.com/journals/ritt20' },
  { id: 'translator',          name: 'The Translator',                            pub: 'Taylor & Francis', issn: '1355-6509', siteUrl: 'https://www.tandfonline.com/journals/rtrn20' },
  { id: 'translation-studies', name: 'Translation Studies',                       pub: 'Taylor & Francis', issn: '1478-1700', siteUrl: 'https://www.tandfonline.com/journals/rtrs20' },
];

const CROSSREF_JB = [
  { id: 'babel',    name: 'Babel',                                pub: 'John Benjamins', issn: '0521-9744', siteUrl: 'https://benjamins.com/catalog/babel' },
  { id: 'interpreting', name: 'Interpreting',                     pub: 'John Benjamins', issn: '1384-6647', siteUrl: 'https://benjamins.com/catalog/intp' },
  { id: 'target',  name: 'Target',                                pub: 'John Benjamins', issn: '0924-1884', siteUrl: 'https://benjamins.com/catalog/target' },
  { id: 'tis',     name: 'Translation and Interpreting Studies',  pub: 'John Benjamins', issn: '1932-2798', siteUrl: 'https://benjamins.com/catalog/tis' },
];

const CROSSREF_JOURNALS = [...CROSSREF_TF, ...CROSSREF_JB];

const RSS_JOURNALS = [
  { id: 'translation-horizons', name: 'Translation Horizons',        nameCN: '翻译界',   pub: '外语教学与研究出版社', rssUrl: 'https://rss.cnki.net/knavi/rss/FYIJ?pcode=CJFD,CCJD', siteUrl: 'https://navi.cnki.net/knavi/detail?p=dYz3uf1G895HAILwB1X5320_-zI9x98xmyP9uka4qySviSN46NaLdjAxkb5iuEJDQW16QH1EN3ZdwvI6oUsW_BZi9jKA7EzJJC-IAEgxYNU=&uniplatform=NZKPT&language=CHS', issn: '2096-4388' },
  { id: 'chinese-translation',  name: 'Chinese Translation Journal', nameCN: '中国翻译', pub: '中国翻译协会',       rssUrl: 'https://rss.cnki.net/knavi/rss/ZGFY?pcode=CJFD,CCJD', siteUrl: 'https://navi.cnki.net/knavi/detail?p=dYz3uf1G894dv0YlQs0dLNtk8oy028iwIGx_BD33xaRAjNeFhGiqYSBKnJYyf3VTGS9fY-P7mNwBTkG2H8mL7W9mVBPFZSjzG4iLwaieZGw=&uniplatform=NZKPT&language=CHS', issn: '1000-873X' },
  { id: 'shanghai-translators', name: 'Shanghai Journal of Translators', nameCN: '上海翻译', pub: '上海大学',       rssUrl: 'https://rss.cnki.net/knavi/rss/SHKF?pcode=CJFD,CCJD', siteUrl: 'https://navi.cnki.net/knavi/detail?p=dYz3uf1G896HLLeE29YPfDvxbXkhPueuVrGbApHX4jKaxKaKXKE56DHapQHCflNMtVfQNky_Z3K2mu_Onkmk9tLLkLn_eWDZt20FUxBH5qGjIsjImUqlPw==&uniplatform=NZKPT&language=CHS', issn: '1672-9358' },
];

const MANUAL_JOURNALS = [
  { id: 'jts', name: 'Journal of Translation Studies', nameCN: '翻译学报', pub: 'HK Journal Hub', siteUrl: 'https://jts.ojhhk.com/EN/home', issn: '' },
];

// ── Helpers ────────────────────────────────────────────────────────

function cleanText(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── CrossRef Fetch ─────────────────────────────────────────────────

async function fetchCrossRefJournal(journal) {
  const url = `${CROSSREF_API}${encodeURIComponent(journal.issn)}/works?filter=type:journal-article&sort=published&order=desc&rows=${FETCH_ROWS}&mailto=ts-tracker@example.com`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = await resp.json();
    if (body.status !== 'ok') throw new Error('CrossRef API status not ok');

    const items = (body.message && body.message.items) ? body.message.items : [];

    const articles = items.map(item => {
      const title = (item.title && item.title[0]) ? cleanText(item.title[0]) : 'Untitled';
      const authors = (item.author && item.author.length > 0)
        ? item.author.map(a => `${a.family || ''} ${a.given || ''}`.trim()).filter(Boolean).join(', ')
        : '';

      let pubDate = null;
      const dateSrc = item['published-online'] || item['published-print'] || item.issued || item.created;
      if (dateSrc && dateSrc['date-parts'] && dateSrc['date-parts'][0]) {
        const dp = dateSrc['date-parts'][0];
        pubDate = new Date(Date.UTC(dp[0], (dp[1] || 1) - 1, dp[2] || 1));
      }

      const keywords = (item.subject || []).map(s => cleanText(s)).filter(Boolean);
      const doi = item.DOI || '';
      const articleUrl = doi ? `https://doi.org/${doi}` : (item.URL || '');
      const abstract = item.abstract ? cleanText(item.abstract).substring(0, 500) : '';

      const volume = item.volume || '';
      const issue = item.issue || '';
      const pages = item.page || '';
      let volumeStr = '';
      if (volume) volumeStr += `Vol. ${volume}`;
      if (issue) volumeStr += volumeStr ? `(${issue})` : `Issue ${issue}`;
      if (pages) volumeStr += volumeStr ? `, pp. ${pages}` : `pp. ${pages}`;

      return {
        id: doi || `${journal.id}-${title}-${pubDate ? pubDate.toISOString() : ''}`,
        title,
        journal: item['container-title'] ? item['container-title'][0] : journal.name,
        journalId: journal.id,
        publisher: journal.pub,
        publisherGroup: CROSSREF_TF.some(j => j.id === journal.id) ? 'tf' : 'jb',
        siteUrl: journal.siteUrl,
        pubDate: pubDate ? pubDate.toISOString() : new Date(0).toISOString(),
        pubDateStr: pubDate ? pubDate.toISOString().substring(0, 10) : '',
        authors: authors || 'Author info unavailable',
        doi,
        articleUrl,
        keywords,
        abstract,
        volumeStr,
        source: 'crossref',
      };
    });

    return { status: 'ok', articles, count: articles.length };
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`  ⚠ CrossRef fetch failed for ${journal.name}: ${err.message}`);
    return { status: 'error', articles: [], count: 0, error: err.message };
  }
}

// ── RSS Fetch ──────────────────────────────────────────────────────

async function fetchRSSJournal(journal) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(journal.rssUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const xmlText = await resp.text();
    if (!xmlText || (!xmlText.includes('<rss') && !xmlText.includes('<feed') && !xmlText.includes('<item'))) {
      throw new Error('Response does not look like RSS/XML');
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      textNodeName: '_text',
      isArray: (name) => ['item', 'entry'].includes(name),
    });

    const doc = parser.parse(xmlText);

    // Navigate RSS 2.0 structure: rss → channel → item[]
    let items = [];
    if (doc.rss && doc.rss.channel && doc.rss.channel.item) {
      items = doc.rss.channel.item;
    } else if (doc.feed && doc.feed.entry) {
      items = doc.feed.entry;
    } else {
      throw new Error('Cannot find item/entry elements in XML');
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('RSS feed returned no items');
    }

    const articles = items.map((item, idx) => {
      const title = cleanText(item.title?._text || item.title || 'Untitled');
      const link = item.link?._text || item.link?.href || item.link || '';
      const description = cleanText((item.description?._text || item.description || '').substring(0, 500));
      const authorRaw = item.author?._text || item.author || '';
      const pubDateRaw = item.pubDate?._text || item.pubDate || item.published || '';

      let pubDate = null;
      if (pubDateRaw) {
        const d = new Date(pubDateRaw);
        if (!isNaN(d.getTime())) pubDate = d;
      }

      const keywords = [];
      const kwMatch = description.match(/关键词[：:]\s*(.+?)(?:[；;]|$|\n)/);
      if (kwMatch) {
        kwMatch[1].split(/[;；,，、]/).forEach(k => {
          const tk = k.trim();
          if (tk && tk.length < 30) keywords.push(tk);
        });
      }

      let cleanDesc = description
        .replace(/关键词[：:].+?([；;]|$|\n)/g, '')
        .replace(/摘要[：:]/g, '')
        .replace(/作者[：:].+?([；;]|$|\n)/g, '')
        .trim();

      return {
        id: `${journal.id}-rss-${idx}`,
        title,
        journal: journal.name,
        journalCN: journal.nameCN,
        journalId: journal.id,
        publisher: journal.pub,
        siteUrl: journal.siteUrl,
        pubDate: pubDate ? pubDate.toISOString() : new Date(Date.now() - idx * 86400000).toISOString(),
        pubDateStr: pubDate ? pubDate.toISOString().substring(0, 10) : '',
        authors: authorRaw || '',
        doi: '',
        articleUrl: link || journal.siteUrl,
        keywords,
        abstract: cleanDesc,
        volumeStr: '',
        source: 'rss',
      };
    });

    return { status: 'ok', articles, count: articles.length };
  } catch (err) {
    console.warn(`  ⚠ RSS fetch failed for ${journal.nameCN}: ${err.message}`);
    return { status: 'error', articles: [], count: 0, error: err.message };
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('📚 Translation Journals Tracker — Data Fetcher');
  console.log('═══════════════════════════════════════════════\n');

  // Ensure data directory
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const metadata = {
    total_articles: 0,
    source_counts: { crossref: 0, rss: 0 },
    journals: {},
    manual_journals: MANUAL_JOURNALS.map(j => j.id),
  };

  const allArticles = [];
  const seenIds = new Set();

  function addArticles(articles) {
    for (const a of articles) {
      if (!seenIds.has(a.id)) {
        seenIds.add(a.id);
        allArticles.push(a);
      }
    }
  }

  // ── Phase 1: CrossRef ──
  console.log('🟢 Phase 1: CrossRef API (8 journals)');
  for (const journal of CROSSREF_JOURNALS) {
    process.stdout.write(`  📡 ${journal.name} (${journal.issn}) … `);
    const result = await fetchCrossRefJournal(journal);
    console.log(result.status === 'ok' ? `✓ ${result.count} articles` : `✗ ${result.error}`);
    metadata.journals[journal.id] = { status: result.status, count: result.count };
    if (result.articles.length > 0) {
      addArticles(result.articles);
      metadata.source_counts.crossref += result.count;
    }
    await sleep(250);
  }

  // ── Phase 2: CNKI RSS ──
  console.log('\n🔵 Phase 2: CNKI RSS (3 journals) [direct fetch, no CORS proxy]');
  for (const journal of RSS_JOURNALS) {
    process.stdout.write(`  📡 ${journal.nameCN} (${journal.name}) … `);
    const result = await fetchRSSJournal(journal);
    console.log(result.status === 'ok' ? `✓ ${result.count} articles` : `✗ ${result.error}`);
    metadata.journals[journal.id] = { status: result.status, count: result.count };
    if (result.articles.length > 0) {
      addArticles(result.articles);
      metadata.source_counts.rss += result.count;
    }
    await sleep(300);
  }

  // ── Build output ──
  metadata.total_articles = allArticles.length;

  const now = new Date();
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(now.getTime() + beijingOffset);

  const output = {
    generated_at: beijingTime.toISOString().replace('Z', '+08:00'),
    generated_ts: now.getTime(),
    metadata,
    articles: allArticles,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✅ Done! ${allArticles.length} articles written to data/journals.json`);
  console.log(`   CrossRef: ${metadata.source_counts.crossref} | RSS: ${metadata.source_counts.rss}`);
  console.log(`   Generated at: ${output.generated_at}`);

  // ── Summary of errors ──
  const errors = Object.entries(metadata.journals).filter(([, v]) => v.status === 'error');
  if (errors.length > 0) {
    console.log(`\n⚠ ${errors.length} journal(s) failed:`);
    errors.forEach(([id]) => console.log(`   - ${id}`));
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
