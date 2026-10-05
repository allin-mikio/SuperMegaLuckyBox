"""golden.js の操作列が、どの機能をどれだけ通っているかを集計する（テストの網羅確認用）。

実行: .venv\\Scripts\\python.exe tests\\coverage_report.py
"""
import collections
import json
import os
import re

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'golden.js')
text = open(path, encoding='utf-8').read()
golden = json.loads(text[text.index('=') + 1:].rstrip().rstrip(';'))

counter = collections.Counter()
for seq in golden:
    for step in seq['steps']:
        summary = step['sum']
        last = summary.get('last') or ''
        endpoint = step['ep'].split('/')[0]
        counter[f'API {endpoint}'] += 1
        if 'ビンゴ' in last:
            counter['ビンゴ成立（ボーナス獲得）'] += 1
        if re.search(r'[雷月星]\+', last):
            counter['  うちトークン獲得'] += 1
        if re.search(r'\d獲得|？', last):
            counter['  うち数字/？ボーナス獲得'] += 1
        if 'コンプリート' in last:
            counter['コンプリート'] += 1
        if '統合マス' in last:
            counter['統合マスのマーク'] += 1
        if endpoint == 'undo' and summary.get('success'):
            counter['Undo成功'] += 1
        if endpoint == 'undo' and not summary.get('success'):
            counter['Undo不可（履歴なし）'] += 1
        if summary.get('error'):
            counter['エラー応答'] += 1
        if summary.get('done', 0) >= 2:
            counter['2枚以上コンプリート済みの状態'] += 1

print(f"シーケンス {len(golden)} / ステップ {sum(len(s['steps']) for s in golden)}")
for key in sorted(counter):
    print(f'{key}: {counter[key]}')
