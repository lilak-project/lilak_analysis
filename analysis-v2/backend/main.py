"""analysis-v2 backend — flows (records) and the macros they point at.

A flow is one record in the shared document: a name and a macro's path. The
macro file stays the original, since its relative includes and its run folder
depend on where it sits. The graph is LILAK's own: `build_graph_model` from
$LILAK_PATH/macros/lilak_configure_flow_editor.py.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from lilak_portal_auth import manager
from rackstore.store import Document, mount_spa

DATA = Path(os.environ.get("ANALYSIS_V2_DATA_DIR", "./data"))
PROJECT = os.environ.get("PORTAL_PROJECT", "")
DIST = Path(os.environ.get("ANALYSIS_V2_DIST_DIR", "./dist"))
LILAK_PATH = Path(os.environ.get("LILAK_PATH") or Path.home() / "Research" / "lilak").expanduser()

# Where a flow's path may point, by name. A flow stores the name beside its path,
# so another root (a user's workspace) is one more entry here.
ROOTS = {"lilak": LILAK_PATH}
MACRO_SUFFIXES = {".mac", ".par"}
SKIP_DIRS = {"build", ".git", "node_modules"}
MODEL_KEYS = ("nodes", "edges", "class_data", "run_rows", "control_rows", "rows",
              "source_kind", "source_path", "input_file_path")


def macro_path(root: str, path: str) -> Path:
    """The macro `path` names under `root`; refuses anything outside it."""
    base = ROOTS.get(root)
    if base is None:
        raise HTTPException(400, "모르는 root입니다.")
    base = base.resolve()
    p = (base / path).resolve()
    if base not in p.parents:
        raise HTTPException(403, "허용된 폴더 밖의 경로입니다.")
    if p.suffix not in MACRO_SUFFIXES:
        raise HTTPException(400, "매크로 파일(.mac, .par)만 열 수 있습니다.")
    if not p.is_file():
        raise HTTPException(404, f"파일이 없습니다: {path}")
    return p


def _find_root() -> None:
    """ROOT is on a login shell's PATH, not on a portal-spawned service's."""
    if shutil.which("root"):
        return
    try:
        found = subprocess.run(["/bin/zsh", "-lc", "command -v root"],
                               capture_output=True, text=True, timeout=15).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return                                    # the graph build reports it
    if found:
        os.environ["PATH"] = f"{Path(found).parent}{os.pathsep}{os.environ.get('PATH', '')}"


def _pin_nplib() -> None:
    """LILAK's env setup searches ~/Research for libNPCore on every call (~1 s)."""
    if os.environ.get("NPLib_DIR"):
        return
    for name in ("libNPCore.dylib", "libNPCore.so"):
        hit = next(Path.home().joinpath("Research").rglob(name), None)
        if hit:
            os.environ["NPLib_DIR"] = str(hit.parent.parent)
            return


def _lilak():
    _find_root()
    _pin_nplib()
    macros = str(LILAK_PATH / "macros")
    if macros not in sys.path:
        sys.path.insert(0, macros)
    try:
        import lilak_configure_flow_editor as mod
    except Exception as e:
        raise HTTPException(503, f"LILAK macros를 불러올 수 없습니다: {e}")
    return mod


DOC = Document(DATA / "data.json", keys=("flows", "settings"), keep_days=30)

app = FastAPI(title="analysis-v2")
DOC.mount(app, project=PROJECT)


@app.get("/api/flow/macros")
def macros(root: str = "lilak", _: dict = Depends(manager)) -> dict:
    """Every macro under a root, for the path box to offer."""
    base = ROOTS.get(root)
    if base is None:
        raise HTTPException(400, "모르는 root입니다.")
    found = []
    for folder, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        found += [str((Path(folder) / f).relative_to(base)) for f in files if Path(f).suffix in MACRO_SUFFIXES]
    return {"macros": sorted(found)}


@app.get("/api/flow/graph")
def graph(path: str, root: str = "lilak", _: dict = Depends(manager)) -> dict:
    """LILAK's graph of one macro. It runs ROOT, so a manager's, like any host read."""
    p = macro_path(root, path)
    mod = _lilak()
    try:
        model = mod.build_graph_model(p.read_text(encoding="utf-8", errors="replace"),
                                      path_hint=str(p), source_kind="parameter")
    except Exception as e:
        raise HTTPException(422, f"그래프 생성 실패: {e}")
    return {k: model.get(k) for k in MODEL_KEYS}


# Must stay last: the catch-all would shadow /api/*.
mount_spa(app, DIST, name="analysis-v2")
