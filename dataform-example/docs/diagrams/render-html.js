// Usage: node render-html.js input.md output.html
const fs = require("fs");
const path = require("path");
const { marked, Renderer } = require("marked");

const [,, inMd, outHtml] = process.argv;
const md = fs.readFileSync(inMd, "utf8");
const mermaidJs = fs.readFileSync(path.join(__dirname, "node_modules/mermaid/dist/mermaid.min.js"), "utf8");

const esc = (s) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const renderer = new Renderer();
renderer.code = function(code, infostring) {
  let text, lang;
  if (code && typeof code === "object") { text = code.text; lang = code.lang; }
  else { text = code; lang = infostring; }
  if ((lang || "").trim() === "mermaid") {
    const b64 = Buffer.from(text, "utf8").toString("base64");
    return `<div class="mermaid-slot" data-code="${b64}"></div>`;
  }
  return `<pre class="code"><code>${esc(text)}</code></pre>`;
};
const body = marked.parse(md, { renderer });

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${path.basename(inMd)}</title>
<style>
  @page { size: A3 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1a2230; line-height: 1.5; font-size: 12.5px; margin: 0; }
  .content { max-width: 100%; }
  h1 { font-size: 26px; color: #0b2a4a; border-bottom: 3px solid #2b6cb0; padding-bottom: 8px; margin-top: 0; }
  h2 { font-size: 19px; color: #12507e; margin-top: 26px; border-bottom: 1px solid #cdd9e5; padding-bottom: 4px; }
  h3 { font-size: 15px; color: #1a4971; margin-top: 18px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 11px; }
  th, td { border: 1px solid #c3d0dd; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #eaf1f8; color: #0b2a4a; }
  tr:nth-child(even) td { background: #f7fafc; }
  code { background: #eef2f7; padding: 1px 4px; border-radius: 3px; font-family: "Cascadia Code", Consolas, monospace; font-size: 11px; }
  pre.code { background: #0f2438; color: #e8eef5; padding: 12px; border-radius: 6px; overflow-x: auto; }
  pre.code code { background: none; color: inherit; padding: 0; }
  .mermaid-slot { text-align: center; page-break-inside: avoid; margin: 18px 0; }
  .mermaid-slot svg { max-width: 100%; height: auto; }
  .mermaid-err { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; padding: 10px; text-align: left; white-space: pre-wrap; font-family: Consolas, monospace; }
  blockquote { border-left: 4px solid #2b6cb0; margin: 12px 0; padding: 4px 14px; background: #f2f7fb; color: #33475b; }
  hr { border: none; border-top: 1px solid #cdd9e5; margin: 22px 0; }
  a { color: #2b6cb0; }
</style></head>
<body><div class="content">${body}</div>
<script>${mermaidJs}</script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose",
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" },
    er: { useMaxWidth: true }, themeVariables: { fontSize: "13px" } });
  (async () => {
    const slots = Array.from(document.querySelectorAll(".mermaid-slot"));
    let ok = 0; const errs = [];
    for (let i = 0; i < slots.length; i++) {
      const b64 = slots[i].getAttribute("data-code");
      const code = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
      try {
        const out = await mermaid.render("mm" + i, code);
        slots[i].innerHTML = out.svg; ok++;
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        errs.push("#" + i + " " + msg.split(String.fromCharCode(10))[0]);
        slots[i].innerHTML = '<div class="mermaid-err">' + msg.replace(/</g,"&lt;") + '</div>';
      }
    }
    document.title = "RENDERSTATUS ok=" + ok + " err=" + errs.length + (errs.length ? " :: " + errs.join(" ;; ") : "");
  })();
</script></body></html>`;

fs.writeFileSync(outHtml, html);
console.log("wrote", outHtml);
