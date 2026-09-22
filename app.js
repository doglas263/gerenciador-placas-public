"use strict";

// ----------------------------------------------------------------------------
// utilidades
// ----------------------------------------------------------------------------
const $ = (s, e = document) => e.querySelector(s);
const $$ = (s, e = document) => [...e.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    n.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
};
const fmtNum = (v) => (v == null || v === "" ? "" : (typeof v === "number"
  ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : v));
const moeda = (v) => (v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function toast(msg, tipo = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + tipo;
  setTimeout(() => t.classList.add("oculto"), 3800);
}

async function getJSON(url) { const r = await fetch(url); return r.json(); }

// ----------------------------------------------------------------------------
// Botão reiniciar servidor
// ----------------------------------------------------------------------------
$("#btn-reiniciar").addEventListener("click", async () => {
  const btn = $("#btn-reiniciar");
  if (btn.classList.contains("reiniciando")) return;
  btn.classList.add("reiniciando");

  // Manda o pedido (pode falhar se o processo morrer antes de responder)
  try { await fetch("/api/reiniciar", { method: "POST" }); } catch (_) {}

  // Polling: começa logo e tenta a cada 500ms por até 15s
  let tentativas = 0;
  const MAX = 30; // 30 × 500ms = 15s
  const tick = setInterval(async () => {
    tentativas++;
    btn.textContent = `↺ Reiniciando… ${tentativas}s`;
    if (tentativas > MAX) {
      clearInterval(tick);
      btn.classList.remove("reiniciando");
      btn.textContent = "↺ Reiniciar";
      toast("Servidor não respondeu após 15s. Tente manualmente.", "err");
      return;
    }
    try {
      const r = await fetch("/api/tipos", { cache: "no-store" });
      if (r.ok) { clearInterval(tick); location.reload(); }
    } catch (_) { /* ainda reiniciando */ }
  }, 500);
});
async function postJSON(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

function tabela(headers, linhas) {
  const t = el("table");
  t.appendChild(el("thead", {}, el("tr", {}, ...headers.map((h) => el("th", {}, h)))));
  const tb = el("tbody");
  if (!linhas.length) {
    tb.appendChild(el("tr", {}, el("td", { colspan: headers.length },
      el("div", { class: "vazio" }, "Nenhum registro."))));
  }
  for (const linha of linhas) tb.appendChild(el("tr", {}, ...linha));
  t.appendChild(tb);
  return t;
}

// Baixa um arquivo gerado por uma rota POST (retorna .xlsx como blob).
async function baixarPost(url, body, tipoErro = "Falha ao exportar") {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) {
      let msg = tipoErro;
      try { msg = (await r.json()).erro || msg; } catch (e) { /* binário */ }
      toast(msg, "err");
      return;
    }
    const blob = await r.blob();
    const nome = (r.headers.get("Content-Disposition") || "").match(/filename="?([^";]+)"?/)?.[1]?.trim() || "export.xlsx";
    const a = el("a", { href: URL.createObjectURL(blob), download: nome });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Excel gerado.", "ok");
  } catch (e) {
    toast(tipoErro + ": " + e.message, "err");
  }
}

// ----------------------------------------------------------------------------
// navegação de abas
// ----------------------------------------------------------------------------
$$(".tab").forEach((b) => b.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.remove("active"));
  $$(".panel").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  $("#" + b.dataset.tab).classList.add("active");
  if (b.dataset.tab === "inventario") carregarFiltrosInventario();
  if (b.dataset.tab === "comparar") carregarComparar();
  if (b.dataset.tab === "continuidade") carregarContinuidade();
  if (b.dataset.tab === "resumo") carregarResumo();
  if (b.dataset.tab === "verificar") carregarVerificar();
  if (b.dataset.tab === "importar")   carregarStatusImportacoes();
  if (b.dataset.tab === "auditoria")  carregarUltimaDataSaida();
  if (b.dataset.tab === "stress")     carregarStress();
  if (b.dataset.tab === "telemetria") carregarTelemInfo();
  if (b.dataset.tab === "km-mensal") carregarKmMensal();
  if (b.dataset.tab === "combustivel") carregarCombustivel();
}));

// Sub-abas (Auditoria)
$$(".subtab").forEach((b) => b.addEventListener("click", () => {
  const pai = b.closest(".panel");
  pai.querySelectorAll(".subtab").forEach((x) => x.classList.remove("active"));
  pai.querySelectorAll(".subpanel").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  $("#" + b.dataset.sub).classList.add("active");
}));

// carrega histórico e status ao abrir a página (aba Importar está ativa por padrão)
carregarHistorico();
carregarStatusImportacoes();

// ----------------------------------------------------------------------------
// IMPORTAR
// ----------------------------------------------------------------------------
const dz = $("#dropzone");
const fileInput = $("#file-input");
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) enviarArquivos(e.dataTransfer.files); });
fileInput.addEventListener("change", () => { if (fileInput.files.length) enviarArquivos(fileInput.files); });

async function enviarArquivos(files) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append("arquivos", f));
  $("#import-status").innerHTML = `<p><span class="spinner"></span> Importando ${files.length} arquivo(s)…</p>`;
  $("#import-resultado").innerHTML = "";
  try {
    const r = await fetch("/api/importar", { method: "POST", body: fd });
    const data = await r.json();
    renderImportResultado(data);
    $("#import-status").innerHTML = "";
    toast("Importação concluída.", "ok");
    carregarHistorico();
  } catch (e) {
    $("#import-status").innerHTML = "";
    toast("Erro na importação: " + e.message, "err");
  }
  fileInput.value = "";
}

function renderImportResultado(data) {
  const cont = $("#import-resultado");
  cont.innerHTML = "";
  for (const res of data.resultados || []) {
    const titulo = el("h3", {}, res.arquivo);
    cont.appendChild(titulo);
    if (res.erro) {
      cont.appendChild(el("div", { class: "imp-grupo" },
        el("span", { class: "badge red" }, "ERRO"), el("span", {}, res.erro)));
      continue;
    }
    if (!res.grupos.length) {
      cont.appendChild(el("div", { class: "info" }, "Nenhum período reconhecido neste arquivo."));
      continue;
    }
    for (const g of res.grupos) {
      cont.appendChild(el("div", { class: "imp-grupo" },
        el("span", { class: "tipo" }, g.tipo),
        el("span", { class: "badge gray" }, g.vigencia),
        el("span", {}, `${g.linhas} registros`),
        g.substituiu
          ? el("span", { class: "badge amber" }, `substituiu ${g.antigos_removidos} antigos`)
          : el("span", { class: "badge green" }, "novo")));
    }
  }
}

// ----------------------------------------------------------------------------
// IMPORTAR — Checklist de saídas T2 (Caminhão / Van / AS)
// ----------------------------------------------------------------------------
const saidaFileInput = $("#saida-file");
const saidaNomeSpan  = $("#saida-file-nome");
saidaFileInput.addEventListener("change", () => {
  const count = saidaFileInput.files.length;
  saidaNomeSpan.textContent = count
    ? `📋 ${count} arquivo(s) selecionado(s)`
    : "📋 Selecionar planilha(s) de saída";
});

$("#saida-import-btn").addEventListener("click", async () => {
  if (!saidaFileInput.files.length) { toast("Selecione ao menos um arquivo.", "err"); return; }
  const fd = new FormData();
  [...saidaFileInput.files].forEach((f) => fd.append("arquivos", f));
  const statusEl = $("#saida-import-status");
  statusEl.innerHTML = `<span class="spinner"></span> Importando…`;
  try {
    const r = await fetch("/api/importar/saidas", { method: "POST", body: fd });
    const d = await r.json();
    if (d.erro) { statusEl.textContent = "Erro: " + d.erro; return; }
    statusEl.innerHTML =
      `<span class="badge green">${d.novas} novos</span> ` +
      `<span class="badge gray">${d.ignoradas} duplicatas ignoradas</span> ` +
      `— total no banco: <strong>${d.total_db}</strong> registros` +
      (d.ultima_data ? ` · última data: <strong>${d.ultima_data}</strong>` : "");
    saidaFileInput.value = "";
    saidaNomeSpan.textContent = "📋 Selecionar planilha(s) de saída";
    toast("Saídas T2 importadas.", "ok");
    carregarUltimaDataSaida();
  } catch (e) {
    statusEl.textContent = "Erro: " + e.message;
    toast("Erro ao importar saídas.", "err");
  }
});

// ----------------------------------------------------------------------------
// IMPORTAR — Checklist de saídas T1 (Cavalo / Carreta)
// ----------------------------------------------------------------------------
const saidaT1FileInput = $("#saida-t1-file");
const saidaT1NomeSpan  = $("#saida-t1-file-nome");
saidaT1FileInput.addEventListener("change", () => {
  const count = saidaT1FileInput.files.length;
  saidaT1NomeSpan.textContent = count
    ? `📋 ${count} arquivo(s) selecionado(s)`
    : "📋 Selecionar CSV Unidocs";
});

$("#saida-t1-import-btn").addEventListener("click", async () => {
  if (!saidaT1FileInput.files.length) { toast("Selecione ao menos um arquivo.", "err"); return; }
  const fd = new FormData();
  [...saidaT1FileInput.files].forEach((f) => fd.append("arquivos", f));
  const statusEl = $("#saida-t1-import-status");
  statusEl.innerHTML = `<span class="spinner"></span> Importando…`;
  try {
    const r = await fetch("/api/importar/unidocs", { method: "POST", body: fd });
    const d = await r.json();
    if (d.erro) { statusEl.textContent = "Erro: " + d.erro; return; }
    statusEl.innerHTML =
      `<span class="badge green">${d.novas} novos</span> ` +
      `<span class="badge gray">${d.ignoradas} duplicatas ignoradas</span> ` +
      `— total no banco: <strong>${d.total_db}</strong> registros` +
      (d.ultima_data ? ` · última data: <strong>${d.ultima_data}</strong>` : "");
    saidaT1FileInput.value = "";
    saidaT1NomeSpan.textContent = "📋 Selecionar CSV Unidocs";
    toast("Unidocs importado com sucesso.", "ok");
  } catch (e) {
    statusEl.textContent = "Erro: " + e.message;
    toast("Erro ao importar Unidocs.", "err");
  }
});

// ----------------------------------------------------------------------------
// IMPORTAR — Botões de download com filtro de data
// ----------------------------------------------------------------------------
function _dlUrl(base, iniId, fimId) {
  const ini = $("#" + iniId)?.value || "";
  const fim = $("#" + fimId)?.value || "";
  const p = new URLSearchParams();
  if (ini) p.set("data_ini", ini);
  if (fim) p.set("data_fim", fim);
  return base + (p.toString() ? "?" + p.toString() : "");
}

$("#pub-btn").addEventListener("click", async () => {
  const btn = $("#pub-btn"), bar = $("#pub-status");
  btn.disabled = true;
  bar.className = "imp-status";
  bar.textContent = "Publicando…";
  try {
    const r = await fetch("/api/publicar", { method: "POST" });
    let d;
    try { d = await r.json(); } catch (_) { d = { erro: `Servidor retornou erro HTTP ${r.status}` }; }
    if (d.ok) {
      bar.className = "imp-status ok";
      bar.textContent = "Publicado com sucesso — GitHub Pages atualiza em ~30s";
    } else {
      bar.className = "imp-status err";
      bar.textContent = d.erro || "Erro desconhecido";
    }
  } catch (e) {
    bar.className = "imp-status err";
    bar.textContent = "Erro: " + e.message;
  } finally {
    btn.disabled = false;
  }
});

$("#ft-dl-btn").addEventListener("click", () => {
  window.location.href = _dlUrl("/api/download/ft", "ft-dl-ini", "ft-dl-fim");
});
$("#checklist-dl-btn").addEventListener("click", () => {
  window.location.href = _dlUrl("/api/download/checklist", "checklist-dl-ini", "checklist-dl-fim");
});
$("#unidocs-dl-btn").addEventListener("click", () => {
  window.location.href = _dlUrl("/api/download/unidocs", "unidocs-dl-ini", "unidocs-dl-fim");
});

// ----------------------------------------------------------------------------
// IMPORTAR — Análise de lacunas
// ----------------------------------------------------------------------------
let gapTiposDisponiveis = [];

async function carregarTiposGap() {
  if (gapTiposDisponiveis.length) return;
  try {
    const tipos = await getJSON("/api/tipos");
    const sel = $("#gap-tipo");
    tipos.forEach((t) => sel.appendChild(el("option", { value: t.tipo }, t.tipo)));
    gapTiposDisponiveis = tipos.map((t) => t.tipo);
  } catch (e) { /* ignora */ }
}
carregarTiposGap();

(function _initGapDatas() {
  const hoje = new Date();
  const primeiroAno  = hoje.getFullYear();
  const primeiraMes  = String(hoje.getMonth() + 1).padStart(2, "0");
  // De: 6 meses atrás, Q1
  const de = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);
  const deAno  = de.getFullYear();
  const deMes  = String(de.getMonth() + 1).padStart(2, "0");
  $("#gap-de-mes").value  = `${deAno}-${deMes}`;
  $("#gap-de-q").value    = "1";
  $("#gap-ate-mes").value = `${primeiroAno}-${primeiraMes}`;
  // Ate Q: selecionamos a quinzena correta com base no dia atual
  $("#gap-ate-q").value   = hoje.getDate() <= 15 ? "1" : "2";
})();

$("#gap-analisar").addEventListener("click", async () => {
  const deMes = $("#gap-de-mes").value;
  const deQ   = $("#gap-de-q").value;
  const ateMes = $("#gap-ate-mes").value;
  const ateQ   = $("#gap-ate-q").value;
  const tipo   = $("#gap-tipo").value;
  if (!deMes || !ateMes) { toast("Selecione o intervalo.", "err"); return; }
  const [deAno, deM]  = deMes.split("-");
  const [ateAno, ateM] = ateMes.split("-");
  const deChave  = `${deAno}-${deM}-${deQ}`;
  const ateChave = `${ateAno}-${ateM}-${ateQ}`;
  const res = $("#gap-resultado");
  res.innerHTML = `<span class="spinner"></span> Analisando…`;
  try {
    const url = `/api/gaps?de=${deChave}&ate=${ateChave}${tipo ? "&tipo=" + encodeURIComponent(tipo) : ""}`;
    const d = await getJSON(url);
    if (d.erro) { res.textContent = "Erro: " + d.erro; return; }
    _renderGaps(d, res);
  } catch (e) {
    res.textContent = "Erro: " + e.message;
  }
});

