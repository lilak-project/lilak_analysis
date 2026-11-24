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
import shlex
import shutil
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from lilak_portal_auth import manager, reach, require_reach
from rackstore.store import Document, mount_spa
import rackstore.browse as browse_kit
from rackstore.lang import mount_lang, say

DATA = Path(os.environ.get("LILAK_FLOW_DATA_DIR", "./data"))
PROJECT = os.environ.get("PORTAL_PROJECT", "")
DIST = Path(os.environ.get("LILAK_FLOW_DIST_DIR", "./dist"))
LILAK_PATH = Path(os.environ.get("LILAK_PATH") or Path.home() / "Research" / "lilak").expanduser()

# Where the files are, by name. An item's id starts with the name, so another
# root (a user's workspace) is one more entry here.
# scratch: a folder everyone in this project shares, outside LILAK's git, for files tried and thrown away.
SCRATCH = (DATA / "scratch").resolve()
SCRATCH.mkdir(parents=True, exist_ok=True)
ROOTS = {"lilak": LILAK_PATH, "scratch": SCRATCH}
ITEM_SUFFIX = ".mac"
SKIP_DIRS = {"build", ".git", "node_modules", "data", "meta"}
FLOW_GROUPS = {"lilak", "LKRun"}          # a file with either is a run: it opens as a flow board
KEPT = ("tags", "note")                   # what the document keeps for a file
MODEL_KEYS = ("nodes", "edges", "class_data", "run_rows", "control_rows", "rows",
              "source_kind", "source_path", "input_file_path")


# LILAK_PATH and the folders the guide browses are outside the portal's data: they are used only
# once this portal's manager has approved them for lilak flow (account menu → Outside paths;
# lilak_portal_auth.reach). The first time one is asked for it is left waiting there.
LILAK_WHY = "LILAK 소스 폴더: 파라미터 파일(.mac) 읽기·고치기, 매크로 실행"


def item_path(item_id: str) -> Path:
    """The file an id (`root:relative/path.mac`) names; refuses anything outside its root."""
    root, _, rel = str(item_id).partition(":")
    base = ROOTS.get(root)
    if base is None or not rel:
        raise HTTPException(400, say("모르는 항목입니다.", "Unknown item."))
    if root == "lilak":
        require_reach(LILAK_PATH, LILAK_WHY)
    base = base.resolve()
    p = (base / rel).resolve()
    if base not in p.parents:
        raise HTTPException(403, say("허용된 폴더 밖의 경로입니다.", "A path outside the allowed folders."))
    if p.suffix != ITEM_SUFFIX:
        raise HTTPException(400, say("파라미터 파일(.mac)만 열 수 있습니다.", "Only parameter files (.mac) open here."))
    if not p.is_file():
        raise HTTPException(404, say(f"파일이 없습니다: {rel}", f"No such file: {rel}"))
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
    require_reach(LILAK_PATH, LILAK_WHY)          # its code runs in this process
    macros = str(LILAK_PATH / "macros")
    if macros not in sys.path:
        sys.path.insert(0, macros)
    try:
        import lilak_configure_flow_editor as mod
    except Exception as e:
        raise HTTPException(503, say(f"LILAK macros를 불러올 수 없습니다: {e}", f"LILAK macros could not be loaded: {e}"))
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
        raise HTTPException(422, say("표로 저장하면 이 파일의 내용이 달라집니다. raw 보기에서 고쳐 주세요.", "Saved as a table this file would change: edit it in the raw view."))
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
    if root == "lilak" and not reach(LILAK_PATH, LILAK_WHY):
        return []
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
            # scratch/a/x.mac is scratch's, whatever its folder.
            project = rel.parts[0] if root == "lilak" and (len(rel.parts) > 2 or rel.parts[0] != "macros") else root
            out.append({"id": f"{root}:{rel.as_posix()}", "name": p.stem, "path": rel.as_posix(),
                        "project": project if len(rel.parts) > 1 else root,
                        "folder": rel.parent.name if len(rel.parts) > 1 else "",
                        "updated": _day(st.st_mtime), "created": _day(getattr(st, "st_birthtime", st.st_ctime)),
                        **_holds(p, st.st_mtime_ns)})
    return out


DOC = Document(DATA / "data.json", keys=("kept", "settings"), keep_days=30)

app = FastAPI(title="lilak_flow")
DOC.mount(app, project=PROJECT)
mount_lang(app)   # a message for a person in the language the page sends (X-Lang)


