# lilak_analysis

The LILAK software services of the [LILAK Web Portal](https://github.com/lilak-project).

| folder | what |
|---|---|
| `lilak_flow/` | **lilak flow** — the LILAK parameter files under `$LILAK_PATH` as a list; one with a run in it opens as a flow board |
| `lilak_flow/jobrun/` | the jobrun side: `lilak_run.py` (a recipe's command) and `recipes.py` (writes lilak-init / lilak-run into a recipes.json) |
| `seed/` | each service's portal manifest |

Drawn with lilak_rack's frame (`racklist`, aliased as `../../lilak_rack/racklist`) and stored by
its `rackstore`, so the portal's stack needs `lilak_rack` beside this checkout. The graph comes
from LILAK's own `macros/lilak_configure_flow_editor.py`, so the host needs LILAK and ROOT.