function _renderGaps(data, container) {
  container.innerHTML = "";
  const periodos  = data.periodos || [];
  const tipos     = data.tipos || [];
  const mensais   = new Set(data.tipos_mensais || []);
  if (!periodos.length) {
    container.appendChild(el("div", { class: "info" }, "Nenhum período no intervalo selecionado."));
    return;
  }
  const total    = periodos.length;
  const ok       = periodos.filter((p) => p.importado).length;
  const parcial  = periodos.filter((p) => !p.importado && (p.tipos_com || []).length > 0).length;
  const faltando = total - ok - parcial;

  // Sumário
  const sum = el("div", { class: "gap-sum" },
    el("span", {}, ["Total esperados: ", el("b", {}, String(total))]),
    ok      ? el("span", {}, [el("b", { style: "color:var(--green)" }, String(ok)),      " completos"]) : null,
    parcial ? el("span", {}, [el("b", { style: "color:var(--amber)" }, String(parcial)), " parciais"])  : null,
    faltando? el("span", {}, [el("b", { style: "color:var(--red)" },   String(faltando))," faltando"])  : null,
  );
  container.appendChild(sum);

  // Nota sobre tipos mensais
  if (mensais.size) {
    const nota = el("p", { class: "hint", style: "margin:8px 0 4px" },
      `Tipos mensais (sem 2ª quinzena): ${[...mensais].join(", ")}.`);
    container.appendChild(nota);
  }

  // Tabela
  const wrap = el("div", { class: "gap-table-wrap" });
  const colTipos = tipos.length > 1 ? tipos : [];
  const headers  = colTipos.length ? ["Período", ...colTipos] : ["Período", "Status"];
  const t = el("table", { class: "gap-table" });
  t.appendChild(el("thead", {}, el("tr", {}, ...headers.map((h) => el("th", {}, h)))));
  const tbody = el("tbody");

  // Determina se é linha Q2 via label (contém "Q2") ou chave (termina em -2)
  const isQ2 = (p) => p.chave.endsWith("-2");

  for (const p of periodos) {
    const tiposNa  = new Set(p.tipos_na  || []);
    const tiposSem = p.tipos_sem || [];
    const tiposCom = p.tipos_com || [];
    const isMiss    = !p.importado && tiposSem.length > 0;
    const isPartial = !p.importado && tiposCom.length > 0 && tiposSem.length > 0;
    const cls = p.importado ? "gap-ok" : (isPartial ? "gap-partial" : "gap-miss");
    const cells = [el("td", {}, p.label)];
    if (colTipos.length) {
      for (const tipo of colTipos) {
        if (tiposNa.has(tipo)) {
          cells.push(el("td", {}, el("span", { class: "badge gray", title: "Tipo mensal — 2ª quinzena não existe" }, "—")));
        } else if (tiposCom.includes(tipo)) {
          cells.push(el("td", {}, el("span", { class: "badge green" }, "✓")));
        } else {
          cells.push(el("td", {}, el("span", { class: "badge red" }, "✗")));
        }
      }
    } else {
      // Tipo único ou view simplificada
      cells.push(el("td", {},
        p.importado
          ? el("span", { class: "badge green" }, "✓ importado")
          : el("span", { class: "badge red" }, "✗ faltando")
      ));
    }
    tbody.appendChild(el("tr", { class: cls }, ...cells));
  }
  t.appendChild(tbody);
  wrap.appendChild(t);
  container.appendChild(wrap);
}

// ----------------------------------------------------------------------------
// INVENTÁRIO
// ----------------------------------------------------------------------------
let invFiltrosCarregados = false;
async function carregarFiltrosInventario() {
  if (invFiltrosCarregados) return;
  invFiltrosCarregados = true;
  const [tipos, unidades, periodos] = await Promise.all([
    getJSON("/api/tipos"), getJSON("/api/unidades"), getJSON("/api/periodos_global"),
  ]);
  const selT = $("#inv-tipo");
  tipos.forEach((t) => selT.appendChild(el("option", { value: t.tipo }, `${t.tipo} (${t.n})`)));
  const selU = $("#inv-unidade");
  unidades.forEach((u) => selU.appendChild(el("option", { value: u }, u)));
  const selP = $("#inv-periodo");
  periodos.forEach((p) => selP.appendChild(el("option", { value: p.chave }, p.label)));
  buscarInventario();
}

function _invParams() {
  const p = new URLSearchParams();
  const chave = $("#inv-periodo").value;
  if (chave) {
    const [ano, mes, periodo] = chave.split("-");
    p.set("ano", ano); p.set("mes", mes); p.set("periodo", periodo);
  }
  if ($("#inv-tipo").value) p.set("tipo", $("#inv-tipo").value);
  if ($("#inv-unidade").value) p.set("unidade", $("#inv-unidade").value);
  if ($("#inv-busca").value) p.set("busca", $("#inv-busca").value);
  return p;
}

let invDados = [];
async function buscarInventario() {
  const p = _invParams();
  $("#inv-info").innerHTML = `<span class="spinner"></span> Carregando…`;
  const data = await getJSON("/api/inventario?" + p.toString());
  invDados = data.registros;
  $("#inv-info").textContent = `${data.total} registro(s).`;
  const headers = ["", "Tipo", "Placa", "Chassi", "Unidade", "Modelo", "Montadora", "Locadora", "Custo aluguel", "Ativo", "Período"];
  const linhas = invDados.map((r) => [
    el("td", {}, el("span", { class: "linkish", onclick: () => verDetalhe(r.id) }, "🔍")),
    el("td", {}, r.tipo || ""),
    el("td", {}, placaBadge(r.placa, r.placa_formato)),
    el("td", {}, r.chassi || ""),
    el("td", {}, r.unidade || ""),
    el("td", {}, r.modelo || ""),
    el("td", {}, r.montadora || ""),
    el("td", {}, r.empresa_locadora || ""),
    el("td", { class: "num" }, moeda(r.custo_aluguel)),
    el("td", {}, r.ativo || ""),
    el("td", {}, periodoCurto(r)),
  ]);
  $("#inv-tabela").replaceWith(Object.assign(tabela(headers, linhas), { id: "inv-tabela" }));
}
function periodoCurto(r) {
  const meses = ["", "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${meses[r.mes] || r.mes}/${r.ano} Q${r.periodo}`;
}
function placaBadge(placa, formato) {
  if (!placa) return document.createTextNode("");
  const span = el("span", {}, placa + " ");
  if (formato === "mercosul") span.appendChild(el("span", { class: "badge purple" }, "MS"));
  return span;
}
$("#inv-buscar").addEventListener("click", buscarInventario);
$("#inv-busca").addEventListener("keydown", (e) => { if (e.key === "Enter") buscarInventario(); });
$("#inv-tipo").addEventListener("change", buscarInventario);
$("#inv-unidade").addEventListener("change", buscarInventario);
$("#inv-periodo").addEventListener("change", buscarInventario);
$("#inv-export").addEventListener("click", () => {
  window.location.href = "/api/exportar/inventario?" + _invParams().toString();
});

async function verDetalhe(id) {
  const d = await getJSON("/api/registro/" + id);
  $("#modal-titulo").textContent = `${d.tipo} · ${d.placa || d.chassi || ""}`;
  const linhas = Object.entries(d.raw || {}).map(([k, v]) =>
    el("tr", {}, el("td", { class: "mud" }, el("b", {}, k)), el("td", {}, String(v ?? ""))));
  const t = el("table", {}, el("tbody", {}, ...linhas));
  $("#modal-corpo").innerHTML = "";
  $("#modal-corpo").appendChild(t);
  $("#modal").classList.remove("oculto");
}
$("#modal-close").addEventListener("click", () => $("#modal").classList.add("oculto"));
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").classList.add("oculto"); });

// ----------------------------------------------------------------------------
// COMPARAR
// ----------------------------------------------------------------------------
let cmpInit = false;
async function carregarComparar() {
  if (cmpInit) return;
  cmpInit = true;
  const tipos = await getJSON("/api/tipos");
  const selT = $("#cmp-tipo");
  selT.innerHTML = "";
  selT.appendChild(el("option", { value: "" }, "Todos"));
  tipos.forEach((t) => selT.appendChild(el("option", { value: t.tipo }, t.tipo)));
  selT.addEventListener("change", carregarPeriodosComparar);
  if (tipos.length) carregarPeriodosComparar();
}
async function carregarPeriodosComparar() {
  const tipo = $("#cmp-tipo").value;
  const periodos = await getJSON("/api/periodos?tipo=" + encodeURIComponent(tipo));
  const opts = periodos.map((p) => el("option", { value: JSON.stringify({ ano: p.ano, mes: p.mes, periodo: p.periodo }) }, p.label));
  const selA = $("#cmp-a"), selB = $("#cmp-b");
  selA.innerHTML = ""; selB.innerHTML = "";
  periodos.forEach((p, i) => {
    selA.appendChild(el("option", { value: JSON.stringify({ ano: p.ano, mes: p.mes, periodo: p.periodo }) }, p.label));
    selB.appendChild(el("option", { value: JSON.stringify({ ano: p.ano, mes: p.mes, periodo: p.periodo }) }, p.label));
  });
  // padrão: A = segundo mais recente, B = mais recente
  if (periodos.length >= 2) { selA.selectedIndex = 1; selB.selectedIndex = 0; }
}
let cmpUltimo = null;
$("#cmp-run").addEventListener("click", async () => {
  const tipo = $("#cmp-tipo").value;
  const a = JSON.parse($("#cmp-a").value || "null");
  const b = JSON.parse($("#cmp-b").value || "null");
  if (!a || !b) { toast("Selecione os dois períodos.", "err"); return; }
  $("#cmp-cards").innerHTML = `<p><span class="spinner"></span> Comparando…</p>`;
  $("#cmp-resultado").innerHTML = "";
  const r = await postJSON("/api/comparar", { tipo, a, b });
  cmpUltimo = { tipo, a, b };
  $("#cmp-export").disabled = false;
  renderComparacao(r);
});
$("#cmp-export").addEventListener("click", () => {
  if (!cmpUltimo) { toast("Faça uma comparação primeiro.", "err"); return; }
  baixarPost("/api/exportar/comparacao", cmpUltimo);
});

function card(valor, rotulo, cls) {
  return el("div", { class: "card " + cls }, el("div", { class: "v" }, String(valor)), el("div", { class: "l" }, rotulo));
}

function renderComparacao(r) {
  const c = r.contagem;
  $("#cmp-cards").innerHTML = "";
  $("#cmp-cards").append(
    card(r.total_a, `${r.label_a} (total)`, "accent"),
    card(r.total_b, `${r.label_b} (total)`, "accent"),
    card(c.entradas, "Entradas", "green"),
    card(c.saidas, "Saídas", "red"),
    card(c.alteracoes, "Alterações", "amber"),
    card(c.mercosul, "→ Mercosul", "purple"),
    card(c.placa_trocada, "Placa trocada", "purple"),
    card(c.trocou_cdd || 0, "Transferência CDD", "accent"),
    card(c.inalterados, "Sem mudança", "gray"),
  );

  const cont = $("#cmp-resultado");
  cont.innerHTML = "";

  cont.appendChild(blocoSimples("Entradas (novos no período B)", "green", r.entradas, "entradas"));
  cont.appendChild(blocoSimples("Saídas (sumiram no período B)", "red", r.saidas, "saidas"));
  cont.appendChild(blocoMercosul("Placa alterada para Mercosul", r.mercosul));
  cont.appendChild(blocoMercosul("Placa trocada (mesmo chassi)", r.placa_trocada));
  cont.appendChild(blocoTransferencia("Transferências de CDD", r.transferencias_cdd || []));
  cont.appendChild(blocoAlteracoes("Alterações de campos", r.alteracoes));
}

function blocoSimples(titulo, cls, itens, nomeCsv) {
  const b = el("div", { class: "bloco" });
  const h = el("h3", {}, `${titulo} `);
  h.appendChild(el("span", { class: "badge " + cls }, String(itens.length)));
  b.appendChild(h);
  const headers = ["Placa", "Chassi", "Unidade", "Modelo", "Montadora", "Locadora", "Custo", "Ativo"];
  const linhas = itens.map((r) => [
    el("td", {}, r.placa || ""), el("td", {}, r.chassi || ""), el("td", {}, r.unidade || ""),
    el("td", {}, r.modelo || ""), el("td", {}, r.montadora || ""), el("td", {}, r.empresa_locadora || ""),
    el("td", { class: "num" }, moeda(r.custo_aluguel)), el("td", {}, r.ativo || ""),
  ]);
  b.appendChild(el("div", { class: "tabela-wrap" }, tabela(headers, linhas)));
  return b;
}

function blocoMercosul(titulo, itens) {
  const b = el("div", { class: "bloco" });
  const h = el("h3", {}, `${titulo} `);
  h.appendChild(el("span", { class: "badge purple" }, String(itens.length)));
  b.appendChild(h);
  const headers = ["Placa anterior", "→", "Placa nova", "Chassi", "Unidade", "Outras mudanças"];
  const linhas = itens.map((r) => [
    el("td", {}, el("span", { class: "de" }, r.placa_a || "")),
    el("td", {}, "→"),
    el("td", {}, el("span", { class: "para" }, r.placa_b || "")),
    el("td", {}, r.chassi || ""), el("td", {}, r.unidade || ""),
    el("td", {}, descMudancas((r.mudancas || []).filter((m) => m.campo !== "Placa"))),
  ]);
  b.appendChild(el("div", { class: "tabela-wrap" }, tabela(headers, linhas)));
  return b;
}

function blocoAlteracoes(titulo, itens) {
  const b = el("div", { class: "bloco" });
  const h = el("h3", {}, `${titulo} `);
  h.appendChild(el("span", { class: "badge amber" }, String(itens.length)));
  b.appendChild(h);
  const headers = ["Placa", "Chassi", "Unidade", "Mudanças"];
  const linhas = itens.map((r) => [
    el("td", {}, placaBadgeFlags(r)), el("td", {}, r.chassi || ""), el("td", {}, r.unidade || ""),
    el("td", {}, descMudancas(r.mudancas || [])),
  ]);
  b.appendChild(el("div", { class: "tabela-wrap" }, tabela(headers, linhas)));
  return b;
}
function blocoTransferencia(titulo, itens) {
  const b = el("div", { class: "bloco" });
  const h = el("h3", {}, `${titulo} `);
  h.appendChild(el("span", { class: "badge blue" }, String(itens.length)));
  b.appendChild(h);
  const headers = ["Placa", "Chassi", "Modelo", "Veio de", "→", "Foi para"];
  const linhas = itens.map((r) => [
    el("td", {}, r.placa || ""), el("td", {}, r.chassi || ""), el("td", {}, r.modelo || ""),
    el("td", {}, el("span", { class: "de" }, r.de || "")),
    el("td", {}, "→"),
    el("td", {}, el("span", { class: "para" }, r.para || "")),
  ]);
  b.appendChild(el("div", { class: "tabela-wrap" }, tabela(headers, linhas)));
  return b;
}
function placaBadgeFlags(r) {
  const span = el("span", {}, (r.placa || "") + " ");
  if ((r.flags || []).includes("chassi_corrigido")) span.appendChild(el("span", { class: "badge amber" }, "chassi"));
  if ((r.flags || []).includes("trocou_cdd")) span.appendChild(el("span", { class: "badge blue" }, "CDD"));
  return span;
}
function descMudancas(muds) {
  const span = el("span", { class: "mud" });
  muds.forEach((m, i) => {
    if (i) span.appendChild(el("br"));
    span.appendChild(el("b", {}, m.campo + ": "));
    span.appendChild(el("span", { class: "de" }, String(m.de ?? "—")));
    span.appendChild(document.createTextNode(" → "));
    span.appendChild(el("span", { class: "para" }, String(m.para ?? "—")));
  });
  return span;
}
// ----------------------------------------------------------------------------
// CONTINUIDADE (matriz vigência × placa)
// ----------------------------------------------------------------------------
const FLAG_INFO = {
  entrou:      { label: "entrou",      cls: "green"  },
  saiu:        { label: "saiu",        cls: "red"    },
  intermitente:{ label: "intermitente",cls: "amber"  },
  trocou_cdd:  { label: "trocou CDD", cls: "blue"   },
  mercosul:    { label: "Mercosul",    cls: "purple" },
  trocou_tipo: { label: "trocou tipo", cls: "orange" },
};

let contInit = false;
async function carregarContinuidade() {
  if (!contInit) {
    contInit = true;
    const [tipos, unidades] = await Promise.all([getJSON("/api/tipos"), getJSON("/api/unidades")]);
    const selT = $("#cont-tipo");
    selT.innerHTML = "";
    selT.appendChild(el("option", { value: "" }, "Todos"));
    tipos.forEach((t) => selT.appendChild(el("option", { value: t.tipo }, t.tipo)));
    const selU = $("#cont-unidade");
    unidades.forEach((u) => selU.appendChild(el("option", { value: u }, u)));
    selT.addEventListener("change", recarregarPeriodos);
    ["#cont-de", "#cont-ate", "#cont-unidade", "#cont-ordenar"].forEach((s) => $(s).addEventListener("change", buscarContinuidade));
    $("#cont-somente").addEventListener("change", buscarContinuidade);
    $("#cont-buscar").addEventListener("click", recarregarPeriodos);
    $("#cont-busca").addEventListener("keydown", (e) => { if (e.key === "Enter") recarregarPeriodos(); });
    $("#cont-export").addEventListener("click", () => { window.location.href = "/api/exportar/continuidade?" + contQuery(); });
  }
  await recarregarPeriodos();
}

function contQuery() {
  const p = new URLSearchParams();
  if ($("#cont-tipo").value) p.set("tipo", $("#cont-tipo").value);
  if ($("#cont-de").value) p.set("de", $("#cont-de").value);
  if ($("#cont-ate").value) p.set("ate", $("#cont-ate").value);
  if ($("#cont-unidade").value) p.set("unidade", $("#cont-unidade").value);
  if ($("#cont-busca").value) p.set("busca", $("#cont-busca").value);
  if ($("#cont-ordenar").value) p.set("ordenar", $("#cont-ordenar").value);
  if ($("#cont-somente").checked) p.set("somente", "1");
  return p.toString();
}

let contReq = 0;  // token para descartar respostas fora de ordem

// Repopula De/Até a partir dos períodos disponíveis do tipo e renderiza (faixa cheia).
async function recarregarPeriodos() {
  const token = ++contReq;
  $("#cont-info").innerHTML = `<span class="spinner"></span> Carregando…`;
  const p = new URLSearchParams();
  p.set("tipo", $("#cont-tipo").value);
  if ($("#cont-busca").value) p.set("busca", $("#cont-busca").value);
  if ($("#cont-unidade").value) p.set("unidade", $("#cont-unidade").value);
  if ($("#cont-ordenar").value) p.set("ordenar", $("#cont-ordenar").value);
  if ($("#cont-somente").checked) p.set("somente", "1");
  const d = await getJSON("/api/continuidade?" + p.toString());
  if (token !== contReq) return;  // chegou uma resposta mais nova
  const selDe = $("#cont-de"), selAte = $("#cont-ate");
  selDe.innerHTML = ""; selAte.innerHTML = "";
  // periodos_disponiveis vem antigo→recente do backend; inverte para exibir recente→antigo
  const periInv = [...(d.periodos_disponiveis || [])].reverse();
  periInv.forEach((per) => {
    selDe.appendChild(el("option", { value: per.chave }, per.label));
    selAte.appendChild(el("option", { value: per.chave }, per.label));
  });
  if (periInv.length) {
    // De = mais antigo (último item na lista invertida), Até = mais recente (primeiro)
    selDe.selectedIndex = periInv.length - 1;
    selAte.selectedIndex = 0;
  }
  renderContResposta(d);  // sem De/Até = faixa cheia
}

async function buscarContinuidade() {
  const token = ++contReq;
  $("#cont-info").innerHTML = `<span class="spinner"></span> Carregando…`;
  const d = await getJSON("/api/continuidade?" + contQuery());
  if (token !== contReq) return;
  renderContResposta(d);
}

function renderContResposta(d) {
  $("#cont-info").innerHTML =
    `${d.n_linhas} placa(s) × ${d.n_colunas} período(s).` +
    (d.n_linhas ? ` <span class="badge amber">${d.n_com_alteracao} com alteração</span>` : "");
  renderMatriz(d);
}

function sinaisCelula(r) {
  const box = el("div", { class: "sinais-inline" });
  r.flags.forEach((f) => {
    const info = FLAG_INFO[f] || { label: f, cls: "gray" };
    box.appendChild(el("span", { class: "badge " + info.cls }, info.label));
  });
  if (r.cdd_origem) {
    box.appendChild(el("span", { class: "veio" }, "← veio de " + r.cdd_origem));
  }
  // Indica direção da troca de tipo
  if (r.tipo_destino && r.tipo_destino.length) {
    box.appendChild(el("span", { class: "veio" }, "→ foi para: " + r.tipo_destino.join(", ")));
  }
  if (r.tipo_origem && r.tipo_origem.length) {
    box.appendChild(el("span", { class: "veio" }, "← veio de: " + r.tipo_origem.join(", ")));
  }
  return box;
}

function renderMatriz(d) {
  const t = el("table", { class: "matriz", id: "cont-tabela" });
  const trh = el("tr", {}, el("th", { class: "sticky-col" }, "Placa · sinalizações"));
  d.colunas.forEach((c) => trh.appendChild(el("th", {}, c.label)));
  t.appendChild(el("thead", {}, trh));

  const tb = el("tbody");
  if (!d.linhas.length) {
    tb.appendChild(el("tr", {}, el("td", { class: "sticky-col" }, "—"),
      el("td", { colspan: d.colunas.length || 1 }, el("div", { class: "vazio" }, "Nenhuma placa para os filtros."))));
  }
  for (const r of d.linhas) {
    const tr = el("tr", {});
    const ident = el("td", { class: "sticky-col" },
      el("div", { class: "pl" }, r.placa || r.chassi || r.id),
      el("div", { class: "ch" }, [r.placa ? (r.chassi || "") : "", r.unidade ? " · " + r.unidade : ""].join("")),
      sinaisCelula(r));
    tr.appendChild(ident);
    const changeSet = new Set(r.cdd_change_idx || []);
    r.seq.forEach((x, i) => {
      let cls = "cel";
      let title = d.colunas[i].label;
      const cdd = (r.unid_seq || [])[i];
      if (x) { cls += " presente"; if (cdd) title += " · CDD: " + cdd; }
      else if (i > r.first && i < r.last) { cls += " lacuna"; title += " — ausente (voltou depois)"; }
      else if (i === r.seq.length - 1 && !x && r.total > 0) { cls += " saiu"; title += " — ausente (saiu)"; }
      if (changeSet.has(i)) { cls += " cdd-change"; title += " — trocou de CDD aqui"; }
      tr.appendChild(el("td", { class: cls, title }, (x && !changeSet.has(i)) ? el("span", { class: "dot" }) : ""));
    });
    tb.appendChild(tr);
  }
  t.appendChild(tb);

  if (d.linhas.length) {
    const trt = el("tr", { class: "linha-total" }, el("td", { class: "sticky-col" }, "Total"));
    d.totais.forEach((v) => trt.appendChild(el("td", { class: "matriz-total" }, String(v))));
    t.appendChild(el("tfoot", {}, trt));
  }
  $("#cont-tabela").replaceWith(t);
}

// ----------------------------------------------------------------------------
// VERIFICAR BASE
// ----------------------------------------------------------------------------
let verifResultados = [];
let verifInit = false;

async function carregarVerificar() {
  if (verifInit) return;
  verifInit = true;
  try {
    const periodos = await getJSON("/api/periodos_global");
    // já vem recente→antigo do backend
    [$("#verif-de"), $("#verif-ate")].forEach((sel) => {
      periodos.forEach((p) => sel.appendChild(el("option", { value: p.chave }, p.label)));
    });
  } catch (_) { /* servidor ainda não reiniciado — ignora */ }
}

function _verifAusencia(r) {
  if (!r.encontrado || r.dias_ausente == null) return el("td", {});
  const d = r.dias_ausente;
  if (d <= 20) return el("td", {}, el("span", { class: "badge green", title: `Última aparição há ${d} dia(s)` }, `${d} dias`));
  if (d <= 45) return el("td", {}, el("span", { class: "badge amber", title: `Fora da base há ${d} dia(s)` }, `${d} dias`));
  return el("td", {}, el("span", { class: "badge red", title: `Fora da base há ${d} dia(s)` }, `${d} dias`));
}

function _verifTrocaCdd(r) {
  const hist = r.historico_unidade || [];
  if (!hist.length) return el("td", {}, "");
  if (hist.length === 1) {
    return el("td", {},
      el("span", { class: "de" }, hist[0].de || ""),
      document.createTextNode(" → "),
      el("span", { class: "para" }, hist[0].para || ""));
  }
  return el("td", {},
    el("span", { class: "linkish", onclick: () => verPeriodos(r) },
      el("span", { class: "badge blue" }, `${hist.length} trocas`)));
}

$("#verif-file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) { $("#verif-file").dataset.nome = f.name; toast("Planilha selecionada: " + f.name); }
});