def items() -> dict:
    doc = DOC.read()
    kept = {r.get("id"): r for r in doc.get("kept") or []}
    flows = [{**f, **{k: kept.get(f["id"], {}).get(k) or ([] if k == "tags" else "") for k in KEPT}}
             for root in ROOTS for f in scan(root)]
    return {"flows": flows, "settings": doc.get("settings") or {}, "version": doc.get("version")}


@app.get("/api/flow/items")
def get_items(_: dict = Depends(manager)) -> dict:
    require_reach(LILAK_PATH, LILAK_WHY)          # says why the list would be empty, and where to approve
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
        raise HTTPException(400, say("rows 나 text 가 필요합니다.", "rows or text is needed."))
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
        raise HTTPException(404, say("되돌릴 저장본이 없습니다.", "No earlier copy to go back to."))
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
        raise HTTPException(400, say("모르는 root입니다.", "Unknown root."))
    if root == "lilak":
        require_reach(LILAK_PATH, LILAK_WHY)
    base = base.resolve()
    name = name[:-len(ITEM_SUFFIX)] if name.endswith(ITEM_SUFFIX) else name
    if not folder.strip("/"):
        raise HTTPException(400, say("폴더를 정해 주세요 (예: macros).", "Name a folder (e.g. macros)."))
    parts = ([] if project == root else [project]) + [x for x in folder.split("/") if x] + [name]
    if not all(NAME.fullmatch(x) for x in parts) or any(x in SKIP_DIRS for x in parts[:-1]):
        raise HTTPException(400, say("프로젝트, 폴더, 이름에는 글자, 숫자, _ . + - 만 쓸 수 있습니다.", "Project, folder and name take letters, digits and _ . + - only."))
    if project != root and not (base / project).is_dir():
        raise HTTPException(400, say(f"그런 프로젝트 폴더가 없습니다: {project}", f"No such project folder: {project}"))
    p = (base / Path(*parts)).with_name(name + ITEM_SUFFIX)
    if base not in p.resolve().parents:
        raise HTTPException(403, say("허용된 폴더 밖의 경로입니다.", "A path outside the allowed folders."))
    if p.exists():
        raise HTTPException(409, say(f"이미 있는 파일입니다: {p.relative_to(base)}", f"That file is there already: {p.relative_to(base)}"))
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
        t = LILAK_PATH / TEMPLATE
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


INCLUDE_FORMATS = ("mac", "conf", "par")


def find_include(here: Path, value: str) -> dict:
    """Where LILAK would find a `<name  value` include (LKParameterContainer::AddFile): e{…}
    from the environment, a leading `!` dropped; /, $, . as given (. from the file's folder,
    where a run starts); else the file's folder, then $LILAK_PATH/common and common/draw_style,
    adding .mac/.conf/.par when there is no such ending. A {reference} or cv{…} cannot be read
    from here: `unknown`. The environment is this server's, which a run may not share."""
    v = str(value or "").strip().split()[0] if str(value or "").strip() else ""
    if not v:
        return {"state": "empty"}
    if "{" in re.sub(r"e\{[^}]*\}", "", v):
        return {"state": "unknown"}

    def env(m):
        name, _, default = m.group(1).partition(":-")
        return os.environ.get(name) or default
    v = re.sub(r"e\{([^}]*)\}", env, v).lstrip("!")
    if not v:
        return {"state": "unknown"}
    if v[0] in "/$.~":
        tries = [Path(os.path.expandvars(os.path.expanduser(v))) if v[0] != "." else here / v]
    else:
        names = [v] if v.endswith(tuple("." + f for f in INCLUDE_FORMATS)) else [f"{v}.{f}" for f in INCLUDE_FORMATS]
        tries = [d / n for d in (here, LILAK_PATH / "common", LILAK_PATH / "common" / "draw_style") for n in names]
    for t in tries:
        if t.is_file():
            t = t.resolve()
            for root, base in ROOTS.items():
                try:
                    rel = t.relative_to(base.resolve())
                except ValueError:
                    continue
                if t.suffix == ITEM_SUFFIX:
                    return {"state": "found", "path": str(t), "id": f"{root}:{rel.as_posix()}"}
            return {"state": "found", "path": str(t)}
    return {"state": "missing", "tried": [str(t) for t in tries]}


@app.get("/api/flow/include")
def include(id: str, value: str, _: dict = Depends(manager)) -> dict:
    """Does a `<` line's file exist, and which file in the list is it (to open it)."""
    return find_include(item_path(id).parent, value)


# A class's header and source, read only: found by name anywhere under LILAK, outside
# its build and data folders. The index is made once and remade when a name is not in it.
CODE_SUFFIX = {"h": (".h", ".hh", ".hpp"), "cpp": (".cpp", ".cc", ".cxx", ".C")}
_code_index: dict = {}


