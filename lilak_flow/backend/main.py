"""lilak_flow backend — the LILAK parameter files as a list, and what one holds.

The items are files: every .mac under a root ($LILAK_PATH) is one, found on each
load. The file stays the original — its relative includes and its run folder
depend on where it sits — so nothing here copies one. What a file cannot say
about itself (tags, a note) is kept beside it in the shared document, by id.
The graph is LILAK's own: `build_graph_model` from
$LILAK_PATH/macros/lilak_configure_flow_editor.py.
"""
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from lilak_portal_auth import manager
from rackstore.store import Document, mount_spa

DATA = Path(os.environ.get("LILAK_FLOW_DATA_DIR", "./data"))
PROJECT = os.environ.get("PORTAL_PROJECT", "")
DIST = Path(os.environ.get("LILAK_FLOW_DIST_DIR", "./dist"))
LILAK_PATH = Path(os.environ.get("LILAK_PATH") or Path.home() / "Research" / "lilak").expanduser()

# Where the files are, by name. An item's id starts with the name, so another
# root (a user's workspace) is one more entry here.
ROOTS = {"lilak": LILAK_PATH}
ITEM_SUFFIX = ".mac"
SKIP_DIRS = {"build", ".git", "node_modules", "data", "meta"}
FLOW_GROUPS = {"lilak", "LKRun"}          # a file with either is a run: it opens as a flow board
KEPT = ("tags", "note")                   # what the document keeps for a file
MODEL_KEYS = ("nodes", "edges", "class_data", "run_rows", "control_rows", "rows",
              "source_kind", "source_path", "input_file_path")


def item_path(item_id: str) -> Path:
    """The file an id (`root:relative/path.mac`) names; refuses anything outside its root."""
    root, _, rel = str(item_id).partition(":")
    base = ROOTS.get(root)
    if base is None or not rel:
        raise HTTPException(400, "모르는 항목입니다.")
    base = base.resolve()
    p = (base / rel).resolve()
    if base not in p.parents:
        raise HTTPException(403, "허용된 폴더 밖의 경로입니다.")
    if p.suffix != ITEM_SUFFIX:
        raise HTTPException(400, "파라미터 파일(.mac)만 열 수 있습니다.")
    if not p.is_file():
        raise HTTPException(404, f"파일이 없습니다: {rel}")
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
    """LILAK's own macro module: its parser needs nothing, its graph needs ROOT."""
    macros = str(LILAK_PATH / "macros")
    if macros not in sys.path:
        sys.path.insert(0, macros)
    try:
        import lilak_configure_flow_editor as mod
    except Exception as e:
        raise HTTPException(503, f"LILAK macros를 불러올 수 없습니다: {e}")
    return mod


def parse_all(text: str) -> list:
    """Every line LILAK's parser keeps: parameters and comments, in file order."""
    return _lilak().parse_parameter_text(text)


def parse(text: str) -> list:
    return [r for r in parse_all(text) if r.get("kind") == "parameter"]


# A line's prefix flags, by the names LILAK's parser gives them.
FLAG_CHARS = {"rewrite": "!", "temporary": "*", "multiple": "&", "conditional": "@", "include": "<"}


def _says(rows: list) -> list:
    """What rows mean, whatever their spacing: two files that say the same compare equal.
    Commented out is one thing however it is held (LILAK reads `#<x` as unit `#` with
    the include flag; the editor holds it as enabled false, unit `<`)."""
    out = []
    for r in rows:
        if r.get("kind") == "comment":
            out.append(("comment", bool(r.get("enabled")), str(r.get("comment") or "").strip()))
        elif str(r.get("name") or "").strip():
            unit = str(r.get("unit") or "").strip()
            flag = ("".join(c for k, c in FLAG_CHARS.items() if (r.get("flags") or {}).get(k))
                    if unit == "#" else unit)
            out.append(("parameter", r.get("enabled") is False or unit == "#", "".join(sorted(flag)),
                        str(r.get("group") or "").strip(), str(r.get("name") or "").strip(),
                        str(r.get("value") or "").strip(), str(r.get("comment") or "").strip()))
    return out