$("#verif-run").addEventListener("click", async () => {
  const fd = new FormData();
  const texto = $("#verif-texto").value.trim();
  if (texto) fd.append("itens", texto);
  const f = $("#verif-file").files[0];
  if (f) fd.append("arquivo", f);
  if (!texto && !f) { toast("Cole placas/chassis ou envie uma planilha.", "err"); return; }
  const de = $("#verif-de").value;
  const ate = $("#verif-ate").value;
  if (de) fd.append("de", de);
  if (ate) fd.append("ate", ate);
  $("#verif-info").innerHTML = `<span class="spinner"></span> Verificando…`;
  const r = await fetch("/api/verificar", { method: "POST", body: fd });
  const data = await r.json();
  if (data.erro) { $("#verif-info").textContent = data.erro; return; }
  verifResultados = data.resultados;
  $("#verif-info").innerHTML =
    `<span class="badge green">${data.encontrados} encontrados</span>  <span class="badge red">${data.nao_encontrados} não encontrados</span>  de ${data.total}.`;
  const headers = ["Consulta", "Situação", "Critério", "Tipo", "Placa", "Chassi",
                   "Unidade", "Troca CDD", "Data ref.", "Ausência", "Períodos", "Primeiro", "Último"];
  const linhas = data.resultados.map((r) => [
    el("td", {}, r.consulta),
    el("td", {}, r.encontrado ? el("span", { class: "badge green" }, "na base") : el("span", { class: "badge red" }, "ausente")),
    el("td", {}, r.criterio || ""),
    el("td", {}, r.tipo || ""),
    el("td", {}, r.placa || ""),
    el("td", {}, r.chassi || ""),
    el("td", {}, r.unidade_atual || ""),
    _verifTrocaCdd(r),
    el("td", {}, r.data_referencia || ""),
    _verifAusencia(r),
    el("td", {}, r.encontrado ? el("span", { class: "linkish", onclick: () => verPeriodos(r) }, `${r.n_periodos} ▸`) : ""),
    el("td", {}, r.primeiro_periodo || ""),
    el("td", {}, r.ultimo_periodo || ""),
  ]);
  $("#verif-tabela").replaceWith(Object.assign(tabela(headers, linhas), { id: "verif-tabela" }));
});

function verPeriodos(r) {
  $("#modal-titulo").textContent = `Períodos · ${r.placa || r.chassi || r.consulta}`;
  const headers = ["Tipo", "Período", "Unidade"];
  const linhas = (r.periodos || []).map((p) => el("tr", {},
    el("td", {}, p.tipo), el("td", {}, p.periodo), el("td", {}, p.unidade || "")));
  $("#modal-corpo").innerHTML = "";
  $("#modal-corpo").appendChild(el("table", {},
    el("thead", {}, el("tr", {}, ...headers.map((h) => el("th", {}, h)))),
    el("tbody", {}, ...linhas)));
  $("#modal").classList.remove("oculto");
}

$("#verif-export").addEventListener("click", () => {
  if (!verifResultados.length) { toast("Faça uma verificação primeiro.", "err"); return; }
  const itens = verifResultados.map((r) => r.consulta);
  const de = $("#verif-de").value || null;
  const ate = $("#verif-ate").value || null;
  baixarPost("/api/exportar/verificacao", { itens, de, ate });
});

// ----------------------------------------------------------------------------
// HISTÓRICO DE IMPORTAÇÕES (aba Importar)
// ----------------------------------------------------------------------------
async function carregarHistorico() {
  try {
    const data = await getJSON("/api/historico");
    if (!Array.isArray(data)) throw new Error(data.erro || "resposta inesperada");
    const h2 = ["Arquivo", "Tipo", "Vigência", "Linhas", "Substituiu", "Quando"];
    const l2 = data.map((h) => [
      el("td", {}, h.arquivo || ""), el("td", {}, h.tipo || ""), el("td", {}, h.vigencia || ""),
      el("td", { class: "num" }, fmtNum(h.n_linhas)),
      el("td", {}, h.substituiu ? "sim" : "não"),
      el("td", {}, (h.imported_at || "").replace("T", " ")),
    ]);
    $("#hist-tabela").replaceWith(Object.assign(tabela(h2, l2), { id: "hist-tabela" }));
  } catch (e) {
    toast("Histórico: " + e.message + " — reinicie o servidor", "err");
  }
}

// ----------------------------------------------------------------------------
// RESUMO
// ----------------------------------------------------------------------------
let resumoInit = false;

const DIM_CONFIG = {
  locadora:         { colunas: ["empresa_locadora"], headers: ["Locadora"] },
  tipo:             { colunas: ["tipo"],             headers: ["Tipo de equipamento"] },
  unidade:          { colunas: ["unidade"],          headers: ["Operação (CDD)"] },
  locadora_tipo:    { colunas: ["empresa_locadora", "tipo"],    headers: ["Locadora", "Tipo"] },
  locadora_unidade: { colunas: ["empresa_locadora", "unidade"], headers: ["Locadora", "Operação"] },
  tipo_unidade:     { colunas: ["tipo", "unidade"],             headers: ["Tipo", "Operação"] },
};

async function carregarResumo() {
  const p = new URLSearchParams();
  if ($("#res-periodo").value)  p.set("pchave",   $("#res-periodo").value);
  if ($("#res-unidade").value)  p.set("unidade",  $("#res-unidade").value);
  if ($("#res-tipo").value)     p.set("tipo",      $("#res-tipo").value);

  const data = await getJSON("/api/resumo?" + p.toString());

  if (!resumoInit) {
    resumoInit = true;
    const selU = $("#res-unidade");
    (data.unidades || []).forEach((u) => selU.appendChild(el("option", { value: u }, u)));

    const selP = $("#res-periodo");
    (data.periodos || []).forEach((pr) =>
      selP.appendChild(el("option", { value: pr.chave }, pr.label)));

    const selT = $("#res-tipo");
    (data.todos_tipos || data.tipos || []).forEach((t) => {
      const nome = typeof t === "string" ? t : t.tipo;
      selT.appendChild(el("option", { value: nome }, nome));
    });

    [selU, selP, selT].forEach((s) => s.addEventListener("change", carregarResumo));
    $("#res-dimensao").addEventListener("change", renderCustos);
    $("#res-limpar").addEventListener("click", () => {
      selU.value = ""; selP.value = ""; selT.value = "";
      carregarResumo();
    });
  }

  const cont = $("#resumo-tipos");
  cont.innerHTML = "";
  (data.tipos || []).forEach((t) => cont.appendChild(card(t.n, t.tipo, "accent")));

  await renderCustos();
}

