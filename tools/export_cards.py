"""app.py (Flask版) のカード定義を docs/js/cards.js に書き出す。

カード内容を Python 側から機械的に出力することで、手作業の転記ミスを防ぐ。
今後 docs/js/cards.js を直接編集してカードを変更してもよい。

実行: .venv\\Scripts\\python.exe tools\\export_cards.py
"""
import io
import json
import os
import sys
from contextlib import redirect_stdout

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

with redirect_stdout(io.StringIO()):
    import app as flask_app

    game = flask_app.LuckyBoxGame()

lines = []
lines.append('// カード定義（tools/export_cards.py で app.py から生成）')
lines.append('// カードの内容を変更する場合はこのファイルを編集し、js/version.js のバージョンも更新すること。')
lines.append('window.LUCKYBOX_CARDS = {')
lines.append('  cardsByRound: ' + json.dumps(game.cards_by_round, ensure_ascii=False) + ',')
lines.append('  cards: {')

card_items = list(game.available_cards.items())
for idx, (card_id, data) in enumerate(card_items):
    lines.append('    ' + json.dumps(card_id) + ': {')
    keys = list(data.keys())
    for k_idx, key in enumerate(keys):
        comma = ',' if k_idx < len(keys) - 1 else ''
        lines.append('      ' + json.dumps(key) + ': ' + json.dumps(data[key], ensure_ascii=False) + comma)
    lines.append('    }' + (',' if idx < len(card_items) - 1 else ''))

lines.append('  }')
lines.append('};')
lines.append('')

out_path = os.path.join(ROOT, 'docs', 'js', 'cards.js')
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(lines))
print(f'wrote {out_path} ({len(card_items)} cards)')
