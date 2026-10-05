"""テスト失敗時の調査用: ブラウザが出力した最初の不一致と、Flask版の期待値の差分を表示する。

使い方:
  1) run_tests.ps1 の出力 DOM を保存（run_tests.ps1 -SaveDom <path>）
  2) .venv\\Scripts\\python.exe tests\\diff_mismatch.py <保存したdomファイル>
"""
import html
import io
import json
import re
import sys
from contextlib import redirect_stdout

import gen_golden


def diff(a, b, path=''):
    if type(a) != type(b):
        print(f'{path}: type {type(a).__name__} != {type(b).__name__}  expected={str(a)[:200]!r} actual={str(b)[:200]!r}')
        return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                print(f'{path}/{k}: 余分 (actualのみ) = {str(b[k])[:200]!r}')
            elif k not in b:
                print(f'{path}/{k}: 不足 (expectedのみ) = {str(a[k])[:200]!r}')
            else:
                diff(a[k], b[k], f'{path}/{k}')
    elif isinstance(a, list):
        if len(a) != len(b):
            print(f'{path}: list length expected={len(a)} actual={len(b)}')
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f'{path}[{i}]')
    elif a != b:
        print(f'{path}: expected={a!r} actual={b!r}')


def main():
    dom = open(sys.argv[1], encoding='utf-8').read()
    m = re.search(r'<pre id="mismatch">(.*?)</pre>', dom, re.S)
    if not m:
        print('不一致データがありません')
        return
    info = json.loads(html.unescape(m.group(1)))
    with redirect_stdout(io.StringIO()):
        sequences = gen_golden.build_all(upto=info['seqNo'])
    expected = json.loads(sequences[info['seqNo']][1][info['stepNo']]['_canon'])
    actual = json.loads(info['canon'])
    print(f"seq#{info['seqNo']} step#{info['stepNo']}")
    diff(expected, actual)


if __name__ == '__main__':
    main()