async function renderCustos() {
  const dim = $("#res-dimensao").value || "locadora";
  const cfg = DIM_CONFIG[dim] || DIM_CONFIG.locadora;
  const p = new URLSearchParams();
  p.set("dimensao", dim);
  if ($("#res-periodo").value)  p.set("pchave",  $("#res-periodo").value);
  if ($("#res-unidade").value)  p.set("unidade", $("#res-unidade").value);
  if ($("#res-tipo").value)     p.set("tipo",    $("#res-tipo").value);
  try {
    const data = await getJSON("/api/custos?" + p.toString());
    if (!Array.isArray(data)) throw new Error(data.erro || "resposta inesperada");

    // totalizadores
    const totEq       = data.reduce((s, r) => s + r.n, 0);
    const totComCusto = data.reduce((s, r) => s + r.n_com_custo, 0);
    const totCusto    = data.reduce((s, r) => s + (r.custo_total || 0), 0);
    const cc = $("#custo-cards");
    cc.innerHTML = "";
    cc.append(
      card(fmtNum(totEq),       "Total equipamentos",      "accent"),
      card(fmtNum(totComCusto), "Com custo registrado",    "amber"),
      card(moeda(totCusto),     "Custo total do período",  "green"),
    );

    // tabela dinâmica
    const headers = [...cfg.headers, "Qtd", "Com custo", "Custo total", "Custo médio/unid."];
    const linhas = data.map((r) => [
      ...cfg.colunas.map((c) => el("td", {}, r[c] || "—")),
      el("td", { class: "num" }, fmtNum(r.n)),
      el("td", { class: "num" }, fmtNum(r.n_com_custo)),
      el("td", { class: "num" }, moeda(r.custo_total)),
      el("td", { class: "num" }, moeda(r.custo_medio)),
    ]);
    $("#custo-tabela").replaceWith(Object.assign(tabela(headers, linhas), { id: "custo-tabela" }));
  } catch (e) {
    toast("Análise de custos: " + e.message + " — reinicie o servidor", "err");
  }
}

// ----------------------------------------------------------------------------
// AUDITORIA — helpers compartilhados
// ----------------------------------------------------------------------------
function _statusBadge(status) {
  if (status === "DEVIDA")     return el("span", { class: "badge devida" }, "DEVIDA");
  if (status === "NÃO DEVIDA") return el("span", { class: "badge ndevida" }, "NÃO DEVIDA");
  if (status === "VERIFICAR")  return el("span", { class: "badge verificar" }, "VERIFICAR");
  return el("span", {}, status || "");
}

function _nomeArquivo(inputEl, spanEl) {
  inputEl.addEventListener("change", () => {
    const f = inputEl.files[0];
    spanEl.textContent = f ? ("📄 " + f.name) : spanEl.dataset.orig;
  });
}

// ----------------------------------------------------------------------------
// AUDITORIA — MULTAS
// ----------------------------------------------------------------------------
let mulResultados = null;
let mulHeaders = [];

_nomeArquivo($("#mul-arquivo"), $("#mul-arq-nome"));
$("#mul-arq-nome").dataset.orig = "📄 Planilha de multas";

async function carregarUltimaDataSaida() {
  const bar = $("#aud-saida-info");
  if (!bar) return;
  try {
    const d = await getJSON("/api/ultima_data_saida");
    if (d.ultima_data) {
      bar.innerHTML = "";
      bar.appendChild(el("span", { class: "si-label" }, "Checklist de saídas:"));
      bar.appendChild(el("span", { class: "si-date" }, d.ultima_data));
      bar.appendChild(el("span", { class: "si-label" }, `— ${d.total} registros`));
    } else {
      bar.innerHTML = "";
      bar.appendChild(el("span", { class: "si-none" }, "⚠ Nenhum checklist de saídas importado. Vá à aba Importar para adicionar."));
    }
  } catch (e) { /* ignora */ }

  const barU = $("#aud-unidocs-info");
  if (!barU) return;
  try {
    const u = await getJSON("/api/ultima_data_unidocs");
    if (u.ultima_data) {
      barU.innerHTML = "";
      barU.appendChild(el("span", { class: "si-label" }, "Unidocs (CT-e):"));
      barU.appendChild(el("span", { class: "si-date" }, u.ultima_data));
      barU.appendChild(el("span", { class: "si-label" }, `— ${u.total} registros`));
    } else {
      barU.innerHTML = "";
      barU.appendChild(el("span", { class: "si-none" }, "⚠ Nenhum CT-e do Unidocs importado. Vá à aba Importar para adicionar."));
    }
  } catch (e) { /* ignora */ }
}

$("#mul-run").addEventListener("click", async () => {
  const arq = $("#mul-arquivo").files[0];
  if (!arq) { toast("Selecione a planilha de multas.", "err"); return; }
  const fd = new FormData();
  fd.append("arquivo", arq);
  $("#mul-info").innerHTML = `<span class="spinner"></span> Verificando…`;
  $("#mul-export").disabled = true;
  mulResultados = null;
  try {
    const r = await fetch("/api/auditoria/multas", { method: "POST", body: fd });
    const data = await r.json();
    if (data.erro) { $("#mul-info").textContent = "Erro: " + data.erro; return; }
    mulResultados = data.resultados;
    mulHeaders = data.headers || [];
    $("#mul-info").innerHTML =
      `<span class="badge devida">${data.devidas} devidas</span>  ` +
      `<span class="badge ndevida">${data.nao_devidas} não devidas</span>  ` +
      `<span class="badge verificar">${data.verificar} verificar</span>  ` +
      `de ${data.total}.`;
    _renderMultas(mulHeaders, data.resultados);
    $("#mul-export").disabled = false;
  } catch (e) {
    $("#mul-info").textContent = "Erro: " + e.message;
  }
});

function _renderMultas(headers, resultados) {
  const hdrs = [...headers,
    "Campo encontrado", "No banco?", "Período coincide?",
    "Unidade na data", "No checklist?", "Data próxima (saída)", "Unidade na data próxima",
    "No Unidocs?", "Data próxima (Unidocs)", "Placa parceira próxima", "STATUS"];
  const linhas = resultados.map((r) => [
    ...headers.map((h) => el("td", {}, String(r[h] ?? ""))),
    el("td", { class: "center" }, r._campo_match || ""),
    el("td", { class: "center" }, r._encontrado_banco === "SIM"
      ? el("span", { class: "badge green" }, "SIM")
      : el("span", { class: "badge gray" }, "NÃO")),
    el("td", { class: "center" }, r._periodo_coincide || ""),
    el("td", {}, r._unidade_momento || ""),
    el("td", { class: "center" }, r._encontrado_saida === "SIM"
      ? el("span", { class: "badge green" }, r._filial_saida || "SIM") : "—"),
    el("td", { class: "center" }, r._saida_data_proxima || "—"),
    el("td", {}, r._saida_filial_proxima || "—"),
    el("td", { class: "center" }, r._encontrado_unidocs === "SIM"
      ? el("span", { class: "badge green" }, r._unidocs_parceira || "SIM")
      : el("span", { class: "badge gray" }, "NÃO")),
    el("td", { class: "center" }, r._unidocs_data_proxima || "—"),
    el("td", {}, r._unidocs_parceira_proxima || "—"),
    el("td", { class: "center" }, _statusBadge(r._status)),
  ]);
  $("#mul-tabela").replaceWith(Object.assign(tabela(hdrs, linhas), { id: "mul-tabela" }));
}

$("#mul-export").addEventListener("click", () => {
  if (!mulResultados) { toast("Faça uma verificação primeiro.", "err"); return; }
  baixarPost("/api/exportar/auditoria/multas", { headers: mulHeaders, resultados: mulResultados });
});

// ----------------------------------------------------------------------------
// AUDITORIA — LOCAÇÃO
// ----------------------------------------------------------------------------
let locResultados = null;
let locHeaders = [];

_nomeArquivo($("#loc-arquivo"), $("#loc-arq-nome"));
$("#loc-arq-nome").dataset.orig = "📄 Planilha de locação";

$("#loc-run").addEventListener("click", async () => {
  const arq = $("#loc-arquivo").files[0];
  if (!arq) { toast("Selecione a planilha de locação.", "err"); return; }
  const fd = new FormData();
  fd.append("arquivo", arq);
  $("#loc-info").innerHTML = `<span class="spinner"></span> Verificando…`;
  $("#loc-export").disabled = true;
  locResultados = null;
  try {
    const r = await fetch("/api/auditoria/locacao", { method: "POST", body: fd });
    const data = await r.json();
    if (data.erro) { $("#loc-info").textContent = "Erro: " + data.erro; return; }
    locResultados = data.resultados;
    locHeaders = data.headers || [];
    $("#loc-info").innerHTML =
      `<span class="badge devida">${data.devidas} devidas</span>  ` +
      `<span class="badge ndevida">${data.nao_devidas} não devidas</span>  ` +
      `<span class="badge verificar">${data.verificar} verificar</span>  ` +
      `de ${data.total}.`;
    _renderLocacao(locHeaders, data.resultados);
    $("#loc-export").disabled = false;
  } catch (e) {
    $("#loc-info").textContent = "Erro: " + e.message;
  }
});

function _renderLocacao(headers, resultados) {
  const hdrs = [...headers,
    "Campo encontrado", "No banco?", "Período coincide?",
    "Períodos coincidentes", "Unidade",
    "Valor cobrado", "Valor recebido (FT)", "Diferença %",
    "Quinzenas sem pagamento FT", "STATUS"];
  const linhas = resultados.map((r) => {
    const dif = r._dif_raw;
    const difCls = dif == null ? "" : dif < 0 ? "telem-sem-telem" : "telem-ok";
    const faltantes = r._quinzenas_faltantes || "";
    const faltanteNode = faltantes
      ? el("span", { class: "badge amber", title: faltantes }, "⚠ " + faltantes)
      : document.createTextNode("—");
    return [
      ...headers.map((h) => el("td", {}, String(r[h] ?? ""))),
      el("td", { class: "center" }, r._campo_match || ""),
      el("td", { class: "center" }, r._encontrado_banco === "SIM"
        ? el("span", { class: "badge green" }, "SIM")
        : el("span", { class: "badge gray" }, "NÃO")),
      el("td", { class: "center" }, r._periodo_coincide || ""),
      el("td", {}, r._periodos_coincidentes || ""),
      el("td", {}, r._unidade || ""),
      el("td", { class: "center" }, r._valor_cobrado || "—"),
      el("td", { class: "center" }, r._valor_recebido || "—"),
      el("td", { class: `center ${difCls}` }, r._dif_percentual || "—"),
      el("td", {}, faltanteNode),
      el("td", { class: "center" }, _statusBadge(r._status)),
    ];
  });
  $("#loc-tabela").replaceWith(Object.assign(tabela(hdrs, linhas), { id: "loc-tabela" }));
}

$("#loc-export").addEventListener("click", () => {
  if (!locResultados) { toast("Faça uma verificação primeiro.", "err"); return; }
  baixarPost("/api/exportar/auditoria/locacao", { headers: locHeaders, resultados: locResultados });
});

// ----------------------------------------------------------------------------
// STRESS TEST
// ----------------------------------------------------------------------------
let stDados = [];
let stUnidadesFiltro = new Set();
let stSortCol = null;
let stSortDir = "asc";

function carregarStress() {
  // pré-preenche mês atual se vazio
  if (!$("#st-mes").value) {
    const hoje = new Date();
    $("#st-mes").value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  }
}

$("#st-run").addEventListener("click", rodarStressTest);
$("#st-mes").addEventListener("keydown", (e) => { if (e.key === "Enter") rodarStressTest(); });

async function rodarStressTest() {
  const mesVal = $("#st-mes").value;
  if (!mesVal) { toast("Selecione o mês.", "err"); return; }
  const [ano, mes] = mesVal.split("-");
  $("#st-info").innerHTML = `<span class="spinner"></span> Analisando…`;
  $("#st-cards").innerHTML = "";
  try {
    stDados = await getJSON(`/api/stress_test?ano=${ano}&mes=${mes}`);
    _popularUnidadesMS(stDados);
    stSortCol = null; stSortDir = "asc";
    _renderStress(stDados);
  } catch (e) {
    $("#st-info").textContent = "Erro: " + e.message;
  }
}

$("#st-somente-problemas").addEventListener("change", () => { if (stDados.length) _renderStress(stDados); });

// Chips de unidade
function _popularUnidadesMS(dados) {
  const unidades = [...new Set(dados.map((r) => r.unidade || "").filter(Boolean))].sort();
  const wrap = $("#st-unidade-chips");
  wrap.innerHTML = "";
  stUnidadesFiltro.clear();
  unidades.forEach((u) => {
    const btn = el("button", { type: "button", class: "chip" }, u);
    btn.addEventListener("click", () => {
      if (stUnidadesFiltro.has(u)) { stUnidadesFiltro.delete(u); btn.classList.remove("ativo"); }
      else { stUnidadesFiltro.add(u); btn.classList.add("ativo"); }
      if (stDados.length) _renderStress(stDados);
    });
    wrap.appendChild(btn);
  });
}

// Extratores de valor para ordenação (por índice de coluna)
const _ST_SORT_KEY = [
  (r) => r.tipo || "",
  (r) => r.placa || "",
  (r) => r.unidade || "",
  (r) => r.n_saidas ?? 0,
  (r) => { // Último checklist DD/MM/YYYY → YYYYMMDD para comparação
    const d = r.ultima_saida;
    if (!d) return "00000000";
    const [dd, mm, aa] = d.split("/");
    return `${aa}${mm}${dd}`;
  },
  (r) => r.dias_sem_saida ?? 99999,
  (r) => Object.entries(r.por_filial || {}).map(([f, n]) => `${f}:${n}`).join(","),
  (r) => { // Status: sem_saida=0, divergente=1, sem_checklist=2, ok=3
    if (!r.tem_checklist) return 2;
    if (r.sem_saida) return 0;
    if (r.filial_divergente) return 1;
    return 3;
  },
];

