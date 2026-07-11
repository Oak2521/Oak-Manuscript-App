"""生成应用图标（零依赖）：256×256 PNG 手绘像素 → 包进 ICO 容器。

设计：湖岸绿圆角底 + 白色稿纸（右上折角）+ 三行文字线 + 绿色对勾。
输出：electron/icon.ico 与 electron/icon.png。
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZE = 256
GREEN = (47, 111, 79, 255)        # --oak
GREEN_DARK = (36, 88, 64, 255)
WHITE = (255, 255, 255, 255)
PAPER_LINE = (176, 196, 186, 255)
TRANSPARENT = (0, 0, 0, 0)


def build_pixels() -> list[list[tuple]]:
    px = [[TRANSPARENT] * SIZE for _ in range(SIZE)]

    def rounded_rect(x0, y0, x1, y1, r, color):
        for y in range(y0, y1):
            for x in range(x0, x1):
                dx = max(x0 + r - x, x - (x1 - 1 - r), 0)
                dy = max(y0 + r - y, y - (y1 - 1 - r), 0)
                if dx * dx + dy * dy <= r * r:
                    px[y][x] = color

    # 底：圆角方块
    rounded_rect(8, 8, 248, 248, 44, GREEN)
    # 稿纸：白色矩形（居中偏左），右上折角
    paper_x0, paper_y0, paper_x1, paper_y1 = 64, 52, 192, 204
    fold = 28
    for y in range(paper_y0, paper_y1):
        for x in range(paper_x0, paper_x1):
            if x - paper_x1 + fold > 0 and paper_y0 + fold - y > 0 and \
               (x - (paper_x1 - fold)) + (paper_y0 + fold - y) > fold:
                continue  # 折角缺口
            px[y][x] = WHITE
    # 折角三角形（深绿）
    for y in range(paper_y0, paper_y0 + fold):
        for x in range(paper_x1 - fold, paper_x1):
            rel_x = x - (paper_x1 - fold)
            rel_y = y - paper_y0
            if rel_x >= rel_y and rel_x + (fold - rel_y) <= fold + 6 and rel_x - rel_y < 6:
                px[y][x] = GREEN_DARK
    # 文字行
    for i, ly in enumerate((92, 116, 140)):
        for y in range(ly, ly + 8):
            for x in range(80, 176 - (i == 2) * 40):
                px[y][x] = PAPER_LINE
    # 对勾（右下，绿粗线）
    def thick_line(x0, y0, x1, y1, w, color):
        steps = max(abs(x1 - x0), abs(y1 - y0)) * 2
        for i in range(steps + 1):
            cx = x0 + (x1 - x0) * i / steps
            cy = y0 + (y1 - y0) * i / steps
            for dy in range(-w, w + 1):
                for dx in range(-w, w + 1):
                    if dx * dx + dy * dy <= w * w:
                        x, y = int(cx + dx), int(cy + dy)
                        if 0 <= x < SIZE and 0 <= y < SIZE:
                            px[y][x] = color

    thick_line(104, 166, 126, 186, 9, GREEN)
    thick_line(126, 186, 168, 130, 9, GREEN)
    return px


def encode_png(px) -> bytes:
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("4B", *px[y][x]) for x in range(SIZE))
        for y in range(SIZE)
    )
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def encode_ico(png: bytes) -> bytes:
    # ICO 容器允许直接内嵌 256×256 PNG
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 22)
    return header + entry + png


def main():
    out_dir = Path(__file__).resolve().parent.parent / "electron"
    png = encode_png(build_pixels())
    (out_dir / "icon.png").write_bytes(png)
    (out_dir / "icon.ico").write_bytes(encode_ico(png))
    print(f"icon.png {len(png)} bytes / icon.ico 已生成 → {out_dir}")


if __name__ == "__main__":
    main()
