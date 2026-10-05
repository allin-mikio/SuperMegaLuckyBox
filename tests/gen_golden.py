"""Flask版 (app.py) を「正解」として、操作列とその応答のハッシュを tests/golden.js に出力する。

JS版エンジン (docs/js/engine.js) が同じ操作列に対して同じ応答を返すかを
tests/run.html（tests/run_tests.ps1 で実行）で検証するための基準データを作る。

実行: .venv\\Scripts\\python.exe tests\\gen_golden.py
      .venv\\Scripts\\python.exe tests\\gen_golden.py --show <シーケンス番号> <ステップ番号>
          -> 指定ステップの「期待される正規化済みJSON」を表示（不一致調査用）
"""
import io
import json
import os
import random
import sys
from contextlib import redirect_stdout

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

_devnull = open(os.devnull, 'w', encoding='utf-8')
with redirect_stdout(_devnull):
    import app as flask_app

def all_card_ids():
    with redirect_stdout(_devnull):
        return list(flask_app.LuckyBoxGame().available_cards.keys())


ROUNDS = ['tutorial', 'round1', 'round2', 'round3', 'round4', 'bogus']


# ---------------------------------------------------------------- hashing
def _imul(a, b):
    return ((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF)) & 0xFFFFFFFF


def cyrb53(s, seed=0):
    """docs/js/engine.js の cyrb53 と同一のハッシュ（UTF-16コード単位で計算）。"""
    h1 = (0xDEADBEEF ^ seed) & 0xFFFFFFFF
    h2 = (0x41C6CE57 ^ seed) & 0xFFFFFFFF
    data = s.encode('utf-16-le')
    for i in range(0, len(data), 2):
        ch = data[i] | (data[i + 1] << 8)
        h1 = _imul(h1 ^ ch, 2654435761)
        h2 = _imul(h2 ^ ch, 1597334677)
    h1 = (_imul(h1 ^ (h1 >> 16), 2246822507) ^ _imul(h2 ^ (h2 >> 13), 3266489909)) & 0xFFFFFFFF
    h2 = (_imul(h2 ^ (h2 >> 16), 2246822507) ^ _imul(h1 ^ (h1 >> 13), 3266489909)) & 0xFFFFFFFF
    return 4294967296 * (2097151 & h2) + h1


def normalize(value):
    """比較用の正規化: timestamp を除去し、順序が不定な activated_bonuses を整列する。"""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k in ('timestamp', 'user_id'):  # user_id はサーバー版のセッション情報（スタンドアローンでは不要）
                continue
            nv = normalize(v)
            if k == 'activated_bonuses' and isinstance(nv, list):
                nv = sorted(nv, key=lambda x: json.dumps(x, separators=(',', ':')))
            out[k] = nv
        return out
    if isinstance(value, list):
        return [normalize(v) for v in value]
    return value