function _renderStress(dados) {
  if (!dados.length) {
    $("#st-info").textContent = "Nenhuma placa encontrada para o mês selecionado.";
    $("#st-tabela").replaceWith(Object.assign(document.createElement("table"), { id: "st-tabela" }));
    return;
  }

  // Filtra por unidade selecionada (multi-select)
  const base = stUnidadesFiltro.size > 0
    ? dados.filter((r) => stUnidadesFiltro.has(r.unidade || ""))
    : dados;

  // Cards e resumo usam `base` (com filtro de unidade, sem o checkbox "só problemas")
  const total      = base.length;
  const semSaida   = base.filter((r) => r.sem_saida && r.tem_checklist).length;
  const divergente = base.filter((r) => r.filial_divergente).length;
  const semDados   = base.filter((r) => !r.tem_checklist).length;
  const ok         = total - semSaida - divergente - semDados;

  const cardsEl = $("#st-cards");
  cardsEl.innerHTML = "";
  cardsEl.appendChild(card(total,      "Total de placas",        ""));
  cardsEl.appendChild(card(ok,         "Com saída OK",           "green"));
  cardsEl.appendChild(card(semSaida,   "Sem saída no mês",       semSaida   ? "red"    : ""));
  cardsEl.appendChild(card(divergente, "Filial divergente",      divergente ? "orange" : ""));
  if (semDados) cardsEl.appendChild(card(semDados, "Sem checklist (T1)", "gray"));

  // Resumo por filial — agrupado sobre `base` (respeita filtro de unidade)
  const porFilialMap = {};
  for (const r of base) {
    const f = r.unidade || "(sem unidade)";
    if (!porFilialMap[f]) porFilialMap[f] = { total: 0, ok: 0, sem_saida: 0, divergente: 0, sem_checklist: 0 };
    porFilialMap[f].total++;
    if (!r.tem_checklist)         porFilialMap[f].sem_checklist++;
    else if (r.sem_saida)         porFilialMap[f].sem_saida++;
    else if (r.filial_divergente) porFilialMap[f].divergente++;
    else                          porFilialMap[f].ok++;
  }
  const filiaisOrdenadas = Object.keys(porFilialMap).sort();
  const hdrsF = ["Filial / Unidade", "Total", "OK", "Sem saída", "Filial divergente", "Sem checklist"];
  const linhasF = filiaisOrdenadas.map((f) => {
    const g = porFilialMap[f];
    const temProblema = g.sem_saida > 0 || g.divergente > 0;
    return [
      el("td", { class: temProblema ? "st-filial-nome problema" : "st-filial-nome" }, f),
      el("td", { class: "num" }, String(g.total)),
      el("td", { class: "num" }, g.ok            ? el("span", { class: "badge green"  }, String(g.ok))            : document.createTextNode("—")),
      el("td", { class: "num" }, g.sem_saida     ? el("span", { class: "badge red"    }, String(g.sem_saida))     : document.createTextNode("—")),
      el("td", { class: "num" }, g.divergente    ? el("span", { class: "badge orange" }, String(g.divergente))    : document.createTextNode("—")),
      el("td", { class: "num" }, g.sem_checklist ? el("span", { class: "badge gray"   }, String(g.sem_checklist)) : document.createTextNode("—")),
    ];
  });
  const tblFilial = tabela(hdrsF, linhasF);
  tblFilial.classList.add("st-resumo-filial");
  const resumoFilialEl = document.getElementById("st-resumo-filial") || el("div", { id: "st-resumo-filial", class: "st-resumo-wrap" });
  resumoFilialEl.innerHTML = "<h3 class='st-sub'>Resumo por filial</h3>";
  resumoFilialEl.appendChild(tblFilial);
  const stTabela0 = document.getElementById("st-tabela");
  if (!document.getElementById("st-resumo-filial")) stTabela0.before(resumoFilialEl);

  // Aplica checkbox "só problemas" sobre `base`
  const somente = $("#st-somente-problemas").checked;
  let visiveis = somente ? base.filter((r) => (r.sem_saida && r.tem_checklist) || r.filial_divergente) : base;

  $("#st-info").textContent = somente
    ? `${visiveis.length} com problema(s) de ${total} placa(s) analisada(s).`
    : `${total} placa(s) analisada(s).`;

  // Ordenação
  if (stSortCol !== null) {
    const key = _ST_SORT_KEY[stSortCol];
    visiveis = [...visiveis].sort((a, b) => {
      const va = key(a), vb = key(b);
      if (va < vb) return stSortDir === "asc" ? -1 : 1;
      if (va > vb) return stSortDir === "asc" ? 1 : -1;
      return 0;
    });
  }

  // Tabela de placas
  const hdrs = ["Tipo", "Placa", "Unidade", "Qtd saídas", "Último checklist", "Dias sem saída", "Por filial", "Status"];
  const linhas = visiveis.map((r) => {
    const porFilialTxt = Object.entries(r.por_filial || {})
      .map(([f, n]) => `${f}: ${n}`)
      .join(" · ") || "—";

    let statusNode;
    if (!r.tem_checklist) {
      statusNode = el("span", { class: "badge gray" }, "sem checklist");
    } else if (r.sem_saida) {
      statusNode = el("span", { class: "badge red" }, "sem saída");
    } else if (r.filial_divergente) {
      statusNode = el("span", { class: "badge orange" }, "filial divergente");
    } else {
      statusNode = el("span", { class: "badge green" }, "ok");
    }

    let diasNode;
    if (r.dias_sem_saida === null) {
      diasNode = el("span", { class: "dias-sem-saida" }, "nunca");
    } else if (r.dias_sem_saida > 0) {
      diasNode = el("span", { class: "dias-sem-saida" }, `${r.dias_sem_saida}d`);
    } else {
      diasNode = document.createTextNode("—");
    }

    return [
      el("td", { class: "center" }, r.tipo || ""),
      el("td", {}, placaBadge(r.placa, null)),
      el("td", {}, r.unidade || ""),
      el("td", { class: "center" }, String(r.n_saidas)),
      el("td", { class: "center st-data" }, r.ultima_saida || "—"),
      el("td", { class: "center" }, diasNode),
      el("td", { class: "st-filial" }, porFilialTxt),
      el("td", { class: "center" }, statusNode),
    ];
  });

  const novaTabela = Object.assign(tabela(hdrs, linhas), { id: "st-tabela" });

  // Cabeçalhos clicáveis para ordenação
  novaTabela.querySelectorAll("th").forEach((th, i) => {
    th.classList.add("th-sort");
    const icon = el("span", { class: stSortCol === i ? "sort-icon th-sorted" : "sort-icon" },
      stSortCol === i ? (stSortDir === "asc" ? " ▲" : " ▼") : " ⇅");
    th.appendChild(icon);
    th.addEventListener("click", () => {
      if (stSortCol === i) stSortDir = stSortDir === "asc" ? "desc" : "asc";
      else { stSortCol = i; stSortDir = "asc"; }
      _renderStress(stDados);
    });
  });

  document.getElementById("st-tabela").replaceWith(novaTabela);
}

$("#st-export").addEventListener("click", () => {
  if (!stDados.length) { toast("Faça uma análise primeiro.", "err"); return; }
  const mesVal = $("#st-mes").value || "";
  const [ano, mes] = mesVal.split("-");
  window.location.href = `/api/exportar/stress_test?ano=${ano}&mes=${mes}`;
});

// ============================================================================
// TELEMETRIA
// ============================================================================
let telemDados = [];

// --- Status central de importações ---
async function carregarStatusImportacoes() {
  // FT: última importação do histórico
  try {
    const hist = await getJSON("/api/historico");
    const bar = $("#ft-status-bar");
    if (bar) {
      if (hist.length) {
        const last = hist[0];
        bar.className = "imp-status ok";
        bar.textContent = `✓ Última importação: ${last.imported_at} · ${last.arquivo}`;
      } else {
        bar.className = "imp-status";
        bar.textContent = "Nenhuma importação registrada.";
      }
    }
  } catch (_) {}

  // Checklist T2
  try {
    const d = await getJSON("/api/ultima_data_saida");
    const bar = $("#checklist-status-bar");
    if (bar) {
      if (d.total > 0) {
        bar.className = "imp-status ok";
        bar.textContent = `✓ ${d.total.toLocaleString("pt-BR")} registros · última data: ${d.ultima_data}`;
      } else {
        bar.className = "imp-status";
        bar.textContent = "Nenhum registro importado.";
      }
    }
  } catch (_) {}

  // Unidocs T1
  try {
    const d = await getJSON("/api/ultima_data_unidocs");
    const bar = $("#unidocs-status-bar");
    if (bar) {
      if (d.total > 0) {
        bar.className = "imp-status ok";
        bar.textContent = `✓ ${d.total.toLocaleString("pt-BR")} registros · última data: ${d.ultima_data}`;
      } else {
        bar.className = "imp-status";
        bar.textContent = "Nenhum registro importado.";
      }
    }
  } catch (_) {}

  // Geotab + Trimble
  try {
    const d = await getJSON("/api/telemetria/info");
    const geoEl = $("#geo-status");
    if (geoEl) {
      if (d.geotab.total > 0) {
        geoEl.className = "imp-status ok";
        geoEl.textContent = `✓ ${d.geotab.total.toLocaleString("pt-BR")} placas · ${d.geotab.importado_em}`;
      } else {
        geoEl.className = "imp-status";
        geoEl.textContent = "Nenhuma placa importada.";
      }
    }
    const triEl = $("#tri-status");
    if (triEl) {
      if (d.trimble.total > 0) {
        triEl.className = "imp-status ok";
        triEl.textContent = `✓ ${d.trimble.total.toLocaleString("pt-BR")} placas · ${d.trimble.importado_em}`;
      } else {
        triEl.className = "imp-status";
        triEl.textContent = "Nenhuma placa importada.";
      }
    }
  } catch (_) {}

  // KM Geotab + KM Veltec
  try {
    const d = await getJSON("/api/km-mensal/info");
    const kmGeoEl = $("#kmgeo-status");
    if (kmGeoEl) {
      kmGeoEl.className = d.geotab.total ? "imp-status ok" : "imp-status";
      kmGeoEl.textContent = d.geotab.total
        ? `✓ ${d.geotab.total.toLocaleString("pt-BR")} registros · ${d.geotab.meses} mês(es) · ${d.geotab.importado_em}`
        : "Nenhum mês importado.";
    }
    const kmVelEl = $("#kmvel-status");
    if (kmVelEl) {
      kmVelEl.className = d.veltec.total ? "imp-status ok" : "imp-status";
      kmVelEl.textContent = d.veltec.total
        ? `✓ ${d.veltec.total.toLocaleString("pt-BR")} registros · ${d.veltec.meses} mês(es) · ${d.veltec.importado_em}`
        : "Nenhum mês importado.";
    }
  } catch (_) {}

  // Combustível
  try {
    const d = await getJSON("/api/combustivel/info");
    const combEl = $("#comb-status");
    if (combEl) {
      combEl.className = d.total ? "imp-status ok" : "imp-status";
      combEl.textContent = d.total
        ? `✓ ${d.total.toLocaleString("pt-BR")} abastecimentos · ${d.meses} mês(es) · ${d.importado_em}`
        : "Nenhum mês importado.";
    }
  } catch (_) {}
}

// --- Importação Geotab ---
const geoFile = $("#geo-file");
const geoNome = $("#geo-file-nome");
geoFile.addEventListener("change", () => {
  geoNome.textContent = geoFile.files.length ? `📡 ${geoFile.files[0].name}` : "📡 Selecionar arquivo Geotab";
});
$("#geo-import-btn").addEventListener("click", async () => {
  if (!geoFile.files.length) { toast("Selecione o arquivo Geotab.", "err"); return; }
  const fd = new FormData();
  fd.append("arquivo", geoFile.files[0]);
  const statusEl = $("#geo-status");
  statusEl.className = "imp-status";
  statusEl.innerHTML = `<span class="spinner"></span> Importando…`;
  try {
    const d = await fetch("/api/importar/geotab", { method: "POST", body: fd }).then(r => r.json());
    if (d.erro) { statusEl.className = "imp-status err"; statusEl.textContent = "Erro: " + d.erro; return; }
    statusEl.className = "imp-status ok";
    statusEl.textContent = `✓ ${d.total} placas importadas — ${d.importado_em}`;
    geoFile.value = ""; geoNome.textContent = "📡 Selecionar arquivo Geotab";
    toast("Geotab importado.", "ok");
    carregarStatusImportacoes();
  } catch (e) {
    statusEl.className = "imp-status err";
    statusEl.textContent = "Erro: " + e.message;
  }
});

// --- Importação Trimble ---
const triFile = $("#tri-file");
const triNome = $("#tri-file-nome");
triFile.addEventListener("change", () => {
  triNome.textContent = triFile.files.length ? `📡 ${triFile.files[0].name}` : "📡 Selecionar arquivo Trimble";
});
$("#tri-import-btn").addEventListener("click", async () => {
  if (!triFile.files.length) { toast("Selecione o arquivo Trimble.", "err"); return; }
  const fd = new FormData();
  fd.append("arquivo", triFile.files[0]);
  const statusEl = $("#tri-status");
  statusEl.className = "imp-status";
  statusEl.innerHTML = `<span class="spinner"></span> Importando…`;
  try {
    const d = await fetch("/api/importar/trimble", { method: "POST", body: fd }).then(r => r.json());
    if (d.erro) { statusEl.className = "imp-status err"; statusEl.textContent = "Erro: " + d.erro; return; }
    statusEl.className = "imp-status ok";
    statusEl.textContent = `✓ ${d.total} placas importadas — ${d.importado_em}`;
    triFile.value = ""; triNome.textContent = "📡 Selecionar arquivo Trimble";
    toast("Trimble importado.", "ok");
    carregarStatusImportacoes();
  } catch (e) {
    statusEl.className = "imp-status err";
    statusEl.textContent = "Erro: " + e.message;
  }
});

// --- Info inicial (placas já importadas) ---
async function carregarTelemInfo() {
  try {
    const d = await getJSON("/api/telemetria/info");
    const geoEl = $("#geo-status");
    const triEl = $("#tri-status");
    if (d.geotab.total > 0) {
      geoEl.className = "imp-status ok";
      geoEl.textContent = `✓ ${d.geotab.total} placas no banco — ${d.geotab.importado_em}`;
    }
    if (d.trimble.total > 0) {
      triEl.className = "imp-status ok";
      triEl.textContent = `✓ ${d.trimble.total} placas no banco — ${d.trimble.importado_em}`;
    }
  } catch (_) {}
}

// --- Cruzamento ---
const STATUS_LABEL = {
  ok:                  "OK",
  sem_monitoramento:   "Sem monitoramento",
  fora_ft:             "Fora do FT",
  ajuste_placa:        "Ajuste de placa",
  divergencia_unidade: "Divergência de unidade",
};
const STATUS_CLASS = {
  ok:                  "telem-ok",
  sem_monitoramento:   "telem-sem-telem",
  fora_ft:             "telem-sem-cad",
  ajuste_placa:        "telem-divergente",
  divergencia_unidade: "telem-div-unid",
};

let telemStatusFiltro = new Set();
let telemSortCol = null;
let telemSortDir = "asc";

const _TELEM_SORT_KEY = [
  (r) => r.placa || "",
  (r) => r.tipo  || "",
  (r) => r.unidade_db || "",
  (r) => r.em_geotab  ? 1 : 0,
  (r) => r.em_trimble ? 1 : 0,
  (r) => r.unidade_telem || "",
  (r) => r.status || "",
];

