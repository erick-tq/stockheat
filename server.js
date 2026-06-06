// StockHeat Backend Server
// Fetches real A-stock data from EastMoney + Douyin + Weibo
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let cache = { sectorData: null, weiboData: null, douyinData: null, indices: null, timestamp: 0 };
const CACHE_TTL = 25000;

// ─── Helpers ──────────────────────────────
async function fetchJSON(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return await resp.json();
  } finally { clearTimeout(timeout); }
}

// ─── Data Sources ─────────────────────────
async function fetchIndices() {
  const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001,0.399006,1.000688&fields=f2,f3,f4,f12';
  const data = await fetchJSON(url);
  if (!data?.data?.diff) return null;
  const map = { '000001':'sh', '399001':'sz', '399006':'cy', '000688':'kc' };
  const indices = {};
  data.data.diff.forEach(item => {
    const k = map[item.f12];
    if (k) indices[k] = { price: item.f2, change: item.f3, changeAbs: item.f4 };
  });
  return indices;
}

async function fetchETFData(codes) {
  const secids = Object.entries(codes)
    .map(([code, mkt]) => `${mkt === 'sh' ? '1' : '0'}.${code}`)
    .join(',');
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f2,f3,f4,f12,f14`;
  const data = await fetchJSON(url);
  if (!data?.data?.diff) return {};
  const result = {};
  data.data.diff.forEach(item => {
    result[item.f12] = { price: item.f2, change: item.f3, name: item.f14 };
  });
  return result;
}

async function fetchDouyinHotSearch() {
  try {
    const resp = await fetch('https://www.douyin.com/aweme/v1/web/hot/search/list/?detail_list=1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Referer': 'https://www.douyin.com/',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const wordList = data?.data?.word_list || [];
    return wordList.map(item => ({
      rank: item.position || 0,
      name: item.word || '',
      heat: item.hot_value || 0,
    }));
  } catch (e) { console.warn('Douyin fetch failed:', e.message); return null; }
}

async function fetchWeiboHotSearch() {
  try {
    const resp = await fetch('https://weibo.com/ajax/statuses/hot_band', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Referer': 'https://weibo.com/',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const bandList = data?.data?.band_list || [];
    return bandList.map(item => ({
      rank: item.realpos || 0,
      name: item.word || item.note || '',
      heat: item.raw_hot || item.num || 0,
    }));
  } catch (e) { console.warn('Weibo fetch failed:', e.message); return null; }
}

// ─── Sector ETF Config ────────────────────
const SECTORS = [
  { code:'BK0446', name:'半导体',   etf:'159995', mkt:'sz' },
  { code:'BK0447', name:'人工智能', etf:'159819', mkt:'sz' },
  { code:'BK0465', name:'新能源车', etf:'515030', mkt:'sh' },
  { code:'BK0458', name:'光伏',     etf:'159857', mkt:'sz' },
  { code:'BK0485', name:'国防军工', etf:'512660', mkt:'sh' },
  { code:'BK0448', name:'5G通信',   etf:'515050', mkt:'sh' },
  { code:'BK0477', name:'生物医药', etf:'512290', mkt:'sh' },
  { code:'BK0460', name:'白酒消费', etf:'512690', mkt:'sh' },
  { code:'BK0490', name:'机器人',   etf:'562500', mkt:'sh' },
  { code:'BK0469', name:'锂电池',   etf:'159840', mkt:'sz' },
  { code:'BK0452', name:'银行',     etf:'512800', mkt:'sh' },
  { code:'BK0451', name:'证券',     etf:'512880', mkt:'sh' },
  { code:'BK0459', name:'医药医疗', etf:'512010', mkt:'sh' },
  { code:'BK0470', name:'消费电子', etf:'159732', mkt:'sz' },
  { code:'BK0492', name:'低空经济', etf:'563300', mkt:'sh' },
  { code:'BK0488', name:'算力',     etf:'516510', mkt:'sh' },
  { code:'BK0462', name:'电力',     etf:'159611', mkt:'sz' },
  { code:'BK0481', name:'创新药',   etf:'159992', mkt:'sz' },
  { code:'BK0493', name:'数据要素', etf:'516000', mkt:'sh' },
  { code:'BK0491', name:'固态电池', etf:'588330', mkt:'sh' },
];

// ─── API ──────────────────────────────────
app.get('/api/stockheat', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.sectorData && (now - cache.timestamp) < CACHE_TTL) {
      return res.json(cache);
    }

    const [indices, etfMap, douyinTopics, weiboTopics] = await Promise.all([
      fetchIndices(),
      fetchETFData(Object.fromEntries(SECTORS.map(s => [s.etf, s.mkt]))),
      fetchDouyinHotSearch(),
      fetchWeiboHotSearch(),
    ]);

    const sectorData = SECTORS.map(s => {
      const etfInfo = etfMap?.[s.etf] || { price: 1.0, change: 0 };
      return {
        code: s.code, name: s.name, etf: s.etf,
        etfName: etfInfo.name || s.name + 'ETF',
        etfPrice: etfInfo.price, priceChange: etfInfo.change,
      };
    });

    const fmtTopics = (topics, limit) => topics ? topics.slice(0, limit).map(t => ({
      rank: t.rank, name: t.name, heat: t.heat,
    })) : [];

    cache = {
      indices,
      sectorData,
      douyinTopics: fmtTopics(douyinTopics, 30),
      weiboTopics: fmtTopics(weiboTopics, 30),
      timestamp: now,
      sources: {
        indices: !!indices,
        etf: Object.keys(etfMap || {}).length > 0,
        douyin: !!douyinTopics,
        weibo: !!weiboTopics,
      },
    };

    console.log(`StockHeat: 指数${cache.sources.indices?'✓':'✗'} ETF${cache.sources.etf?'✓':'✗'} 抖音${cache.sources.douyin?'✓':'✗'} 微博${cache.sources.weibo?'✓':'✗'}`);
    res.json(cache);
  } catch (e) {
    console.error('API error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), cacheAge: Date.now() - cache.timestamp });
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`\n📡 StockHeat Backend running at http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/stockheat`);
  console.log(`   Frontend: http://localhost:${PORT}/\n`);
});
