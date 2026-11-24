"""The files are the items, and an id can never leave its root. Run: python backend/test_flow.py"""
import os
import sys
import tempfile
import types
from pathlib import Path

root = Path(tempfile.mkdtemp()).resolve()
os.environ["LILAK_PATH"] = str(root)
os.environ["LILAK_FLOW_DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parent))

# LILAK's parser, stood in for: one parameter a line, `group/name value`.
fake = types.ModuleType("lilak_configure_flow_editor")
fake.parse_parameter_text = lambda text: [
    {"kind": "parameter", "group": ln.split()[0].rpartition("/")[0].lstrip("/"), "name": ln.split()[0].rpartition("/")[2],
     "value": " ".join(ln.split()[1:])}
    for ln in text.splitlines() if ln.strip()]
fake.normalize_searchrun_mfm_rows = lambda rows: rows
fake.serialize_rows = lambda rows: "".join(
    f"{r['group'].strip('/') + '/' if r.get('group') else ''}{r['name']}  {r.get('value', '')}".rstrip() + "\n" for r in rows)
sys.modules["lilak_configure_flow_editor"] = fake

from fastapi import HTTPException   # noqa: E402
from fastapi.testclient import TestClient   # noqa: E402
from lilak_portal_auth import manager   # noqa: E402
import main   # noqa: E402

for d in ("tebat/macros", "macros", "build", "data/log"):
    (root / d).mkdir(parents=True)
(root / "tebat/macros/reco.mac").write_text("lilak/add T\nLKRun/RunName tebat\nT/x 1\n")
(root / "tebat/macros/only.mac").write_text("T/x 1\n")
(root / "macros/base.mac").write_text("")
(root / "tebat/macros/notes.txt").write_text("x")
(root / "build/skip.mac").write_text("x")
(root / "data/log/skip.mac").write_text("x")
(root.parent / "outside.mac").write_text("x")
(root / "tebat/link.mac").symlink_to(root.parent / "outside.mac")


def refused(item_id, code):
    try:
        main.item_path(item_id)
    except HTTPException as e:
        assert e.status_code == code, (item_id, e.status_code)
        return
    raise AssertionError(f"{item_id} was let through")


assert main.item_path("lilak:tebat/macros/reco.mac") == root / "tebat/macros/reco.mac"
refused("lilak:../outside.mac", 403)
refused(f"lilak:{root.parent / 'outside.mac'}", 403)
refused("lilak:tebat/link.mac", 403)      # a symlink out is still out
refused("lilak:tebat/macros/notes.txt", 400)
refused("lilak:tebat/macros/gone.mac", 404)
refused("elsewhere:tebat/macros/reco.mac", 400)
refused("tebat/macros/reco.mac", 400)

got = {f["id"]: f for f in main.scan("lilak")}
assert sorted(got) == ["lilak:macros/base.mac", "lilak:tebat/macros/only.mac", "lilak:tebat/macros/reco.mac"], sorted(got)
reco = got["lilak:tebat/macros/reco.mac"]
assert (reco["project"], reco["folder"], reco["name"], reco["count"], reco["flow"]) == ("tebat", "macros", "reco", 3, True)
assert got["lilak:tebat/macros/only.mac"]["flow"] is False
assert got["lilak:macros/base.mac"]["project"] == "lilak"

# Tags and a note are kept beside the file; the file itself is never touched.
c = TestClient(main.app)
assert c.get("/api/flow/items").status_code == 401
main.app.dependency_overrides[manager] = lambda: {"email": "t@t"}
doc = c.get("/api/flow/items").json()
before = (root / "tebat/macros/reco.mac").read_text()
put = lambda flows, version: c.put("/api/flow/items", json={"version": version, "flows": flows})   # noqa: E731
r = put([{"id": "lilak:tebat/macros/reco.mac", "tags": ["tebat"], "note": "first"},
         {"id": "lilak:../outside.mac", "tags": ["x"]}], doc["version"])
assert r.status_code == 200, r.text
now = {f["id"]: f for f in r.json()["flows"]}
assert now["lilak:tebat/macros/reco.mac"]["tags"] == ["tebat"] and now["lilak:tebat/macros/reco.mac"]["note"] == "first"
assert len(main.DOC.read()["kept"]) == 1, "an id that is no file is not kept"
assert put([{"id": "lilak:macros/base.mac", "note": "late"}], doc["version"]).status_code == 409
assert (root / "tebat/macros/reco.mac").read_text() == before

# Editing a file: saved through LILAK's writer, the old text kept, a stale save refused.
ID = "lilak:tebat/macros/only.mac"
f = c.get("/api/flow/file", params={"id": ID}).json()
assert [r["name"] for r in f["rows"]] == ["x"] and f["backups"] == 0
edit = lambda **k: c.put("/api/flow/file", json={"id": ID, **k})   # noqa: E731
rows2 = [{**f["rows"][0], "value": "2"}, {"kind": "parameter", "group": "T", "name": "y", "value": "3"}]
g = edit(version=f["version"], rows=rows2)
assert g.status_code == 200 and (root / "tebat/macros/only.mac").read_text() == "T/x  2\nT/y  3\n", g.text
assert g.json()["backups"] == 1
assert edit(version=f["version"], rows=rows2).status_code == 409, "the version it read is gone"
# The writer would drop this leading slash: refused, and the file is as it was.
bad = edit(version=g.json()["version"], rows=[{"kind": "parameter", "group": "/vis", "name": "open", "value": "OGL"}])
assert bad.status_code == 422 and (root / "tebat/macros/only.mac").read_text() == "T/x  2\nT/y  3\n"
raw = edit(version=g.json()["version"], text="/vis/open OGL\n")
assert raw.status_code == 200 and (root / "tebat/macros/only.mac").read_text() == "/vis/open OGL\n"
# The copy carries the time of the save, not the old file's own (copy2 keeps that).
os.utime(root / "tebat/macros/reco.mac", (1, 1))
r0 = c.get("/api/flow/file", params={"id": "lilak:tebat/macros/reco.mac"}).json()
for v in ("a", "b"):
    r0 = c.put("/api/flow/file", json={"id": "lilak:tebat/macros/reco.mac", "version": r0["version"], "text": f"lilak/add {v}\n"}).json()
assert r0["backups"] == 1, r0["backups"]
# Saves a moment apart are one run of edits: one copy, of the file before the run.
assert raw.json()["backups"] == 1
back = c.post("/api/flow/restore", json={"id": ID})
assert back.status_code == 200 and (root / "tebat/macros/only.mac").read_text() == "T/x 1\n", back.text
assert back.json()["backups"] == 1, "what the restore replaced is kept"
assert c.post("/api/flow/restore", json={"id": ID}).json()["text"] == "/vis/open OGL\n", "twice undoes it"
assert c.put("/api/flow/file", json={"id": "lilak:../outside.mac", "version": "0", "text": "x"}).status_code == 403
assert (root.parent / "outside.mac").read_text() == "x"
assert c.post("/api/flow/convert", json={"text": "A/b 1\n"}).json()["rows"][0]["group"] == "A"

# A new file: in an existing project, never over another, never outside.
new = lambda **k: c.post("/api/flow/new", json=k)   # noqa: E731
made = new(project="tebat", folder="macros", name="fresh", rows=[{"kind": "parameter", "group": "T", "name": "z", "value": "9"}])
assert made.status_code == 200 and made.json()["id"] == "lilak:tebat/macros/fresh.mac", made.text
assert (root / "tebat/macros/fresh.mac").read_text() == "T/z  9\n"
assert new(project="tebat", folder="macros", name="fresh").status_code == 409
assert new(project="tebat", folder="macros2", name="blank.mac").status_code == 200 and (root / "tebat/macros2/blank.mac").read_text() == main.BLANK
assert new(project="lilak", folder="macros", name="own").status_code == 200 and (root / "macros/own.mac").is_file()
both = new(project="tebat", folder="macros", name="both", ids=["lilak:tebat/macros/fresh.mac", "lilak:macros/base.mac"])
assert both.status_code == 200 and (root / "tebat/macros/both.mac").read_text().startswith("# from tebat/macros/fresh.mac\nT/z  9\n\n# from macros/base.mac")
for bad in (dict(project="nope", folder="macros", name="a"), dict(project="tebat", folder="..", name="a"),
            dict(project="tebat", folder="macros", name="../a"), dict(project="tebat", folder="", name="a"),
            dict(project="..", folder="x", name="a"), dict(project="tebat", folder="build", name="a"),
            dict(project="tebat", folder="macros", name="a b")):
    assert new(**bad).status_code == 400, bad
assert new(project="tebat", folder="macros", name="m", ids=["lilak:../outside.mac"]).status_code == 403
print("flow: ok")

# Commented out is one meaning however it is held: LILAK's `#<` read back, or the editor's
# enabled false + unit `<` — so a table save of a commented-out include goes through.
held = {"kind": "parameter", "group": "a", "name": "b", "value": "1"}
assert main._says([{**held, "unit": "#", "flags": {"include": True}}]) == main._says([{**held, "enabled": False, "unit": "<"}])
assert main._says([{**held, "unit": "#"}]) == main._says([{**held, "enabled": False, "unit": ""}])
assert main._says([{**held, "unit": "#", "flags": {"include": True}}]) != main._says([{**held, "unit": "#"}])
print("says ok")

# A `<` line's file, found the way LILAK's AddFile looks.
inc = root / "tebat/macros"
(inc / "sub.mac").write_text("A/x  1\n")
(root / "common").mkdir(exist_ok=True)
(root / "common" / "style.conf").write_text("s 1\n")
here = inc
assert main.find_include(here, "sub.mac")["id"] == "lilak:tebat/macros/sub.mac", "beside the file, openable"
assert main.find_include(here, "sub")["id"] == "lilak:tebat/macros/sub.mac", "the ending added"
assert main.find_include(here, "style")["state"] == "found" and "id" not in main.find_include(here, "style"), "from common, not a .mac"
assert main.find_include(here, "nope.mac")["state"] == "missing"
assert main.find_include(here, "{ref}.mac")["state"] == "unknown"
os.environ["FLOW_T"] = "sub"
assert main.find_include(here, "e{FLOW_T}.mac")["state"] == "found"
assert main.find_include(here, "e{FLOW_NONE:-sub}")["state"] == "found", "e{NAME:-default}"
assert main.find_include(here, "./sub.mac")["state"] == "found" and main.find_include(here, "!sub.mac")["state"] == "found"
print("include ok")

# LKRun::Print's block after Init, colours and all; it ends at the blank line.
out = "[LKRun::Print] \x1b[0;32minfo> \x1b[0m# Parameters\nLKRun/Name                    atomx\nT/mode   xy, zy\nlilak/add   A\n\n[LKRun::Print] List of tasks\n"
assert main.init_values(out) == [["LKRun/Name", "atomx"], ["T/mode", "xy, zy"], ["lilak/add", "A"]]
assert main.init_values("no block") == []
assert main.ENV_RX.findall("e{DATA}/x e{N:-1}") == ["DATA", "N"]
print("init ok")

# The run's files, from a dry Init's words.
d = Path(tempfile.mkdtemp())
(d / "in.root").write_text("x")
(d / "raw").mkdir()
for f in ("run_0421.dat.a", "run_0421.dat.a.mfm_event_index", "run_0422.dat.a"):
    (d / "raw" / f).write_text("x")
said = ("info> Input file : in.root\nLooking for 421(mfm) in raw\n"
        "Dry init: output file would be /no/out.root (not written)\n10000 input entries\n")
f = main.files_of(d, said)
assert [(i["path"], i["exists"]) for i in f["inputs"]] == [("in.root", True)]
assert [Path(x).name for x in f["search"]["found"]] == ["run_0421.dat.a"], "the run's, no sidecar"
assert (f["output"]["path"], f["output"]["exists"]) == ("/no/out.root", False) and f["entries"] == 10000
assert main.files_of(d, "Given input file does not exist! gone.root\n")["inputs"] == [{"path": "gone.root", "exists": False}]
print("files ok")

# A graph is kept while its file, its includes and LILAK's library stand as they were.
d = Path(tempfile.mkdtemp())
(d / "inc.mac").write_text("G/a  1\n")
(d / "top.mac").write_text("<inc  inc.mac\nG/b  2\n")
real_parse = main.parse_all
main.parse_all = lambda text: [{**r, "name": r["name"].lstrip("<"), "unit": "<" if r["name"].startswith("<") else ""} for r in real_parse(text)]
k0 = main.graph_key(d / "top.mac")
assert any(n.endswith("inc.mac") for n, _ in k0), "an include is part of the key"
os.utime(d / "inc.mac", ns=(1, 1))
assert main.graph_key(d / "top.mac") != k0, "an include changed: drawn anew"
main.parse_all = real_parse
print("graph key ok")

# The file card's info: where it is, its size and time.
g = main._at(Path(__file__).parent, Path(__file__).name)
assert g["exists"] and g["size"] > 0 and g["mtime"] and g["full"].endswith("test_flow.py")
assert main._at(Path(__file__).parent, "nope.root")["size"] is None

# A run that went wrong though root ended 0.
assert main.BAD_RX.findall("ok\nError in <TFile::TFile>: file x does not exist\nfine\n") == ["Error in <TFile::TFile>: file x does not exist"]
assert not main.BAD_RX.findall("Init done\n100 events\n")

# How far a run got: every-Nth "Execute Event", then End of Run's count.
assert main.events_of("[LKRun::Init] info> 0 input entries\nExecute Event 0\nExecute Event 9") == {"events": 10, "total": None}
assert main.events_of("100 input entries\nExecute Event 19\nEnd of Run 0 -> 41 (42)") == {"events": 42, "total": 100}
assert main.events_of("") == {"events": None, "total": None}

# The files as they are now: a search folder or the output's folder that is not there shows.
c = main.checked({"inputs": [], "search": {"tag": "mfm", "run": 1, "paths": [str(Path(__file__).parent), "/nope/x"], "found": []},
                  "output": {"path": "/nope/out.root", "full": "/nope/out.root", "exists": False}})
assert [d["exists"] for d in c["search"]["dirs"]] == [True, False]
assert c["outdir"] == {"path": "/nope", "exists": False} and c["output"]["exists"] is False
assert main.checked(None) is None
print("checked ok")

# A Run's output already there is kept aside (name.bak-<when>.root) before the run writes over it.
import tempfile as _tf
import shutil
_d = Path(_tf.mkdtemp())
(_d / "o.root").write_text("x")
main._graphs["t:o.mac"] = (None, {"files": {"inputs": [], "output": {"path": "o.root", "full": str(_d / "o.root"), "exists": True}}})
_b = main.backup_output("t:o.mac")
assert _b and Path(_b).read_text() == "x" and not (_d / "o.root").exists() and Path(_b).name.startswith("o.bak-"), _b
assert main.backup_output("t:o.mac") == "", "nothing left to keep"
assert main.backup_output("t:none.mac") == ""
print("backup ok")

# An Init's output kept aside goes back when it ends (LILAK left an empty one there).
(_d / "i.bak-1.root").write_text("good"); (_d / "i.root").write_text("stub")
_r = {"mode": "init", "backup": str(_d / "i.bak-1.root")}
main.put_back(_r)
assert (_d / "i.root").read_text() == "good" and not (_d / "i.bak-1.root").exists() and _r["backup"] == ""
(_d / "k.bak-1.root").write_text("old")
main.put_back({"mode": "run", "backup": str(_d / "k.bak-1.root")})
assert (_d / "k.bak-1.root").exists(), "a Run's is kept"
print("put back ok")

# No allowed folder set: none (the home folder is not asked for unasked); set, it is used.
from fastapi.testclient import TestClient as _TC
assert main.roots() == [] and _TC(main.app).get("/api/browse").json()["roots"] == []
assert _TC(main.app).put("/api/browse/places", json={"roots": [str(Path.home())]}).json()["roots"] == [str(Path.home().resolve())]

# The output's folder: made or linked, only under the home folder.
import fastapi as _fa
_h = Path(_tf.mkdtemp(dir=Path.home()))
try:
    main._graphs["t:m.mac"] = (None, {"files": {"inputs": [], "output": {"path": "a/o.root", "full": str(_h / "a/o.root")}}})
    assert main.out_dir({"id": "t:m.mac", "make": True}, {})["outdir"]["exists"] and (_h / "a").is_dir()
    (_h / "real").mkdir()
    main._graphs["t:l.mac"] = (None, {"files": {"inputs": [], "output": {"path": "b/o.root", "full": str(_h / "b/o.root")}}})
    assert main.out_dir({"id": "t:l.mac", "link": str(_h / "real")}, {})["outdir"]["exists"] and (_h / "b").is_symlink()
    for bad in ({"id": "t:m.mac", "make": True}, {"id": "t:x.mac", "make": True}):
        try:
            main.out_dir(bad, {}); raise AssertionError(bad)
        except _fa.HTTPException:
            pass
    main._graphs["t:o.mac"] = (None, {"files": {"inputs": [], "output": {"path": "/tmp/zz/o.root", "full": "/private/tmp/lilak_flow_nope/o.root"}}})
    try:
        main.out_dir({"id": "t:o.mac", "make": True}, {}); raise AssertionError("outside the roots")
    except _fa.HTTPException as e:
        assert e.status_code == 403
    main._graphs["t:k.mac"] = (None, {"files": {"inputs": [], "output": {"path": "c/o.root", "full": str(_h / "c/o.root")}}})
    try:
        main.out_dir({"id": "t:k.mac", "link": "/private/tmp"}, {}); raise AssertionError("link outside home")
    except _fa.HTTPException as e:
        assert e.status_code == 403
finally:
    shutil.rmtree(_h)
assert not Path("/private/tmp/lilak_flow_nope").exists()
print("outdir ok")

# The guide's SearchRun preview with a root tag: <Name>_<run>….<tag>.root.
_s = Path(_tf.mkdtemp())
for n in ("atomx_0421.conv.root", "atomx_0421.d1.conv.root", "atomx_0422.conv.root", "atomx_0421.reco.root", "other_0421.conv.root"):
    (_s / n).write_text("")
assert [Path(x).name for x in main.search_tag([str(_s)], 421, "atomx", "conv")] == ["atomx_0421.conv.root", "atomx_0421.d1.conv.root"]
assert main.search_tag(["/nope"], 1, "a", "b") == []
print("search tag ok")

# The allowed folders: a root itself counts (going up to it), a sibling with the same start does not.
_r = [Path("/Users/x")]
assert main._under(Path("/Users/x"), _r) and main._under(Path("/Users/x/a/b"), _r)
assert not main._under(Path("/Users/xy"), _r) and not main._under(Path("/Users"), _r)
print("roots ok")

# Outside paths wait for the portal's yes: refused, LILAK's files are not listed or opened and no folder is browsed.
_real = (main.reach, main.require_reach, main.browse_kit.reach)
def _no(path, why=""):
    raise HTTPException(403, "not approved")
main.reach, main.require_reach = (lambda path, why="": False), _no
main.browse_kit.reach = main.reach   # the browsing tab's roots ask the portal through the kit
try:
    assert main.scan("lilak") == [] and main.roots() == []
    for call in (lambda: main.item_path("lilak:tebat/macros/reco.mac"), lambda: main.new_path("lilak", "tebat", "macros", "n"),
                 lambda: main._in_roots(str(root))):
        try:
            call()
            raise AssertionError("an unapproved path was used")
        except HTTPException as e:
            assert e.status_code == 403
    assert TestClient(main.app).get("/api/flow/items").status_code == 403
finally:
    main.reach, main.require_reach, main.browse_kit.reach = _real
assert TestClient(main.app).get("/api/flow/items").status_code == 200
print("outside paths ok")

# The rack's browsing tab, mounted here: a folder in the allowed ones lists; outside them is refused.
_c = TestClient(main.app)
_b = _c.get("/api/browse", params={"path": str(Path(__file__).parent)}).json()
assert _b["path"] == str(Path(__file__).parent) and "main.py" in [f["name"] for f in _b["files"]], _b
assert _c.get("/api/browse", params={"path": "/private/etc"}).status_code == 403
print("browse ok")

# Nothing shallower than the home folder is set or asked of the portal (no approval request is made for it).
assert main.browse_kit.deep_enough(Path.home()) and main.browse_kit.deep_enough(Path.home() / "data")
assert not main.browse_kit.deep_enough(Path("/Volumes")) and not main.browse_kit.deep_enough(Path.home().parent)
_rs = main.browse_kit.reach_status
main.browse_kit.reach_status = lambda path, why="": "outside"      # what the portal says of /Volumes
try:
    assert _TC(main.app).put("/api/browse/places", json={"roots": ["/Volumes"]}).status_code == 400
    main.browse_kit.reach_status = lambda path, why="": "approved"  # a data disk a portal manager put on its list
    assert _TC(main.app).put("/api/browse/places", json={"roots": ["/Volumes"]}).status_code == 200
finally:
    main.browse_kit.reach_status = _rs
    _TC(main.app).put("/api/browse/places", json={"roots": [str(Path.home())]})
print("shallow ok")

# A folder the portal holds: its comments come with the listing; asking again goes back to the portal (again=True).
_ri, _asked = main.browse_kit.reach_info, []
def _held(path, why="", again=False):
    _asked.append(again)
    return {"status": "waiting" if again else "held", "comments": [{"by": "admin", "at": 1, "text": "쓰는 이유를 적어 주세요"}]}
main.browse_kit.reach_info = _held
try:
    _i = _TC(main.app).get("/api/browse").json()["info"][str(Path.home())]
    assert _i["status"] == "held" and _i["comments"][0]["text"].startswith("쓰는"), _i
    assert _TC(main.app).post("/api/browse/again", json={"path": str(Path.home())}).status_code == 200 and True in _asked
    assert _TC(main.app).post("/api/browse/again", json={"path": "/Volumes"}).status_code == 400
finally:
    main.browse_kit.reach_info = _ri
print("held ok")

# A search folder that holds none of the runs, though folders just inside it do: those are named.
_sd = Path(_tf.mkdtemp())
(_sd / "cobo0").mkdir(); (_sd / "cobo1").mkdir(); (_sd / "empty").mkdir()
(_sd / "cobo0" / "run_0420.dat.x").write_text(""); (_sd / "cobo1" / "run_0420.dat.y").write_text("")
_sc = main.search_check({"id": "x", "tag": "mfm", "paths": [str(_sd)], "runs": [420]}, {})
assert _sc["runs"]["420"] == [] and _sc["deeper"] == {str(_sd): [str(_sd / "cobo0"), str(_sd / "cobo1")]}, _sc
assert main.search_check({"id": "x", "tag": "mfm", "paths": [str(_sd / "cobo0")], "runs": [420]}, {})["deeper"] == {}
(_sd / "empty" / "deep").mkdir(); (_sd / "empty" / "deep" / "run_0420.dat.z").write_text("")
assert str(_sd / "empty" / "deep") not in main.search_check({"id": "x", "tag": "mfm", "paths": [str(_sd)], "runs": [420]}, {})["deeper"][str(_sd)], "one level only"
# `SearchRun mfm recursive`: every folder below, as LILAK walks it.
_rc = main.search_check({"id": "x", "tag": "mfm", "paths": [str(_sd)], "runs": [420], "recursive": True}, {})
assert sorted(Path(f).parent.name for f in _rc["runs"]["420"]) == [] , _rc  # the test files are empty: left out
(_sd / "cobo0" / "run_0420.dat.x").write_text("data")
assert [Path(f).parent.name for f in main.search_check({"id": "x", "tag": "mfm", "paths": [str(_sd)], "runs": [420], "recursive": True}, {})["runs"]["420"]] == ["cobo0"]
print("deeper ok")

# The input card's files are LILAK's own "Found" lines when it printed them (a recursive search looked below).
_fo = main.files_of(Path("/"), "[LKRun::SearchRunFiles] info> Looking for 420(mfm) in /a\n[LKRun::SearchRunFiles] info> Found /a/cobo1/run_0420.dat.x\n")
assert _fo["search"]["found"] == ["/a/cobo1/run_0420.dat.x"], _fo
print("found lines ok")

# SearchRun mfm with InputFile commented out: a save keeps the InputPaths as written (no to/input put over them).
_rw = main.parse_all("LKRun/InputPath  /data/run\nLKRun/SearchRun  mfm\n#LKRun/InputFile  to/input/file\n")
_tx = main.text_of(_rw)
assert "/data/run" in _tx and "to/input\n" not in _tx.replace("to/input/file", ""), _tx
print("searchrun save ok")

# A person's message in the page's language (X-Lang), Korean when none is sent.
_tc = TestClient(main.app)
assert _tc.get("/api/flow/file", params={"id": "nope"}).json()["detail"] == "모르는 항목입니다."
assert _tc.get("/api/flow/file", params={"id": "nope"}, headers={"X-Lang": "en"}).json()["detail"] == "Unknown item."
print("lang ok")
assert _tc.get("/api/flow/file", params={"id": "nope", "lang": "en"}).json()["detail"] == "Unknown item.", "?lang= too"
print("lang query ok")