function _renderTelemetria(dados) {
  // Chips de status (reconstrói se mudou de análise)
  const chipWrap = $("#telem-chip-status");
  chipWrap.innerHTML = "";
  const ordens = ["fora_ft", "sem_monitoramento", "divergencia_unidade", "ajuste_placa", "ok"];
  ordens.forEach((s) => {
    const b = el("button", { type: "button", class: "chip" + (telemStatusFiltro.has(s) ? " ativo" : "") }, STATUS_LABEL[s]);
    b.dataset.status = s;
    b.addEventListener("click", () => {
      if (telemStatusFiltro.has(s)) { telemStatusFiltro.delete(s); b.classList.remove("ativo"); }
      else { telemStatusFiltro.add(s); b.classList.add("ativo"); }
      _renderTelemetria(telemDados);
    });
    chipWrap.appendChild(b);
  });

  const soProblemas = $("#telem-so-problemas").checked;
  const PROBLEMAS = new Set(["sem_monitoramento", "fora_ft", "ajuste_placa", "divergencia_unidade"]);

  let visiveis = dados.resultados;
  if (telemStatusFiltro.size > 0) visiveis = visiveis.filter(r => telemStatusFiltro.has(r.status));
  if (soProblemas) visiveis = visiveis.filter(r => PROBLEMAS.has(r.status));

  if (telemSortCol !== null) {
    const key = _TELEM_SORT_KEY[telemSortCol];
    visiveis = [...visiveis].sort((a, b) => {
      const va = key(a), vb = key(b);
      if (va < vb) return telemSortDir === "asc" ? -1 : 1;
      if (va > vb) return telemSortDir === "asc" ? 1 : -1;
      return 0;
    });
  }

  // Cards
  const t = dados.totais;
  const cardsEl = $("#telem-cards");
  cardsEl.innerHTML = "";
  cardsEl.appendChild(card(t.total,               "Total analisado",        ""));
  cardsEl.appendChild(card(t.ok,                  "OK",                     t.ok > 0 ? "green" : ""));
  cardsEl.appendChild(card(t.fora_ft,             "Fora do FT",             t.fora_ft > 0 ? "red" : ""));
  cardsEl.appendChild(card(t.sem_monitoramento,   "Sem monitoramento",      t.sem_monitoramento > 0 ? "red" : ""));
  cardsEl.appendChild(card(t.divergencia_unidade, "Divergência de unidade", (t.divergencia_unidade || 0) > 0 ? "purple" : ""));
  cardsEl.appendChild(card(t.ajuste_placa,        "Ajuste de placa",        t.ajuste_placa > 0 ? "orange" : ""));

  $("#telem-info").textContent =
    `BD: ${dados.db_placas} placas · Geotab: ${dados.geo_placas} · Trimble: ${dados.tri_placas} · Exibindo ${visiveis.length} registro(s).`;

  // --- Tabela resumo por unidade canônica (usa todos os resultados, sem filtro de status) ---
  const GRUPO_LABEL = {
    LONDRINA:      "CDD LONDRINA",
    SAO_CRISTOVAO: "CDD SAO CRISTOVAO",
    FCO_BELTRAO:   "CDS FCO BELTRAO",
    DIADEMA:       "CDD DIADEMA",
    FOZ_IGUACU:    "CDD FOZ DO IGUACU",
    PONTA_GROSSA:  "PONTA GROSSA",
    CASCAVEL:      "CDD CASCAVEL",
    PRAIA_GRANDE:  "CDD PRAIA GRANDE",
    PETROPOLIS:    "CDD PETROPOLIS",
    ARACAJU:       "CDD ARACAJU",
    SALVADOR:      "CDD SALVADOR",
    ESTANCIA:      "ESTANCIA",
    CAMACARI:      "CDL CAMAÇARI-INTERNALIZAÇÃO",
  };
  const resumoMap = {};
  for (const r of dados.resultados) {
    const g = r.grupo || "—";
    if (!resumoMap[g]) resumoMap[g] = { total: 0, ok: 0, fora_ft: 0, sem_monitoramento: 0, divergencia_unidade: 0, ajuste_placa: 0 };
    resumoMap[g].total++;
    if (resumoMap[g][r.status] !== undefined) resumoMap[g][r.status]++;
  }
  const _n = (v) => v || "—";
  const resumoLinhas = Object.entries(resumoMap)
    .sort(([a], [b]) => (GRUPO_LABEL[a] || a).localeCompare(GRUPO_LABEL[b] || b, "pt-BR"))
    .map(([gid, c]) => [
      el("td", {}, GRUPO_LABEL[gid] || gid),
      el("td", { style: "text-align:center" }, c.total),
      el("td", { class: "telem-ok",         style: "text-align:center" }, _n(c.ok)),
      el("td", { class: "telem-sem-cad",    style: "text-align:center" }, _n(c.fora_ft)),
      el("td", { class: "telem-sem-telem",  style: "text-align:center" }, _n(c.sem_monitoramento)),
      el("td", { class: "telem-div-unid",   style: "text-align:center" }, _n(c.divergencia_unidade)),
      el("td", { class: "telem-divergente", style: "text-align:center" }, _n(c.ajuste_placa)),
    ]);
  const tot = dados.totais;
  const b6 = "font-weight:600";
  resumoLinhas.push([
    el("td", { style: b6 }, "TOTAL"),
    el("td", { style: `text-align:center;${b6}` }, tot.total),
    el("td", { class: "telem-ok",         style: `text-align:center;${b6}` }, _n(tot.ok)),
    el("td", { class: "telem-sem-cad",    style: `text-align:center;${b6}` }, _n(tot.fora_ft)),
    el("td", { class: "telem-sem-telem",  style: `text-align:center;${b6}` }, _n(tot.sem_monitoramento)),
    el("td", { class: "telem-div-unid",   style: `text-align:center;${b6}` }, _n(tot.divergencia_unidade || 0)),
    el("td", { class: "telem-divergente", style: `text-align:center;${b6}` }, _n(tot.ajuste_placa)),
  ]);
  const resumoHdrs = ["Unidade", "Total", "OK", "Fora do FT", "Sem monitoramento", "Div. Unidade", "Ajuste de placa"];
  const resumoTabela = tabela(resumoHdrs, resumoLinhas);
  resumoTabela.id = "telem-resumo";
  const resumoWrap = $("#telem-resumo-wrap");
  resumoWrap.innerHTML = "";
  resumoWrap.appendChild(resumoTabela);

  const hdrs = ["Placa", "Tipo", "Unidade (FT)", "Geotab", "Trimble", "Unidade Telemetria", "Status"];
  const linhas = visiveis.map((r) => {
    const cls = STATUS_CLASS[r.status] || "";

    // Coluna Geotab: mostra placa original da telemetria quando difere do registro
    const geoTxt = r.em_geotab
      ? (r.placa_geotab && r.placa_geotab !== r.placa
          ? el("span", {}, [el("span", { class: "badge green" }, "Sim"), document.createTextNode(" " + r.placa_geotab)])
          : el("span", { class: "badge green" }, "Sim"))
      : el("span", { class: "badge gray" }, "Não");

    const triTxt = r.em_trimble
      ? (r.placa_trimble && r.placa_trimble !== r.placa
          ? el("span", {}, [el("span", { class: "badge green" }, "Sim"), document.createTextNode(" " + r.placa_trimble)])
          : el("span", { class: "badge green" }, "Sim"))
      : el("span", { class: "badge gray" }, "Não");

    // Coluna Unidade Telemetria: destaca em roxo quando diverge do FT
    const isDivUnid = r.status === "divergencia_unidade";
    const unidTelemTxt = r.unidade_telem
      ? (isDivUnid
          ? el("span", { class: "telem-div-unid", title: `FT: ${r.unidade_db}` }, "⚠ " + r.unidade_telem)
          : r.unidade_telem)
      : "—";

    return [
      el("td", {}, placaBadge(r.placa, null)),
      el("td", { class: "center" }, r.tipo || "—"),
      el("td", {}, r.unidade_db || "—"),
      el("td", { class: "center" }, geoTxt),
      el("td", { class: "center" }, triTxt),
      el("td", {}, unidTelemTxt),
      el("td", { class: "center" }, el("span", { class: cls }, STATUS_LABEL[r.status] || r.status)),
    ];
  });

  const novaTabela = tabela(hdrs, linhas);
  novaTabela.id = "telem-tabela";
  novaTabela.querySelectorAll("th").forEach((th, i) => {
    th.classList.add("th-sort");
    const icon = el("span", { class: telemSortCol === i ? "sort-icon th-sorted" : "sort-icon" },
      telemSortCol === i ? (telemSortDir === "asc" ? " ▲" : " ▼") : " ⇅");
    th.appendChild(icon);
    th.addEventListener("click", () => {
      if (telemSortCol === i) telemSortDir = telemSortDir === "asc" ? "desc" : "asc";
      else { telemSortCol = i; telemSortDir = "asc"; }
      _renderTelemetria(telemDados);
    });
  });
  $("#telem-tabela").replaceWith(novaTabela);
}

$("#telem-run").addEventListener("click", async () => {
  $("#telem-info").innerHTML = `<span class="spinner"></span> Cruzando…`;
  $("#telem-cards").innerHTML = "";
  try {
    telemDados = await getJSON("/api/telemetria/cruzamento");
    telemSortCol = null; telemSortDir = "asc";
    _renderTelemetria(telemDados);
  } catch (e) {
    $("#telem-info").textContent = "Erro: " + e.message;
  }
});

$("#telem-so-problemas").addEventListener("change", () => {
  if (telemDados.resultados) _renderTelemetria(telemDados);
});

$("#telem-export").addEventListener("click", () => {
  if (!telemDados.resultados) { toast("Faça o cruzamento primeiro.", "err"); return; }
  window.location.href = "/api/exportar/telemetria";
});

// ----------------------------------------------------------------------------
// KM MENSAL
// ----------------------------------------------------------------------------
const MESES_ABREV = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const mesLabel = (ano, mes) => `${MESES_ABREV[mes] || mes}/${ano}`;

let kmMesesCarregados = false;
let kmCarregado = false;

// Importação (cartões na aba "Importar" — mesmo padrão do Geotab/Trimble de Telemetria)
async function importarKmArquivos(fileInput, statusEl, nomeSpan, nomeDefault) {
  if (!fileInput.files.length) { toast("Selecione ao menos um arquivo.", "err"); return; }
  const fd = new FormData();
  [...fileInput.files].forEach((f) => fd.append("arquivos", f));
  statusEl.className = "imp-status";
  statusEl.innerHTML = `<span class="spinner"></span> Importando…`;
  try {
    const r = await fetch("/api/km-mensal/importar", { method: "POST", body: fd });
    const d = await r.json();
    const resultados = d.resultados || [];
    const erros = resultados.filter((x) => x.erro);
    const ok = resultados.filter((x) => !x.erro);
    if (ok.length === 0 && erros.length > 0) {
      statusEl.className = "imp-status err";
      statusEl.textContent = "Erro: " + erros.map((e) => e.erro).join(" · ");
    } else {
      const totalRegs = ok.reduce((s, x) => s + (x.total || 0), 0);
      statusEl.className = "imp-status ok";
      statusEl.textContent = `✓ ${ok.length} arquivo(s) importado(s) — ${totalRegs.toLocaleString("pt-BR")} registro(s)`
        + (erros.length ? ` · ${erros.length} com erro` : "");
      toast("Importação concluída.", "ok");
    }
    kmMesesCarregados = false; // força recarregar filtros/dados na próxima vez que abrir a aba KM Mensal
  } catch (e) {
    statusEl.className = "imp-status err";
    statusEl.textContent = "Erro: " + e.message;
  }
  fileInput.value = "";
  nomeSpan.textContent = nomeDefault;
}

const kmGeoFile = $("#kmgeo-file");
const kmGeoNome = $("#kmgeo-file-nome");
const KMGEO_NOME_PADRAO = "📡 Selecionar arquivo(s) Geotab";
kmGeoFile.addEventListener("change", () => {
  kmGeoNome.textContent = kmGeoFile.files.length ? `📡 ${kmGeoFile.files.length} arquivo(s) selecionado(s)` : KMGEO_NOME_PADRAO;
});
$("#kmgeo-import-btn").addEventListener("click", () =>
  importarKmArquivos(kmGeoFile, $("#kmgeo-status"), kmGeoNome, KMGEO_NOME_PADRAO));

const kmVelFile = $("#kmvel-file");
const kmVelNome = $("#kmvel-file-nome");
const KMVEL_NOME_PADRAO = "📡 Selecionar arquivo(s) Veltec";
kmVelFile.addEventListener("change", () => {
  kmVelNome.textContent = kmVelFile.files.length ? `📡 ${kmVelFile.files.length} arquivo(s) selecionado(s)` : KMVEL_NOME_PADRAO;
});
$("#kmvel-import-btn").addEventListener("click", () =>
  importarKmArquivos(kmVelFile, $("#kmvel-status"), kmVelNome, KMVEL_NOME_PADRAO));

// Importação — Combustível
async function importarCombustivelArquivos(fileInput, statusEl, nomeSpan, nomeDefault) {
  if (!fileInput.files.length) { toast("Selecione ao menos um arquivo.", "err"); return; }
  const fd = new FormData();
  [...fileInput.files].forEach((f) => fd.append("arquivos", f));
  statusEl.className = "imp-status";
  statusEl.innerHTML = `<span class="spinner"></span> Importando…`;
  try {
    const r = await fetch("/api/combustivel/importar", { method: "POST", body: fd });
    const d = await r.json();
    const resultados = d.resultados || [];
    const erros = resultados.filter((x) => x.erro);
    const ok = resultados.filter((x) => !x.erro);
    if (ok.length === 0 && erros.length > 0) {
      statusEl.className = "imp-status err";
      statusEl.textContent = "Erro: " + erros.map((e) => e.erro).join(" · ");
    } else {
      const novos = ok.reduce((s, x) => s + (x.novos || 0), 0);
      const atualizados = ok.reduce((s, x) => s + (x.atualizados || 0), 0);
      const diesel = ok.reduce((s, x) => s + (x.diesel || 0), 0);
      statusEl.className = "imp-status ok";
      statusEl.textContent = `✓ ${ok.length} arquivo(s) — ${diesel.toLocaleString("pt-BR")} linhas de diesel, `
        + `${novos.toLocaleString("pt-BR")} novo(s), ${atualizados.toLocaleString("pt-BR")} atualizado(s)`
        + (erros.length ? ` · ${erros.length} com erro` : "");
      toast("Importação concluída.", "ok");
    }
    combMesesCarregados = false; // força recarregar filtros/dados na próxima vez que abrir a aba Combustível
  } catch (e) {
    statusEl.className = "imp-status err";
    statusEl.textContent = "Erro: " + e.message;
  }
  fileInput.value = "";
  nomeSpan.textContent = nomeDefault;
}

const combFile = $("#comb-file");
const combNome = $("#comb-file-nome");
const COMB_NOME_PADRAO = "⛽ Selecionar arquivo(s) de abastecimento";
combFile.addEventListener("change", () => {
  combNome.textContent = combFile.files.length ? `⛽ ${combFile.files.length} arquivo(s) selecionado(s)` : COMB_NOME_PADRAO;
});
$("#comb-import-btn").addEventListener("click", () =>
  importarCombustivelArquivos(combFile, $("#comb-status"), combNome, COMB_NOME_PADRAO));

async function carregarFiltrosKm() {
  if (kmMesesCarregados) return;
  kmMesesCarregados = true;
  try {
    const [meses, totaisTodos] = await Promise.all([
      getJSON("/api/km-mensal/meses"),
      getJSON("/api/km-mensal/totais"),
    ]);
    const selMes = $("#km-filtro-mes");
    selMes.innerHTML = '<option value="">Todos</option>';
    meses.forEach((m) => selMes.appendChild(el("option", { value: `${m.ano}-${m.mes}` }, mesLabel(m.ano, m.mes))));

    // Unidades já vêm consolidadas do servidor (grupo canônico de CDD).
    const unidades = new Set(totaisTodos.map((t) => t.unidade));
    const selUnid = $("#km-filtro-unidade");
    selUnid.innerHTML = '<option value="">Todas</option>';
    [...unidades].sort((a, b) => a.localeCompare(b, "pt-BR"))
      .forEach((u) => selUnid.appendChild(el("option", { value: u }, u)));
  } catch (_) {}
}

function kmFiltros() {
  const mesVal = $("#km-filtro-mes").value;
  const params = new URLSearchParams();
  if (mesVal) {
    const [ano, mes] = mesVal.split("-");
    params.set("ano", ano); params.set("mes", mes);
  }
  const unidade = $("#km-filtro-unidade").value;
  if (unidade) params.set("unidade", unidade);
  const fonte = $("#km-filtro-fonte").value;
  if (fonte) params.set("fonte", fonte);
  return params;
}

async function carregarKmMensal() {
  await carregarFiltrosKm();
  await atualizarKmTabelas();
  kmCarregado = true;
}

