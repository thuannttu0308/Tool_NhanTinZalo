"""Đóng gói phiên bản mới.

Cách dùng:
    python tools/release.py 1.2.0 "Mô tả thay đổi"            # chỉ cập nhật version + extension
    python tools/release.py 1.2.0 "Mô tả thay đổi" --build    # build thêm .exe và .apk
"""
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "thuannttu0308/Tool_NhanTinZalo"
UI_FILES = ["index.html", "style.css", "app.js", "version.js", "vendor/xlsx.full.min.js", "vendor/exceljs.min.js"]


def set_version(version, notes):
    p = ROOT / "ui" / "version.js"
    s = p.read_text(encoding="utf-8")
    p.write_text(re.sub(r"APP_VERSION = '[^']*'", f"APP_VERSION = '{version}'", s), encoding="utf-8")

    p = ROOT / "extension-src" / "manifest.json"
    m = json.loads(p.read_text(encoding="utf-8"))
    m["version"] = version
    p.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    major, minor, patch = (int(x) for x in version.split("."))
    p = ROOT / "android" / "app" / "build.gradle.kts"
    s = p.read_text(encoding="utf-8")
    s = re.sub(r"versionCode = \d+", f"versionCode = {major * 10000 + minor * 100 + patch}", s)
    s = re.sub(r'versionName = "[^"]*"', f'versionName = "{version}"', s)
    p.write_text(s, encoding="utf-8")


def build_extension():
    out = ROOT / "extension"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "extension-src", out)
    for f in UI_FILES:
        dst = out / f
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "ui" / f, dst)
    return sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())


def zip_extension():
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    target = dist / "NhanTinZalo-extension.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for p in (ROOT / "extension").rglob("*"):
            if p.is_file():
                z.write(p, Path("NhanTinZalo") / p.relative_to(ROOT / "extension"))
    return target


def write_version_json(version, notes, files):
    tag = f"v{version}"
    data = {
        "version": version,
        "notes": notes,
        "page": f"https://github.com/{REPO}/releases/latest",
        "extension": {
            "base": f"https://raw.githubusercontent.com/{REPO}/{tag}/extension/",
            "files": files,
        },
        "desktop": {"windows": f"https://github.com/{REPO}/releases/download/{tag}/NhanTinZalo.exe"},
        "android": {"apk": f"https://github.com/{REPO}/releases/download/{tag}/NhanTinZalo.apk"},
    }
    (ROOT / "version.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_binaries():
    desktop = ROOT / "desktop"
    subprocess.run([
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--onefile",
        "--name", "NhanTinZalo", "--add-data", f"..{os.sep}ui{os.pathsep}ui",
        "--collect-data", "playwright", "--collect-submodules", "playwright",
        "--collect-all", "uiautomation", "--hidden-import", "comtypes.stream",
        "--hidden-import", "zalo_app", "--hidden-import", "zalo_web", "main.py",
    ], cwd=desktop, check=True)
    shutil.copy2(desktop / "dist" / "NhanTinZalo.exe", ROOT / "dist" / "NhanTinZalo.exe")

    android = ROOT / "android"
    env = dict(os.environ)
    if not env.get("JAVA_HOME"):
        jdks = sorted((Path.home() / ".jdks").glob("*17*"))
        if jdks:
            env["JAVA_HOME"] = str(jdks[-1])
    cmd = [str(android / ("gradlew.bat" if os.name == "nt" else "gradlew")), "assembleRelease", "-q"]
    subprocess.run(cmd, cwd=android, check=True, env=env)
    shutil.copy2(android / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk", ROOT / "dist" / "NhanTinZalo.apk")


def main():
    if len(sys.argv) < 3 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
        print(__doc__)
        sys.exit(1)
    version, notes = sys.argv[1], sys.argv[2]
    set_version(version, notes)
    files = build_extension()
    write_version_json(version, notes, files)
    print("Extension:", zip_extension())
    if "--build" in sys.argv:
        build_binaries()
        print("Đã build .exe và .apk vào thư mục dist")
    print(f"Xong phiên bản {version}")


if __name__ == "__main__":
    main()
