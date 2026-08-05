/**
 * ============================================================================
 *  Painel de Share of Voice — Zendesk LATAM
 * ----------------------------------------------------------------------------
 *  Sem biblioteca externa de propósito: os gráficos são SVG e HTML gerados aqui.
 *  Um site que não depende de CDN nenhum continua funcionando daqui a anos, sem
 *  ninguém atualizar versão de biblioteca.
 *
 *  Fonte de dados: o JSON agregado publicado por apps-script/Resumo.gs.
 *  Formato esperado: versão 1.x (ver FORMATO_SUPORTADO).
 *
 *  IDIOMA: a interface é em INGLÊS (a equipe que a usa trabalha em inglês).
 *  O código, os comentários e a documentação continuam em português — quem
 *  mantém é lusófona. Todo texto que a pessoa lê na tela fica em inglês, com
 *  formato de número e data en-US (ponto decimal, vírgula de milhar).
 *  Cuidado: parte do texto visível NÃO está aqui — nomes de tema, mensagens de
 *  alerta e avisos vêm prontos do Resumo.gs. Traduzir só aqui deixaria o painel
 *  bilíngue. Ver docs/DECISOES.md ADR-0009.
 * ============================================================================
 */
(function () {
  'use strict';

  var FORMATO_SUPORTADO = 1; // versão maior do JSON que este site entende

  /** Cores por marca. Marca desconhecida cai numa cor neutra. */
  var CORES = {
    'Zendesk':    'var(--zendesk-viva)',
    'Salesforce': 'var(--salesforce)',
    'Intercom':   'var(--intercom)',
    'Freshworks': 'var(--freshworks)',
    'ServiceNow': 'var(--servicenow)',
    'HubSpot':    'var(--hubspot)'
  };

  function cor(marca) { return CORES[marca] || 'var(--outra)'; }

  // === Utilitários de formatação ==========================================

  function pct(v, casas) {
    if (typeof casas !== 'number') casas = 1;
    return (v * 100).toFixed(casas) + '%';
  }

  function num(v) {
    return Number(v || 0).toLocaleString('en-US');
  }

  /** 1234567 → "1.2M"; 45000 → "45K". Para o alcance (UVM). */
  function numCurto(v) {
    v = Number(v || 0);
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return Math.round(v / 1e3) + 'K';
    return num(v);
  }

  var MESES_CURTOS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** '2026-08' → 'Aug/26' */
  function mesLegivel(iso) {
    var p = String(iso).split('-');
    if (p.length < 2) return iso;
    var i = Number(p[1]) - 1;
    if (i < 0 || i > 11) return iso;
    return MESES_CURTOS[i] + '/' + p[0].slice(2);
  }

  /** '2026-08-04' → 'August 4, 2026' */
  var MESES_LONGOS = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November',
                      'December'];
  function diaLegivel(iso) {
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso || '—';
    return MESES_LONGOS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }

  function diasDesde(iso) {
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var alvo = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var h = new Date();
    var hoje = Date.UTC(h.getFullYear(), h.getMonth(), h.getDate());
    return Math.round((hoje - alvo) / 86400000);
  }

  // === Manipulação segura do DOM =========================================
  // Sempre textContent, nunca innerHTML com dado vindo do JSON: título de
  // matéria e nome de veículo são texto de terceiros.

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = String(texto);
    return n;
  }

  function svgEl(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    }
    return n;
  }

  function limpar(no) {
    while (no.firstChild) no.removeChild(no.firstChild);
  }

  /**
   * Quadradinho de cor seguido do nome, num par que a quebra de linha não
   * separa. Em coluna estreita (folha A4, celular) o quadradinho descolava do
   * nome e caía sozinho numa linha, virando enfeite sem sentido.
   */
  function marcaComCor(nome, corDeFundo) {
    var par = el('span', 'par-marca');
    var pastilha = el('span', 'marcador');
    pastilha.style.background = corDeFundo;
    par.appendChild(pastilha);
    par.appendChild(document.createTextNode(nome));
    return par;
  }

  function porId(id) { return document.getElementById(id); }

  // === Carregamento ======================================================

  function carregar() {
    // Modo demonstração: só quando um arquivo de dados falsos foi carregado de
    // propósito (scripts/previa-site.sh). Nunca em produção — o site publicado
    // não inclui demo.js.
    if (window.DADOS_DEMONSTRACAO) {
      porId('demonstracao').hidden = false;
      desenhar(window.DADOS_DEMONSTRACAO);
      return;
    }

    var url = (window.CONFIG && CONFIG.URL_RESUMO || '').trim();

    if (!url) {
      mostrarErro('The summary URL has not been configured yet.',
        'Open the site\'s config.js file and set URL_RESUMO to the URL of the ' +
        'web app published by Apps Script (the one ending in /exec).');
      return;
    }

    buscar(url)
      .then(function (dados) {
        if (!dados || dados.ok === false) {
          throw new Error(dados && dados.erro || 'The summary returned an error.');
        }
        var maior = parseInt(String(dados.versao || '0').split('.')[0], 10);
        if (maior !== FORMATO_SUPORTADO) {
          throw new Error('The summary is in format ' + dados.versao +
            ', and this site understands format ' + FORMATO_SUPORTADO +
            '.x. Please update the site.');
        }
        desenhar(dados);
      })
      .catch(function (erro) {
        mostrarErro('Could not fetch the data.', erro && erro.message || String(erro));
      });
  }

  /**
   * Tenta fetch e, se falhar, cai para JSONP. O Apps Script não permite
   * configurar CORS, então o fetch direto pode ser bloqueado pelo navegador —
   * o JSONP é a saída que não exige servidor intermediário.
   */
  function buscar(url) {
    return fetch(url, { redirect: 'follow' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function () { return viaJsonp(url); });
  }

  function viaJsonp(url) {
    return new Promise(function (resolve, reject) {
      var nome = 'sovCb' + Math.random().toString(36).slice(2, 10);
      var script = document.createElement('script');
      var relogio = setTimeout(function () {
        encerrar();
        reject(new Error('Timed out fetching the data (20s).'));
      }, 20000);

      function encerrar() {
        clearTimeout(relogio);
        delete window[nome];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[nome] = function (dados) { encerrar(); resolve(dados); };
      script.onerror = function () {
        encerrar();
        reject(new Error('The summary URL did not respond. Check the URL in ' +
          'config.js and whether the Apps Script deployment is published.'));
      };
      script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + nome;
      document.body.appendChild(script);
    });
  }

  function mostrarErro(titulo, detalhe) {
    porId('carregando').hidden = true;
    porId('painel').hidden = true;
    var caixa = porId('erro');
    caixa.hidden = false;
    caixa.querySelector('h2').textContent = titulo;
    porId('erro-detalhe').textContent = detalhe || '';
    porId('atualizado-em').textContent = 'unavailable';
  }

  // === Desenho ===========================================================

  function desenhar(d) {
    porId('carregando').hidden = true;
    porId('erro').hidden = true;
    porId('painel').hidden = false;

    cabecalho(d);
    avisos(d);
    cartoes(d);
    sovBarras(d);
    sovTabela(d);
    evolucao(d);
    alertas(d);
    temas(d);
    sentimento(d);
    veiculos(d);

    porId('rodape-versao').textContent = 'Summary format: ' + d.versao + '.';
  }

  function cabecalho(d) {
    var ultimo = d.cobertura && d.cobertura.ultimoAlerta;
    porId('atualizado-em').textContent = ultimo ? diaLegivel(ultimo) : 'no data';

    var dias = ultimo ? diasDesde(ultimo) : null;
    var limite = (window.CONFIG && CONFIG.DIAS_PARA_ALERTAR) || 10;
    if (dias !== null && dias > limite) {
      porId('atualizacao').classList.add('vencida');
    }

    var periodo = porId('cobertura-periodo');
    if (d.cobertura && d.cobertura.primeiroAlerta) {
      var texto = 'Series since ' + diaLegivel(d.cobertura.primeiroAlerta);
      if (dias !== null) {
        texto += dias === 0 ? ' · today'
               : dias === 1 ? ' · 1 day ago'
               : ' · ' + dias + ' days ago';
      }
      periodo.textContent = texto;
    }
  }

  function avisos(d) {
    var caixa = porId('avisos');
    limpar(caixa);
    var lista = (d.avisos || []);
    if (!lista.length) { caixa.hidden = true; return; }
    caixa.hidden = false;
    lista.forEach(function (a) {
      var no = el('div', 'aviso ' + (a.gravidade || 'media'));
      no.appendChild(el('span', 'icone', a.gravidade === 'alta' ? '!' : 'i'));
      no.appendChild(el('span', null, a.mensagem));
      caixa.appendChild(no);
    });
  }

  function cartoes(d) {
    var caixa = porId('cartoes');
    limpar(caixa);

    var sov = d.sov || [];
    var propria = sov.filter(function (s) { return s.ehPrincipal; })[0];
    var lider = sov[0];
    var totalArtigos = sov.reduce(function (a, s) { return a + s.artigosUnicos; }, 0);
    var posicao = 0;
    sov.forEach(function (s, i) { if (s.ehPrincipal) posicao = i + 1; });

    function cartao(chave, valor, apoio, principal) {
      var c = el('div', 'cartao' + (principal ? ' principal' : ''));
      c.appendChild(el('div', 'chave', chave));
      c.appendChild(el('div', 'valor', valor));
      if (apoio) c.appendChild(el('div', 'apoio', apoio));
      caixa.appendChild(c);
    }

    if (propria) {
      cartao('Zendesk SoV · full period', pct(propria.share),
        num(propria.artigosUnicos) + ' unique articles', true);
      cartao('Industry rank',
        ordinal(posicao) + ' of ' + sov.length,
        lider && !lider.ehPrincipal ? 'Leader: ' + lider.marca : 'Zendesk leads');
      cartao('Estimated reach', numCurto(propria.uvm),
        'Sum of article UVM');
    } else {
      cartao('Zendesk SoV · full period', '—',
        'Zendesk does not appear in the data', true);
    }

    cartao('Industry total', num(totalArtigos),
      'Unique articles, ' + sov.length + ' brands');
  }

  /** 1 → '1st', 2 → '2nd', 3 → '3rd', 4 → '4th', 11 → '11th'. */
  function ordinal(n) {
    n = Number(n) || 0;
    var resto100 = n % 100;
    if (resto100 >= 11 && resto100 <= 13) return n + 'th';
    var resto10 = n % 10;
    return n + (resto10 === 1 ? 'st' : resto10 === 2 ? 'nd'
              : resto10 === 3 ? 'rd' : 'th');
  }

  // --- Bloco 1: Share of Voice -------------------------------------------

  function sovBarras(d) {
    var caixa = porId('g-sov-barras');
    limpar(caixa);
    var sov = d.sov || [];
    if (!sov.length) { caixa.appendChild(el('p', 'vazio', 'No data.')); return; }

    var maior = sov[0].share || 1;
    var lista = el('div', 'barras');

    sov.forEach(function (s) {
      var item = el('div', 'barra-item');
      var topo = el('div', 'barra-topo');
      topo.appendChild(el('span', 'barra-nome' + (s.ehPrincipal ? ' propria' : ''), s.marca));
      topo.appendChild(el('span', 'barra-valor',
        pct(s.share) + ' · ' + num(s.artigosUnicos)));
      item.appendChild(topo);

      var trilha = el('div', 'barra-trilha');
      var cheio = el('div', 'barra-preenchida');
      // Escala relativa ao maior, para que a diferença apareça mesmo quando
      // todos os shares são pequenos.
      cheio.style.width = Math.max(2, (s.share / maior) * 100) + '%';
      cheio.style.background = cor(s.marca);
      trilha.appendChild(cheio);
      item.appendChild(trilha);
      lista.appendChild(item);
    });

    caixa.appendChild(lista);
  }

  function sovTabela(d) {
    var caixa = porId('g-sov-tabela');
    limpar(caixa);
    var sov = d.sov || [];
    if (!sov.length) { caixa.appendChild(el('p', 'vazio', 'No data.')); return; }

    var tabela = el('table');
    var thead = el('thead');
    var tr = el('tr');
    ['Brand', 'Unique', 'Total', 'Reach', 'Share'].forEach(function (t, i) {
      tr.appendChild(el('th', i === 0 ? null : 'num', t));
    });
    thead.appendChild(tr);
    tabela.appendChild(thead);

    var tbody = el('tbody');
    sov.forEach(function (s) {
      var linha = el('tr', s.ehPrincipal ? 'propria' : null);
      var tdMarca = el('td');
      tdMarca.appendChild(marcaComCor(s.marca, cor(s.marca)));
      linha.appendChild(tdMarca);
      linha.appendChild(el('td', 'num', num(s.artigosUnicos)));
      linha.appendChild(el('td', 'num', num(s.artigosTotal)));
      linha.appendChild(el('td', 'num', numCurto(s.uvm)));
      linha.appendChild(el('td', 'num', pct(s.share)));
      tbody.appendChild(linha);
    });
    tabela.appendChild(tbody);
    caixa.appendChild(tabela);
  }

  // --- Bloco 2: Evolução --------------------------------------------------

  function evolucao(d) {
    var caixa = porId('g-evolucao');
    var caixaLegenda = porId('legenda-evolucao');
    limpar(caixa);
    limpar(caixaLegenda);

    var ev = d.evolucao || { meses: [], series: [] };
    if (ev.meses.length < 2) {
      caixa.appendChild(el('p', 'vazio',
        ev.meses.length === 1
          ? 'Only one month of data so far: the trend appears from the second month on.'
          : 'Not enough data for the time series.'));
      return;
    }

    var L = 900, A = 340;
    // Margem direita larga o bastante para o último rótulo do eixo X ('ago/26')
    // caber inteiro: com 16px ele saía cortado na borda.
    var mE = 48, mD = 30, mT = 16, mB = 38;
    var larg = L - mE - mD, alt = A - mT - mB;

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + L + ' ' + A,
      role: 'img',
      'aria-label': 'Share of Voice mensal por marca'
    });

    // Escala Y adaptativa. Fixar 0–100% desperdiçaria a maior parte do gráfico:
    // com 6 marcas, nenhuma passa de ~35%, e as linhas ficariam amontoadas na
    // base. O topo sobe até o próximo múltiplo de 10% acima do maior valor,
    // com piso de 40% para que a escala não fique exagerada em dados pequenos.
    var maiorShare = 0;
    ev.series.forEach(function (s) {
      s.share.forEach(function (v) { if (v > maiorShare) maiorShare = v; });
    });
    var topoY = Math.max(0.4, Math.min(1, Math.ceil(maiorShare * 10) / 10));

    // 4 divisões, sempre em números redondos.
    var passos = [0, topoY / 4, topoY / 2, topoY * 3 / 4, topoY];

    function x(i) {
      return ev.meses.length === 1 ? mE + larg / 2
           : mE + (i / (ev.meses.length - 1)) * larg;
    }
    function y(v) { return mT + alt - (v / topoY) * alt; }

    passos.forEach(function (p) {
      svg.appendChild(svgEl('line', {
        x1: mE, y1: y(p), x2: mE + larg, y2: y(p), class: 'grade-linha'
      }));
      var t = svgEl('text', {
        x: mE - 8, y: y(p) + 4, class: 'eixo-texto', 'text-anchor': 'end'
      });
      // Uma casa decimal só quando necessário (topo de 45% gera passo 11,25%).
      var valor = p * 100;
      t.textContent = (Math.abs(valor - Math.round(valor)) < 0.05
        ? String(Math.round(valor))
        : valor.toFixed(1).replace('.', ',')) + '%';
      svg.appendChild(t);
    });

    // Eixo X: com muitos meses, rotula alternadamente para não sobrepor.
    var salto = Math.ceil(ev.meses.length / 12);
    var ultimoMes = ev.meses.length - 1;
    ev.meses.forEach(function (mes, i) {
      if (i % salto !== 0 && i !== ultimoMes) return;
      // Se o salto faria o penúltimo rótulo colar no último, omite o penúltimo.
      if (i !== ultimoMes && ultimoMes - i < salto) return;
      var t = svgEl('text', {
        x: x(i), y: mT + alt + 20, class: 'eixo-texto',
        // Extremos ancorados para dentro, para não vazarem da área do gráfico.
        'text-anchor': i === 0 ? 'start' : (i === ultimoMes ? 'end' : 'middle')
      });
      t.textContent = mesLegivel(mes);
      svg.appendChild(t);
    });

    svg.appendChild(svgEl('line', {
      x1: mE, y1: mT + alt, x2: mE + larg, y2: mT + alt, class: 'eixo-linha'
    }));

    // Marca própria por último, para ficar acima das outras linhas.
    var ordenadas = ev.series.slice().sort(function (a, b) {
      return (a.ehPrincipal ? 1 : 0) - (b.ehPrincipal ? 1 : 0);
    });

    ordenadas.forEach(function (s) {
      var pontos = s.share.map(function (v, i) { return x(i) + ',' + y(v); });
      svg.appendChild(svgEl('polyline', {
        points: pontos.join(' '),
        class: 'linha-serie' + (s.ehPrincipal ? ' propria' : ''),
        stroke: cor(s.marca)
      }));
      s.share.forEach(function (v, i) {
        var c = svgEl('circle', {
          cx: x(i), cy: y(v), r: s.ehPrincipal ? 4 : 3,
          class: 'ponto-serie', fill: cor(s.marca)
        });
        var titulo = svgEl('title');
        titulo.textContent = s.marca + ' — ' + mesLegivel(ev.meses[i]) + ': ' +
          pct(v) + ' (' + num(s.artigosUnicos[i]) + ' articles)';
        c.appendChild(titulo);
        svg.appendChild(c);
      });
    });

    caixa.appendChild(svg);

    // Legenda ordenada pelo share do mês mais recente. O percentual aqui é do
    // ÚLTIMO MÊS, e não do período inteiro como nos cartões do topo — sem dizer
    // isso, a diferença entre os dois números parece erro.
    var ultimo = ev.meses.length - 1;
    caixaLegenda.appendChild(el('span', 'legenda-titulo',
      'In ' + mesLegivel(ev.meses[ultimo]) + ':'));
    ev.series.slice().sort(function (a, b) {
      return b.share[ultimo] - a.share[ultimo];
    }).forEach(function (s) {
      var item = el('span', 'legenda-item' + (s.ehPrincipal ? ' propria' : ''));
      var traco = el('span', 'legenda-cor');
      traco.style.background = cor(s.marca);
      item.appendChild(traco);
      item.appendChild(document.createTextNode(
        s.marca + ' (' + pct(s.share[ultimo], 0) + ')'));
      caixaLegenda.appendChild(item);
    });
  }

  // --- Bloco 3: Alertas --------------------------------------------------

  var ROTULOS_ALERTA = {
    pico_concorrente: 'Competitor spike',
    queda_principal: 'Zendesk drop',
    lideranca: 'Leadership'
  };

  function alertas(d) {
    var caixa = porId('lista-alertas');
    limpar(caixa);
    var a = d.alertas || {};

    if (!a.suficienteParaComparar) {
      caixa.appendChild(el('div', 'sem-alerta',
        a.motivo || 'Not enough history to compare months.'));
      return;
    }

    if (!a.lista || !a.lista.length) {
      caixa.appendChild(el('div', 'sem-alerta',
        'No relevant movement in the most recent month, compared with the ' +
        'average of previous months.'));
      return;
    }

    a.lista.forEach(function (item) {
      var no = el('div', 'alerta ' + (item.gravidade || 'media'));
      no.appendChild(el('span', 'tipo', ROTULOS_ALERTA[item.tipo] || item.tipo));
      no.appendChild(el('p', null, item.mensagem));
      caixa.appendChild(no);
    });
  }

  // --- Bloco 4: Temas ----------------------------------------------------

  function temas(d) {
    var caixa = porId('g-temas');
    limpar(caixa);
    var t = d.temas || { lista: [] };

    if (!t.lista || !t.lista.length) {
      caixa.appendChild(el('p', 'vazio', 'No articles to classify.'));
      return;
    }

    if (t.artigosConsiderados) {
      var cobertura = t.artigosClassificados / t.artigosConsiderados;
      caixa.appendChild(el('p', 'secao-nota',
        num(t.artigosClassificados) + ' of ' + num(t.artigosConsiderados) +
        ' articles (' + pct(cobertura, 0) + ') matched a topic.'));
    }

    var maior = t.lista.reduce(function (m, x) { return Math.max(m, x.total); }, 0) || 1;
    var lista = el('div', 'barras');

    t.lista.forEach(function (tema) {
      var item = el('div', 'barra-item');
      var topo = el('div', 'barra-topo');
      topo.appendChild(el('span', 'barra-nome', tema.tema));
      topo.appendChild(el('span', 'barra-valor', num(tema.total) + ' mentions'));
      item.appendChild(topo);

      // Barra empilhada por marca: mostra quem domina cada tema.
      var pilha = el('div', 'empilhada');
      pilha.style.width = Math.max(4, (tema.total / maior) * 100) + '%';

      var marcas = Object.keys(tema.porMarca).sort(function (a, b) {
        return tema.porMarca[b] - tema.porMarca[a];
      });
      marcas.forEach(function (marca) {
        var fatia = el('span');
        fatia.style.width = (tema.porMarca[marca] / tema.total * 100) + '%';
        fatia.style.background = cor(marca);
        fatia.title = marca + ': ' + num(tema.porMarca[marca]);
        pilha.appendChild(fatia);
      });
      item.appendChild(pilha);
      lista.appendChild(item);
    });

    caixa.appendChild(lista);
    caixa.appendChild(legendaMarcas(d));
  }

  function legendaMarcas(d) {
    var caixa = el('div', 'legenda');
    (d.sov || []).forEach(function (s) {
      var item = el('span', 'legenda-item' + (s.ehPrincipal ? ' propria' : ''));
      item.appendChild(marcaComCor(s.marca, cor(s.marca)));
      caixa.appendChild(item);
    });
    return caixa;
  }

  // --- Bloco 5: Sentimento ----------------------------------------------

  function sentimento(d) {
    var caixa = porId('g-sentimento');
    limpar(caixa);
    var lista = d.sentimento || [];
    if (!lista.length) {
      caixa.appendChild(el('p', 'vazio', 'No classified articles.'));
      return;
    }

    var legenda = el('div', 'legenda-sentimento');
    [['Positive', 'var(--positivo)'], ['Neutral', 'var(--neutro)'],
     ['Negative', 'var(--negativo)'], ['Unclassified', '#DDE1E6']]
      .forEach(function (par) {
        var item = el('span', 'legenda-item');
        item.appendChild(marcaComCor(par[0], par[1]));
        legenda.appendChild(item);
      });
    caixa.appendChild(legenda);

    var barras = el('div', 'barras');
    lista.forEach(function (s) {
      var item = el('div', 'barra-item');
      var topo = el('div', 'barra-topo');
      topo.appendChild(el('span', 'barra-nome' + (s.ehPrincipal ? ' propria' : ''),
        s.marca));
      var resumo = s.classificadas > 0
        ? pct(s.positivo / s.classificadas, 0) + ' positive · ' +
          num(s.total) + ' articles'
        : num(s.total) + ' articles, none classified';
      topo.appendChild(el('span', 'barra-valor', resumo));
      item.appendChild(topo);

      var pilha = el('div', 'empilhada');
      // O primeiro item é a classe CSS (não traduzir) e o segundo o rótulo
      // visível no tooltip.
      [['positivo', 'Positive', s.positivo], ['neutro', 'Neutral', s.neutro],
       ['negativo', 'Negative', s.negativo], ['sem', 'Unclassified', s.semClassificacao]]
        .forEach(function (par) {
          if (!par[2]) return;
          var fatia = el('span', 'fatia-' + par[0]);
          fatia.style.width = (par[2] / s.total * 100) + '%';
          fatia.title = par[1] + ': ' + num(par[2]);
          pilha.appendChild(fatia);
        });
      item.appendChild(pilha);
      barras.appendChild(item);
    });
    caixa.appendChild(barras);
  }

  // --- Bloco 6: Veículos -------------------------------------------------

  function veiculos(d) {
    var v = d.veiculos || { top: [], lacunas: { top: [] } };

    var caixaTop = porId('g-veiculos');
    limpar(caixaTop);
    if (!v.top || !v.top.length) {
      caixaTop.appendChild(el('p', 'vazio', 'No outlets in the data.'));
    } else {
      caixaTop.appendChild(el('p', 'secao-nota',
        num(v.total) + ' outlets in the period. Top ' + v.top.length + ':'));
      var maior = v.top[0].total || 1;
      var lista = el('div', 'barras');
      v.top.forEach(function (item) {
        var no = el('div', 'barra-item');
        var topo = el('div', 'barra-topo');
        topo.appendChild(el('span', 'barra-nome', item.veiculo));
        topo.appendChild(el('span', 'barra-valor', num(item.total)));
        no.appendChild(topo);

        var pilha = el('div', 'empilhada');
        pilha.style.width = Math.max(4, (item.total / maior) * 100) + '%';
        Object.keys(item.porMarca).sort(function (a, b) {
          return item.porMarca[b] - item.porMarca[a];
        }).forEach(function (marca) {
          var fatia = el('span');
          fatia.style.width = (item.porMarca[marca] / item.total * 100) + '%';
          fatia.style.background = cor(marca);
          fatia.title = marca + ': ' + num(item.porMarca[marca]);
          pilha.appendChild(fatia);
        });
        no.appendChild(pilha);
        lista.appendChild(no);
      });
      caixaTop.appendChild(lista);
      caixaTop.appendChild(legendaMarcas(d));
    }

    var caixaLacunas = porId('g-lacunas');
    limpar(caixaLacunas);
    var lac = v.lacunas || { top: [], total: 0 };
    if (!lac.top || !lac.top.length) {
      caixaLacunas.appendChild(el('p', 'vazio',
        'Every outlet in the period has published something about Zendesk.'));
      return;
    }
    caixaLacunas.appendChild(el('p', 'secao-nota',
      num(lac.total) + ' outlets published about competitors and never about ' +
      'Zendesk. Sorted by volume — this is where press effort tends to pay ' +
      'off most.'));

    var tabela = el('table');
    var thead = el('thead');
    var tr = el('tr');
    tr.appendChild(el('th', null, 'Outlet'));
    tr.appendChild(el('th', 'num', 'Articles'));
    tr.appendChild(el('th', null, 'Covers'));
    thead.appendChild(tr);
    tabela.appendChild(thead);

    var tbody = el('tbody');
    lac.top.forEach(function (item) {
      var linha = el('tr');
      linha.appendChild(el('td', null, item.veiculo));
      linha.appendChild(el('td', 'num', num(item.total)));
      var tdMarcas = el('td');
      Object.keys(item.porMarca).sort(function (a, b) {
        return item.porMarca[b] - item.porMarca[a];
      }).forEach(function (marca, i) {
        if (i > 0) tdMarcas.appendChild(document.createTextNode(', '));
        tdMarcas.appendChild(marcaComCor(marca, cor(marca)));
      });
      linha.appendChild(tdMarcas);
      tbody.appendChild(linha);
    });
    tabela.appendChild(tbody);
    caixaLacunas.appendChild(tabela);
  }

  // === Início ============================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', carregar);
  } else {
    carregar();
  }
})();
