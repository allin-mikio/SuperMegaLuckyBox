"""PWA 用アイコン (docs/icons/*.png) を、ロゴ画像 tools/logo.png から生成する。

ロゴを差し替えたいとき:
  1. tools/logo.png を新しい画像に置き換える（正方形・背景は透明にしない・512px 以上を推奨）
  2. .venv\\Scripts\\python.exe tools\\make_icons.py
  3. docs/js/version.js のバージョンを上げてコミットする
  （iPad のホーム画面のアイコンは自動では変わらない。いったん削除して「ホーム画面に追加」をやり直す）

必要なもの: Pillow（開発用。公開されるアプリには含まれない）
  .venv\\Scripts\\python.exe -m pip install pillow

出力:
  - icon-192.png / icon-512.png : 通常アイコン（Android・ブラウザ用）
  - icon-maskable-512.png       : マスカブル（Android が丸/角丸に切り抜いても欠けないよう、
                                  ロゴを 80% に縮め、周囲をロゴ自身のぼかしで埋める）
  - apple-touch-icon.png        : iPad / iPhone のホーム画面用（180x180。角丸は iOS が付ける）
  - docs/images/title-logo.png  : 画面タイトル（「はろなぞ4」）の左に表示する画像（192x192）
"""
import os
import sys

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit('Pillow が必要です: .venv\\Scripts\\python.exe -m pip install pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'tools', 'logo.png')
OUT_DIR = os.path.join(ROOT, 'docs', 'icons')
IMAGES_DIR = os.path.join(ROOT, 'docs', 'images')

# マスカブル版で、ロゴを縮める割合（Android の安全領域は中央の約80%）
MASKABLE_SCALE = 0.8


def load_source():
    img = Image.open(SOURCE).convert('RGBA')
    if img.width != img.height:
        # 正方形でなければ、中央を正方形に切り出す
        side = min(img.size)
        left = (img.width - side) // 2
        top = (img.height - side) // 2
        img = img.crop((left, top, left + side, top + side))
        print(f'注意: 正方形ではないため、中央 {side}x{side} を切り出しました')
    # 透明部分は白で塗る（iOS は透明を黒く表示するため）
    flat = Image.new('RGBA', img.size, (255, 255, 255, 255))
    flat.alpha_composite(img)
    return flat.convert('RGB')


def resized(img, size):
    return img.resize((size, size), Image.LANCZOS)


def maskable(img, size):
    # 背景: ロゴを大きく引き伸ばして強くぼかしたもの（縁の色になじませる）
    background = resized(img, size).filter(ImageFilter.GaussianBlur(size / 12))
    inner = int(round(size * MASKABLE_SCALE))
    offset = (size - inner) // 2
    background.paste(resized(img, inner), (offset, offset))
    return background


def save(img, name):
    path = os.path.join(OUT_DIR, name)
    img.save(path, 'PNG', optimize=True)
    print(f'wrote {path} ({os.path.getsize(path) // 1024} KB)')


def main():
    if not os.path.exists(SOURCE):
        sys.exit(f'ロゴ画像が見つかりません: {SOURCE}')
    os.makedirs(OUT_DIR, exist_ok=True)
    src = load_source()
    if src.width < 512:
        print(f'注意: ロゴが {src.width}px です。512px 以上を推奨します（拡大するとぼやけます）')
    save(resized(src, 192), 'icon-192.png')
    save(resized(src, 512), 'icon-512.png')
    save(maskable(src, 512), 'icon-maskable-512.png')
    save(resized(src, 180), 'apple-touch-icon.png')
    # 画面タイトルの横に表示する画像（docs/images/title-logo.png）。軽く保つため 192px に縮める
    os.makedirs(IMAGES_DIR, exist_ok=True)
    path = os.path.join(IMAGES_DIR, 'title-logo.png')
    resized(src, 192).save(path, 'PNG', optimize=True)
    print(f'wrote {path} ({os.path.getsize(path) // 1024} KB)')


if __name__ == '__main__':
    main()
