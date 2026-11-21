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
