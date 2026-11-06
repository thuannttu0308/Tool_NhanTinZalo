#!/bin/bash
set -e
cd "$(dirname "$0")"

python3 -m pip install -r requirements.txt

python3 -m PyInstaller --noconfirm --clean --windowed \
  --name "NhanTinZalo" \
  --add-data "../ui:ui" \
  --collect-data playwright \
  --collect-submodules playwright \
  --hidden-import zalo_app --hidden-import zalo_web \
  --osx-bundle-identifier vn.tmark.nhantinzalo \
  main.py

echo "Da build xong: desktop/dist/NhanTinZalo.app"
