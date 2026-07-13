# Data model & flow diagrams

Three diagrams describing the unified regulatory-reporting platform. Each exists
as **Markdown** (Mermaid source — renders inline on GitHub/GitLab and is the
editable source of truth) and as a rendered **PDF** (A3 landscape, for sharing
with people who don't have a Mermaid viewer).

| Diagram | Markdown | PDF | What it shows |
|---|---|---|---|
| **Logical ER** | [ER-LOGICAL.md](ER-LOGICAL.md) | [ER-LOGICAL.pdf](ER-LOGICAL.pdf) | Business/conceptual entities and relationships, independent of storage |
| **Physical ER** | [ER-PHYSICAL.md](ER-PHYSICAL.md) | [ER-PHYSICAL.pdf](ER-PHYSICAL.pdf) | Actual tables, columns and types, per pipeline layer (sources → staging → reference → marts → submissions) |
| **Data flow** | [DATA-FLOW.md](DATA-FLOW.md) | [DATA-FLOW.pdf](DATA-FLOW.pdf) | Context (L0), pipeline DAG (L1) with the compliance gate, and the config control plane |

The **logical** view captures the "write once, run every market" principle —
jurisdiction variance is data (`REGULATOR_CODE_MAP`, the `REG_ATTRIBUTE`
carrier), not new entities. The **physical** view is grounded in the real
persisted objects (`cdc_landing.*`, `stg_*`, `ref_*`/`map_*`, `dim_*`/`fct_*`,
`rg_breach_*`, `submission_ready_*`). The **data-flow** view shows how data moves
and where the assertion gate blocks bad data from reaching a regulator.

## Regenerating the PDFs

The Markdown files are the source of truth. To re-render the PDFs after editing
them, no cloud service is needed — it uses locally-installed Microsoft Edge
(Chromium) to print, and `mermaid` + `marked` for rendering:

```bash
# from a scratch dir with: npm install mermaid marked
# 1) Markdown -> self-contained HTML (Mermaid inlined, diagrams base64-encoded
#    so HTML labels survive the parser, then rendered explicitly in-page)
node render-html.js ER-LOGICAL.md ER-LOGICAL.html

# 2) HTML -> PDF via headless Edge (waits for async Mermaid render)
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=40000 \
  --print-to-pdf="ER-LOGICAL.pdf" "file:///ABS/PATH/ER-LOGICAL.html"
```

`render-html.js` (in this folder) is the small, dependency-light helper that does
step 1. Any Mermaid-capable renderer (VS Code preview, the Mermaid Live Editor,
`mmdc`) will produce equivalent output from the same Markdown.
