(() => {
  const CONFIG = {
    pubmedQuery: 'Xinsheng Wu Huachun Zou',
    rssUrl: 'https://pubmed.ncbi.nlm.nih.gov/rss/search/1TmjO1ifNewr3ZCXeKQ51L39DD88RQ2pLVl-AXtYCYAoQ3OQyZ/?limit=200&utm_campaign=pubmed-2&fc=20251114043805',
    dataUrl: 'assets/data/publications.json',
    eutilsBase: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
    maxResults: 10000,
    summaryBatchSize: 200,
    fetchTimeoutMs: 8000,
    ownerPattern: /\bXinsheng\s+Wu\b|^Wu\s+X\b/i
  };

  const THEME_RULES = [
    {
      id: 'evidence-methods',
      label: 'Evidence interpretation and methods',
      description: 'Articles focused on real-world evidence, trial interpretation, target-trial thinking, and evidence appraisal.',
      keywords: ['real-world evidence', 'real world evidence', 'randomized trials', 'randomized trial', 'trial interpretation', 'evidence appraisal', 'target trial', 'emulation', 'causal inference']
    },
    {
      id: 'surveillance-burden',
      label: 'Surveillance and disease burden',
      description: 'Population-level surveillance, underdiagnosis, underreporting, and global, regional, national, or provincial burden estimates.',
      keywords: ['surveillance', 'underdiagnosis', 'underreporting', 'reported HIV', 'reported AIDS', 'reporting', 'AIDS cases', 'burden', 'burdens', 'global', 'regional', 'national', 'province', 'provinces', 'GBD', 'drug use', 'COVID-19', 'observational study']
    },
    {
      id: 'hiv-prevention-transmission',
      label: 'HIV prevention and transmission',
      description: 'HIV prevention interventions and transmission-focused behavioral outcomes, including circumcision, PrEP, and risk compensation.',
      keywords: ['prevention', 'prevent HIV', 'prevent infection', 'circumcision', 'voluntary medical male circumcision', 'risk compensation', 'men who have sex with men', 'MSM', 'sexual transmission', 'transmission', 'PrEP']
    },
    {
      id: 'prediction-prognosis',
      label: 'Prediction and prognostic modeling',
      description: 'Prediction models, prognostic modeling, risk stratification, validation, screening tools, and machine-learning algorithms.',
      keywords: ['prediction', 'predictive', 'prognostic', 'prognosis', 'prediction model', 'prediction models', 'risk stratification', 'validation', 'screening', 'machine learning', 'algorithm']
    },
    {
      id: 'art-clinical-outcomes',
      label: 'ART and clinical outcomes',
      description: 'HIV treatment studies on antiretroviral regimens, adherence, virologic, immunologic, metabolic, BMI, weight, survival, and mortality outcomes.',
      keywords: ['antiretroviral', 'ART', 'BIC/FTC/TAF', 'bictegravir', 'dolutegravir', 'tenofovir', 'emtricitabine', 'INSTI', 'integrase', 'virologic', 'immunologic', 'metabolic', 'adherence', 'therapy', 'therapies', 'treatment', 'mortality', 'survival', 'BMI', 'body mass index', 'weight gain', 'people living with HIV', 'people with HIV']
    },
    {
      id: 'implementation-health-services',
      label: 'Implementation and health services',
      description: 'Implementation, care-delivery, service-cascade, and health-services studies that connect epidemiologic evidence with public health practice.',
      keywords: ['implementation', 'health services', 'service delivery', 'care delivery', 'care pathway', 'care cascade', 'cascade', 'program', 'programme', 'service', 'services', 'clinical cohort', 'cohort', 'public health practice']
    }
  ];

  const THEME_BY_ID = new Map(THEME_RULES.map((theme) => [theme.id, theme]));
  const MONTHS = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const trimTitle = (title = '') => String(title).replace(/\s+/g, ' ').trim().replace(/\.+$/, '');

  const chunks = (array, size) => {
    const output = [];
    for (let i = 0; i < array.length; i += size) output.push(array.slice(i, i + size));
    return output;
  };

  const yearFromPubDate = (value = '') => {
    const match = String(value).match(/\b(19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  };

  const monthFromPubDate = (value = '') => {
    const text = String(value || '').toLowerCase();
    const numeric = text.match(/\b(19|20)\d{2}[/-](\d{1,2})(?:[/-]\d{1,2})?/);
    if (numeric) {
      const month = Number(numeric[2]);
      return month >= 1 && month <= 12 ? month : null;
    }
    const word = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
    return word ? MONTHS[word[1]] || null : null;
  };

  const quarterFromMonth = (month) => (month ? `Q${Math.ceil(month / 3)}` : null);

  const sortValue = (record) => {
    const year = Number(record.year) || 0;
    const quarterNumber = Number(String(record.quarter || '').replace('Q', '')) || 1;
    const month = monthFromPubDate(record.sortpubdate || record.pubdate || record.date || '') || ((quarterNumber - 1) * 3 + 1);
    return year * 10000 + month * 100 + 1;
  };

  const normalizeAuthors = (authors) => {
    if (!Array.isArray(authors)) return [];
    return authors.map((author) => {
      if (typeof author === 'string') return author;
      return author?.name || author?.fullName || '';
    }).filter(Boolean);
  };

  const normalizeRecord = (raw = {}) => {
    const authors = normalizeAuthors(raw.authors);
    const authorsText = raw.authorsText || raw.authors_text || authors.join(', ') || 'Unknown author';
    const pubdate = raw.pubdate || raw.epubdate || raw.sortpubdate || raw.date || raw.year || '';
    const year = Number(raw.year) || yearFromPubDate(pubdate) || null;
    const month = monthFromPubDate(raw.sortpubdate || raw.pubdate || raw.epubdate || raw.date || '');
    const quarter = raw.quarter || quarterFromMonth(month) || (year ? 'Q1' : null);
    const pmid = String(raw.pmid || raw.uid || raw.id || '').trim();
    const journal = raw.journal || raw.fulljournalname || raw.source || 'PubMed';
    const title = trimTitle(raw.title || '');
    return classifyRecord({
      pmid,
      title,
      authors,
      authorsText,
      journal,
      year,
      quarter,
      pubdate: String(pubdate || year || ''),
      sortpubdate: raw.sortpubdate || raw.sortdate || '',
      url: raw.url || (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '')
    });
  };

  const normalizeSummary = (summary = {}) => normalizeRecord({
    pmid: summary.uid,
    title: summary.title,
    authors: summary.authors || [],
    journal: summary.fulljournalname || summary.source,
    pubdate: summary.pubdate || summary.epubdate || summary.sortpubdate,
    sortpubdate: summary.sortpubdate,
    url: summary.uid ? `https://pubmed.ncbi.nlm.nih.gov/${summary.uid}/` : ''
  });

  const keywordScore = (text, keyword) => {
    const normalizedKeyword = String(keyword).toLowerCase();
    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (normalizedKeyword.length <= 3 && /^[a-z0-9]+$/i.test(normalizedKeyword)) {
      return new RegExp(`\\b${escaped}\\b`, 'i').test(text) ? 1 : 0;
    }
    if (/\s|[-/]/.test(normalizedKeyword)) return text.includes(normalizedKeyword) ? 3 : 0;
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text) ? 2 : 0;
  };

  function classifyRecord(record) {
    const text = `${record.title || ''}`.toLowerCase();
    const defaultTheme = THEME_RULES[THEME_RULES.length - 1];
    const best = THEME_RULES.find((theme) => theme.keywords.some((keyword) => keywordScore(text, keyword) > 0)) || defaultTheme;
    return {
      ...record,
      theme: best.id,
      themeLabel: best.label,
      themeDescription: best.description
    };
  }

  const sortRecords = (records) => records.slice().sort((a, b) => sortValue(b) - sortValue(a));

  const uniqueByPmid = (records) => {
    const seen = new Set();
    const output = [];
    for (const record of records) {
      const key = record.pmid || `${record.title}-${record.year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(record);
    }
    return output;
  };

  const fetchWithTimeout = async (url, options = {}) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return response;
    } finally {
      window.clearTimeout(timer);
    }
  };

  const fetchText = async (url) => {
    const response = await fetchWithTimeout(url, { cache: 'no-store' });
    return response.text();
  };

  const fetchJson = async (url) => {
    const response = await fetchWithTimeout(url, { cache: 'no-store' });
    return response.json();
  };

  const fetchIdsFromRss = async () => {
    const xmlText = await fetchText(CONFIG.rssUrl);
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('PubMed RSS could not be parsed.');
    return $$('item link', xml)
      .map((link) => link.textContent.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/)?.[1])
      .filter(Boolean);
  };

  const fetchIdsFromEsearch = async () => {
    const searchUrl = `${CONFIG.eutilsBase}/esearch.fcgi?db=pubmed&retmode=json&tool=academic-homepage-publications&sort=pub_date&retmax=${CONFIG.maxResults}&term=${encodeURIComponent(CONFIG.pubmedQuery)}`;
    const search = await fetchJson(searchUrl);
    return search?.esearchresult?.idlist || [];
  };

  const fetchLivePublications = async () => {
    let ids = [];
    try {
      ids = await fetchIdsFromRss();
    } catch (error) {
      console.warn(error);
    }
    if (!ids.length) ids = await fetchIdsFromEsearch();
    if (!ids.length) throw new Error('PubMed returned no matching records.');

    const summaries = [];
    for (const batch of chunks(ids, CONFIG.summaryBatchSize)) {
      const summaryUrl = `${CONFIG.eutilsBase}/esummary.fcgi?db=pubmed&retmode=json&tool=academic-homepage-publications&id=${batch.join(',')}`;
      const summary = await fetchJson(summaryUrl);
      const ordered = (summary?.result?.uids || batch).map((uid) => summary.result[uid]).filter(Boolean);
      summaries.push(...ordered);
    }
    return sortRecords(uniqueByPmid(summaries.map(normalizeSummary)));
  };

  const fetchLocalPublications = async () => {
    const payload = await fetchJson(CONFIG.dataUrl);
    const records = Array.isArray(payload?.records) ? payload.records : [];
    return sortRecords(uniqueByPmid(records.map(normalizeRecord)));
  };

  const readDomPublications = () => {
    const list = $('#publication-list');
    if (!list) return [];
    return sortRecords($$('.pub-entry', list).map((entry) => {
      const titleElement = $('.title', entry);
      const strongTitles = titleElement ? $$('strong', titleElement) : [];
      const titleNode = strongTitles[strongTitles.length - 1];
      const title = trimTitle(titleNode?.textContent || titleElement?.textContent || '');
      const fullTitleText = titleElement?.textContent || '';
      const authorsText = fullTitleText.replace(titleNode?.textContent || title, '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim() || 'Unknown author';
      const sourceElement = $('.source', entry);
      const sourceText = sourceElement?.textContent || '';
      const journal = $('em', sourceElement)?.textContent || 'PubMed';
      const year = yearFromPubDate(sourceText);
      const pmid = entry.dataset.pmid || sourceText.match(/PMID:\s*(\d+)/i)?.[1] || '';
      return normalizeRecord({
        pmid,
        title,
        authorsText,
        journal,
        year,
        pubdate: String(year || ''),
        url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : ''
      });
    }));
  };

  const formatAuthors = (record) => {
    const authorString = record.authorsText || (record.authors || []).join(', ') || 'Unknown author';
    return escapeHtml(authorString)
      .replace(/\bXinsheng\s+Wu\b/g, '<strong>Xinsheng Wu</strong>')
      .replace(/\bWu\s+X\b/g, '<strong>Wu X</strong>');
  };

  const renderThemeBadge = (themeId) => {
    const theme = THEME_BY_ID.get(themeId) || THEME_RULES[0];
    return `<span class="theme-badge" data-theme="${escapeHtml(theme.id)}">${escapeHtml(theme.label)}</span>`;
  };

  const renderPublicationRecord = (record, index) => `
        <article class="pub-entry" data-pmid="${escapeHtml(record.pmid)}" data-theme="${escapeHtml(record.theme)}" data-year="${escapeHtml(record.year || '')}" data-quarter="${escapeHtml(record.quarter || '')}">
          <p class="pub-index">${String(index + 1).padStart(2, '0')}</p>
          <div>
            <p class="title">${formatAuthors(record)}. <strong>${escapeHtml(record.title)}.</strong></p>
            <p class="source"><em>${escapeHtml(record.journal)}</em> · ${escapeHtml(record.year || 'n.d.')} · PMID: ${escapeHtml(record.pmid)} · <a href="${escapeHtml(record.url)}" target="_blank" rel="noreferrer">PubMed</a></p>
            <p class="pub-theme-line">${renderThemeBadge(record.theme)} <span>${escapeHtml(record.themeDescription)}</span></p>
          </div>
        </article>`;

  const countThemes = (records) => {
    const counts = new Map(THEME_RULES.map((theme) => [theme.id, 0]));
    records.forEach((record) => counts.set(record.theme, (counts.get(record.theme) || 0) + 1));
    return counts;
  };

  const visibleThemesForRecords = (records, counts = countThemes(records)) => {
    const usedThemes = THEME_RULES.filter((theme) => (counts.get(theme.id) || 0) > 0);
    return usedThemes.length ? usedThemes : THEME_RULES;
  };

  const renderKeywordList = () => {};

  const initPublicationPage = () => {
    const list = $('#publication-list');
    const count = $('#publication-count');
    const status = $('#publication-status');
    const filters = $('#theme-filters');
    const summary = $('#theme-summary');
    if (!list || !count || !status || !filters) return;

    let records = readDomPublications();
    let activeTheme = 'all';

    const renderFilters = () => {
      const counts = countThemes(records);
      const visibleThemes = visibleThemesForRecords(records, counts);
      if (activeTheme !== 'all' && !visibleThemes.some((theme) => theme.id === activeTheme)) activeTheme = 'all';
      filters.innerHTML = [
        `<button type="button" class="theme-chip${activeTheme === 'all' ? ' is-active' : ''}" data-theme="all">All themes <span>${records.length}</span></button>`,
        ...visibleThemes.map((theme) => `<button type="button" class="theme-chip${activeTheme === theme.id ? ' is-active' : ''}" data-theme="${escapeHtml(theme.id)}">${escapeHtml(theme.label)} <span>${counts.get(theme.id) || 0}</span></button>`)
      ].join('');
    };

    const renderList = () => {
      const visible = activeTheme === 'all' ? records : records.filter((record) => record.theme === activeTheme);
      list.classList.remove('is-preloading');
      list.innerHTML = visible.length
        ? visible.map(renderPublicationRecord).join('')
        : '<div class="empty-state">No publications are currently listed in this research area.</div>';
      count.textContent = activeTheme === 'all'
        ? `${records.length} publication${records.length === 1 ? '' : 's'}`
        : `${visible.length} publication${visible.length === 1 ? '' : 's'} in ${THEME_BY_ID.get(activeTheme)?.label || 'selected research area'}`;
      const themeText = activeTheme === 'all'
        ? 'Browse publications by research area.'
        : `${THEME_BY_ID.get(activeTheme)?.label || 'Selected research area'} publications are shown below.`;
      status.textContent = themeText;
      if (summary) {
        summary.textContent = 'Browse publications by research area. Use the filters to focus the list.';
      }
    };

    const renderAll = () => {
      renderFilters();
      renderList();
    };

    filters.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-theme]');
      if (!button) return;
      activeTheme = button.dataset.theme || 'all';
      renderAll();
    });

    count.textContent = 'Loading…';
    status.textContent = 'Loading the publication list…';

    fetchLivePublications()
      .then((liveRecords) => {
        if (liveRecords.length >= records.length) records = liveRecords;
        renderAll();
      })
      .catch((liveError) => {
        console.warn(liveError);
        fetchLocalPublications()
          .then((localRecords) => {
            if (localRecords.length >= records.length) records = localRecords;
            renderAll();
            status.textContent = 'Showing the latest available publication records.';
          })
          .catch((localError) => {
            console.warn(localError);
            renderAll();
            status.textContent = 'Showing the available publication records.';
          });
      });
  };

  const isFirstAuthor = (record) => {
    const first = record.authors?.[0] || (record.authorsText || '').split(/,|;/)[0] || '';
    return CONFIG.ownerPattern.test(first.trim());
  };

  const updateFirstAuthorMetric = (records) => {
    const target = $('#first-author-count');
    if (!target || !records.length) return;
  
    const staticValue = Number(target.dataset.staticValue || 0) || 0;
    const computed = records.filter(isFirstAuthor).length;
  
    target.textContent = String(Math.max(computed, staticValue));
  };

  const aggregateByQuarter = (records) => {
    const dated = records.filter((record) => record.year);
    if (!dated.length) return [];
    const maxYear = Math.max(...dated.map((record) => Number(record.year)));
    const minObservedYear = Math.min(...dated.map((record) => Number(record.year)));
    const startYear = Math.max(minObservedYear, maxYear - 4);
    const buckets = [];
    const bucketMap = new Map();
    for (let year = startYear; year <= maxYear; year += 1) {
      for (let quarter = 1; quarter <= 4; quarter += 1) {
        const key = `${year}-Q${quarter}`;
        const bucket = { key, label: `${year} Q${quarter}`, year, quarter, count: 0, records: [] };
        buckets.push(bucket);
        bucketMap.set(key, bucket);
      }
    }
    dated.forEach((record) => {
      const year = Number(record.year);
      if (year < startYear || year > maxYear) return;
      const quarter = Number(String(record.quarter || 'Q1').replace('Q', '')) || 1;
      const key = `${year}-Q${quarter}`;
      const bucket = bucketMap.get(key);
      if (!bucket) return;
      bucket.count += 1;
      bucket.records.push(record);
    });
    return buckets;
  };

  const renderRecentWorkChart = (records) => {
    const chart = $('#recent-work-chart');
    const detail = $('#recent-work-detail');
    if (!chart || !detail) return;
    const buckets = aggregateByQuarter(records);
    if (!buckets.length) {
      chart.innerHTML = '<div class="empty-state">Publication timing will appear here after the PubMed feed is available.</div>';
      detail.innerHTML = '';
      return;
    }

    const width = 920;
    const height = 330;
    const margin = { top: 28, right: 20, bottom: 58, left: 46 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
    const step = innerWidth / buckets.length;
    const barWidth = Math.max(10, Math.min(34, step * 0.64));
    const yScale = (value) => margin.top + innerHeight - (value / maxCount) * innerHeight;
    const latestNonZero = buckets.slice().reverse().find((bucket) => bucket.count > 0) || buckets[buckets.length - 1];

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const y = margin.top + innerHeight - ratio * innerHeight;
      const value = Math.round(maxCount * ratio);
      return `<line class="chart-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}" />
        <text class="chart-y-label" x="${margin.left - 12}" y="${y + 4}" text-anchor="end">${value}</text>`;
    }).join('');

    const bars = buckets.map((bucket, index) => {
      const x = margin.left + index * step + (step - barWidth) / 2;
      const y = yScale(bucket.count);
      const h = margin.top + innerHeight - y;
      const isActive = bucket.key === latestNonZero.key;
      return `<g class="chart-bar-group${isActive ? ' is-active' : ''}" data-key="${bucket.key}" tabindex="0" role="button" aria-label="${escapeHtml(bucket.label)}: ${bucket.count} publication${bucket.count === 1 ? '' : 's'}">
          <rect class="chart-hit" x="${x - 4}" y="${margin.top}" width="${barWidth + 8}" height="${innerHeight}" rx="8"></rect>
          <rect class="chart-bar" x="${x}" y="${y}" width="${barWidth}" height="${Math.max(2, h)}" rx="7"></rect>
          <text class="chart-value" x="${x + barWidth / 2}" y="${Math.max(16, y - 7)}" text-anchor="middle">${bucket.count || ''}</text>
          <text class="chart-quarter" x="${x + barWidth / 2}" y="${height - 34}" text-anchor="middle">Q${bucket.quarter}</text>
          ${bucket.quarter === 1 ? `<text class="chart-year" x="${x + barWidth / 2}" y="${height - 16}" text-anchor="middle">${bucket.year}</text>` : ''}
        </g>`;
    }).join('');

    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Publications by year and quarter">
        ${gridLines}
        <line class="chart-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${margin.top + innerHeight}" y2="${margin.top + innerHeight}" />
        ${bars}
      </svg>`;

    const showBucket = (key) => {
      const bucket = buckets.find((item) => item.key === key) || latestNonZero;
      $$('.chart-bar-group', chart).forEach((node) => node.classList.toggle('is-active', node.dataset.key === bucket.key));
      const items = bucket.records.slice(0, 6).map((record) => `<li><a href="${escapeHtml(record.url || 'publications.html')}" target="_blank" rel="noreferrer">${escapeHtml(record.title)}</a></li>`).join('');
      detail.innerHTML = `<h3>${escapeHtml(bucket.label)}</h3>
        <p>${bucket.count} publication${bucket.count === 1 ? '' : 's'} recorded in this period.</p>
        ${items ? `<ul>${items}</ul>` : '<p class="muted-note">No publication records in this quarter.</p>'}`;
    };

    chart.onmouseover = (event) => {
      const group = event.target.closest('.chart-bar-group');
      if (group) showBucket(group.dataset.key);
    };
    chart.onfocusin = (event) => {
      const group = event.target.closest('.chart-bar-group');
      if (group) showBucket(group.dataset.key);
    };
    chart.onclick = (event) => {
      const group = event.target.closest('.chart-bar-group');
      if (group) showBucket(group.dataset.key);
    };
    showBucket(latestNonZero.key);
  };

  const renderTopicMap = (records) => {
    const map = $('#topic-map');
    const detail = $('#topic-detail');
    if (!map || !detail) return;
    const counts = countThemes(records);
    const visibleThemes = visibleThemesForRecords(records, counts);
    const grouped = new Map(visibleThemes.map((theme) => [theme.id, records.filter((record) => record.theme === theme.id)]));
    const desktopLayoutTemplates = {
      1: [{ x: 50, y: 15 }],
      2: [{ x: 50, y: 14 }, { x: 50, y: 86 }],
      3: [{ x: 50, y: 13 }, { x: 82, y: 66 }, { x: 18, y: 66 }],
      4: [{ x: 50, y: 12 }, { x: 82, y: 50 }, { x: 50, y: 88 }, { x: 18, y: 50 }],
      5: [{ x: 50, y: 12 }, { x: 82, y: 35 }, { x: 72, y: 78 }, { x: 28, y: 78 }, { x: 18, y: 35 }],
      6: [{ x: 50, y: 11 }, { x: 82, y: 31 }, { x: 82, y: 69 }, { x: 50, y: 89 }, { x: 18, y: 69 }, { x: 18, y: 31 }]
    };
    const compactLayoutTemplates = {
      1: [{ x: 50, y: 16 }],
      2: [{ x: 50, y: 16 }, { x: 50, y: 84 }],
      3: [{ x: 50, y: 14 }, { x: 78, y: 66 }, { x: 22, y: 66 }],
      4: [{ x: 50, y: 13 }, { x: 78, y: 50 }, { x: 50, y: 87 }, { x: 22, y: 50 }],
      5: [{ x: 50, y: 13 }, { x: 78, y: 36 }, { x: 70, y: 78 }, { x: 30, y: 78 }, { x: 22, y: 36 }],
      6: [{ x: 50, y: 12 }, { x: 78, y: 32 }, { x: 78, y: 68 }, { x: 50, y: 88 }, { x: 22, y: 68 }, { x: 22, y: 32 }]
    };
    const isCompactMap = window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
    const layoutTemplates = isCompactMap ? compactLayoutTemplates : desktopLayoutTemplates;
    const radiusX = isCompactMap ? 28 : 34;
    const radiusY = isCompactMap ? 36 : 39;
    const positions = layoutTemplates[visibleThemes.length] || visibleThemes.map((_, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(visibleThemes.length, 1);
      return { x: 50 + Math.cos(angle) * radiusX, y: 50 + Math.sin(angle) * radiusY };
    });
    const activeTheme = visibleThemes.find((theme) => (counts.get(theme.id) || 0) > 0) || visibleThemes[0] || THEME_RULES[0];

    const lines = visibleThemes.map((theme, index) => {
      const pos = positions[index] || positions[0];
      return `<line x1="50" y1="50" x2="${pos.x}" y2="${pos.y}" />`;
    }).join('');

    const nodes = visibleThemes.map((theme, index) => {
      const pos = positions[index] || positions[0];
      const count = counts.get(theme.id) || 0;
      const examples = (grouped.get(theme.id) || []).slice(0, 2).map((record) => `<span>${escapeHtml(record.title)}</span>`).join('');
      return `<button type="button" class="topic-node${theme.id === activeTheme.id ? ' is-active' : ''}${count ? '' : ' is-empty'}" data-theme="${escapeHtml(theme.id)}" style="left:${pos.x}%;top:${pos.y}%">
          <span class="topic-node-title">${escapeHtml(theme.label)}</span>
          <span class="topic-node-count">${count} publication${count === 1 ? '' : 's'}</span>
          <span class="topic-node-examples">${examples}</span>
        </button>`;
    }).join('');

    map.innerHTML = `<svg class="topic-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
      <div class="topic-hub"><span>Focused themes</span><strong>${records.length}</strong><small>PubMed records</small></div>
      ${nodes}`;


    const showTheme = (themeId) => {
      const theme = THEME_BY_ID.get(themeId) || activeTheme;
      const themeRecords = grouped.get(theme.id) || [];
      $$('.topic-node', map).forEach((node) => node.classList.toggle('is-active', node.dataset.theme === theme.id));
      const list = themeRecords.map((record) => `<li><a href="${escapeHtml(record.url || 'publications.html')}" target="_blank" rel="noreferrer">${escapeHtml(record.title)}</a></li>`).join('');
      detail.innerHTML = `<h3>${escapeHtml(theme.label)}</h3>
        <p>${escapeHtml(theme.description)}</p>
        ${list ? `<ul>${list}</ul>` : '<p class="muted-note">No publications are currently listed in this research area.</p>'}`;
    };

    map.onclick = (event) => {
      const button = event.target.closest('button[data-theme]');
      if (button) showTheme(button.dataset.theme);
    };
    showTheme(activeTheme.id);
  };

  const updateHonorsMetric = () => {
    const honorsCount = $('#honors-count');
    const honorItems = $$('#honors-list p');
    if (honorsCount && honorItems.length) honorsCount.textContent = String(honorItems.length);
  };

  const initHomePage = () => {
    if (!$('#recent-work-chart') && !$('#topic-map') && !$('#first-author-count') && !$('#honors-count')) return;
    updateHonorsMetric();
    const renderHome = (records) => {
      if (!records.length) return;
      updateFirstAuthorMetric(records);
      renderRecentWorkChart(records);
      renderTopicMap(records);
    };

    fetchLivePublications()
      .then(renderHome)
      .catch((liveError) => {
        console.warn(liveError);
        fetchLocalPublications()
          .then(renderHome)
          .catch((localError) => console.warn(localError));
      });
  };

  initPublicationPage();
  initHomePage();
})();
