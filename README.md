# lilak_analysis

The LILAK software services of the [LILAK Web Portal](https://github.com/lilak-project).

| folder | what |
|---|---|
| `analysis-v2/` | LILAK macros as flow maps: a list of flows, each pointing at a macro under `$LILAK_PATH` |
| `seed/` | each service's portal manifest |

Drawn with lilak_rack's frame (`racklist`, aliased as `../../lilak_rack/racklist`) and stored by
its `rackstore`, so the portal's stack needs `lilak_rack` beside this checkout. The graph comes
from LILAK's own `macros/lilak_configure_flow_editor.py`, so the host needs LILAK and ROOT.
