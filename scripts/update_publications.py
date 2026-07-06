#!/usr/bin/env python3
"""Regenerate the publication cache, metrics, and static publication list.

Usage:
  python scripts/update_publications.py

Optional environment variables:
  PUBMED_RSS_URL  Override the default PubMed RSS feed URL.
  PUBMED_QUERY    Override the backup PubMed query.
  PUBMED_EMAIL    Contact email sent to NCBI E-utilities.
  PUBMED_TOOL     Tool name sent to NCBI E-utilities.
"""
from __future__ import annotations

import html
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = ROOT / "index.html"
PUBLICATIONS_HTML = ROOT / "publications.html"
PUBLICATION_DATA = ROOT / "assets" / "data" / "publications.json"

# Keep these aligned with the PubMed link used on the website.
DEFAULT_QUERY = "Xinsheng Wu Huachun Zou"
DEFAULT_RSS_URL = (
    "https://pubmed.ncbi.nlm.nih.gov/rss/search/"
    "1TmjO1ifNewr3ZCXeKQ51L39DD88RQ2pLVl-AXtYCYAoQ3OQyZ/"
    "?limit=200&utm_campaign=pubmed-2&fc=20251114043805"
)

EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
MAX_RESULTS = 10000
BATCH_SIZE = 200
REQUEST_DELAY_SECONDS = 0.34  # Keep under NCBI's no-key casual-use rate.
OWNER_RE = re.compile(r"\bXinsheng\s+Wu\b|^Wu\s+X\b", re.I)


THEME_RULES = [{"id": "evidence-methods", "label": "Evidence interpretation and methods", "description": "Articles focused on real-world evidence, trial interpretation, target-trial thinking, and evidence appraisal.", "keywords": ["real-world evidence", "real world evidence", "randomized trials", "randomized trial", "trial interpretation", "evidence appraisal", "target trial", "emulation", "causal inference"]}, {"id": "surveillance-burden", "label": "Surveillance and disease burden", "description": "Population-level surveillance, underdiagnosis, underreporting, and global, regional, national, or provincial burden estimates.", "keywords": ["surveillance", "underdiagnosis", "underreporting", "reported HIV", "reported AIDS", "reporting", "AIDS cases", "burden", "burdens", "global", "regional", "national", "province", "provinces", "GBD", "drug use", "COVID-19", "observational study"]}, {"id": "hiv-prevention-transmission", "label": "HIV prevention and transmission", "description": "HIV prevention interventions and transmission-focused behavioral outcomes, including circumcision, PrEP, and risk compensation.", "keywords": ["prevention", "prevent HIV", "prevent infection", "circumcision", "voluntary medical male circumcision", "risk compensation", "men who have sex with men", "MSM", "sexual transmission", "transmission", "PrEP"]}, {"id": "prediction-prognosis", "label": "Prediction and prognostic modeling", "description": "Prediction models, prognostic modeling, risk stratification, validation, screening tools, and machine-learning algorithms.", "keywords": ["prediction", "predictive", "prognostic", "prognosis", "prediction model", "prediction models", "risk stratification", "validation", "screening", "machine learning", "algorithm"]}, {"id": "art-clinical-outcomes", "label": "ART and clinical outcomes", "description": "HIV treatment studies on antiretroviral regimens, adherence, virologic, immunologic, metabolic, BMI, weight, survival, and mortality outcomes.", "keywords": ["antiretroviral", "ART", "BIC/FTC/TAF", "bictegravir", "dolutegravir", "tenofovir", "emtricitabine", "INSTI", "integrase", "virologic", "immunologic", "metabolic", "adherence", "therapy", "therapies", "treatment", "mortality", "survival", "BMI", "body mass index", "weight gain", "people living with HIV", "people with HIV"]}, {"id": "implementation-health-services", "label": "Implementation and health services", "description": "Implementation, care-delivery, service-cascade, and health-services studies that connect epidemiologic evidence with public health practice.", "keywords": ["implementation", "health services", "service delivery", "care delivery", "care pathway", "care cascade", "cascade", "program", "programme", "service", "services", "clinical cohort", "cohort", "public health practice"]}]

MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def keyword_score(text: str, keyword: str) -> int:
    keyword_normalized = keyword.lower()
    escaped = re.escape(keyword_normalized)
    if len(keyword_normalized) <= 3 and re.fullmatch(r"[a-z0-9]+", keyword_normalized, re.I):
        return 1 if re.search(rf"\b{escaped}\b", text, re.I) else 0
    if re.search(r"\s|[-/]", keyword_normalized):
        return 3 if keyword_normalized in text else 0
    return 2 if re.search(rf"\b{escaped}\b", text, re.I) else 0