// ── Busca de KM por placa/dia ────────────────────────────────────────────
function fmtDataBR(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function renderKmBuscaLinha(res) {
  const linhas = [
    ["KM inicial", res.km_inicial == null ? "—" : fmtNum(res.km_inicial)],
    ["KM final", res.km_final == null ? "—" : fmtNum(res.km_final)],
    ["KM rodado no dia", fmtNum(res.km_rodado)],
    ["Média (inicial/final)", res.km_medio == null ? "—" : fmtNum(res.km_medio)],
    ["Unidade na telemetria", res.unidade_telemetria || "—"],
    ["Unidade no FT", (res.unidade_ft || "—") + (res.unidade_ft && !res.unidade_ft_exata ? " (histórico)" : "")],
    ["Tipo no FT", res.tipo_ft || "—"],
  ];
  const box = el("div", { class: "card km-busca-card" });
  box.appendChild(el("div", { class: "km-busca-hdr" },
    el("strong", {}, res.placa),
    el("span", { class: "badge amber" }, res.fonte === "geotab" ? "Geotab" : "Veltec"),
    el("span", { class: "hint" }, fmtDataBR(res.data)),
  ));
  const tbl = el("table", { class: "km-busca-tabela" });
  const tbody = el("tbody");
  linhas.forEach(([label, valor]) => {
    tbody.appendChild(el("tr", {}, el("td", {}, label), el("td", {}, valor)));
  });
  tbl.appendChild(tbody);
  box.appendChild(tbl);
  return box;
}

async function buscarKmDia() {
  const placa = $("#km-busca-placa").value.trim().toUpperCase();
  const data = $("#km-busca-data").value;
  const cont = $("#km-busca-resultado");
  if (!placa || !data) { toast("Informe placa e data.", "err"); return; }

  cont.innerHTML = `<span class="spinner"></span> Buscando…`;
  try {
    const r = await fetch(`/api/km-mensal/buscar-dia?placa=${encodeURIComponent(placa)}&data=${data}`);
    const d = await r.json();
    if (d.erro) { cont.innerHTML = `<div class="inline-err" style="display:block">${d.erro}</div>`; return; }

    cont.innerHTML = "";

    if (!d.exato) {
      cont.appendChild(el("div", { class: "info" }, `Sem dado exato para ${placa} em ${fmtDataBR(data)}.`));
      if (d.data_anterior || d.data_posterior) {
        const linha = el("div", { class: "filtros", style: "margin-top:6px;margin-bottom:0" });
        linha.appendChild(el("span", { class: "hint" }, "Usar a data mais próxima:"));
        if (d.data_anterior) {
          const btn = el("button", { class: "btn" }, `⟵ ${fmtDataBR(d.data_anterior)} (anterior)`);
          btn.addEventListener("click", () => { $("#km-busca-data").value = d.data_anterior; buscarKmDia(); });
          linha.appendChild(btn);
        }
        if (d.data_posterior) {
          const btn2 = el("button", { class: "btn" }, `${fmtDataBR(d.data_posterior)} (posterior) ⟶`);
          btn2.addEventListener("click", () => { $("#km-busca-data").value = d.data_posterior; buscarKmDia(); });
          linha.appendChild(btn2);
        }
        cont.appendChild(linha);
      } else {
        cont.appendChild(el("div", { class: "hint" }, "Essa placa não tem nenhum dia de telemetria importado."));
      }
      return;
    }

    d.resultados.forEach((res) => cont.appendChild(renderKmBuscaLinha(res)));
  } catch (e) {
    cont.innerHTML = `<div class="inline-err" style="display:block">Erro: ${e.message}</div>`;
  }
}

$("#km-busca-btn").addEventListener("click", buscarKmDia);
$("#km-busca-placa").addEventListener("keydown", (e) => { if (e.key === "Enter") buscarKmDia(); });
$("#km-busca-data").addEventListener("keydown", (e) => { if (e.key === "Enter") buscarKmDia(); });

function kmFiltrosRanking() {
  // Ranking por placa sempre olha o histórico completo — ignora o filtro de mês.
  const params = new URLSearchParams();
  const unidade = $("#km-filtro-unidade").value;
  if (unidade) params.set("unidade", unidade);
  const fonte = $("#km-filtro-fonte").value;
  if (fonte) params.set("fonte", fonte);
  return params;
}

async function atualizarKmTabelas() {
  const params = kmFiltros();
  $("#km-info").innerHTML = `<span class="spinner"></span> Carregando…`;
  try {
    const [totais, detalhe, ranking] = await Promise.all([
      getJSON("/api/km-mensal/totais?" + params.toString()),
      getJSON("/api/km-mensal/resumo?" + params.toString()),
      getJSON("/api/km-mensal/ranking?" + kmFiltrosRanking().toString()),
    ]);
    renderKmChart(totais);
    renderKmTotais(totais);
    renderKmRanking(ranking);
    renderKmDetalhe(detalhe);
    const kmSoma = detalhe.reduce((s, r) => s + (r.km || 0), 0);
    $("#km-info").textContent = `${detalhe.length} registro(s) de placa/mês · ${Math.round(kmSoma).toLocaleString("pt-BR")} km no total.`;
  } catch (e) {
    $("#km-info").textContent = "Erro: " + e.message;
  }
}

// ── Tabelas ordenáveis (clique no cabeçalho) ────────────────────────────────
const _kmSortState = {};

function renderTabelaOrdenavel(id, hdrs, dados, sortKeys, rowBuilder) {
  if (!_kmSortState[id]) _kmSortState[id] = { col: null, dir: "asc" };
  const st = _kmSortState[id];

  let visiveis = dados;
  if (st.col !== null) {
    const key = sortKeys[st.col];
    visiveis = [...dados].sort((a, b) => {
      const va = key(a), vb = key(b);
      if (va < vb) return st.dir === "asc" ? -1 : 1;
      if (va > vb) return st.dir === "asc" ? 1 : -1;
      return 0;
    });
  }

  const linhas = visiveis.map(rowBuilder);
  const t = tabela(hdrs, linhas);
  t.id = id;
  t.querySelectorAll("th").forEach((th, i) => {
    th.classList.add("th-sort");
    const icon = el("span", { class: st.col === i ? "sort-icon th-sorted" : "sort-icon" },
      st.col === i ? (st.dir === "asc" ? " ▲" : " ▼") : " ⇅");
    th.appendChild(icon);
    th.addEventListener("click", () => {
      if (st.col === i) st.dir = st.dir === "asc" ? "desc" : "asc";
      else { st.col = i; st.dir = "asc"; }
      renderTabelaOrdenavel(id, hdrs, dados, sortKeys, rowBuilder);
    });
  });
  $("#" + id).replaceWith(t);
}

const SVGNS = "http://www.w3.org/2000/svg";
function _svg(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function renderKmChart(totais) {
  const wrap = $("#km-chart");
  wrap.innerHTML = "";

  // Soma o KM de todas as unidades por mês (respeita os filtros já aplicados).
  const porMes = {};
  totais.forEach((r) => {
    const chave = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
    porMes[chave] = (porMes[chave] || 0) + (r.km_total || 0);
  });
  const dados = Object.keys(porMes).sort().map((chave) => {
    const [ano, mes] = chave.split("-").map(Number);
    return { ano, mes, km: porMes[chave] };
  });

  if (!dados.length) {
    wrap.appendChild(el("div", { class: "vazio", style: "padding:24px" }, "Sem dados para exibir."));
    return;
  }

  const H = 260, padL = 64, padR = 16, padT = 20, padB = 34;
  const W = Math.max(560, dados.length * 84);
  const areaW = W - padL - padR, areaH = H - padT - padB;
  const maxKm = Math.max(...dados.map((d) => d.km), 1);
  const gap = areaW / dados.length;
  const barW = Math.min(46, gap * 0.55);

  const svg = _svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });

  const NGRID = 4;
  for (let i = 0; i <= NGRID; i++) {
    const y = padT + areaH * (1 - i / NGRID);
    svg.appendChild(_svg("line", {
      x1: padL, x2: W - padR, y1: y, y2: y,
      style: "stroke:var(--line);stroke-width:1",
    }));
    const txt = _svg("text", {
      x: padL - 8, y: y + 4, "text-anchor": "end",
      style: "fill:var(--txt-dim);font-size:11px",
    });
    txt.textContent = Math.round(maxKm * i / NGRID).toLocaleString("pt-BR");
    svg.appendChild(txt);
  }

  dados.forEach((d, i) => {
    const x = padL + i * gap + (gap - barW) / 2;
    const h = areaH * (d.km / maxKm);
    const y = padT + areaH - h;

    const rect = _svg("rect", { x, y, width: barW, height: Math.max(h, 1), rx: 3, style: "fill:var(--accent)" });
    rect.appendChild(_svg("title")).textContent = `${mesLabel(d.ano, d.mes)}: ${Math.round(d.km).toLocaleString("pt-BR")} km`;
    svg.appendChild(rect);

    const valTxt = _svg("text", {
      x: x + barW / 2, y: y - 6, "text-anchor": "middle",
      style: "fill:var(--txt);font-size:11px",
    });
    valTxt.textContent = fmtNum(Math.round(d.km / 1000)) + "k";
    svg.appendChild(valTxt);

    const lbl = _svg("text", {
      x: x + barW / 2, y: padT + areaH + 18, "text-anchor": "middle",
      style: "fill:var(--txt-dim);font-size:11px",
    });
    lbl.textContent = mesLabel(d.ano, d.mes);
    svg.appendChild(lbl);
  });

  wrap.appendChild(svg);
}

const _KM_TOTAIS_HDRS = [
  "Unidade", "Mês", "Veículos c/ telemetria", "KM total", "KM médio (telemetria)",
  "Veículos c/ match FT", "KM médio (match FT)",
  "Frotas ativas (méd. quinz.)", "KM médio por frota ativa",
];
const _KM_TOTAIS_SORT = [
  (r) => r.unidade || "",
  (r) => r.ano * 100 + r.mes,
  (r) => r.veiculos,
  (r) => r.km_total,
  (r) => r.km_medio,
  (r) => r.veiculos_match,
  (r) => r.km_medio_match,
  (r) => r.frotas_ativas_media,
  (r) => r.km_medio_frota_ativa,
];
function renderKmTotais(totais) {
  renderTabelaOrdenavel("km-tabela-totais", _KM_TOTAIS_HDRS, totais, _KM_TOTAIS_SORT, (r) => [
    el("td", {}, r.unidade),
    el("td", { class: "center" }, mesLabel(r.ano, r.mes)),
    el("td", { class: "center" }, r.veiculos),
    el("td", { class: "center" }, fmtNum(r.km_total)),
    el("td", { class: "center" }, fmtNum(r.km_medio)),
    el("td", { class: "center" }, r.veiculos_match),
    el("td", { class: "center" }, r.veiculos_match ? fmtNum(r.km_medio_match) : "—"),
    el("td", { class: "center" }, fmtNum(r.frotas_ativas_media)),
    el("td", { class: "center" }, r.frotas_ativas_media ? fmtNum(r.km_medio_frota_ativa) : "—"),
  ]);
}

// Tipo/unidade podem vir do cadastro do mês exato ou, quando a placa não
// está no FT naquele mês, do cadastro mais próximo no tempo (tipo_estimado).
// Mostra um "~" discreto nesse segundo caso, em vez de deixar em branco.
function tipoCell(r) {
  if (!r.tipo) return "—";
  return r.tipo_estimado
    ? el("span", { title: "Inferido do cadastro FT mais próximo no tempo (placa sem registro no mês exato)" },
        "~ " + r.tipo)
    : r.tipo;
}

const _KM_DETALHE_HDRS = ["Placa", "Unidade", "No FT", "Tipo", "Fonte", "Mês", "KM"];
const _KM_DETALHE_SORT = [
  (r) => r.placa || "",
  (r) => r.unidade || "",
  (r) => (r.no_ft ? 1 : 0),
  (r) => r.tipo || "",
  (r) => r.fonte || "",
  (r) => r.ano * 100 + r.mes,
  (r) => r.km || 0,
];
function renderKmDetalhe(detalhe) {
  renderTabelaOrdenavel("km-tabela-detalhe", _KM_DETALHE_HDRS, detalhe, _KM_DETALHE_SORT, (r) => [
    el("td", {}, placaBadge(r.placa, null)),
    el("td", {}, r.unidade || "—"),
    el("td", { class: "center" }, r.no_ft
      ? el("span", { class: "badge green" }, "Sim")
      : el("span", { class: "badge gray" }, "Não")),
    el("td", { class: "center" }, tipoCell(r)),
    el("td", { class: "center" }, r.fonte === "geotab" ? "Geotab" : "Veltec"),
    el("td", { class: "center" }, mesLabel(r.ano, r.mes)),
    el("td", { class: "center" }, fmtNum(r.km)),
  ]);
}

const _KM_RANKING_HDRS = ["Placa", "Unidade", "Tipo", "Fonte", "Meses", "KM total", "KM médio/mês", "KM mín (mês)", "KM máx (mês)"];
const _KM_RANKING_SORT = [
  (r) => r.placa || "",
  (r) => r.unidade || "",
  (r) => r.tipo || "",
  (r) => r.fonte || "",
  (r) => r.meses,
  (r) => r.km_total,
  (r) => r.km_medio_mensal,
  (r) => r.km_min,
  (r) => r.km_max,
];
function renderKmRanking(ranking) {
  renderTabelaOrdenavel("km-tabela-ranking", _KM_RANKING_HDRS, ranking, _KM_RANKING_SORT, (r) => [
    el("td", {}, placaBadge(r.placa, null)),
    el("td", {}, r.unidade || "—"),
    el("td", { class: "center" }, tipoCell(r)),
    el("td", { class: "center" }, r.fonte === "geotab" ? "Geotab" : "Veltec"),
    el("td", { class: "center" }, r.meses),
    el("td", { class: "center" }, fmtNum(r.km_total)),
    el("td", { class: "center" }, fmtNum(r.km_medio_mensal)),
    el("td", { class: "center" }, fmtNum(r.km_min)),
    el("td", { class: "center" }, fmtNum(r.km_max)),
  ]);
}

$("#km-atualizar").addEventListener("click", atualizarKmTabelas);
$("#km-filtro-mes").addEventListener("change", atualizarKmTabelas);
$("#km-filtro-unidade").addEventListener("change", atualizarKmTabelas);
$("#km-filtro-fonte").addEventListener("change", atualizarKmTabelas);
$("#km-export").addEventListener("click", () => {
  window.location.href = "/api/exportar/km-mensal";
});

// ----------------------------------------------------------------------------
// COMBUSTÍVEL
// ----------------------------------------------------------------------------
let combMesesCarregados = false;

async function carregarFiltrosCombustivel() {
  if (combMesesCarregados) return;
  combMesesCarregados = true;
  try {
    const [meses, medias] = await Promise.all([
      getJSON("/api/combustivel/meses"),
      getJSON("/api/combustivel/medias-cdd-tipo"),
    ]);
    const selMes = $("#comb-filtro-mes");
    selMes.innerHTML = '<option value="">Todos</option>';
    meses.forEach((m) => selMes.appendChild(el("option", { value: `${m.ano}-${m.mes}` }, mesLabel(m.ano, m.mes))));

    const unidades = new Set(medias.map((m) => m.unidade));
    const selUnid = $("#comb-filtro-unidade");
    selUnid.innerHTML = '<option value="">Todas</option>';
    [...unidades].sort((a, b) => a.localeCompare(b, "pt-BR"))
      .forEach((u) => selUnid.appendChild(el("option", { value: u }, u)));
  } catch (_) {}
}

function combFiltros() {
  const mesVal = $("#comb-filtro-mes").value;
  const params = new URLSearchParams();
  if (mesVal) {
    const [ano, mes] = mesVal.split("-");
    params.set("ano", ano); params.set("mes", mes);
  }
  const unidade = $("#comb-filtro-unidade").value;
  if (unidade) params.set("unidade", unidade);
  const tipo = $("#comb-filtro-tipo").value;
  if (tipo) params.set("tipo", tipo);
  return params;
}

async function carregarCombustivel() {
  await carregarFiltrosCombustivel();
  await atualizarCombustivelTabelas();
  await atualizarCorrecao();
}

async function atualizarCombustivelTabelas() {
  const params = combFiltros();
  $("#comb-info").innerHTML = `<span class="spinner"></span> Carregando…`;
  try {
    const { detalhe, medias, alertas, alertas_historico, ranking, mensal } =
      await getJSON("/api/combustivel/dashboard?" + params.toString());
    renderCombCards(detalhe);
    renderCombChart(mensal);
    renderCombMedias(medias);
    renderCombAlertas(alertas);
    renderCombAlertasHistorico(alertas_historico);
    renderCombRanking(ranking);
    renderCombDetalhe(detalhe);
    $("#comb-info").textContent = `${detalhe.length} registro(s) de placa/mês.`;
  } catch (e) {
    $("#comb-info").textContent = "Erro: " + e.message;
  }
}