def _index_code() -> dict:
    out: dict = {}
    base = LILAK_PATH.resolve()
    for folder, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            p = Path(folder) / f
            if p.suffix in CODE_SUFFIX["h"] + CODE_SUFFIX["cpp"] and not p.is_symlink():
                out.setdefault(p.stem, []).append(p)
    return out


def find_code(cls: str, kind: str) -> Path | None:
    global _code_index
    if not re.fullmatch(r"[A-Za-z_]\w*", cls or "") or kind not in CODE_SUFFIX:
        return None
    for fresh in (False, True):
        if fresh or not _code_index:
            _code_index = _index_code()
        hits = sorted((p for p in _code_index.get(cls, []) if p.suffix in CODE_SUFFIX[kind] and p.is_file()),
                      key=lambda p: ("/source/" not in str(p), len(str(p))))
        if hits:
            return hits[0]
    return None


@app.get("/api/flow/code")
def code(cls: str, kind: str = "h", _: dict = Depends(manager)) -> dict:
    p = find_code(cls, kind)
    if not p:
        raise HTTPException(404, say(f"{cls}: {kind} 파일을 찾지 못했습니다", f"{cls}: no {kind} file found"))
    return {"path": p.relative_to(LILAK_PATH.resolve()).as_posix(),
            "text": p.read_text(encoding="utf-8", errors="replace")[:2_000_000]}


RUN_GROUPS = {"", "lilak", "LKRun", "persistency"}   # the Run card's


@app.get("/api/flow/classpars")
def class_pars(cls: str, _: dict = Depends(manager)) -> dict:
    """The parameters class `cls` can take: its template (meta/parameters/configure_<cls>.mac, with
    value and comment; the groups of the helpers it makes too, LKFrameBuilder for the merger) and the
    `"<cls>/<name>"` its header and source read (name only). The run card's groups stay the run card's."""
    if not re.fullmatch(r"[A-Za-z_]\w*", cls):
        raise HTTPException(400, say("클래스 이름이 아닙니다", "Not a class name"))
    out, seen = [], set()
    tpl = LILAK_PATH / "meta" / "parameters" / f"configure_{cls}.mac"
    if tpl.is_file():
        for r in parse_all(tpl.read_text(encoding="utf-8", errors="replace")):
            g = r.get("group") or ""
            if r.get("kind") == "parameter" and g not in RUN_GROUPS and (g, r.get("name")) not in seen:
                seen.add((g, r["name"]))
                out.append({"group": g, "name": r["name"], "value": r.get("value") or "", "comment": r.get("comment") or "", "from": "template"})
    rx = re.compile(r'"' + re.escape(cls) + r'/(\w+)"')
    for kind in ("h", "cpp"):
        f = find_code(cls, kind)
        for name in rx.findall(f.read_text(encoding="utf-8", errors="replace")) if f else []:
            if (cls, name) not in seen:
                seen.add((cls, name))
                out.append({"group": cls, "name": name, "value": "", "comment": "", "from": "source"})
    return {"pars": out}


# What `lilak/add` can take: the classes under LILAK whose header makes them a task or a detector.
_kinds = {"tasks": re.compile(r"class\s+\w+\s*:\s*public\s+LKTask\b"),
          "detectors": re.compile(r"class\s+\w+\s*:\s*public\s+LKDetector\b")}


@app.get("/api/flow/classes")
def classes(_: dict = Depends(manager)) -> dict:
    global _code_index
    _code_index = _index_code()
    out = {k: [] for k in _kinds}
    for stem, paths in sorted(_code_index.items()):
        for p in paths:
            if p.suffix in CODE_SUFFIX["h"]:
                text = p.read_text(encoding="utf-8", errors="replace")
                for k, rx in _kinds.items():
                    if rx.search(text) and stem not in out[k]:
                        out[k].append(stem)
    return out


ENV_RX = re.compile(r"e\{([A-Za-z_]\w*)")
_env_lock = threading.Lock()


def init_values(stdout: str) -> list:
    """The `# Parameters` block LKRun::Print writes after Init: [[group/name, value], ...], in order."""
    s = re.sub(r"\x1b\[[0-9;]*m", "", stdout)
    m = re.search(r"# Parameters\n(.*?)(?:\n\s*\n|\Z)", s, re.S)
    if not m:
        return []
    return [[k, v.strip()] for k, _, v in (line.strip().partition(" ") for line in m.group(1).splitlines()) if k]