def classify_theme(title: str, journal: str = "") -> dict:
    text = f"{title or ''}".lower()
    default_theme = THEME_RULES[-1]
    for theme in THEME_RULES:
        if any(keyword_score(text, keyword) > 0 for keyword in theme["keywords"]):
            return theme
    return default_theme


def month_from_pubdate(value: str) -> int | None:
    text = (value or "").lower()
    numeric = re.search(r"\b(?:19|20)\d{2}[/-](\d{1,2})(?:[/-]\d{1,2})?", text)
    if numeric:
        month = int(numeric.group(1))
        return month if 1 <= month <= 12 else None
    word = re.search(
        r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b",
        text,
    )
    return MONTHS.get(word.group(1)) if word else None


def quarter_from_pubdate(value: str) -> str | None:
    month = month_from_pubdate(value)
    return f"Q{((month - 1) // 3) + 1}" if month else None


def cached_publication_count(page: str) -> int:
    return len(re.findall(r'<article\s+class="pub-entry"', page))


def chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(values), size):
        yield values[i : i + size]


def unique_preserving_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output


def eutils_json(endpoint: str, params: dict[str, str | int]) -> dict:
    params = dict(params)
    params.setdefault("retmode", "json")
    params.setdefault("tool", os.getenv("PUBMED_TOOL", "academic-homepage-publications"))
    if os.getenv("PUBMED_EMAIL"):
        params.setdefault("email", os.environ["PUBMED_EMAIL"])

    url = f"{EUTILS_BASE}/{endpoint}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "academic-homepage-publications/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_ids_from_rss() -> list[str]:
    rss_url = os.getenv("PUBMED_RSS_URL", DEFAULT_RSS_URL)
    if not rss_url:
        return []
    rss_xml = fetch_text(rss_url)
    return unique_preserving_order(re.findall(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)/", rss_xml))


def fetch_ids_from_esearch() -> list[str]:
    query = os.getenv("PUBMED_QUERY", DEFAULT_QUERY)
    search = eutils_json(
        "esearch.fcgi",
        {
            "db": "pubmed",
            "sort": "pub_date",
            "retmax": MAX_RESULTS,
            "term": query,
        },
    )
    return search.get("esearchresult", {}).get("idlist", [])


def fetch_publication_ids(existing_count: int) -> tuple[list[str], str]:
    try:
        rss_ids = fetch_ids_from_rss()
    except Exception as exc:  # noqa: BLE001 - fall back to ESearch in scheduled runs.
        print(f"RSS fetch failed; falling back to ESearch: {exc}")
        rss_ids = []

    if rss_ids and len(rss_ids) >= existing_count:
        return rss_ids, "PubMed RSS"

    esearch_ids = fetch_ids_from_esearch()
    if esearch_ids:
        return esearch_ids, "PubMed ESearch"

    if rss_ids:
        return rss_ids, "PubMed RSS"

    raise SystemExit("PubMed returned no records. Check PUBMED_RSS_URL or PUBMED_QUERY.")


def fetch_summaries(ids: list[str]) -> list[dict]:
    records: list[dict] = []
    for batch in chunks(ids, BATCH_SIZE):
        time.sleep(REQUEST_DELAY_SECONDS)
        summary = eutils_json(
            "esummary.fcgi",
            {
                "db": "pubmed",
                "id": ",".join(batch),
            },
        )
        result = summary.get("result", {})
        ordered = [result[uid] for uid in result.get("uids", batch) if uid in result]
        records.extend(ordered)
    return records


def year_from_pubdate(value: str) -> str:
    match = re.search(r"\b(19|20)\d{2}\b", value or "")
    return match.group(0) if match else "n.d."


def trim_title(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().rstrip(".")


def author_names(record: dict) -> list[str]:
    return [author.get("name", "") for author in record.get("authors") or [] if author.get("name")]


def format_authors(authors: list[dict]) -> str:
    names = [author.get("name", "") for author in authors if author.get("name")]
    if not names:
        return "Unknown author"

    visible = names[:6] + (["et al."] if len(names) > 7 else names[6:])
    rendered = []
    for name in visible:
        safe = html.escape(name)
        if OWNER_RE.search(name):
            rendered.append(f"<strong>{safe}</strong>")
        else:
            rendered.append(safe)
    return ", ".join(rendered)


def render_record(record: dict, index: int) -> str:
    normalized = normalize_record(record)
    pmid = html.escape(str(normalized.get("pmid", "")))
    title = html.escape(normalized.get("title", ""))
    journal = html.escape(normalized.get("journal") or "PubMed")
    year = html.escape(str(normalized.get("year") or "n.d."))
    quarter = html.escape(str(normalized.get("quarter") or ""))
    theme_id = html.escape(normalized.get("theme", "implementation-health-services"))
    theme_label = html.escape(normalized.get("themeLabel", "Implementation and health services"))
    theme_description = html.escape(normalized.get("themeDescription", ""))
    authors = format_authors(record.get("authors") or [])
    return f'''        <article class="pub-entry" data-pmid="{pmid}" data-theme="{theme_id}" data-year="{year}" data-quarter="{quarter}">
          <p class="pub-index">{index + 1:02d}</p>
          <div>
            <p class="title">{authors}. <strong>{title}.</strong></p>
            <p class="source"><em>{journal}</em> · {year} · PMID: {pmid} · <a href="https://pubmed.ncbi.nlm.nih.gov/{pmid}/" target="_blank" rel="noreferrer">PubMed</a></p>
            <p class="pub-theme-line"><span class="theme-badge" data-theme="{theme_id}">{theme_label}</span> <span>{theme_description}</span></p>
          </div>
        </article>'''


def normalize_record(record: dict) -> dict:
    pmid = str(record.get("uid", ""))
    title = trim_title(record.get("title", ""))
    pubdate = record.get("pubdate") or record.get("epubdate") or record.get("sortpubdate") or ""
    year_value = year_from_pubdate(pubdate)
    journal = record.get("fulljournalname") or record.get("source") or "PubMed"
    theme = classify_theme(title, journal)
    return {
        "pmid": pmid,
        "title": title,
        "authors": author_names(record),
        "authorsText": ", ".join(author_names(record)) or "Unknown author",
        "journal": journal,
        "year": int(year_value) if year_value.isdigit() else None,
        "quarter": quarter_from_pubdate(record.get("sortpubdate") or pubdate) or "Q1",
        "pubdate": pubdate,
        "sortpubdate": record.get("sortpubdate") or "",
        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
        "theme": theme["id"],
        "themeLabel": theme["label"],
        "themeDescription": theme["description"],
    }


def write_publication_data(records: list[dict], source: str) -> None:
    PUBLICATION_DATA.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": source,
        "pubmed_query": os.getenv("PUBMED_QUERY", DEFAULT_QUERY),
        "rss_url": os.getenv("PUBMED_RSS_URL", DEFAULT_RSS_URL),
        "records": [normalize_record(record) for record in records],
    }
    PUBLICATION_DATA.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def replace_between_markers(text: str, start: str, end: str, replacement: str) -> str:
    pattern = re.compile(rf"({re.escape(start)})(.*?)(\n\s*{re.escape(end)})", re.S)
    replaced, count = pattern.subn(rf"\1\n{replacement}\3", text)
    if count != 1:
        raise SystemExit(f"Could not find marker block: {start} ... {end}")
    return replaced


def is_first_author(record: dict) -> bool:
    names = author_names(record)
    return bool(names and OWNER_RE.search(names[0]))


def update_first_author_metric(records: list[dict]) -> None:
    if not INDEX_HTML.exists():
        return
    page = INDEX_HTML.read_text(encoding="utf-8")
    computed = sum(1 for record in records if is_first_author(record))
    current_match = re.search(r'<strong id="first-author-count"[^>]*>(\d+)</strong>', page)
    current = int(current_match.group(1)) if current_match else 0
    if computed < current:
        return
    page = re.sub(
        r'(<strong id="first-author-count" data-static-value=")\d+(">)\d+(</strong>)',
        rf"\g<1>{computed}\g<2>{computed}\g<3>",
        page,
        count=1,
    )
    INDEX_HTML.write_text(page, encoding="utf-8")


def update_publications_page(records: list[dict]) -> None:
    page = PUBLICATIONS_HTML.read_text(encoding="utf-8")
    rendered = "\n\n".join(render_record(record, i) for i, record in enumerate(records))

    page = replace_between_markers(page, "<!-- PUBLICATIONS-START -->", "<!-- PUBLICATIONS-END -->", rendered)
    page = re.sub(
        r'<p class="publication-count" id="publication-count">.*?</p>',
        f'<p class="publication-count" id="publication-count">{len(records)} publications</p>',
        page,
        count=1,
    )
    page = re.sub(
        r'<p class="publication-status" id="publication-status">.*?</p>',
        '<p class="publication-status" id="publication-status">Showing the latest available publication records.</p>',
        page,
        count=1,
    )
    PUBLICATIONS_HTML.write_text(page, encoding="utf-8")


def main() -> None:
    page = PUBLICATIONS_HTML.read_text(encoding="utf-8")
    existing_count = cached_publication_count(page)

    ids, source = fetch_publication_ids(existing_count)
    records = fetch_summaries(ids)
    if existing_count and len(records) < existing_count:
        raise SystemExit(
            f"Refusing to replace {existing_count} cached records with only {len(records)} PubMed records. "
            "Check PUBMED_RSS_URL or PUBMED_QUERY before updating."
        )

    update_publications_page(records)
    write_publication_data(records, source)
    update_first_author_metric(records)
    print(f"Updated publication cache with {len(records)} PubMed records from {source}.")


if __name__ == "__main__":
    main()