function renderCombCards(detalhe) {
  const litros = detalhe.reduce((s, r) => s + (r.litros || 0), 0);
  const valor = detalhe.reduce((s, r) => s + (r.valor_pago || 0), 0);
  const kmRodado = detalhe.reduce((s, r) => s + (r.km_rodado_combustivel || 0), 0);
  const kmLitroGeral = kmRodado ? kmRodado / litros : 0;
  const precoMedio = litros ? valor / litros : 0;
  const veiculos = new Set(detalhe.map((r) => r.placa_norm)).size;

  const cardsEl = $("#comb-cards");
  cardsEl.innerHTML = "";
  cardsEl.appendChild(card(veiculos, "Veículos com abastecimento", "accent"));
  cardsEl.appendChild(card(fmtNum(Math.round(litros)), "Litros de diesel", ""));
  cardsEl.appendChild(card(moeda(valor), "Valor gasto", "amber"));
  cardsEl.appendChild(card(moeda(precoMedio), "Preço médio/litro", ""));
  cardsEl.appendChild(card(fmtNum(kmLitroGeral.toFixed(2)), "KM/L médio geral", "green"));
}

function renderCombChart(mensal) {
  const wrap = $("#comb-chart");
  wrap.innerHTML = "";

  if (!mensal.length) {
    wrap.appendChild(el("div", { class: "vazio", style: "padding:24px" }, "Sem dados para exibir."));
    return;
  }

  const H = 260, padL = 76, padR = 16, padT = 20, padB = 34;
  const W = Math.max(560, mensal.length * 84);
  const areaW = W - padL - padR, areaH = H - padT - padB;
  const maxVal = Math.max(...mensal.map((d) => d.valor_pago), 1);
  const gap = areaW / mensal.length;
  const barW = Math.min(46, gap * 0.55);

  const svg = _svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });

  const NGRID = 4;
  for (let i = 0; i <= NGRID; i++) {
    const y = padT + areaH * (1 - i / NGRID);
    svg.appendChild(_svg("line", {
      x1: padL, x2: W - padR, y1: y, y2: y,
      style: "stroke:var(--line);stroke-width:1",
    }));
    const txt = _svg("text", {
      x: padL - 8, y: y + 4, "text-anchor": "end",
      style: "fill:var(--txt-dim);font-size:11px",
    });
    txt.textContent = moeda(maxVal * i / NGRID);
    svg.appendChild(txt);
  }

  mensal.forEach((d, i) => {
    const x = padL + i * gap + (gap - barW) / 2;
    const h = areaH * (d.valor_pago / maxVal);
    const y = padT + areaH - h;

    const rect = _svg("rect", { x, y, width: barW, height: Math.max(h, 1), rx: 3, style: "fill:var(--amber)" });
    rect.appendChild(_svg("title")).textContent = `${mesLabel(d.ano, d.mes)}: ${moeda(d.valor_pago)} (${fmtNum(d.litros)} L)`;
    svg.appendChild(rect);

    const valTxt = _svg("text", {
      x: x + barW / 2, y: y - 6, "text-anchor": "middle",
      style: "fill:var(--txt);font-size:11px",
    });
    valTxt.textContent = "R$ " + fmtNum(Math.round(d.valor_pago / 1000)) + "k";
    svg.appendChild(valTxt);

    const lbl = _svg("text", {
      x: x + barW / 2, y: padT + areaH + 18, "text-anchor": "middle",
      style: "fill:var(--txt-dim);font-size:11px",
    });
    lbl.textContent = mesLabel(d.ano, d.mes);
    svg.appendChild(lbl);
  });

  wrap.appendChild(svg);
}

const _COMB_MEDIAS_HDRS = ["Unidade", "Tipo", "Veículos", "Litros", "KM rodado", "KM/L médio", "Valor pago", "Custo/KM"];
const _COMB_MEDIAS_SORT = [
  (r) => r.unidade || "",
  (r) => r.tipo || "",
  (r) => r.veiculos,
  (r) => r.litros,
  (r) => r.km_rodado,
  (r) => r.km_litro_medio,
  (r) => r.valor_pago,
  (r) => r.custo_por_km,
];
function renderCombMedias(medias) {
  renderTabelaOrdenavel("comb-tabela-medias", _COMB_MEDIAS_HDRS, medias, _COMB_MEDIAS_SORT, (r) => [
    el("td", {}, r.unidade),
    el("td", { class: "center" }, r.tipo),
    el("td", { class: "center" }, r.veiculos),
    el("td", { class: "center" }, fmtNum(r.litros)),
    el("td", { class: "center" }, fmtNum(r.km_rodado)),
    el("td", { class: "center" }, fmtNum(r.km_litro_medio)),
    el("td", { class: "center" }, moeda(r.valor_pago)),
    el("td", { class: "center" }, moeda(r.custo_por_km)),
  ]);
}

const _COMB_ALERTAS_HDRS = ["Placa", "Unidade", "Tipo", "Mês", "KM/L", "KM/L médio do tipo", "Desvio %"];
const _COMB_ALERTAS_SORT = [
  (r) => r.placa || "",
  (r) => r.unidade || "",
  (r) => r.tipo || "",
  (r) => r.ano * 100 + r.mes,
  (r) => r.km_litro,
  (r) => r.km_litro_medio_tipo,
  (r) => r.desvio_pct,
];
function renderCombAlertas(alertas) {
  renderTabelaOrdenavel("comb-tabela-alertas", _COMB_ALERTAS_HDRS, alertas, _COMB_ALERTAS_SORT, (r) => [
    el("td", {}, placaBadge(r.placa, null)),
    el("td", {}, r.unidade || "—"),
    el("td", { class: "center" }, tipoCell(r)),
    el("td", { class: "center" }, mesLabel(r.ano, r.mes)),
    el("td", { class: "center" }, fmtNum(r.km_litro)),
    el("td", { class: "center" }, fmtNum(r.km_litro_medio_tipo)),
    el("td", { class: "center" }, el("span", { class: r.desvio_pct < 0 ? "badge red" : "badge purple" },
      (r.desvio_pct > 0 ? "+" : "") + fmtNum(r.desvio_pct) + "%")),
  ]);
}

const _COMB_ALERTAS_HIST_HDRS = ["Placa", "Unidade", "Tipo", "Mês", "KM/L do mês", "KM/L médio da placa",
  "Meses histórico", "Desvio %", "Nº Abastecimento suspeito", "Data", "Km rodado", "Litros"];
const _COMB_ALERTAS_HIST_SORT = [
  (r) => r.placa || "",
  (r) => r.unidade || "",
  (r) => r.tipo || "",
  (r) => r.ano * 100 + r.mes,
  (r) => r.km_litro,
  (r) => r.km_litro_medio_placa,
  (r) => r.meses_historico,
  (r) => r.desvio_pct,
  (r) => r.abastecimento_suspeito || 0,
  (r) => r.abastecimento_data || "",
  (r) => r.abastecimento_km_rodado || 0,
  (r) => r.abastecimento_litros || 0,
];
function renderCombAlertasHistorico(alertas) {
  renderTabelaOrdenavel("comb-tabela-alertas-historico", _COMB_ALERTAS_HIST_HDRS, alertas, _COMB_ALERTAS_HIST_SORT, (r) => [
    el("td", {}, placaBadge(r.placa, null)),
    el("td", {}, r.unidade || "—"),
    el("td", { class: "center" }, tipoCell(r)),
    el("td", { class: "center" }, mesLabel(r.ano, r.mes)),
    el("td", { class: "center" }, fmtNum(r.km_litro)),
    el("td", { class: "center" }, fmtNum(r.km_litro_medio_placa)),
    el("td", { class: "center" }, r.meses_historico),
    el("td", { class: "center" }, el("span", { class: r.desvio_pct < 0 ? "badge red" : "badge purple" },
      (r.desvio_pct > 0 ? "+" : "") + fmtNum(r.desvio_pct) + "%")),
    el("td", { class: "center" }, r.abastecimento_suspeito
      ? el("span", { class: "badge amber", title: "Corrija esse Nº Abastecimento na origem e reimporte — a reimportação substitui a linha" },
          String(r.abastecimento_suspeito))
      : "—"),
    el("td", { class: "center" }, r.abastecimento_data || "—"),
    el("td", { class: "center" }, r.abastecimento_km_rodado == null ? "—" : fmtNum(r.abastecimento_km_rodado)),
    el("td", { class: "center" }, r.abastecimento_litros == null ? "—" : fmtNum(r.abastecimento_litros)),
  ]);
}

const _COMB_RANKING_HDRS = ["Placa", "Unidade", "Tipo", "Meses", "Litros", "Litros/mês", "KM rodado", "KM/L médio", "Valor pago", "Custo/KM"];
const _COMB_RANKING_SORT = [
  (r) => r.placa || "",
  (r) => r.unidade || "",
  (r) => r.tipo || "",
  (r) => r.meses,
  (r) => r.litros,
  (r) => r.litros_medio_mes,
  (r) => r.km_rodado,
  (r) => r.km_litro_medio,
  (r) => r.valor_pago,
  (r) => r.custo_por_km,
];
function renderCombRanking(ranking) {
  renderTabelaOrdenavel("comb-tabela-ranking", _COMB_RANKING_HDRS, ranking, _COMB_RANKING_SORT, (r) => [
    el("td", {}, placaBadge(r.placa, null)),
    el("td", {}, r.unidade || "—"),
    el("td", { class: "center" }, tipoCell(r)),
    el("td", { class: "center" }, r.meses),
    el("td", { class: "center" }, fmtNum(r.litros)),
    el("td", { class: "center" }, fmtNum(r.litros_medio_mes)),
    el("td", { class: "center" }, fmtNum(r.km_rodado)),
    el("td", { class: "center" }, fmtNum(r.km_litro_medio)),
    el("td", { class: "center" }, moeda(r.valor_pago)),
    el("td", { class: "center" }, moeda(r.custo_por_km)),
  ]);
}

const _COMB_DETALHE_HDRS = ["Placa", "Unidade", "No FT", "Tipo", "Mês", "Abast.", "Litros",
  "KM combustível", "KM telemetria", "Delta KM %", "KM/L", "Valor pago", "Custo/KM"];
const _COMB_DETALHE_SORT = [
  (r) => r.placa || "",
  (r) => r.unidade || "",
  (r) => (r.no_ft ? 1 : 0),
  (r) => r.tipo || "",
  (r) => r.ano * 100 + r.mes,
  (r) => r.abastecimentos,
  (r) => r.litros,
  (r) => r.km_rodado_combustivel,
  (r) => (r.km_telemetria == null ? -1 : r.km_telemetria),
  (r) => (r.delta_km_pct == null ? -Infinity : r.delta_km_pct),
  (r) => r.km_litro,
  (r) => r.valor_pago,
  (r) => r.custo_por_km,
];
function renderCombDetalhe(detalhe) {
  renderTabelaOrdenavel("comb-tabela-detalhe", _COMB_DETALHE_HDRS, detalhe, _COMB_DETALHE_SORT, (r) => [
    el("td", {}, placaBadge(r.placa, null)),
    el("td", {}, r.unidade || "—"),
    el("td", { class: "center" }, r.no_ft
      ? el("span", { class: "badge green" }, "Sim")
      : el("span", { class: "badge gray" }, "Não")),
    el("td", { class: "center" }, tipoCell(r)),
    el("td", { class: "center" }, mesLabel(r.ano, r.mes)),
    el("td", { class: "center" }, r.abastecimentos),
    el("td", { class: "center" }, fmtNum(r.litros)),
    el("td", { class: "center" }, fmtNum(r.km_rodado_combustivel)),
    el("td", { class: "center" }, r.km_telemetria == null ? "—" : fmtNum(r.km_telemetria)),
    el("td", { class: "center" }, r.delta_km_pct == null ? "—" : el("span",
      { class: Math.abs(r.delta_km_pct) >= 20 ? "badge purple" : "" },
      (r.delta_km_pct > 0 ? "+" : "") + fmtNum(r.delta_km_pct) + "%")),
    el("td", { class: "center" }, fmtNum(r.km_litro)),
    el("td", { class: "center" }, moeda(r.valor_pago)),
    el("td", { class: "center" }, moeda(r.custo_por_km)),
  ]);
}

$("#comb-atualizar").addEventListener("click", atualizarCombustivelTabelas);
$("#comb-filtro-mes").addEventListener("change", atualizarCombustivelTabelas);
$("#comb-filtro-unidade").addEventListener("change", atualizarCombustivelTabelas);
$("#comb-filtro-tipo").addEventListener("change", atualizarCombustivelTabelas);
$("#comb-export").addEventListener("click", () => {
  window.location.href = "/api/exportar/combustivel";
});

// ── Relatório de correção de KM (comparação diária) ─────────────────────────
function corrFiltros() {
  const params = new URLSearchParams();
  const mesVal = $("#comb-filtro-mes").value;
  if (mesVal) {
    const [ano, mes] = mesVal.split("-");
    params.set("ano", ano); params.set("mes", mes);
  }
  params.set("desvio_min", $("#corr-desvio-min").value || 20);
  params.set("diferenca_km_min", $("#corr-diferenca-min").value || 50);
  return params;
}

const _COMB_CORRECAO_HDRS = ["Nº Abastecimento", "Placa", "Data", "Data abast. anterior",
  "Km rodado informado", "Km telemetria (período)", "Diferença (km)", "Desvio %",
  "Quilometragem informada", "Quilometragem sugerida", "Litros"];
const _COMB_CORRECAO_SORT = [
  (r) => r.nro_abastecimento,
  (r) => r.placa || "",
  (r) => r.data || "",
  (r) => r.data_abastecimento_anterior || "",
  (r) => r.km_rodado_informado,
  (r) => r.km_telemetria_periodo,
  (r) => r.diferenca_km,
  (r) => r.desvio_pct,
  (r) => r.quilometragem_informada || 0,
  (r) => r.quilometragem_sugerida || 0,
  (r) => r.litros || 0,
];
function renderCombCorrecao(dados) {
  renderTabelaOrdenavel("comb-tabela-correcao", _COMB_CORRECAO_HDRS, dados, _COMB_CORRECAO_SORT, (r) => [
    el("td", {}, el("span", { class: "badge amber" }, String(r.nro_abastecimento))),
    el("td", {}, placaBadge(r.placa, null)),
    el("td", { class: "center" }, r.data),
    el("td", { class: "center" }, r.data_abastecimento_anterior),
    el("td", { class: "center" }, fmtNum(r.km_rodado_informado)),
    el("td", { class: "center" }, fmtNum(r.km_telemetria_periodo)),
    el("td", { class: "center" }, fmtNum(r.diferenca_km)),
    el("td", { class: "center" }, el("span", { class: r.desvio_pct < 0 ? "badge red" : "badge purple" },
      (r.desvio_pct > 0 ? "+" : "") + fmtNum(r.desvio_pct) + "%")),
    el("td", { class: "center" }, r.quilometragem_informada == null ? "—" : fmtNum(r.quilometragem_informada)),
    el("td", { class: "center" }, r.quilometragem_sugerida == null ? "—" : fmtNum(r.quilometragem_sugerida)),
    el("td", { class: "center" }, fmtNum(r.litros)),
  ]);
}

async function atualizarCorrecao() {
  $("#corr-info").innerHTML = `<span class="spinner"></span> Carregando…`;
  try {
    const dados = await getJSON("/api/combustivel/correcao?" + corrFiltros().toString());
    renderCombCorrecao(dados);
    $("#corr-info").textContent = `${dados.length} abastecimento(s) sinalizado(s) para correção.`;
  } catch (e) {
    $("#corr-info").textContent = "Erro: " + e.message;
  }
}

$("#corr-atualizar").addEventListener("click", atualizarCorrecao);
$("#corr-export").addEventListener("click", () => {
  window.location.href = "/api/exportar/correcao-km";
});
