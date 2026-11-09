"""A flow's path can never leave its root. Run: python backend/test_flow.py"""
import os
import sys
import tempfile
from pathlib import Path

root = Path(tempfile.mkdtemp()).resolve()
os.environ["LILAK_PATH"] = str(root)
os.environ["ANALYSIS_V2_DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException   # noqa: E402
from main import macro_path, macros   # noqa: E402

(root / "tebat").mkdir()
(root / "tebat/reco.mac").write_text("x")
(root / "tebat/notes.txt").write_text("x")
(root / "build").mkdir()
(root / "build/skip.mac").write_text("x")
(root.parent / "outside.mac").write_text("x")
(root / "tebat/link.mac").symlink_to(root.parent / "outside.mac")


def refused(root_name, path, code):
    try:
        macro_path(root_name, path)
    except HTTPException as e:
        assert e.status_code == code, (path, e.status_code)
        return
    raise AssertionError(f"{path} was let through")


assert macro_path("lilak", "tebat/reco.mac") == root / "tebat/reco.mac"
refused("lilak", "../outside.mac", 403)
refused("lilak", str(root.parent / "outside.mac"), 403)
refused("lilak", "tebat/link.mac", 403)      # a symlink out is still out
refused("lilak", "tebat/notes.txt", 400)
refused("lilak", "tebat/gone.mac", 404)
refused("elsewhere", "tebat/reco.mac", 400)
assert macros("lilak", {})["macros"] == ["tebat/link.mac", "tebat/reco.mac"]
print("flow: ok")
