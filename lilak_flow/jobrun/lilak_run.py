#!/usr/bin/env python3
"""A jobrun recipe's command: init or run one LILAK parameter file.

    lilak_run.py <path under $LILAK_PATH> init|run <output folder>

What `lilak run <file>` does — root on macros/run_lilak.C — in a login shell (ROOT
and LILAK's environment are there, not in jobrun's), from the file's own folder
so its relative paths hold. `init` stops after LKRun::Init. The path is checked
again here: it goes into a shell line and a C++ string.
"""
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

LILAK_PATH = Path(os.environ.get("LILAK_PATH") or Path.home() / "Research" / "lilak").expanduser().resolve()
SAFE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_./+-]*\.mac")


def command(rel: str, mode: str) -> tuple:
    """(the folder to run in, the shell line), or ValueError for a path that may not run."""
    if mode not in ("init", "run"):
        raise ValueError(f"mode is init or run, not {mode!r}")
    if not SAFE.fullmatch(rel) or ".." in rel:
        raise ValueError(f"not a parameter file path: {rel!r}")
    p = (LILAK_PATH / rel).resolve()
    if LILAK_PATH not in p.parents or not p.is_file():
        raise ValueError(f"no such file under {LILAK_PATH}: {rel}")
    call = f'{LILAK_PATH}/macros/run_lilak.C("{p}",0,{int(mode == "run")})'
    return p.parent, f"cd {shlex.quote(str(p.parent))} && root -l -b -q {shlex.quote(call)}"


def check() -> None:
    import tempfile
    global LILAK_PATH
    LILAK_PATH = Path(tempfile.mkdtemp()).resolve()
    (LILAK_PATH / "p").mkdir()
    (LILAK_PATH / "p/a.mac").write_text("")
    folder, line = command("p/a.mac", "init")
    assert folder == LILAK_PATH / "p" and line.endswith(f"""run_lilak.C("{LILAK_PATH}/p/a.mac",0,0)'"""), line
    assert command("p/a.mac", "run")[1].endswith(',0,1)\'')
    for bad in ("../a.mac", "p/../../a.mac", "/etc/a.mac", 'p/a".mac', "p/a.mac;ls", "p/gone.mac", "p/a.txt", "-a.mac"):
        try:
            command(bad, "run")
        except ValueError:
            continue
        raise AssertionError(f"{bad} was let through")
    print("lilak_run: ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        check()
        sys.exit(0)
    try:
        folder, line = command(sys.argv[1], sys.argv[2])
    except (IndexError, ValueError) as e:
        sys.exit(f"lilak_run: {e}")
    print(f"$ {line}", flush=True)
    sys.exit(subprocess.run(["/bin/zsh", "-lc", line], stdin=subprocess.DEVNULL).returncode)
