#!/usr/bin/env python3
"""Local review queue only. No network, scheduling, or message transport."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def save(folder, queue):
    folder.mkdir(parents=True, exist_ok=True)
    temp = folder / 'queue.json.tmp'
    temp.write_text(json.dumps(queue, indent=2, ensure_ascii=False) + '\n')
    temp.replace(folder / 'queue.json')
    lines = ['# Outreach review', '', 'Manual action only. Nothing has been sent by this tool.', '',
             f"Campaign: {queue['campaign_id']}", f"Sender: {queue['sender']['name']}", '']
    for item in queue['items']:
        p = item['content']
        lines += [f"## {p['company']} · {item['id']}", '', f"Status: {item['status']}",
                  f"Version: {item['version']}", f"Channel: {p['channel']}",
                  f"Destination: {p['destination'] or 'UNRESOLVED'}", '',
                  f"Subject: {p.get('subject', '')}", '', p['body'], '']
        if p.get('fields'):
            lines += ['Form fields:', '', json.dumps(p['fields'], indent=2, ensure_ascii=False), '']
        lines += ['Blockers: ' + ('; '.join(item['blockers']) or 'None recorded'), '', 'Evidence:', '']
        lines += [f"- {e['claim']} — {e['url']} (checked {e['checked_at']})" for e in p['evidence']]
        lines += ['']
    (folder / 'review.md').write_text('\n'.join(lines) + '\n')


def build(source, folder):
    data = json.loads(source.read_text())
    if not data.get('campaign_id') or not data.get('sender', {}).get('name'):
        raise ValueError('Campaign ID and sender name required')
    prior_path = folder / 'queue.json'
    prior = json.loads(prior_path.read_text()) if prior_path.exists() else {}
    if prior and prior['campaign_id'] != data['campaign_id']:
        raise ValueError('Different campaign: use a separate output folder')
    old = {x['id']: x for x in prior.get('items', [])}
    history = list(prior.get('history', []))
    items, ids, targets = [], set(), set()
    for raw in data['items']:
        p = dict(raw)
        for key in ['id', 'company', 'company_domain', 'channel', 'destination', 'body', 'evidence', 'blockers']:
            if key not in p:
                raise ValueError(f'Missing {key}')
        if p['id'] in ids or p['channel'] not in ['email', 'linkedin', 'application']:
            raise ValueError('Duplicate ID or invalid channel')
        if not isinstance(p['blockers'], list) or not isinstance(p['evidence'], list):
            raise ValueError('Blockers and evidence must be lists')
        if not p['company_domain'] or not p['body'].strip():
            raise ValueError('Company domain and body required')
        for e in p['evidence']:
            if not all(e.get(k) for k in ['url', 'checked_at', 'claim']):
                raise ValueError('Evidence needs URL, checked_at and claim')
        p['company_domain'] = p['company_domain'].strip().lower().removeprefix('www.')
        p['destination'] = p['destination'].strip()
        duplicate = (p['company_domain'], p['channel'], p['destination'].casefold(), p['body'])
        if duplicate in targets:
            raise ValueError('Duplicate draft under another ID')
        targets.add(duplicate)
        ids.add(p['id'])
        version = digest({'campaign_id': data['campaign_id'], 'sender': data['sender'], 'content': p})
        previous = old.pop(p['id'], None)
        if previous and previous['version'] == version:
            items.append(previous)
            continue
        if previous:
            history.append(previous)
        blockers = list(p['blockers'])
        if not p['destination']:
            blockers.append('Destination unresolved')
        if not p['evidence']:
            blockers.append('Evidence missing')
        items.append({'id': p['id'], 'version': version, 'content': p, 'blockers': blockers,
                      'status': 'blocked' if blockers else 'needs_review', 'approval': None,
                      'created_at': now()})
    history.extend(old.values())
    queue = {'campaign_id': data['campaign_id'], 'sender': data['sender'], 'send_enabled': False,
             'updated_at': now(), 'items': items, 'history': history}
    save(folder, queue)
    return f"Built {len(items)} manual review items"


def approve(folder, item_id, version, reviewer):
    queue = json.loads((folder / 'queue.json').read_text())
    item = next((x for x in queue['items'] if x['id'] == item_id), None)
    if not item or item['version'] != version:
        raise ValueError('Item missing or version changed; review current content')
    if item['blockers'] or not reviewer.strip():
        raise ValueError('Resolve blockers and provide reviewer name')
    item['approval'] = {'reviewer': reviewer, 'version': version, 'at': now()}
    item['status'] = 'approved_for_manual_action'
    queue['updated_at'] = now()
    save(folder, queue)
    return 'Review recorded. Nothing sent or submitted.'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    b = commands.add_parser('build')
    b.add_argument('input', type=Path)
    b.add_argument('output', type=Path)
    a = commands.add_parser('approve')
    a.add_argument('output', type=Path)
    a.add_argument('item_id')
    a.add_argument('version')
    a.add_argument('reviewer')
    args = parser.parse_args()
    try:
        print(build(args.input, args.output) if args.command == 'build' else
              approve(args.output, args.item_id, args.version, args.reviewer))
    except (ValueError, KeyError, TypeError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