def canonical(value):
    return json.dumps(normalize(value), sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def summarize(resp):
    state = resp.get('game_state') if isinstance(resp, dict) and 'game_state' in resp else resp
    s = {'success': resp.get('success') if isinstance(resp, dict) else None}
    if isinstance(state, dict) and 'cards' in state and 'lightning_tokens' in state:
        s.update({
            'L': state['lightning_tokens'], 'M': state['moon_tokens'], 'S': state['star_tokens'],
            'score': state['score'], 'cards': len(state['cards']),
            'done': len(state['completed_cards']), 'hist': len(state['history']),
            'last': state['history'][-1]['action'] if state['history'] else None,
        })
    if isinstance(resp, dict) and resp.get('error'):
        s['error'] = resp['error']
    return s


# ---------------------------------------------------------------- driver
GET_ENDPOINTS = ('get_state', 'game_state', 'cards_by_round/')


def call(client, endpoint, data):
    with redirect_stdout(_devnull):
        if endpoint.startswith(GET_ENDPOINTS):
            resp = client.get('/api/' + endpoint)
        else:
            resp = client.post('/api/' + endpoint, json=data)
    return resp.get_json()


def current_state(resp):
    if isinstance(resp, dict):
        if 'game_state' in resp and isinstance(resp['game_state'], dict):
            return resp['game_state']
        if 'cards' in resp and 'lightning_tokens' in resp:
            return resp
    return None


def run_sequence(op_provider):
    """op_provider(state) -> (endpoint, data) or None で終了。応答を記録して返す。"""
    client = flask_app.app.test_client()
    steps = []
    state = current_state(call(client, 'get_state', None))
    while True:
        op = op_provider(state)
        if op is None:
            break
        endpoint, data = op
        resp = call(client, endpoint, data)
        steps.append({
            'ep': endpoint,
            'data': data,
            'hash': cyrb53(canonical(resp)),
            'sum': summarize(resp),
            '_canon': canonical(resp),
        })
        new_state = current_state(resp)
        if new_state is not None:
            state = new_state
    return steps


def pick_unmarked(state, rng):
    cells = []
    for ci, card in enumerate(state['cards']):
        for r, row in enumerate(card['marked']):
            for c, marked in enumerate(row):
                if not marked:
                    cells.append((ci, r, c))
    return rng.choice(cells) if cells else None


def random_provider(rng, n_ops, card_ids):
    counter = {'i': 0}

    def provider(state):
        if counter['i'] >= n_ops:
            return None
        counter['i'] += 1
        x = rng.random()
        n_cards = len(state['cards']) if state else 0
        if x < 0.16:
            cid = rng.choice(card_ids + ['nope']) if rng.random() < 0.1 else rng.choice(card_ids)
            return 'add_card', {'card_id': cid}
        if x < 0.70:
            if n_cards == 0:
                return 'mark_cell', {'card_index': 0, 'row': 0, 'col': 0}
            if rng.random() < 0.85:
                pick = pick_unmarked(state, rng)
                if pick:
                    return 'mark_cell', {'card_index': pick[0], 'row': pick[1], 'col': pick[2]}
            # 既にマーク済み/範囲外を含むランダム
            return 'mark_cell', {
                'card_index': rng.randint(-1, n_cards),
                'row': rng.randint(-1, 5),
                'col': rng.randint(-1, 5),
            }
        if x < 0.80:
            return 'undo', {}
        if x < 0.82:
            return 'reset', {}
        if x < 0.90:
            t = rng.choice(['lightning', 'moon', 'star', 'lightning', 'bogus'])
            return 'adjust_tokens', {'token_type': t, 'amount': rng.choice([1, -1, 1, -1, 2, -2, 0, 5])}
        if x < 0.95:
            return 'get_state', None
        return 'cards_by_round/' + rng.choice(ROUNDS), None

    return provider


def scripted_edge_provider():
    ops = [
        ('get_state', None),
        ('undo', {}),
        ('mark_cell', {'card_index': 0, 'row': 0, 'col': 0}),
        ('mark_cell', {}),
        ('add_card', {}),
        ('add_card', {'card_id': 'nope'}),
        ('adjust_tokens', {'token_type': 'x', 'amount': 1}),
        ('adjust_tokens', {'token_type': 'moon'}),
        ('adjust_tokens', {'token_type': 'lightning', 'amount': 0}),
        ('adjust_tokens', {'token_type': 'lightning', 'amount': -9}),
        ('adjust_tokens', {'token_type': 'lightning', 'amount': 9}),
        ('add_card', {'card_id': 'Tutorial'}),
        ('add_card', {'card_id': 'Tutorial'}),
        ('mark_cell', {'card_index': 0, 'row': 3, 'col': 0}),
        ('mark_cell', {'card_index': 0, 'row': 0, 'col': 0}),
        ('mark_cell', {'card_index': 0, 'row': 0, 'col': 0}),
        ('undo', {}), ('undo', {}), ('undo', {}), ('undo', {}), ('undo', {}), ('undo', {}),
        ('reset', {}),
    ] + [('cards_by_round/' + r, None) for r in ROUNDS]
    it = iter(ops)
    return lambda state: next(it, None)


def complete_card_provider(card_id, rng, undo_all):
    plan = {'stage': 0, 'cells': None}

    def provider(state):
        if plan['stage'] == 0:
            plan['stage'] = 1
            return 'add_card', {'card_id': card_id}
        if plan['stage'] == 1:
            if plan['cells'] is None:
                card = state['cards'][0]
                rows, cols = card['size']
                cells = [(r, c) for r in range(rows) for c in range(cols)]
                rng.shuffle(cells)
                plan['cells'] = cells
            if plan['cells']:
                r, c = plan['cells'].pop()
                return 'mark_cell', {'card_index': 0, 'row': r, 'col': c}
            plan['stage'] = 2
        if plan['stage'] == 2:
            if undo_all and state['can_undo']:
                return 'undo', {}
            plan['stage'] = 3
        if plan['stage'] == 3:
            plan['stage'] = 4
            return 'reset', {}
        return None

    return provider


def build_all(upto=None):
    """全シーケンスを作る。upto を指定するとそのシーケンス番号までで打ち切る（調査用）。"""
    rng = random.Random(20261006)
    card_ids = all_card_ids()
    sequences = []

    def done():
        return upto is not None and len(sequences) > upto

    sequences.append(('edge cases', run_sequence(scripted_edge_provider())))
    for i, cid in enumerate(card_ids):
        if done():
            return sequences
        sequences.append((f'complete {cid}', run_sequence(complete_card_provider(cid, rng, undo_all=(i % 2 == 0)))))
    for i in range(14):
        if done():
            return sequences
        sequences.append((f'random {i}', run_sequence(random_provider(rng, 260, card_ids))))
    return sequences


def main():
    sequences = build_all()

    if len(sys.argv) >= 4 and sys.argv[1] == '--show':
        seq_no, step_no = int(sys.argv[2]), int(sys.argv[3])
        step = sequences[seq_no][1][step_no]
        print(step['_canon'])
        return

    golden = []
    total = 0
    for name, steps in sequences:
        total += len(steps)
        golden.append({
            'name': name,
            'steps': [{k: v for k, v in s.items() if k != '_canon'} for s in steps],
        })

    out = os.path.join(ROOT, 'tests', 'golden.js')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// tests/gen_golden.py で生成（手で編集しない）\n')
        f.write('window.GOLDEN = ')
        json.dump(golden, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print(f'sequences={len(golden)} steps={total} -> {out} ({os.path.getsize(out) // 1024} KB)')


if __name__ == '__main__':
    main()
