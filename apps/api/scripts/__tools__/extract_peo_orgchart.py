#!/usr/bin/env python3
"""Deterministic extractor for DoD PEO/CPE organization-chart PDFs (text-based,
not scanned). Org charts scramble under linear text extraction because boxes are
laid out spatially, so this clusters words into boxes by 2-D proximity (union-find
over bounding-box gaps), then parses each box into name / rank / role.

Each box typically reads:  <RANK NAME>  <ROLE TITLE...>
e.g. "BG CHRISTINE A. BEELER CAPABILITY PROGRAM EXECUTIVE"

Output JSON: { org, source, asOf, people: [ {fullName, rank, role, roleTitle, raw} ] }
Personnel only — PE mapping is done downstream (org -> PE portfolio crosswalk),
never guessed here.

Usage: python extract_peo_orgchart.py <pdf> --org "PEO STRI" --as-of 2026-03-20 [--source URL]
"""
import sys
import json
import re
import collections

RANKS = [
    'GEN', 'LTG', 'MG', 'BG', 'COL', 'LTC', 'MAJ', 'CPT', 'CW5', 'CW4', 'CW3',
    'SGM', 'CSM', 'MSG', 'SFC', 'DR.', 'MR.', 'MS.', 'MRS.', 'HON',
]
RANK_RE = re.compile(r'^(' + '|'.join(re.escape(r) for r in RANKS) + r')(?=\s|$)', re.I)

# Role keywords -> normalized role code (matches acquisition_personnel.role values).
ROLE_MAP = [
    ('CAPABILITY PROGRAM EXECUTIVE', 'PEO'),
    ('PROGRAM EXECUTIVE', 'PEO'),
    ('DEPUTY CAPABILITY PROGRAM EXECUTIVE', 'DPEO'),
    ('DEPUTY PROGRAM EXECUTIVE', 'DPEO'),
    ('PROJECT MANAGER', 'PM'),
    ('PRODUCT MANAGER', 'PM'),
    ('PROJECT LEAD', 'PM'),
    ('PRODUCT LEAD', 'PM'),
    ('PRODUCT DIRECTOR', 'PM'),
    ('DEPUTY PROJECT', 'DPM'),
    ('DEPUTY PRODUCT', 'DPM'),
    ('CHIEF OF STAFF', 'STAFF'),
    ('DIVISION CHIEF', 'STAFF'),
    ('DIRECTOR', 'STAFF'),
    ('CHIEF', 'STAFF'),
    ('OFFICER', 'STAFF'),
    ('ADVISOR', 'STAFF'),
]


def normalize_role(role_title: str) -> str:
    up = role_title.upper()
    for kw, code in ROLE_MAP:
        if kw in up:
            return code
    return 'OTHER'


def cluster_boxes(words):
    parent = list(range(len(words)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[find(i)] = find(j)

    def close(a, b):
        dx = max(b['x0'] - a['x1'], a['x0'] - b['x1'])
        dy = max(b['top'] - a['bottom'], a['top'] - b['bottom'])
        return dx < 40 and dy < 20

    for i in range(len(words)):
        for j in range(i + 1, len(words)):
            if close(words[i], words[j]):
                union(i, j)

    groups = collections.defaultdict(list)
    for i, w in enumerate(words):
        groups[find(i)].append(w)

    boxes = []
    for g in groups.values():
        g.sort(key=lambda w: (round(w['top'] / 6), w['x0']))
        txt = ' '.join(w['text'] for w in g).strip()
        x = min(w['x0'] for w in g)
        y = min(w['top'] for w in g)
        boxes.append((round(y), round(x), txt))
    boxes.sort()
    return boxes


def parse_person(text: str):
    """Split '<RANK NAME> <ROLE...>' into name + role. Returns None if no rank/name."""
    m = RANK_RE.match(text)
    if not m:
        return None
    # Find where the name ends and the role begins: the role starts at the first
    # all-caps role keyword. Heuristic: name = rank + following Title/CamelCase or
    # ALLCAPS tokens until we hit a known role word.
    tokens = text.split()
    role_start = None
    role_first_words = ('CAPABILITY', 'PROGRAM', 'DEPUTY', 'PROJECT', 'PRODUCT',
                        'SENIOR', 'ASSISTANT', 'CHIEF', 'DIVISION', 'DIRECTOR',
                        'EXECUTIVE', 'PUBLIC', 'CHIEF', 'COMMANDER')
    for idx in range(1, len(tokens)):
        if tokens[idx] in role_first_words:
            role_start = idx
            break
    if role_start is None:
        return None
    name = ' '.join(tokens[:role_start]).strip().rstrip(',')
    role_title = ' '.join(tokens[role_start:]).strip()
    rank = m.group(1).rstrip('.').upper()
    # full name without the rank prefix
    full_name = re.sub(RANK_RE, '', name).strip().rstrip(',')
    return {
        'fullName': full_name,
        'rank': rank,
        'role': normalize_role(role_title),
        'roleTitle': role_title,
        'raw': text,
    }


def main():
    if len(sys.argv) < 2:
        print('usage: extract_peo_orgchart.py <pdf> [--org X] [--as-of Y] [--source Z]', file=sys.stderr)
        sys.exit(2)
    pdf_path = sys.argv[1]

    def opt(name, default=None):
        hit = [a for a in sys.argv if a.startswith(f'--{name}=')]
        if hit:
            return hit[0].split('=', 1)[1]
        if f'--{name}' in sys.argv:
            i = sys.argv.index(f'--{name}')
            if i + 1 < len(sys.argv):
                return sys.argv[i + 1]
        return default

    org = opt('org', 'UNKNOWN')
    as_of = opt('as-of', None)
    source = opt('source', None)

    import pdfplumber
    people = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            for _y, _x, txt in cluster_boxes(words):
                if len(txt) < 6:
                    continue
                p = parse_person(txt)
                if p and p['fullName'] and len(p['fullName']) >= 3:
                    people.append(p)

    # Dedup by (fullName, roleTitle)
    seen = set()
    uniq = []
    for p in people:
        k = (p['fullName'].lower(), p['roleTitle'].lower())
        if k in seen:
            continue
        seen.add(k)
        uniq.append(p)

    out = {
        'org': org,
        'source': source,
        'asOf': as_of,
        'stats': {'people': len(uniq)},
        'people': uniq,
    }
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
