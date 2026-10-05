"""Writes Studio's test fixtures. Every company, person and address here is made up.

Run from apps/outreach: python3 tests/fixtures/make-fixtures.py
Each company stands in for one behavior the tests check (prior contact, sheet alias,
country-level domains, sheet conflicts, published email research).
"""
import json
from pathlib import Path

OUT = Path(__file__).parent

MESSAGE = (
    "Hi {first},\n\nWe're building Gridline from Entrepreneurs First.\n"
    "Gridline is the workload intelligence and orchestration layer for heterogeneous GPU compute.\n\n"
    "Are you open to a 15-min chat on how we can bring more customers to {company}'s idle compute?"
)

# name, sheet name, region, location, routes, people [(name, role)], sheet cells C..H
COMPANIES = [
    ("Corewell GPU", None, "North America", "United States",
     {"email": "hello@corewell.example", "support": "support@corewell.example", "partner": "https://corewell.example/partners"},
     [("Sam Rivera", "VP Partnerships"), ("Dana Lee", "CTO")],
     dict(C="Not applied", E="Yes", F="Presenting", H="Akshit")),
    ("Lumen Compute", None, "North America", "United States",
     {"email": "sales@lumen.example", "support": "", "partner": "https://lumen.example/partners"},
     [("Noor Haddad", "Head of Sales")],
     dict(C="Not applied", E="No", F="Contacted", H="Akshit")),
    ("Cascade Cloud", None, "North America", "United States",
     {"email": "info@cascadecloud.example", "support": "", "partner": ""},
     [("Jordan Blake", "CEO")],
     dict(C="Not applied", E="No", F="Meeting schedule 07/09/2026", H="Chinmay")),
    ("Ion Harbor", None, "North America", "Canada",
     {"email": "", "support": "", "partner": "https://ionharbor.example/partner-program"},
     [("Mira Stone", "Chief Revenue Officer")],
     dict(C="", E="No", F="", H="Akshit")),
    ("Podline", None, "North America", "United States",
     {"email": "partners@podline.example", "support": "", "partner": ""},
     [("Theo Park", "Growth Lead")],
     dict(C="Not applied", E="No", F="Prospecting", H="Akshit")),
    ("Hive HPC", None, "North America", "United States",
     {"email": "hello@hivehpc.example", "support": "", "partner": ""},
     [("Ruth Okafor", "COO")],
     dict(B="Pat Quinn", C="NA", E="No", F="Contacted + Applied", H="Chinmay")),
    ("Nebula Racks", None, "Europe", "Netherlands",
     {"email": "hello@nebularacks.example", "support": "", "partner": ""},
     [("Arno Jansen", "Founder")],
     dict(C="Not applied", E="No", F="Prospecting", H="Chinmay")),
    ("Meridian Metal", None, "Europe", "Germany",
     {"email": "sales@meridianmetal.example", "support": "", "partner": ""},
     [("Elena Vogel", "Head of Partnerships")],
     dict(B="Lee Morgan", C="Not applied", E="No", F="Prospecting", H="Chinmay")),
    ("Orbit Data Services", "Orbit AI", "Asia", "India",
     {"email": "contact@orbitdata.example", "support": "", "partner": ""},
     [("Kenji Mori", "Director, Cloud")],
     dict(C="Applied", E="No", F="Contacted", H="Chinmay")),
    ("Nimbus Grid", None, "Asia", "India",
     {"email": "", "support": "", "partner": "https://nimbusgrid.example/partners"},
     [("Rhea Kim", "VP Business Development")],
     dict(C="", E="No", F="", H="Akshit")),
    ("Kumo Internet", None, "Asia", "Japan",
     {"email": "info@kumo-fixture.ad.jp", "support": "", "partner": ""},
     [("Aiko Tanaka", "Business Development")],
     dict(C="", E="No", F="", H="Akshit")),
    ("Lantern IDC", None, "Asia", "Vietnam",
     {"email": "sales@lanternidc-fixture.com.vn", "support": "", "partner": ""},
     [("Minh Tran", "Sales Director")],
     dict(C="", E="No", F="", H="Akshit")),
    ("Tui Solutions", None, "Oceania", "New Zealand",
     {"email": "hello@tui-fixture.co.nz", "support": "", "partner": ""},
     [("Hana Walker", "General Manager")],
     dict(C="", E="No", F="Prospecting", H="Chinmay")),
]

# Statuses the newer sheet snapshot changes (stands in for an hourly sheet check).
LATEST = {
    "Meridian Metal": dict(C="Applied", F="Contacted + Applied"),
    "Kumo Internet": dict(F="Contacted + Applied"),
    "Lantern IDC": dict(F="Contacted + Applied"),
    "Nimbus Grid": dict(F="Contacted + Applied"),
    "Tui Solutions": dict(F="Rejected / Lost"),
}


def key(name):
    return "".join(ch for ch in name.lower() if ch.isalnum())


def domain(routes):
    for v in routes.values():
        if v:
            host = v.split("@")[-1].split("//")[-1].split("/")[0]
            return host
    return ""