def text_of(rows: list) -> str:
    """Rows as LILAK writes them (`lilak par`'s own serializer) — refused if the text
    it writes would not read back as those rows. Its writer drops what it does not
    model (a leading `/` of a Geant4 command, a commented-out include)."""
    # LILAK's own rule on a save (`lilak par` does it too): with LKRun/SearchRun mfm,
    # InputFile is commented out and InputPath made from it.
    rows = _lilak().normalize_searchrun_mfm_rows([dict(r) for r in rows])
    text = _lilak().serialize_rows(rows)
    if _says(parse_all(text)) != _says(rows):
        raise HTTPException(422, "표로 저장하면 이 파일의 내용이 달라집니다. raw 보기에서 고쳐 주세요.")
    return text


BACKUPS = DATA / "backups"
KEEP_BACKUPS = 20
# The page saves as you type, so a save is not a moment worth keeping on its own: the file
# is kept as it was before a run of edits — a save after BURST_S of quiet starts a new one.
BURST_S = 600


def _backup_dir(item_id: str) -> Path:
    return BACKUPS / re.sub(r"[^A-Za-z0-9_.-]", "_", item_id)


def _version(p: Path) -> str:
    return str(p.stat().st_mtime_ns)


def _file(item_id: str, p: Path) -> dict:
    text = p.read_text(encoding="utf-8", errors="replace")
    d = _backup_dir(item_id)
    return {"rows": parse_all(text), "text": text, "version": _version(p),
            "backups": len(list(d.glob("*.mac"))) if d.is_dir() else 0}


def _write(item_id: str, p: Path, text: str, keep: bool = False) -> None:
    """Replace the file, keeping what it held before this run of edits (or always, `keep`),
    the last KEEP_BACKUPS of them."""
    d = _backup_dir(item_id)
    d.mkdir(parents=True, exist_ok=True)
    last = max(d.glob("*.mac"), default=None)
    if keep or last is None or datetime.now().timestamp() - last.stat().st_mtime > BURST_S:
        shutil.copy2(p, d / f"{datetime.now():%Y%m%d-%H%M%S-%f}.mac")
    for old in sorted(d.glob("*.mac"))[:-KEEP_BACKUPS]:
        old.unlink()
    tmp = p.with_name(f".{p.name}.lilak_flow.tmp")
    tmp.write_text(text, encoding="utf-8")
    shutil.copymode(p, tmp)
    os.replace(tmp, p)
    # The run goes on: its quiet is counted from now. (copy2 kept the old file's own time.)
    os.utime(max(d.glob("*.mac")))


_seen: dict = {}     # path → (mtime_ns, what the file holds), so a load reads only what changed


def _holds(p: Path, mtime_ns: int) -> dict:
    hit = _seen.get(p)
    if hit and hit[0] == mtime_ns:
        return hit[1]
    try:
        rows = parse(p.read_text(encoding="utf-8", errors="replace"))
        got = {"count": len(rows),
               "flow": any((r.get("group") or "").split("/")[0] in FLOW_GROUPS for r in rows)}
    except HTTPException:
        got = {"count": 0, "flow": False}         # no LILAK to read it with: still listed
    _seen[p] = (mtime_ns, got)
    return got


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")


def scan(root: str) -> list:
    """Every parameter file under a root, as records."""
    base = ROOTS[root].resolve()
    out = []
    for folder, dirs, files in os.walk(base):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith("."))
        for f in sorted(files):
            p = Path(folder) / f
            if p.suffix != ITEM_SUFFIX or p.is_symlink():
                continue
            rel = p.relative_to(base)
            st = p.stat()
            # lilak/macros/x.mac is LILAK's own; tebat/macros/x.mac is the tebat project's.
            project = rel.parts[0] if len(rel.parts) > 2 or rel.parts[0] != "macros" else root
            out.append({"id": f"{root}:{rel.as_posix()}", "name": p.stem, "path": rel.as_posix(),
                        "project": project if len(rel.parts) > 1 else root,
                        "folder": rel.parent.name if len(rel.parts) > 1 else "",
                        "updated": _day(st.st_mtime), "created": _day(getattr(st, "st_birthtime", st.st_ctime)),
                        **_holds(p, st.st_mtime_ns)})
    return out