@app.post("/api/flow/init")
def init(body: dict = Body(...), _: dict = Depends(manager)) -> dict:
    """The file's parameters as LILAK holds them after Init (a dry one: no output, no log kept),
    includes read, references and conditions applied. `env` sets e{…} for this run only."""
    p = item_path(body.get("id"))
    env = {k: str(v) for k, v in (body.get("env") or {}).items() if re.fullmatch(r"[A-Za-z_]\w*", k) and str(v)}
    _lilak()
    _find_root()
    _pin_nplib()
    import lilak_parameter_editor as pe
    # ponytail: one Init at a time, since the run's environment is this process's; a per-run env if they queue up.
    with _env_lock:
        was = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            r = pe.run_root_macro_with_parameter(p.read_text(encoding="utf-8", errors="replace") + "\nlilak/print par\n",
                                                 str(p), set_print_plane=0, set_allow_run=0, dry_init=1)
        finally:
            for k, v in was.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
    pars = init_values(r.get("stdout", ""))
    return {"pars": pars, "returncode": r.get("returncode", 0),
            "tail": "" if pars else (r.get("stdout", "")[-3000:] + "\n" + r.get("stderr", "")[-2000:])}


_readers: dict = {}


def reads_input(cls: str) -> bool:
    """A task that opens the run's input files itself (LKGETConversionTask, the frame merger...):
    its source asks LKRun for them."""
    if cls not in _readers:
        src = find_code(cls, "cpp")
        _readers[cls] = bool(src) and bool(re.search(r"InputFileNameArray|GetNumInputFiles|GetInputFileName",
                                                      src.read_text(encoding="utf-8", errors="replace")))
    return _readers[cls]


def _at(here: Path, name: str) -> dict:
    """A file LILAK names, and whether it is there (a run starts in the macro's folder)."""
    q = Path(os.path.expandvars(os.path.expanduser(name)))
    q = q if q.is_absolute() else here / q
    st = q.stat() if q.is_file() else None
    return {"path": name, "exists": q.exists(), "full": str(q),
            "size": st.st_size if st else None, "mtime": st.st_mtime if st else None}


def _atoi(t: str) -> int:
    """TString::Atoi: the leading digits (LILAK reads run_NNNN's number from its 6th character on)."""
    m = re.match(r"\d+", t)
    return int(m.group()) if m else 0


def search_mfm(paths: list, run: int) -> list:
    """LKRun::SearchRunFiles with `mfm`: run_NNNN… files in the input paths, not their sidecars."""
    out = []
    for d in paths:
        try:
            names = sorted(os.listdir(d))
        except OSError:
            continue
        for f in names:
            if f.startswith("run_") and ".mfm_event_index" not in f and ".mfm_event_ranges.json" not in f \
                    and not os.path.isdir(os.path.join(d, f)) and _atoi(f[5:9]) == run:
                out.append(os.path.join(d, f))
    return out


def files_of(here: Path, stdout: str) -> dict:
    """What the graph's dry Init says of the run's files: the inputs it opened (or could not),
    an mfm search, the output it would write, and the input's entries."""
    s = re.sub(r"\x1b\[[0-9;]*m", "", stdout or "")
    inputs = [_at(here, m.strip()) for m in re.findall(r"Input file : (.+)", s)]
    inputs += [{"path": m.strip(), "exists": False} for m in re.findall(r"Given input file does not exist! (.+)", s)]
    looks = re.findall(r"Looking for (\d+)\((\w+)\) in (.+)", s)
    search = None
    if looks:
        run, tag = int(looks[0][0]), looks[0][1]
        paths = [str((here / q.strip()) if not Path(q.strip()).is_absolute() else q.strip()) for _, _, q in looks]
        # What LILAK itself found (its "Found …" lines): with `SearchRun mfm recursive` it looked below the
        # paths too, which a search here of the paths alone would miss. Its own words when it said any.
        said = [m.strip() for m in re.findall(r"SearchRunFiles\] \w+> Found (.+)", s)]
        search = {"tag": tag, "run": run, "paths": paths, "found": said or (search_mfm(paths, run) if tag == "mfm" else [])}
        search["files"] = [_at(here, f) for f in search["found"]]
    out = re.search(r"Dry init: output file would be (.+?) \(not written\)", s)
    entries = re.search(r"(\d+) input entries", s)
    return {"inputs": inputs, "search": search, "output": _at(here, out.group(1)) if out else None,
            "entries": int(entries.group(1)) if entries else None,
            "error": " · ".join(m.strip() for m in re.findall(r"(Search failed with tag .+|Input file do not exist!)", s))}