def providers():
    regions = {}
    for name, _, region, location, routes, people, _ in COMPANIES:
        d = domain(routes)
        regions.setdefault(region, []).append({
            "name": name,
            "location": location,
            "summary": f"{name} rents GPU capacity. Fictional test company.",
            "judgment": "Route to partnerships first.",
            "contacts": routes,
            "people": [{
                "name": p,
                "search": f"{p} {name}",
                "url": "",
                "bio": f"{role} at {name}.",
                "message": MESSAGE.format(first=p.split()[0], company=name),
                "role": role,
            } for p, role in people],
            "notes": "",
            "hook": f"{name} recently added new GPU capacity.",
            "source": {"title": f"{name} news", "url": f"https://{d}/news", "publisher": name},
            "nvidia": {"status": "Not found", "note": "", "url": ""},
        })
    return [{"region": r, "companies": cs} for r, cs in regions.items()]


def rows(latest=False):
    out = []
    for i, (name, sheet_name, _, location, routes, people, cells) in enumerate(COMPANIES):
        n = i + 2
        values = dict(A=sheet_name or name, B=people[0][0], D=f"https://{domain(routes)}/news", G=location)
        values.update(cells)
        if latest:
            values.update(LATEST.get(name, {}))
        out.append({"row": n, "cells": {f"{c}{n}": values.get(c, "") for c in "ABCDEFGH"}})
    return out


def research():
    def row(company, website, candidates):
        return {
            "companyId": key(company),
            "company": company,
            "checkedAt": "2026-09-09T12:00:00.000Z",
            "website": website,
            "pages": [{"url": f"{website}/contact", "status": 200}],
            "candidates": [{
                "address": a, "source": f"{website}/contact", "kind": k, "contact": c,
                "checkedAt": "2026-09-09T12:00:00.000Z", "excerpt": f"Contact: {a}",
            } for a, k, c in candidates],
        }
    return [
        row("Nebula Racks", "https://nebularacks.example",
            [("arno.jansen@nebularacks.example", "person", "Arno Jansen"), ("hello@nebularacks.example", "team", "")]),
        row("Nimbus Grid", "https://nimbusgrid.example",
            [("partners@nimbusgrid.example", "team", ""), ("info@nimbusgrid.example", "team", "")]),
        row("Corewell GPU", "https://corewell.example", [("sales@corewell.example", "team", "")]),
        row("Kumo Internet", "https://kumo-fixture.ad.jp", [("info@kumo-fixture.ad.jp", "team", "")]),
    ]


def curated_company(name, region, people, hook):
    return {
        "id": key(name), "name": name, "sheetName": name, "region": region, "location": "",
        "poc": people[0][0] if people else "", "owner": "Akshit", "salesStatus": "Prospecting",
        "partnerStatus": "", "ncp": "No", "nextStep": "", "followUp": "", "notes": "", "revision": 1,
        "summary": f"{name}. Fictional curated company.", "hook": hook, "routing": "",
        "routes": {"email": "", "partner": "", "product": "", "exec": ""},
        "story": f"https://{key(name)}.example/about", "artifactSource": "", "sheetSource": "",
        "sheetRow": 0, "sheetValues": {},
        "people": [{"id": f"{key(name)}-{i}", "name": p, "role": r, "bio": r, "profile": "",
                    "referenceDraft": "", "source": "research"} for i, (p, r) in enumerate(people)],
        "knownPriorContact": False,
    }


SAMPLES = [
    dict(company="Ion Harbor", domain="ionharbor.example", contact="Mira Stone", role="Chief Revenue Officer",
         hook="Your white-label GPU partner program looks relevant to offering Ion Harbor through Gridline.",
         source="https://ionharbor.example/partner-program",
         linkedin="https://www.linkedin.com/in/fixture-mira-stone/", program="https://ionharbor.example/partner-program"),
    dict(company="Podline", domain="podline.example", contact="Theo Park", role="Growth · confirm partnership routing",
         hook="Your integration partner track looks relevant to helping shared users manage GPU workloads.",
         source="https://podline.example/partners",
         linkedin="https://www.linkedin.com/in/fixture-theo-park/", program="https://podline.example/partners"),
    dict(company="Hive HPC", domain="hivehpc.example", contact="Ruth Okafor", role="COO",
         hook="Your bare-metal offering looks relevant to a small provider integration.",
         source="https://hivehpc.example/about", linkedin="", program=""),
]

CONFIG = {
    "version": "fixture-2026-09-08",
    "files": {
        "providers": "providers.json",
        "sheet": "sheet.json",
        "sheetLatest": "sheet-latest.json",
        "curated": "curated-companies.json",
        "emailResearch": "email-research.json",
        "samples": "samples.json",
    },
    "sheetUrl": "https://sheets.example/tracker/edit",
    "artifactUrl": "https://research.example/providers",
    "aliases": {"Orbit AI": "Orbit Data Services"},
    "knownPriorContact": ["lumencompute", "corewellgpu", "cascadecloud"],
    "curated": {
        "draft": [{"id": "glowhive", "domain": "glowhive.example"}],
        "park": [{"id": "pitwallai", "domain": "pitwall.example",
                  "reason": "Research blocked: operating company and contact could not be verified."}],
    },
    "domainRepairs": {},
}


def write(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


write("source.json", CONFIG)
write("providers.json", providers())
write("sheet.json", rows())
write("sheet-latest.json", {"sourceUrl": "https://sheets.example/tracker", "capturedAt": "2026-09-09T13:00:00.000Z", "rows": rows(latest=True)})
write("email-research.json", research())
write("curated-companies.json", [
    curated_company("Glowhive", "Asia", [("Asha Rao", "Founder")], "a GPU cluster for regional startups"),
    curated_company("Pitwall AI", "Europe", [], "motorsport telemetry models"),
])
write("samples.json", SAMPLES)