DOC = Document(DATA / "data.json", keys=("kept", "settings"), keep_days=30)

app = FastAPI(title="lilak_flow")
DOC.mount(app, project=PROJECT)


def items() -> dict:
    doc = DOC.read()
    kept = {r.get("id"): r for r in doc.get("kept") or []}
    flows = [{**f, **{k: kept.get(f["id"], {}).get(k) or ([] if k == "tags" else "") for k in KEPT}}
             for root in ROOTS for f in scan(root)]
    return {"flows": flows, "settings": doc.get("settings") or {}, "version": doc.get("version")}


@app.get("/api/flow/items")
def get_items(_: dict = Depends(manager)) -> dict:
    return items()


@app.put("/api/flow/items")
def put_items(body: dict = Body(...), me: dict = Depends(manager)):
    """Keep what the page changed about the files: {version, flows: [{id, tags, note}]}.
    A file is never written or removed here."""
    cur = DOC.read()
    if body.get("version") != cur.get("version"):
        return JSONResponse(status_code=409, content=items())
    known = {f["id"] for root in ROOTS for f in scan(root)}
    kept = {r.get("id"): r for r in cur.get("kept") or []}
    for f in body.get("flows") or []:
        if not isinstance(f, dict) or f.get("id") not in known:
            continue
        rec = {"id": f["id"], "tags": [str(t) for t in f.get("tags") or []], "note": str(f.get("note") or "")}
        if rec["tags"] or rec["note"]:
            kept[rec["id"]] = {**kept.get(rec["id"], {}), **rec}
        else:
            kept.pop(rec["id"], None)
    DOC.write({**cur, "kept": list(kept.values())}, me.get("email") or me.get("username") or "", replaces=cur)
    return items()


@app.get("/api/flow/file")
def get_file(id: str, _: dict = Depends(manager)) -> dict:
    """One file to edit: its rows (comments too), its text, and the version a save must name."""
    return _file(id, item_path(id))


@app.put("/api/flow/file")
def put_file(body: dict = Body(...), _: dict = Depends(manager)):
    """Save {id, version, rows} (LILAK's writer) or {id, version, text} (as typed).
    Refused with 409 and the file as it is now if it changed since `version`."""
    item_id = str(body.get("id") or "")
    p = item_path(item_id)
    if str(body.get("version")) != _version(p):
        return JSONResponse(status_code=409, content=_file(item_id, p))
    if isinstance(body.get("text"), str):
        text = body["text"]
    elif isinstance(body.get("rows"), list):
        text = text_of(body["rows"])
    else:
        raise HTTPException(400, "rows 나 text 가 필요합니다.")
    if text != p.read_text(encoding="utf-8", errors="replace"):
        _write(item_id, p, text)
    return _file(item_id, p)


@app.post("/api/flow/restore")
def restore(body: dict = Body(...), _: dict = Depends(manager)) -> dict:
    """Put back the file as it was before the last run of edits."""
    item_id = str(body.get("id") or "")
    p = item_path(item_id)
    d = _backup_dir(item_id)
    last = max(d.glob("*.mac"), default=None) if d.is_dir() else None
    if last is None:
        raise HTTPException(404, "되돌릴 저장본이 없습니다.")
    text = last.read_text(encoding="utf-8", errors="replace")
    last.unlink()
    _write(item_id, p, text, keep=True)     # what it replaces is kept in turn, so twice undoes it
    return _file(item_id, p)


NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.+-]*")
TEMPLATE = Path("meta") / "parameters" / "configure_LKRun.mac"   # what `lilak make_run` starts from
BLANK = "# new lilak run\nLKRun/Name  run\nLKRun/RunID  0\nlilak/run  0\nlilak/auto_exit  1\n"


def new_path(root: str, project: str, folder: str, name: str) -> Path:
    """Where a new file goes: <root>/<project>/<folder>/<name>.mac (the root's own
    project, named after the root, has no folder of its own). An existing project only."""
    base = ROOTS.get(root)
    if base is None:
        raise HTTPException(400, "모르는 root입니다.")
    base = base.resolve()
    name = name[:-len(ITEM_SUFFIX)] if name.endswith(ITEM_SUFFIX) else name
    if not folder.strip("/"):
        raise HTTPException(400, "폴더를 정해 주세요 (예: macros).")
    parts = ([] if project == root else [project]) + [x for x in folder.split("/") if x] + [name]
    if not all(NAME.fullmatch(x) for x in parts) or any(x in SKIP_DIRS for x in parts[:-1]):
        raise HTTPException(400, "프로젝트, 폴더, 이름에는 글자, 숫자, _ . + - 만 쓸 수 있습니다.")
    if project != root and not (base / project).is_dir():
        raise HTTPException(400, f"그런 프로젝트 폴더가 없습니다: {project}")
    p = (base / Path(*parts)).with_name(name + ITEM_SUFFIX)
    if base not in p.resolve().parents:
        raise HTTPException(403, "허용된 폴더 밖의 경로입니다.")
    if p.exists():
        raise HTTPException(409, f"이미 있는 파일입니다: {p.relative_to(base)}")
    return p


@app.post("/api/flow/new")
def new_file(body: dict = Body(...), _: dict = Depends(manager)) -> dict:
    """Make a parameter file: {project, folder, name} and what goes in it —
    {rows} or {text} (a clone, a save-as), {ids} (those files, one after another),
    {template: true} (LILAK's run template), or nothing (a few lines to start from)."""
    root = str(body.get("root") or "lilak")
    p = new_path(root, str(body.get("project") or ""), str(body.get("folder") or ""), str(body.get("name") or ""))
    if isinstance(body.get("text"), str):
        text = body["text"]
    elif isinstance(body.get("rows"), list):
        text = text_of(body["rows"])
    elif isinstance(body.get("ids"), list) and body["ids"]:
        text = "".join(f"# from {str(i).partition(':')[2]}\n{item_path(i).read_text(encoding='utf-8', errors='replace').rstrip()}\n\n"
                       for i in body["ids"])
    else:
        t = ROOTS[root] / TEMPLATE
        text = t.read_text(encoding="utf-8", errors="replace") if body.get("template") and t.is_file() else BLANK
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "x", encoding="utf-8") as f:      # "x": never over a file made meanwhile
        f.write(text)
    return {"id": f"{root}:{p.relative_to(ROOTS[root].resolve()).as_posix()}", "name": p.stem}


@app.post("/api/flow/convert")
def convert(body: dict = Body(...), _: dict = Depends(manager)) -> dict:
    """Between the two views of an unsaved edit: {text} → rows, {rows} → text."""
    if isinstance(body.get("text"), str):
        return {"rows": parse_all(body["text"])}
    return {"text": text_of(body.get("rows") or [])}


@app.get("/api/flow/graph")
def graph(id: str, _: dict = Depends(manager)) -> dict:
    """LILAK's graph of one file. It runs ROOT, so a manager's, like any host read."""
    p = item_path(id)
    mod = _lilak()
    _find_root()
    _pin_nplib()
    try:
        model = mod.build_graph_model(p.read_text(encoding="utf-8", errors="replace"),
                                      path_hint=str(p), source_kind="parameter")
    except Exception as e:
        raise HTTPException(422, f"그래프 생성 실패: {e}")
    return {k: model.get(k) for k in MODEL_KEYS}


# Must stay last: the catch-all would shadow /api/*.
mount_spa(app, DIST, name="lilak_flow")
