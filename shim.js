/**
 * shim.js — carregado ANTES de app.js.
 * Sobrescreve window.fetch SINCRONAMENTE para interceptar /api/... calls.
 * As respostas ficam em fila até o data.json terminar de carregar.
 */
(function () {
  // ------------------------------------------------------------------ dados
  let _DATA = null;
  let _waiters = [];
  let REGS = [];

  function _dataReady() {
    if (_DATA !== null) return Promise.resolve();
    return new Promise((resolve) => _waiters.push(resolve));
  }

  // Carrega data.json usando o fetch ORIGINAL (antes de sobrescrevê-lo)
  const _origFetch = window.fetch.bind(window);
  _origFetch(`./data.json?v=${Date.now()}`)
    .then((r) => r.json())
    .then((d) => {
      _DATA = d;
      REGS = _DATA.registros || [];
      _waiters.forEach((resolve) => resolve());
      _waiters = [];
      _setupUI();
    })
    .catch((e) => {
      document.body.innerHTML = `<div style="padding:2rem;color:#f66">Erro ao carregar data.json: ${e}</div>`;
    });

  // ----------------------------------------------------------------- normalize (port do Python)
  const MESES = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  function periodoLabel(ano, mes, periodo, mensal) {
    return `${MESES[mes] || mes}/${ano} · ${mensal ? "Mensal" : "Q" + periodo}`;
  }
  function periodoChave(ano, mes, periodo) {
    return `${ano}-${String(mes).padStart(2, "0")}-${periodo}`;
  }
  function normPlaca(p) {
    if (!p) return null;
    return String(p).replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null;
  }
  const _LET = { A: "0", B: "1", C: "2", D: "3", E: "4", F: "5", G: "6", H: "7", I: "8", J: "9" };
  const _DIG = { "0": "A", "1": "B", "2": "C", "3": "D", "4": "E", "5": "F", "6": "G", "7": "H", "8": "I", "9": "J" };
  const _RE_OLD = /^[A-Z]{3}[0-9]{4}$/;
  const _RE_MER = /^[A-Z]{3}[0-9][A-J][0-9]{2}$/;
  function fmtPlaca(p) {
    p = normPlaca(p); if (!p) return null;
    if (_RE_OLD.test(p)) return "antiga";
    if (_RE_MER.test(p)) return "mercosul";
    return null;
  }
  function paraAntiga(p) {
    p = normPlaca(p); if (!p || !_RE_MER.test(p)) return null;
    const d = _LET[p[4]]; return d != null ? p.slice(0, 4) + d + p.slice(5) : null;
  }
  function paraMercosul(p) {
    p = normPlaca(p); if (!p || !_RE_OLD.test(p)) return null;
    return p.slice(0, 4) + _DIG[p[4]] + p.slice(5);
  }
  function chavePlaca(p) {
    p = normPlaca(p); if (!p) return null;
    return _RE_MER.test(p) ? (paraAntiga(p) || p) : p;
  }
  function virouMercosul(antiga, nova) {
    return fmtPlaca(antiga) === "antiga" && fmtPlaca(nova) === "mercosul"
      && paraMercosul(antiga) === normPlaca(nova);
  }

  // --------------------------------------------------------- resposta falsa
  function fakeResp(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --------------------------------------------------------- helpers comuns
  function periodosDistintos(rows) {
    const m = {};
    rows.forEach((r) => {
      const k = periodoChave(r.ano, r.mes, r.periodo);
      if (!m[k]) m[k] = { ano: r.ano, mes: r.mes, periodo: r.periodo, mensal: false, chave: k };
      if (r.negocio === "ARMAZEM") m[k].mensal = true;
    });
    return Object.values(m)
      .sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0))
      .map((p) => ({ ...p, label: periodoLabel(p.ano, p.mes, p.periodo, p.mensal) }));
  }

  function filtrarRegs(params) {
    const tipo = params.get("tipo") || "";
    const unidade = params.get("unidade") || "";
    const ano = params.get("ano") ? +params.get("ano") : null;
    const mes = params.get("mes") ? +params.get("mes") : null;
    const periodo = params.get("periodo") ? +params.get("periodo") : null;
    const busca = (params.get("busca") || "").toUpperCase();
    return REGS.filter((r) => {
      if (tipo && r.tipo !== tipo) return false;
      if (unidade && r.unidade !== unidade) return false;
      if (ano && r.ano !== ano) return false;
      if (mes && r.mes !== mes) return false;
      if (periodo) {
        if (periodo === 2 && !(r.periodo === 2 || (r.periodo === 1 && r.negocio === "ARMAZEM"))) return false;
        if (periodo !== 2 && r.periodo !== periodo) return false;
      }
      if (busca) {
        const h = [r.placa_norm || "", r.chassi_norm || "", r.modelo || "", r.unidade || ""].join(" ").toUpperCase();
        if (!h.includes(busca)) return false;
      }
      return true;
    });
  }

  // --------------------------------------------------------- implementações
  function apiTipos() {
    const m = {};
    REGS.forEach((r) => { if (r.tipo) m[r.tipo] = (m[r.tipo] || 0) + 1; });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0])).map(([tipo, n]) => ({ tipo, n }));
  }

  function apiUnidades() {
    const s = new Set();
    REGS.forEach((r) => { if (r.unidade) s.add(r.unidade); });
    return [...s].sort();
  }

  function apiPeriodosGlobal() {
    return periodosDistintos(REGS).reverse();
  }

  function apiPeriodos(params) {
    const tipo = params.get("tipo") || "";
    return periodosDistintos(tipo ? REGS.filter((r) => r.tipo === tipo) : REGS).reverse();
  }

  function apiInventario(params) {
    const regs = filtrarRegs(params).map(({ raw_json, ...r }) => r);
    return { total: regs.length, registros: regs };
  }

  function apiResumo(params) {
    let tipo = params.get("tipo") || "";
    let unidade = params.get("unidade") || "";
    let ano = params.get("ano") ? +params.get("ano") : null;
    let mes = params.get("mes") ? +params.get("mes") : null;
    let periodo = params.get("periodo") ? +params.get("periodo") : null;
    const pchave = params.get("pchave") || "";
    if (pchave) {
      const p = pchave.split("-");
      if (p.length === 3) { ano = +p[0]; mes = +p[1]; periodo = +p[2]; }
    }
    const m = {};
    REGS.forEach((r) => {
      if (tipo && r.tipo !== tipo) return;
      if (unidade && r.unidade !== unidade) return;
      if (ano && r.ano !== ano) return;
      if (mes && r.mes !== mes) return;
      if (periodo) {
        if (periodo === 2 && !(r.periodo === 2 || (r.periodo === 1 && r.negocio === "ARMAZEM"))) return;
        if (periodo !== 2 && r.periodo !== periodo) return;
      }
      const k = `${r.tipo}|${r.ano}|${r.mes}|${r.periodo}`;
      if (!m[k]) m[k] = { tipo: r.tipo, ano: r.ano, mes: r.mes, periodo: r.periodo, n: 0, placas: new Set(), chassis: new Set() };
      m[k].n++;
      if (r.placa_norm) m[k].placas.add(r.placa_norm);
      if (r.chassi_tail) m[k].chassis.add(r.chassi_tail);
    });
    const resumo = Object.values(m)
      .sort((a, b) => b.ano - a.ano || b.mes - a.mes || b.periodo - a.periodo || a.tipo.localeCompare(b.tipo))
      .map((r) => ({ tipo: r.tipo, ano: r.ano, mes: r.mes, periodo: r.periodo, n: r.n, placas: r.placas.size, chassis: r.chassis.size, label: periodoLabel(r.ano, r.mes, r.periodo) }));
    const tiposMap = {};
    resumo.forEach((r) => { tiposMap[r.tipo] = (tiposMap[r.tipo] || 0) + r.n; });
    const tipos = Object.entries(tiposMap).sort((a, b) => a[0].localeCompare(b[0])).map(([tipo, n]) => ({ tipo, n }));
    return { resumo, tipos, todos_tipos: apiTipos().map((t) => t.tipo), periodos: apiPeriodosGlobal(), unidades: apiUnidades(), historico: _DATA.historico || [] };
  }

  function apiComparar(body) {
    const { tipo, a, b } = body;
    const ra = REGS.filter((r) => (!tipo || r.tipo === tipo) && r.ano === +a.ano && r.mes === +a.mes && r.periodo === +a.periodo);
    const rb = REGS.filter((r) => (!tipo || r.tipo === tipo) && r.ano === +b.ano && r.mes === +b.mes && r.periodo === +b.periodo);
    const la = periodoLabel(+a.ano, +a.mes, +a.periodo);
    const lb = periodoLabel(+b.ano, +b.mes, +b.periodo);
    const CAMPOS = [
      ["unidade", "Unidade"], ["operador", "Operador"], ["empresa_locadora", "Empresa locadora"],
      ["custo_aluguel", "Custo aluguel"], ["modelo", "Modelo"], ["montadora", "Montadora"],
      ["capacidade_pallets", "Capac. pallets"], ["ativo", "Ativo"], ["chassi_norm", "Chassi"], ["placa_norm", "Placa"],
    ];
    function ident(r) {
      if (r.placa_norm) return "P:" + chavePlaca(r.placa_norm);
      if (r.chassi_tail) return "C:" + r.chassi_tail;
      return "X:" + Math.random();
    }
    function idx(regs) { const m = {}; regs.forEach((r) => { const k = ident(r); if (!m[k]) m[k] = r; }); return m; }
    function valEq(a, b) {
      if (a == null && b == null) return true;
      if (a == null || b == null) return false;
      if (typeof a === "number" && typeof b === "number") return Math.round(a * 100) === Math.round(b * 100);
      return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
    }
    function resumoReg(r) {
      return { placa: r.placa_norm, chassi: r.chassi_norm, tipo: r.tipo, unidade: r.unidade, modelo: r.modelo, montadora: r.montadora, empresa_locadora: r.empresa_locadora, custo_aluguel: r.custo_aluguel, ativo: r.ativo };
    }
    const iA = idx(ra), iB = idx(rb);
    const kA = new Set(Object.keys(iA)), kB = new Set(Object.keys(iB));
    const comuns = [...kA].filter((k) => kB.has(k));
    const soA = [...kA].filter((k) => !kB.has(k));
    const soB = [...kB].filter((k) => !kA.has(k));
    const mercosul = [], alteracoes = [], placaTrocada = [];
    let inalterados = 0;
    comuns.forEach((k) => {
      const rA = iA[k], rB = iB[k];
      const mudancas = [], flags = [];
      CAMPOS.forEach(([campo, rotulo]) => {
        if (!valEq(rA[campo], rB[campo])) {
          mudancas.push({ campo: rotulo, de: rA[campo], para: rB[campo] });
          if (campo === "placa_norm" && virouMercosul(rA[campo], rB[campo])) flags.push("mercosul");
          if (campo === "chassi_norm") flags.push("chassi_corrigido");
          if (campo === "unidade") flags.push("trocou_cdd");
        }
      });
      if (!mudancas.length) { inalterados++; return; }
      const item = { ...resumoReg(rB), placa_a: rA.placa_norm, placa_b: rB.placa_norm, mudancas, flags: [...new Set(flags)].sort() };
      flags.includes("mercosul") ? mercosul.push(item) : alteracoes.push(item);
    });
    const byChass = {};
    soB.forEach((k) => { const ct = iB[k].chassi_tail; if (ct) (byChass[ct] = byChass[ct] || []).push(k); });
    const sRes = new Set(), eRes = new Set();
    soA.forEach((ka) => {
      const rA = iA[ka]; const ct = rA.chassi_tail; if (!ct) return;
      const cand = (byChass[ct] || []).find((k) => !eRes.has(k)); if (!cand) return;
      const rB = iB[cand]; sRes.add(ka); eRes.add(cand);
      const pA = rA.placa_norm, pB = rB.placa_norm;
      const tf = virouMercosul(pA, pB) ? "mercosul" : "placa_trocada";
      const mudancas = [], flags = [tf];
      CAMPOS.forEach(([campo, rotulo]) => { if (!valEq(rA[campo], rB[campo])) { mudancas.push({ campo: rotulo, de: rA[campo], para: rB[campo] }); if (campo === "unidade") flags.push("trocou_cdd"); } });
      const item = { ...resumoReg(rB), placa_a: pA, placa_b: pB, mudancas, flags: [...new Set(flags)].sort() };
      tf === "mercosul" ? mercosul.push(item) : placaTrocada.push(item);
    });
    const srt = (arr) => arr.sort((a, b) => (a.unidade || "").localeCompare(b.unidade || "") || (a.placa || "").localeCompare(b.placa || ""));
    const entradas = srt(soB.filter((k) => !eRes.has(k)).map((k) => resumoReg(iB[k])));
    const saidas = srt(soA.filter((k) => !sRes.has(k)).map((k) => resumoReg(iA[k])));
    srt(alteracoes);
    const transferencias = [];
    [...alteracoes, ...mercosul, ...placaTrocada].forEach((r) => {
      if ((r.flags || []).includes("trocou_cdd")) {
        const m = (r.mudancas || []).find((m) => m.campo === "Unidade");
        if (m) transferencias.push({ placa: r.placa_b || r.placa, chassi: r.chassi, modelo: r.modelo, de: m.de, para: m.para });
      }
    });
    transferencias.sort((a, b) => (a.de || "").localeCompare(b.de || "") || (a.para || "").localeCompare(b.para || ""));
    return { label_a: la, label_b: lb, total_a: ra.length, total_b: rb.length, entradas, saidas, alteracoes, mercosul, placa_trocada: placaTrocada, transferencias_cdd: transferencias, inalterados, contagem: { entradas: entradas.length, saidas: saidas.length, alteracoes: alteracoes.length, mercosul: mercosul.length, placa_trocada: placaTrocada.length, trocou_cdd: transferencias.length, inalterados } };
  }

  function apiContinuidade(params) {
    const tipo = params.get("tipo") || "";
    const unidade = params.get("unidade") || "";
    const busca = (params.get("busca") || "").toUpperCase();
    const de = params.get("de") || "";
    const ate = params.get("ate") || "";
    const somente = params.get("somente") === "1";
    const ordenar = params.get("ordenar") || "alteracoes";
    const rows = tipo ? REGS.filter((r) => r.tipo === tipo) : [...REGS];
    const todosP = periodosDistintos(rows);
    let filtRows = rows;
    if (busca) filtRows = rows.filter((r) => (r.placa_norm || "").includes(busca) || (r.chassi_norm || "").includes(busca) || (r.modelo || "").toUpperCase().includes(busca));
    let colunas = todosP;
    if (de) colunas = colunas.filter((c) => c.chave >= de);
    if (ate) colunas = colunas.filter((c) => c.chave <= ate);
    const ordemSet = new Set(colunas.map((c) => `${c.ano}|${c.mes}|${c.periodo}`));
    const linhas = {};
    filtRows.forEach((r) => {
      const kp = `${r.ano}|${r.mes}|${r.periodo}`;
      if (!ordemSet.has(kp)) return;
      const ident = r.placa_norm ? (chavePlaca(r.placa_norm) || r.placa_norm) : r.chassi_tail;
      if (!ident) return;
      if (!linhas[ident]) linhas[ident] = { placa: null, chassi: null, modelo: null, tipo: r.tipo, pres: new Set(), unid: {}, fmt: {}, unidades: new Set() };
      const L = linhas[ident];
      L.pres.add(kp); if (r.unidade) { L.unid[kp] = r.unidade; L.unidades.add(r.unidade); } if (r.placa_formato) L.fmt[kp] = r.placa_formato;
    });
    [...filtRows].sort((a, b) => a.ano - b.ano || a.mes - b.mes || a.periodo - b.periodo).forEach((r) => {
      const ident = r.placa_norm ? (chavePlaca(r.placa_norm) || r.placa_norm) : r.chassi_tail;
      const L = linhas[ident]; if (!L) return;
      if (r.placa_norm) L.placa = r.placa_norm; if (r.chassi_norm) L.chassi = r.chassi_norm; if (r.modelo) L.modelo = r.modelo;
    });
    const ordemArr = colunas.map((c) => `${c.ano}|${c.mes}|${c.periodo}`);
    const OF = { saiu: 5, entrou: 4, trocou_tipo: 4, trocou_cdd: 3, intermitente: 2, mercosul: 1 };
    const out = [];
    Object.entries(linhas).forEach(([ident, L]) => {
      const seq = ordemArr.map((k) => (L.pres.has(k) ? 1 : 0));
      const idxs = seq.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
      if (!idxs.length) return;
      const first = idxs[0], last = idxs[idxs.length - 1];
      const gaps = ordemArr.slice(first, last + 1).filter((_, i) => seq[first + i] === 0).length;
      const unidSeq = ordemArr.map((k) => L.unid[k] || null);
      const cddMudancas = [], cddIdx = []; let ant = null;
      idxs.forEach((i) => { const at = unidSeq[i]; if (at != null) { if (ant != null && at !== ant) { cddMudancas.push({ de: ant, para: at, periodo: colunas[i].label }); cddIdx.push(i); } ant = at; } });
      const fmts = ordemArr.map((k) => L.fmt[k]).filter(Boolean);
      const virouMerc = fmts.includes("antiga") && fmts.includes("mercosul") && fmts.indexOf("antiga") < fmts.length - 1 - [...fmts].reverse().indexOf("mercosul");
      const flags = [];
      if (first > 0) flags.push("entrou");
      if (seq[seq.length - 1] === 0) flags.push("saiu");
      if (gaps > 0) flags.push("intermitente");
      if (cddMudancas.length) flags.push("trocou_cdd");
      if (virouMerc) flags.push("mercosul");
      if (unidade && !L.unidades.has(unidade)) return;
      if (somente && !flags.length) return;
      out.push({ id: ident, placa: L.placa, chassi: L.chassi, modelo: L.modelo, tipo: L.tipo, unidade: unidSeq[last], unidades: [...L.unidades].sort(), seq, unid_seq: unidSeq, first, last, total: idxs.length, gaps, ativo_fim: seq[seq.length - 1] === 1, flags, cdd_mudancas: cddMudancas, cdd_origem: cddMudancas.length ? cddMudancas[cddMudancas.length - 1].de : null, cdd_change_idx: cddIdx, primeiro_label: colunas[first]?.label || null, ultimo_label: colunas[last]?.label || null });
    });
    if (ordenar === "placa") out.sort((a, b) => (a.placa || a.chassi || "").localeCompare(b.placa || b.chassi || ""));
    else out.sort((a, b) => (b.flags.length - a.flags.length) || (Math.max(0, ...b.flags.map((f) => OF[f] || 0)) - Math.max(0, ...a.flags.map((f) => OF[f] || 0))) || (a.placa || a.chassi || "").localeCompare(b.placa || b.chassi || ""));
    const totais = ordemArr.map((_, i) => out.reduce((s, r) => s + r.seq[i], 0));
    return { colunas, periodos_disponiveis: todosP, linhas: out, totais, n_linhas: out.length, n_colunas: colunas.length, n_com_alteracao: out.filter((r) => r.flags.length).length };
  }

  function apiVerificar(formData) {
    const texto = formData instanceof FormData ? (formData.get("itens") || "") : "";
    const de = formData instanceof FormData ? (formData.get("de") || null) : null;
    const ate = formData instanceof FormData ? (formData.get("ate") || null) : null;
    const itens = texto.replace(/[;,]/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean);
    const porPlaca = {}, porChass = {};
    REGS.forEach((r) => {
      if (r.placa_norm) { const k = chavePlaca(r.placa_norm); if (k) (porPlaca[k] = porPlaca[k] || []).push(r); }
      if (r.chassi_tail) (porChass[r.chassi_tail] = porChass[r.chassi_tail] || []).push(r);
    });
    function diasAusente(ano, mes, periodo) {
      const dia = periodo === 1 ? 15 : new Date(ano, mes, 0).getDate();
      return Math.floor((Date.now() - new Date(ano, mes - 1, dia).getTime()) / 86400000);
    }
    function periodoOrd(r) { return r.ano * 10000 + r.mes * 100 + r.periodo; }
    function resultadoDe(achados, consulta, criterio) {
      if (de) achados = achados.filter((r) => periodoChave(r.ano, r.mes, r.periodo) >= de);
      if (ate) achados = achados.filter((r) => periodoChave(r.ano, r.mes, r.periodo) <= ate);
      if (!achados.length) return { consulta, encontrado: false, criterio: criterio + " (fora do período)", periodos: [] };
      achados = [...achados].sort((a, b) => periodoOrd(a) - periodoOrd(b));
      const visto = new Set(); const periodos = [];
      achados.forEach((r) => {
        const k = `${r.tipo}|${r.ano}|${r.mes}|${r.periodo}`;
        if (!visto.has(k)) { visto.add(k); periodos.push({ tipo: r.tipo, periodo: r.periodo_label || periodoLabel(r.ano, r.mes, r.periodo, r.negocio === "ARMAZEM"), unidade: r.unidade, ano: r.ano, mes: r.mes, q: r.periodo }); }
      });
      const histU = []; let prev = null;
      periodos.forEach((p) => { if (p.unidade && prev && p.unidade !== prev) histU.push({ periodo: p.periodo, de: prev, para: p.unidade }); if (p.unidade) prev = p.unidade; });
      const unidAtual = [...periodos].reverse().find((p) => p.unidade)?.unidade || null;
      const prim = achados[0], ult = achados[achados.length - 1];
      const da = diasAusente(ult.ano, ult.mes, ult.periodo);
      return { consulta, encontrado: true, criterio, tipo: prim.tipo, placa: prim.placa_norm, chassi: prim.chassi_norm, n_periodos: periodos.length, primeiro_periodo: periodos[0]?.periodo, ultimo_periodo: periodos[periodos.length - 1]?.periodo, data_referencia: (() => { const dia = ult.periodo === 1 ? 15 : new Date(ult.ano, ult.mes, 0).getDate(); return `${String(dia).padStart(2, "0")}/${String(ult.mes).padStart(2, "0")}/${String(ult.ano % 100).padStart(2, "0")}`; })(), dias_ausente: da, unidade_atual: unidAtual, trocou_unidade: histU.length > 0, historico_unidade: histU, periodos };
    }
    const resultados = itens.map((termo) => {
      const p = normPlaca(termo); const ck = p ? chavePlaca(p) : null;
      let achados = null; let criterio = null;
      if (ck && porPlaca[ck]) { achados = porPlaca[ck]; criterio = "placa"; }
      if (!achados && termo.length >= 6) {
        const tail = termo.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(-7);
        if (porChass[tail]) { achados = porChass[tail]; criterio = "chassi (final)"; }
      }
      if (!achados && p && porPlaca[p]) { achados = porPlaca[p]; criterio = "placa"; }
      if (!achados && termo.length >= 3) {
        const frag = termo.toUpperCase().replace(/\s/g, "");
        const grupos = {};
        REGS.forEach((r) => { const raw = r.placa_norm || ""; if (!raw) return; const k = chavePlaca(raw) || raw; if (raw.includes(frag) || k.includes(frag)) (grupos[k] = grupos[k] || []).push(r); });
        const gs = Object.values(grupos);
        if (gs.length === 1) { achados = gs[0]; criterio = "placa (parcial)"; }
        else if (gs.length > 1) return gs.map((g) => resultadoDe(g, termo, "placa (parcial)"));
      }
      if (achados) return resultadoDe(achados, termo, criterio || "");
      return { consulta: termo, encontrado: false, criterio: null, periodos: [] };
    }).flat();
    const enc = resultados.filter((r) => r.encontrado).length;
    return { total: resultados.length, encontrados: enc, nao_encontrados: resultados.length - enc, resultados };
  }

  function apiLocadoras(params) {
    const tipo = params.get("tipo") || "";
    const unidade = params.get("unidade") || "";
    const pchave = params.get("pchave") || "";
    let ano = null, mes = null, periodo = null;
    if (pchave) { const p = pchave.split("-"); if (p.length === 3) { ano = +p[0]; mes = +p[1]; periodo = +p[2]; } }
    else { if (params.get("ano")) ano = +params.get("ano"); if (params.get("mes")) mes = +params.get("mes"); if (params.get("periodo")) periodo = +params.get("periodo"); }
    const m = {};
    REGS.filter((r) => r.empresa_locadora).forEach((r) => {
      if (tipo && r.tipo !== tipo) return;
      if (unidade && r.unidade !== unidade) return;
      if (ano && r.ano !== ano) return;
      if (mes && r.mes !== mes) return;
      if (periodo) { if (periodo === 2 && !(r.periodo === 2 || (r.periodo === 1 && r.negocio === "ARMAZEM"))) return; if (periodo !== 2 && r.periodo !== periodo) return; }
      const k = `${r.empresa_locadora}|${r.montadora || ""}|${r.modelo || ""}`;
      if (!m[k]) m[k] = { empresa_locadora: r.empresa_locadora, montadora: r.montadora, modelo: r.modelo, n: 0, custos: [] };
      m[k].n++;
      if (r.custo_aluguel) m[k].custos.push(+r.custo_aluguel);
    });
    return Object.values(m).sort((a, b) => (a.empresa_locadora || "").localeCompare(b.empresa_locadora || "") || (a.montadora || "").localeCompare(b.montadora || "")).map((d) => ({ empresa_locadora: d.empresa_locadora, montadora: d.montadora, modelo: d.modelo, n: d.n, custo_medio: d.custos.length ? d.custos.reduce((s, x) => s + x, 0) / d.custos.length : null, custo_total: d.custos.reduce((s, x) => s + x, 0) }));
  }

  function apiCustos(params) {
    const dimensao = params.get("dimensao") || "locadora";
    const tipo = params.get("tipo") || "";
    const unidade = params.get("unidade") || "";
    const pchave = params.get("pchave") || "";
    let ano = null, mes = null, periodo = null;
    if (pchave) { const p = pchave.split("-"); if (p.length === 3) { ano = +p[0]; mes = +p[1]; periodo = +p[2]; } }
    else { if (params.get("ano")) ano = +params.get("ano"); if (params.get("mes")) mes = +params.get("mes"); if (params.get("periodo")) periodo = +params.get("periodo"); }
    const _DIMS = { locadora: ["empresa_locadora"], tipo: ["tipo"], unidade: ["unidade"], locadora_tipo: ["empresa_locadora", "tipo"], locadora_unidade: ["empresa_locadora", "unidade"], tipo_unidade: ["tipo", "unidade"] };
    const cols = _DIMS[dimensao] || _DIMS["locadora"];
    const m = {};
    REGS.forEach((r) => {
      if (tipo && r.tipo !== tipo) return;
      if (unidade && r.unidade !== unidade) return;
      if (ano && r.ano !== ano) return;
      if (mes && r.mes !== mes) return;
      if (periodo) { if (periodo === 2 && !(r.periodo === 2 || (r.periodo === 1 && r.negocio === "ARMAZEM"))) return; if (periodo !== 2 && r.periodo !== periodo) return; }
      const k = cols.map((c) => r[c] || "(sem)").join("|");
      if (!m[k]) m[k] = Object.fromEntries(cols.map((c) => [c, r[c] || "(sem)"]));
      m[k].n = (m[k].n || 0) + 1;
      if (r.custo_aluguel) { m[k]._custos = m[k]._custos || []; m[k]._custos.push(+r.custo_aluguel); }
    });
    return Object.values(m).map((d) => {
      const cs = d._custos || [];
      const ct = cs.reduce((s, x) => s + x, 0);
      delete d._custos;
      return { ...d, n_com_custo: cs.length, custo_total: ct, custo_medio: cs.length ? ct / cs.length : null };
    }).sort((a, b) => (b.custo_total || 0) - (a.custo_total || 0));
  }

  function apiStressTest(params) {
    const ano = +params.get("ano"), mes = +params.get("mes");
    if (!ano || !mes) return { erro: "Informe ano e mes." };
    const doPeriodo = REGS.filter((r) => r.ano === ano && r.mes === mes);
    const porPlaca = {};
    doPeriodo.forEach((r) => { if (!r.placa_norm) return; if (!porPlaca[r.placa_norm]) porPlaca[r.placa_norm] = []; porPlaca[r.placa_norm].push(r); });
    return Object.entries(porPlaca)
      .filter(([, regs]) => regs.length > 1)
      .map(([placa, regs]) => ({ placa, tipos: regs.map((r) => ({ tipo: r.tipo, unidade: r.unidade, periodo: r.periodo, negocio: r.negocio })) }));
  }

  // ---------------------------------------------------------- sobrescreve fetch SINCRONAMENTE
  window.fetch = async function (url, opts = {}) {
    const u = typeof url === "string" ? url : url.toString();
    if (!u.startsWith("/api/")) return _origFetch(url, opts);

    // Aguarda o data.json carregar antes de responder qualquer chamada /api/
    await _dataReady();

    const urlObj = new URL(u, location.origin);
    const p = urlObj.pathname, params = urlObj.searchParams;
    const method = (opts.method || "GET").toUpperCase();
    try {
      if (p === "/api/tipos") return fakeResp(apiTipos());
      if (p === "/api/unidades") return fakeResp(apiUnidades());
      if (p === "/api/periodos_global") return fakeResp(apiPeriodosGlobal());
      if (p === "/api/periodos") return fakeResp(apiPeriodos(params));
      if (p === "/api/inventario") return fakeResp(apiInventario(params));
      if (p === "/api/resumo") return fakeResp(apiResumo(params));
      if (p === "/api/continuidade") return fakeResp(apiContinuidade(params));
      if (p === "/api/locadoras") return fakeResp(apiLocadoras(params));
      if (p === "/api/custos") return fakeResp(apiCustos(params));
      if (p === "/api/telemetria/cruzamento") return fakeResp(_DATA.telemetria?.cruzamento || {});
      if (p === "/api/telemetria/info") return fakeResp(_DATA.telemetria?.info || {});
      if (p === "/api/historico") return fakeResp(_DATA.historico || []);
      if (p === "/api/ultima_data_saida") return fakeResp(_DATA.ultima_data_saida || { total: 0, ultima_data: null });
      if (p === "/api/ultima_data_unidocs") return fakeResp(_DATA.ultima_data_unidocs || { total: 0, ultima_data: null });
      if (p === "/api/stress_test") return fakeResp(apiStressTest(params));
      if (p === "/api/comparar" && method === "POST") {
        let body;
        if (typeof opts.body === "string") body = JSON.parse(opts.body);
        else if (opts.body instanceof FormData) body = Object.fromEntries(opts.body.entries());
        else body = {};
        return fakeResp(apiComparar(body));
      }
      if (p === "/api/verificar" && method === "POST") return fakeResp(apiVerificar(opts.body || new FormData()));
      if (p.startsWith("/api/exportar/") || p.startsWith("/api/download/") || p.startsWith("/api/importar") || p.startsWith("/api/reiniciar") || p.startsWith("/api/publicar")) {
        return fakeResp({ erro: "Não disponível na versão pública." }, 403);
      }
      return _origFetch(url, opts);
    } catch (e) {
      return fakeResp({ erro: String(e) }, 500);
    }
  };

  // --------------------------------------------------------- UI: executada após data.json carregar
  function _setupUI() {
    function apply() {
      ["importar", "auditoria"].forEach((tab) => {
        const btn = document.querySelector(`[data-tab="${tab}"]`);
        if (btn) btn.style.display = "none";
      });
      const btnR = document.getElementById("btn-reiniciar");
      if (btnR) btnR.parentElement.style.display = "none";
      const primBtn = document.querySelector('[data-tab="inventario"]');
      if (primBtn) {
        document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".panel").forEach((s) => s.classList.remove("active"));
        primBtn.classList.add("active");
        document.getElementById("inventario")?.classList.add("active");
      }
      document.querySelectorAll('button[id$="-dl-btn"], button[id^="exportar"], .btn-export, [id*="export"]').forEach((b) => {
        if (b.textContent?.includes("Baixar") || b.textContent?.includes("Exportar") || b.textContent?.includes("Excel")) b.style.display = "none";
      });
      const ts = _DATA.exported_at ? new Date(_DATA.exported_at).toLocaleString("pt-BR") : "";
      if (ts) {
        const badge = document.createElement("span");
        badge.className = "hint";
        badge.style.cssText = "font-size:11px;margin-left:14px;opacity:.7;";
        badge.textContent = `Dados exportados em ${ts}`;
        document.querySelector(".brand")?.appendChild(badge);
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", apply);
    } else {
      apply();
    }
  }
})();