# A drawn graph, kept while nothing it was drawn from has changed: the file, the files it
# includes (and theirs), and LILAK's library. What lies outside those (input data appearing,
# the environment) shows on the board's Reload, which always draws anew.
_graphs: dict = {}
GRAPHS_KEPT = 64


def graph_key(p: Path) -> tuple:
    seen, todo, key = set(), [p], []
    while todo:
        f = todo.pop()
        if f in seen or not f.is_file():
            continue
        seen.add(f)
        key.append((str(f), f.stat().st_mtime_ns))
        try:
            rows = parse_all(f.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        for r in rows:
            if r.get("kind") == "parameter" and ("<" in str(r.get("unit") or "") or (r.get("flags") or {}).get("include")):
                got = find_include(f.parent, r.get("value"))
                if got.get("path"):
                    todo.append(Path(got["path"]))
    lib = LILAK_PATH / "build" / ("libLILAK.dylib" if sys.platform == "darwin" else "libLILAK.so")
    key.append(("lib", lib.stat().st_mtime_ns if lib.exists() else 0))
    return tuple(sorted(key))


@app.get("/api/flow/graph")
def graph(id: str, fresh: bool = False, _: dict = Depends(manager)) -> dict:
    """LILAK's graph of one file. It runs ROOT, so a manager's, like any host read.
    Kept (graph_key) unless `fresh`."""
    p = item_path(id)
    key = graph_key(p)
    if not fresh and _graphs.get(id, (None,))[0] == key:
        return {**_graphs[id][1], "files": checked(_graphs[id][1].get("files"))}
    out = _draw(p)
    _graphs.pop(id, None)
    _graphs[id] = (key, out)
    while len(_graphs) > GRAPHS_KEPT:
        _graphs.pop(next(iter(_graphs)))
    return {**out, "files": checked(out.get("files"))}


def checked(files: dict | None) -> dict | None:
    """The run's files as they are now (a kept graph's may be old): each input, each folder the mfm
    search looks in, the output and the folder it goes in, there or not."""
    if not files:
        return files
    now = lambda f: {**f, **_at(Path("/"), f.get("full") or f["path"])} if f.get("full") else f
    out = {**files, "inputs": [now(f) for f in files.get("inputs") or []]}
    if files.get("search"):
        out["search"] = {**files["search"], "dirs": [{"path": d, "exists": os.path.isdir(d)} for d in files["search"]["paths"]]}
    if files.get("output"):
        o = now(files["output"])
        d = str(Path(o.get("full") or o["path"]).parent)
        out["output"], out["outdir"] = o, {"path": d, "exists": os.path.isdir(d)}
    return out


def _draw(p: Path) -> dict:
    mod = _lilak()
    _find_root()
    _pin_nplib()
    try:
        # `lilak/print par` after the dry Init: the values as LILAK holds them (e{…}, {refs} resolved).
        model = mod.build_graph_model(p.read_text(encoding="utf-8", errors="replace") + "\nlilak/print par\n",
                                      path_hint=str(p), source_kind="parameter")
    except Exception as e:
        raise HTTPException(422, say(f"그래프 생성 실패: {e}", f"Drawing the graph failed: {e}"))
    out = {k: model.get(k) for k in MODEL_KEYS}
    last = max([r.get("line_no") or 0 for r in out.get("rows") or []], default=0)
    for k in ("rows", "control_rows", "run_rows"):   # the added last line is not the file's
        if out.get(k):
            out[k] = [r for r in out[k] if not (r.get("raw") == "lilak/print par" and r.get("line_no") == last)]
    out["init"] = init_values(((model.get("report") or {}).get("configure_log") or {}).get("stdout", ""))
    out["files"] = files_of(p.parent, ((model.get("report") or {}).get("configure_log") or {}).get("stdout", ""))
    # The run's tasks that read the input file itself (an mfm, not a branch): the input card's lines go to them.
    out["files"]["readers"] = [n.get("class_name") for n in out.get("nodes") or []
                               if n.get("kind") == "class" and reads_input(n.get("class_name") or "")]
    # The groups each class's template holds besides its own (the helpers it makes: LKFrameBuilder for the
    # merger): they are that card's, not Others'.
    out["helpers"] = {}
    for n in out.get("nodes") or []:
        cls = n.get("class_name") or ""
        if n.get("kind") == "class" and re.fullmatch(r"[A-Za-z_]\w*", cls):
            tpl = LILAK_PATH / "meta" / "parameters" / f"configure_{cls}.mac"
            if tpl.is_file():
                gs = {r.get("group") for r in parse_all(tpl.read_text(encoding="utf-8", errors="replace"))
                      if r.get("kind") == "parameter" and r.get("group")}
                out["helpers"][cls] = sorted(g for g in gs if g != cls and g not in RUN_GROUPS)
    # The e{…} this file names, with this server's value (an Init here sees that one).
    names = sorted({n for r in out.get("rows") or [] for n in ENV_RX.findall(str(r.get("value") or ""))})
    out["env"] = {n: os.environ.get(n, "") for n in names}
    return out


# Init and run, here (not on jobboard): the run goes on in the background, the page asks how it is
# and writes the outcome to the set's logbook. jobrun/lilak_run.py makes the command (root in a login
# shell, from the file's folder), as it did for the jobboard recipes.
RUNNER = Path(__file__).resolve().parent.parent / "jobrun" / "lilak_run.py"
_runs: dict = {}
# Lines that mean the Init or run went wrong though root ended 0 (LILAK's own messages, ROOT's errors).
BAD_RX = re.compile(r"^.*(?:\bError\b|\bERROR\b|[Ff]ailed|does not exist|Segmentation|\*\*\* Break).*$", re.M)

HARMLESS_RX = re.compile(r"TGeoManager::SetMaxThreads")   # ROOT says it on every LILAK start


@app.post("/api/flow/exec")
def exec_start(body: dict = Body(...), _: dict = Depends(manager)) -> dict:
    p, mode = item_path(body.get("id")), str(body.get("mode") or "")
    if mode not in ("init", "run"):
        raise HTTPException(400, say("init이나 run만 됩니다.", "Only init or run."))
    for r in _runs.values():
        if r["id"] == body.get("id") and r["proc"].poll() is None:
            raise HTTPException(409, say("이 파일은 이미 돌고 있습니다.", "This file is running already."))
    rid = datetime.now().strftime("%Y%m%d-%H%M%S-") + os.urandom(3).hex()
    out = DATA / "runs"
    out.mkdir(parents=True, exist_ok=True)
    log = out / f"{rid}.log"
    # LILAK opens (and so empties) the output already in Init: kept aside for either.
    backup = backup_output(str(body.get("id")))
    _find_root()
    proc = subprocess.Popen([sys.executable, str(RUNNER), str(p), mode], stdout=log.open("w"), stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, env={**os.environ, "LILAK_PATH": str(LILAK_PATH), "LILAK_RUN_ROOTS": str(SCRATCH)})
    _runs[rid] = {"id": body.get("id"), "mode": mode, "log": log, "proc": proc, "start": datetime.now(timezone.utc), "backup": backup}
    return {"rid": rid, "backup": backup}


def put_back(r: dict) -> None:
    """An Init is over: the output it kept aside goes back (LILAK made an empty one in its place)."""
    b = Path(r.get("backup") or "")
    if r["mode"] == "init" and b.is_file():
        b.replace(b.with_name(b.name.split(".bak-")[0] + ".root"))
    r["backup"] = ""


def run_state(r: dict) -> dict:
    rc = r["proc"].poll()
    if rc is not None and r.get("backup"):
        put_back(r)
    text = r["log"].read_text(errors="replace") if r["log"].exists() else ""
    bad = [m.strip() for m in BAD_RX.findall(re.sub(r"\x1b\[[0-9;]*m", "", text)) if not HARMLESS_RX.search(m)][:20]
    return {"done": rc is not None, "returncode": rc, "ok": rc == 0 and not bad, "errors": bad,
            "seconds": round((datetime.now(timezone.utc) - r["start"]).total_seconds()), "tail": text[-60000:],
            **events_of(text)}


def events_of(text: str) -> dict:
    """How far LKRun got: `events` executed (its every-Nth "Execute Event i" while it runs, "End of Run
    a -> b (n)" once over) of `total` (its input entries; none for a task that makes its own events)."""
    end = re.findall(r"End of Run -?\d+ -> -?\d+ \((\d+)\)", text)
    ex = re.findall(r"Execute Event (\d+)", text)
    total = re.findall(r"(\d+) input entries", text)
    return {"events": int(end[-1]) if end else int(ex[-1]) + 1 if ex else None,
            "total": int(total[-1]) or None if total else None}


@app.get("/api/flow/runheader")
def run_header(out: str, _: dict = Depends(manager)) -> dict:
    """The RunHeader LILAK wrote with output `out` (LILAK_PATH/data/log/run_<name>.log, the same
    parameters the file keeps as RunHeader), and the output as it is now."""
    # ponytail: the log of the last run that wrote this name, read without root; read the file's own
    # RunHeader (root) if a log and its .root can part.
    name = Path(out).name.removesuffix(".root")
    if not re.fullmatch(r"[\w.\-]+", name):
        raise HTTPException(400, say("출력 파일 이름이 아닙니다", "Not an output file name"))
    log = LILAK_PATH / "data" / "log" / f"run_{name}.log"
    rows = []
    if log.is_file():
        for line in re.sub(r"\x1b\[[0-9;]*m", "", log.read_text(errors="replace")).splitlines():
            m = re.match(r"(\S+)\s*(.*)$", line.strip())
            if m:
                rows.append([m.group(1), m.group(2).strip()])
    # Only the log of this very output: one of another run with the same name (run_0000) is not it.
    said = next((v for k, v in rows if k == "OutputFile"), "")
    if not Path(out).is_file() or os.path.realpath(said) != os.path.realpath(out):
        rows = []
    return {"file": _at(Path("/"), out), "log": str(log) if rows else "", "rows": rows}


# What the guide may browse, make folders in and link to: the rack's browsing tab (rackstore.browse:
# settings.roots, each one the portal approved for this service), mounted as /api/browse.
ROOTS_WHY = "lilak flow가 둘러보고 출력 폴더를 만드는 곳"
roots = lambda: browse_kit.roots(DOC, ROOTS_WHY)
_under = browse_kit.under
_in_roots = lambda path: browse_kit.in_roots(DOC, path, ROOTS_WHY)
browse_kit.mount_browse(app, DOC, ROOTS_WHY)


@app.post("/api/flow/outdir")
def out_dir(body: dict = Body(...), _: dict = Depends(manager)) -> dict:
    """The output's folder, missing: {id, make: true} makes it, {id, link: <folder>} puts a link
    there to a folder that is (both in the allowed folders, roots()). The run's files as they are after."""
    files = checked((_graphs.get(str(body.get("id")), (None, {}))[1] or {}).get("files")) or {}
    # The guide names the folder itself (as the file will say it, relative to the file's folder).
    d = str(_near(str(body["id"]), str(body["path"]))) if body.get("path") else (files.get("outdir") or {}).get("path")
    if not d:
        raise HTTPException(400, say("보드를 먼저 열어 주세요 (출력 폴더를 모릅니다).", "Open the board first (the output folder is not known yet)."))
    if os.path.lexists(d):
        raise HTTPException(409, say(f"이미 있습니다: {d}", f"There already: {d}"))
    q = _in_roots(d)
    if body.get("link"):
        to = _in_roots(str(body["link"]))
        if not to.is_dir():
            raise HTTPException(400, say(f"링크할 폴더가 없습니다: {to}", f"No folder to link to: {to}"))
        q.parent.mkdir(parents=True, exist_ok=True)
        q.symlink_to(to, target_is_directory=True)
    elif body.get("make"):
        q.mkdir(parents=True)
    else:
        raise HTTPException(400, say("make 나 link 가 필요합니다.", "make or link is needed."))
    return checked(files)


def _near(item_id: str, path: str) -> Path:
    """A path as a run of this file reads it: relative ones from the file's own folder ($VARS, ~ too)."""
    q = Path(os.path.expandvars(os.path.expanduser(path)))
    return q if q.is_absolute() else item_path(item_id).parent / q


@app.post("/api/flow/check")
def check_paths(body: dict = Body(...), _: dict = Depends(manager)) -> dict:
    """Are these there, as a run of file `id` reads them: {files: [...], dirs: [...]} → each {path, full, exists, size, mtime}."""
    item = str(body.get("id"))
    at = lambda x, d: {**_at(Path("/"), str(_near(item, x))), "path": x, "dir": d,
                       "exists": (os.path.isdir if d else os.path.isfile)(_near(item, x))}
    return {"files": [at(x, False) for x in body.get("files") or []], "dirs": [at(x, True) for x in body.get("dirs") or []]}


def search_tag(paths: list, run: int, name: str, tag: str) -> list:
    """LKRun::SearchRunFiles with a root tag: <Name>_<run, 4 digits>….<tag>.root in the input paths."""
    out = []
    for d in paths:
        try:
            names = sorted(os.listdir(d))
        except OSError:
            continue
        for f in names:
            if f.startswith(name + "_") and f.endswith(tag + ".root") and _atoi(f[len(name) + 1:len(name) + 5]) == run:
                out.append(os.path.join(d, f))
    return out


@app.post("/api/flow/searchcheck")
def search_check(body: dict = Body(...), _: dict = Depends(manager)) -> dict:
    """What a SearchRun would find: {id, tag (mfm or a root tag), paths, runs, name} → {runs: {run: [files]}, dirs}."""
    item, tag, name = str(body.get("id")), str(body.get("tag") or "mfm"), str(body.get("name") or "")
    paths = [str(_near(item, x)) for x in body.get("paths") or [] if str(x).strip()]
    runs = [int(r) for r in body.get("runs") or []][:2000]
    look = lambda ps, r: search_mfm(ps, r) if tag == "mfm" else search_tag(ps, r, name, tag)

    def below(x: str) -> list:
        """x and every folder under it, as LILAK's `SearchRun mfm recursive` walks (no hidden ones, not through links)."""
        out = []
        for d, subs, _files in os.walk(x, followlinks=False):
            subs[:] = sorted(s for s in subs if not s.startswith(".") and not os.path.islink(os.path.join(d, s)))
            out.append(d)
        return out
    if body.get("recursive") and tag == "mfm":
        walked = [d for x in paths if os.path.isdir(x) for d in below(x)]
        # LILAK leaves empty files out when it walks (GANIL's ACTIONS_ … are empty).
        found = {str(r): [f for f in look(walked, r) if os.path.getsize(f) > 0] for r in runs}
        return {"runs": found, "dirs": [{"path": x, "exists": os.path.isdir(x)} for x in paths], "deeper": {}}
    found = {str(r): look(paths, r) for r in runs}
    # LILAK looks only right inside each folder: where one holds none, the folders below it that do
    # (acquisition/run → cobo0, cobo1, mutant), which the guide writes as the InputPaths instead.
    # One level below (the folders just inside, not through links, hidden ones left out): the guide adds
    # the ones holding the runs as InputPaths of their own.
    deeper = {}
    for x in paths:
        if os.path.isdir(x) and not any(look([x], r) for r in runs[:50]):
            subs = sorted(os.path.join(x, e.name) for e in os.scandir(x)
                          if e.is_dir(follow_symlinks=False) and not e.name.startswith("."))
            hit = [d for d in subs if any(look([d], r) for r in runs[:50])]
            if hit:
                deeper[x] = hit
    return {"runs": found, "dirs": [{"path": x, "exists": os.path.isdir(x)} for x in paths], "deeper": deeper}


PRINT_PARS = RUNNER.parent / "print_pars.C"
_outpars: dict = {}


@app.get("/api/flow/outpars")
def out_pars(out: str, _: dict = Depends(manager)) -> dict:
    """The parameters an output file was made with (its ParameterContainer, read with root), kept
    while the file is unchanged: [[name, value]], in its order."""
    p = Path(out)
    if p.suffix != ".root" or not p.is_file() or re.search(r'["\\$`]', out):
        raise HTTPException(400, say("출력 .root 파일이 아닙니다", "Not an output .root file"))
    key = (str(p.resolve()), p.stat().st_mtime_ns)
    if key not in _outpars:
        call = f'{PRINT_PARS}("{p.resolve()}")'
        _find_root()
        r = subprocess.run(["/bin/zsh", "-lc", f"root -l -b -q {shlex.quote(call)}"], capture_output=True, text=True,
                           timeout=60, stdin=subprocess.DEVNULL)
        text = re.sub(r"\x1b\[[0-9;]*m", "", r.stdout)
        if "LILAK_FLOW_NO_PARAMETERS" in text:
            return {"pars": [], "error": "ParameterContainer가 없습니다"}
        pars = [[m.group(1), m.group(2).strip()] for line in text.splitlines()
                if (m := re.match(r"([A-Za-z_][\w]*/[^\s]+)\s*(.*)$", line.strip()))]
        _outpars.clear()   # ponytail: one kept, the file looked at last; a dict per file if several are compared
        _outpars[key] = pars
    return {"pars": _outpars[key]}


def backup_output(item_id: str) -> str:
    """Before a Run writes over its output: the one there is renamed name.bak-<when>.root beside it."""
    files = checked((_graphs.get(item_id, (None, {}))[1] or {}).get("files")) or {}
    o = files.get("output") or {}
    p = Path(o.get("full") or "")
    if not o.get("exists") or p.suffix != ".root" or not p.is_file():
        return ""
    to = p.with_name(f"{p.stem}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}.root")
    p.rename(to)
    return str(to)


@app.get("/api/flow/exec/{rid}")
def exec_state(rid: str, _: dict = Depends(manager)) -> dict:
    r = _runs.get(rid)
    if not r:
        raise HTTPException(404, say("모르는 실행입니다 (서비스가 다시 시작되었을 수 있습니다).", "Unknown run (the service may have restarted)."))
    return run_state(r)


# Must stay last: the catch-all would shadow /api/*.
mount_spa(app, DIST, name="lilak_flow")
