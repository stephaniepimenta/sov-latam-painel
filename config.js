/**
 * Configuração do site — o ÚNICO arquivo que precisa ser editado à mão.
 *
 * Cole abaixo, entre as aspas, a URL do app da web publicado pelo Apps Script
 * (a que termina em /exec). O passo a passo está em docs/MANUAL_ADMIN.md §7.
 *
 * Não coloque token nenhum aqui: tudo neste arquivo é público para quem abrir o
 * site. É justamente por isso que o Apps Script publica um resumo agregado em
 * vez de dar acesso à planilha (docs/DECISOES.md ADR-0007).
 */
var CONFIG = {
  URL_RESUMO: 'https://script.google.com/macros/s/AKfycbzzOENWuqLA3kLuxLew-q4ZNEfyk2drvn1dm_I8x565MmwmVma-v5KfBqmRZyds12rV3w/exec',

  /** Depois de quantos dias sem alerta novo o site avisa em vermelho. */
  DIAS_PARA_ALERTAR: 10
};
