#!/usr/bin/env python3
"""Put lilak_flow's recipes into a jobrun's recipes.json (this Mac's by default).

    python3 jobrun/recipes.py [recipes.json]      # keeps a .bak-<date> of what it replaces

jobrun has no parameter type for a path, so the file is a `choice`: every
parameter file with a run in it, as the list shows them. Run this again after
adding one. Only the lilak-* recipes are touched.
"""
import json
import os
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))
os.environ.setdefault("LILAK_FLOW_DATA_DIR", "/tmp/lilak_flow-recipes")


def recipes(macros: list) -> dict:
    def one(mode, what, timeout):
        return {"description": f"LILAK 파라미터 파일 하나를 {what} (lilak flow가 낸다). macro는 $LILAK_PATH 아래 경로.",
                "argv": ["python3", str(HERE / "lilak_run.py"), "{macro}", mode, "{output}"],
                "timeout_s": timeout, "params": {"macro": {"type": "choice", "choices": macros}}}
    return {"lilak-init": one("init", "LKRun::Init까지만 돌린다", 600),
            "lilak-run": one("run", "끝까지 돌린다 (lilak run)", 7200)}


if __name__ == "__main__":
    import main
    target = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "Research/jobrun_local/recipes.json")
    macros = [f["path"] for f in main.scan("lilak") if f["flow"]]
    cur = json.loads(target.read_text(encoding="utf-8"))
    new = {**{k: v for k, v in cur.items() if not k.startswith("lilak-")}, **recipes(macros)}
    if new != cur:
        shutil.copy2(target, f"{target}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
        target.write_text(json.dumps(new, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{target}: lilak-init, lilak-run with {len(macros)} files" + ("" if new != cur else " (unchanged)"))
