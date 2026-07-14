# PT derived schemas — status: DERIVED, NOT OFFICIAL

The files in this folder are an **interpretation of Regulamento n.º 903-B/2015**
(SRIJ, Diário da República, 2.ª série, n.º 250, 23-12-2015) built for architectural
and demonstration purposes inside this repository. They are **not** SRIJ's official
technical specification. The authoritative, current wire formats live in SRIJ's
**"Modelo de Dados de Jogo Online"** package, which the regulation itself defers to
(secções 2.1.2, 2.2.2, 3.3, 9.9.2) and which evolves independently of the 2015
gazette text.

The regulation's Anexo 1 prints illustrative XSDs in the gazette. These files
transcribe them, with documented **normalisations** where the gazette print is
internally inconsistent or not valid/usable XSD (e.g. `datahr` declared `xs:int`
against a documented 14-digit datetime mask; monetary fields declared `xs:string`
against "em euros" comments; a malformed `xsd:list`-based S/N enumeration;
`mixed="true"` record types; duplicate global element declarations). Every element
is traceable to the regulation; every non-literal typing choice is marked
`INFERRED` or `NORMALISED` in its `xs:documentation`. Nothing was added that the
regulation does not mention.

## Files

| File | Source in the regulation | Root element | Cadence |
|---|---|---|---|
| `pt-common.xsd` | Anexo 1 (envelope shared by all six category XSDs) | — (include) | — |
| `RESF.xsd` | Anexo 1, V.1 Schema RESF_ (resumo financeiro) | `ficheiro` | daily |
| `JGDR.xsd` | Anexo 1, V.2 Schema JGDR_ (registos de jogadores) | `ficheiro` | hourly |
| `SESS.xsd` | Anexo 1, V.3 Schema SESS_ (sessões) | `ficheiro` | hourly |
| `AJOG.xsd` | Anexo 1, V.4 Schema AJOG_ (atividade de jogo, 6 verticals) | `ficheiro` | hourly |
| `TRAN.xsd` | Anexo 1, V.5 Schema TRAN_ (transações) | `ficheiro` | hourly |
| `EXCL.xsd` | Anexo 1, V.6 Schema EXCL_ (autoexclusão) | `ficheiro` | daily |
| `srij-lista-excluidos.xsd` | Anexo 1, ListaExcluidos SOAP service | `PedidoListaExcluidos` / `RespostaListaExcluidos` | on demand |
| `srij-notificacao-pedido-exclusao.xsd` | Anexo 1, NotificacaoPedidoExclusao push service | `NotificacaoPedidoExclusao` / `Resposta…` | real time |
| `srij-verificacao-identidade.xsd` | Anexo 1, PedidoVerificacaoIdentidadeTP service | `PedidoVerificacaoTP` / `RespostaVerificacaoTP` | at registration |
| `*.sample.xml` | — | one fictitious, schema-valid instance per file family | — |

The six category schemas are separate files because each declares its own
no-namespace root `ficheiro` with different content — exactly how the gazette
organises them; `pt-common.xsd` is a chameleon include holding the shared file
envelope (`cod_entexpl`, `datahr`, `id_ficheiro`, `cod_cofre`) and shared simple
types.

## Validation

Compiled and validated with the repo venv's `xmlschema` (4.3.2): all ten XSDs
compile, and every `*.sample.xml` validates against its schema.

```
.venv/Scripts/python.exe -c "import xmlschema; xmlschema.XMLSchema('docs/regulator/pt/derived/AJOG.xsd').validate('docs/regulator/pt/derived/AJOG.sample.xml')"
```

## What a real onboarding still needs

See **"Open questions for implementation"** in [`../pt-data-model.md`](../pt-data-model.md):
the current Modelo de Dados package and versioned XSDs, operator/GameVault code
assignment and Multicert enrolment, authoritative code lists (game types, payment
types, card encodings, result codes), current service endpoints/environments, and
SRIJ's validation rules that drive the `rp.xml` reprocessing loop.
