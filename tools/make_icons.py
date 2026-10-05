"""PWA 用アイコン (docs/icons/*.png) を生成する。外部ライブラリ不要（標準ライブラリのみ）。

デザイン: オレンジのグラデーション背景に、紫のプレゼント箱（ラッキーボックス）。
  - icon-192.png / icon-512.png        : 通常アイコン
  - icon-maskable-512.png              : マスカブル（端末側で丸/角丸に切り抜かれても欠けないよう、中身を小さめに描く）

実行: .venv\\Scripts\\python.exe tools\\make_icons.py
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'docs', 'icons')

PURPLE = (75, 0, 130)
PURPLE_LIGHT = (106, 27, 154)
YELLOW = (255, 235, 59)
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def in_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def in_circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size, scale):
    """scale: 中身の大きさ（1.0=通常、0.8=マスカブル用に小さめ）"""
    s = size
    c = s / 2
    u = s * scale / 100.0  # 内容を 100 単位の座標系で描くための単位長

    def px(v):  # 100単位系 -> ピクセル（中央基準）
        return c + (v - 50) * u

    # 箱の寸法（100単位系）
    body = (px(22), px(46), px(78), px(84), 4 * u)
    lid = (px(17), px(33), px(83), px(50), 4 * u)
    rib_v = (px(45), px(33), px(55), px(84))
    rib_h = (px(17), px(38), px(83), px(45))

    rows = []
    for y in range(s):
        row = bytearray()
        for x in range(s):
            t = (x + y) / (2.0 * s)
            color = lerp((255, 179, 0), (255, 112, 0), t)  # 背景グラデーション

            if in_round_rect(x, y, *body):
                color = PURPLE_LIGHT if x < c else PURPLE
            if in_round_rect(x, y, *lid):
                color = lerp(PURPLE_LIGHT, PURPLE, 0.35)
            # リボン（縦）
            if rib_v[0] <= x <= rib_v[2] and rib_v[1] <= y <= rib_v[3]:
                color = YELLOW
            # リボン（フタの帯）
            if rib_h[0] <= x <= rib_h[2] and rib_h[1] <= y <= rib_h[3]:
                color = YELLOW
            # 蝶結び（左右の輪）
            for cx in (px(40), px(60)):
                if in_circle(x, y, cx, px(27), 7.5 * u) and not in_circle(x, y, cx, px(27), 3.5 * u):
                    color = YELLOW
            # 結び目
            if in_circle(x, y, px(50), px(30), 4.5 * u):
                color = YELLOW
            # ハイライト（箱の「？」を示す白い丸）
            if in_circle(x, y, px(50), px(65), 6.5 * u):
                color = WHITE
            row.extend(color)
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    raw = b''.join(b'\x00' + row for row in rows)  # フィルタなし
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, size, scale in (
        ('icon-192.png', 192, 1.0),
        ('icon-512.png', 512, 1.0),
        ('icon-maskable-512.png', 512, 0.8),
    ):
        path = os.path.join(OUT_DIR, name)
        write_png(path, size, render(size, scale))
        print(f'wrote {path} ({os.path.getsize(path) // 1024} KB)')


if __name__ == '__main__':
    main()
