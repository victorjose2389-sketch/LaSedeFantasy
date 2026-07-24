/**
 * logic.js — Fantasy Football Core Logic
 * Modular: Puntuaciones, Sustituciones, Clasificaciones
 */

(function (exports) {
  "use strict";

  // ─── Helpers ──────────────────────────────────────────────
  const _posNorm = { GK: "GK", POR: "GK", DF: "DF", DEF: "DF", MF: "MF", MED: "MF", FW: "FW", DEL: "FW" };
  function normPos(pos) { return _posNorm[pos] || pos; }

  // ──────────────────────────────────────────────────────────
  // 1. PUNTUACIÓN SOFASCORE
  // ──────────────────────────────────────────────────────────

  /**
   * Convierte el rating de SofaScore (1.0–10.0) a puntos Fantasy.
   *
   * Escala:
   *   rating < 6.0           → 0 pts
   *   rating 6.0 – 6.9       → escala base directa (2–4 pts)
   *   rating ≥ 7.0           → (rating × 2) redondeado + bonos
   *       Bono gol:     +5 pts por gol
   *       Bono asistencia: +3 pts por asistencia
   *
   * @param {Object} player
   * @param {number} player.rating   – Calificación SofaScore (1.0–10.0)
   * @param {number} [player.goals]  – Goles marcados en el partido
   * @param {number} [player.assists]– Asistencias en el partido
   * @returns {number} Puntos Fantasy calculados
   */
  function calcularPuntosSofaScore(player) {
    const rating = Number(player.rating) || 0;

    // Sin participación
    if (rating < 6.0) return 0;

    // Escala base: 6.0 → 2 pts, 6.5 → 3 pts, 6.9 → ~4 pts
    if (rating < 7.0) {
      return Math.round((rating - 5.0) * 2);
    }

    // Rating ≥ 7.0: base × 2 + bonificaciones
    let puntos = Math.round(rating * 2);

    const goles = Number(player.goals) || 0;
    const asistencias = Number(player.assists) || 0;

    if (goles > 0 || asistencias > 0) {
      puntos += goles * 5 + asistencias * 3;
    }

    return puntos;
  }


  // ──────────────────────────────────────────────────────────
  // 2. SUSTITUCIONES AUTOMÁTICAS
  // ──────────────────────────────────────────────────────────

  /**
   * Verifica si un jugador efectivamente jugó en el partido.
   * Un jugador "jugó" si tiene rating > 0 Y minutos > 0.
   *
   * @param {Object} player
   * @returns {boolean}
   */
  function jugadorActivo(player) {
    if (!player) return false;
    return (Number(player.rating) > 0) && (Number(player.minutes) > 0);
  }

  /**
   * Procesa sustituciones automáticas para una plantilla.
   *
   * Lógica:
   *   1. Recorre los 11 titulares (según la formación activa).
   *   2. Si un titular no jugó (0 min / sin rating), busca suplente:
   *      a. Primero: suplente de la MISMA posición en el banquillo.
   *      b. Fallback: cualquier suplente del banquillo que sí haya jugado,
   *         respetando el orden del banquillo (1ro, 2do, 3ro…).
   *   3. La sustitución es 100% (los puntos del suplente reemplazan al titular).
   *   4. Respeta la formación táctica: no mete un delantero en defensa.
   *
   * @param {Object}  roster       – Objeto { slotKey: playerObj, … } (ROSTER_DATABASE)
   * @param {string[]} starterKeys – Keys de los slots titulares
   * @param {string[]} benchKeys   – Keys de los slots del banquillo
   * @param {Function} getSlotPos  – (slotKey) => "GK"|"DF"|"MF"|"FW"
   * @returns {{ sustituciones: Array<{out: string, in_: string, outPts: number, inPts: number}>, rosterClone: Object }}
   */
  function procesarSustituciones(roster, starterKeys, benchKeys, getSlotPos) {
    const rosterClone = JSON.parse(JSON.stringify(roster));
    const sustituciones = [];
    const benchUsados = new Set();

    for (const slotKey of starterKeys) {
      const titular = rosterClone[slotKey];
      if (jugadorActivo(titular)) continue;

      const slotPos = normPos(getSlotPos(slotKey));

      // ── Prioridad 1: suplente de la misma posición ──
      let subKey = benchKeys.find((bk) => {
        if (benchUsados.has(bk)) return false;
        const sub = rosterClone[bk];
        if (!sub || !jugadorActivo(sub)) return false;
        return normPos(sub.pos) === slotPos;
      });

      // ── Prioridad 2: cualquier suplente activo (orden del banquillo) ──
      if (!subKey) {
        subKey = benchKeys.find((bk) => {
          if (benchUsados.has(bk)) return false;
          const sub = rosterClone[bk];
          return sub && jugadorActivo(sub);
        });
      }

      if (!subKey) continue;

      const suplente = rosterClone[subKey];
      benchUsados.add(subKey);

      const titPts = Number(titular?.pts) || 0;
      const subPts = calcularPuntosSofaScore(suplente);

      // La sustitución es al 100%
      rosterClone[slotKey] = { ...suplente, pts: subPts };
      rosterClone[subKey] = null;

      sustituciones.push({
        titular: titular?.name || slotKey,
        suplente: suplente.name,
        outPts: titPts,
        inPts: subPts,
        slotTitular: slotKey,
        slotSuplente: subKey,
      });
    }

    return { sustituciones, rosterClone };
  }


  // ──────────────────────────────────────────────────────────
  // 3. SISTEMA DE CLASIFICACIONES
  // ──────────────────────────────────────────────────────────

  /**
   * Calcula los puntos totales de un usuario según el tipo de tabla.
   *
   * @param {Object} userData – Documento Firestore del usuario
   * @param {string} tipo     – "general" | "nacional" | "champions"
   * @returns {number}
   */
  function calcularPuntosUsuario(userData, tipo) {
    const roster = userData.roster || {};
    let total = 0;

    for (const key of Object.keys(roster)) {
      const p = roster[key];
      if (!p) continue;

      // Solo contar titulares (los primeros 11 según formación)
      if (typeof p.isStarter !== "undefined" && !p.isStarter) continue;

      switch (tipo) {
        case "nacional":
          total += Number(p.ptsLiga) || 0;
          break;
        case "champions":
          total += Number(p.ptsUcl) || 0;
          break;
        case "general":
        default:
          total += (Number(p.ptsLiga) || 0) + (Number(p.ptsUcl) || 0);
          break;
      }
    }

    return total;
  }

  /**
   * Calcula el valor total de la plantilla de un usuario.
   *
   * @param {Object} roster
   * @returns {number} – En millones (ej: 175.5)
   */
  function calcularValorPlantilla(roster) {
    let val = 0;
    for (const key of Object.keys(roster)) {
      if (roster[key]) val += Number(roster[key].val) || 0;
    }
    return Math.round(val * 10) / 10;
  }

  /**
   * Calcula los puntos de una jornada específica para un usuario.
   *
   * @param {Object} userData
   * @param {number} jornadaNum – Número de jornada (1, 2, 3…)
   * @returns {number}
   */
  function calcularPuntosJornada(userData, jornadaNum) {
    const weeklyHistory = userData.weeklyHistory || [];
    const entry = weeklyHistory.find((w) => w.gw === jornadaNum);
    return entry ? Number(entry.pts) || 0 : 0;
  }

  /**
   * Genera la tabla de clasificación completa para todos los usuarios.
   *
   * @param {Object[]} usersArray – Array de documentos Firestore de usuarios
   * @param {Object}   [options]
   * @param {string}   [options.tab="general"]  – pestaña activa
   * @param {number}   [options.jornada]        – filtrar por jornada específica
   * @param {boolean}  [options.porValor=false]  – ordenar por valor de plantilla
   * @returns {Object[]} – [{ rank, team, manager, pts, val, current }]
   */
  function generarClasificacion(usersArray, options = {}) {
    const { tab = "general", jornada, porValor = false } = options;

    const rows = usersArray.map((u) => {
      const roster = u.roster || {};
      const teamName = u.clubName || u.clubProfile?.teamName || "Sin nombre";
      const manager = u.clubProfile?.managerName || u.email?.split("@")[0] || "";

      let pts = 0;
      if (jornada) {
        pts = calcularPuntosJornada(u, jornada);
      } else if (porValor) {
        pts = calcularValorPlantilla(roster);
      } else {
        pts = calcularPuntosUsuario(u, tab);
      }

      const val = calcularValorPlantilla(roster);

      return {
        rank: 0,
        uid: u._uid || "",
        team: teamName,
        manager: manager,
        pts: Math.round(pts * 10) / 10,
        val: val,
        current: false,
      };
    });

    // Ordenar
    if (porValor) {
      rows.sort((a, b) => b.val - a.val);
    } else {
      rows.sort((a, b) => b.pts - a.pts);
    }

    // Asignar ranking
    rows.forEach((r, i) => (r.rank = i + 1));

    return rows;
  }

  /**
   * Genera todas las pestañas de clasificación de una sola vez.
   *
   * @param {Object[]} usersArray
   * @returns {Object} – { general: [...], nacional: [...], champions: [...], weekly: [...], value: [...] }
   */
  function generarTodasClasificaciones(usersArray) {
    return {
      general: generarClasificacion(usersArray, { tab: "general" }),
      nacional: generarClasificacion(usersArray, { tab: "nacional" }),
      champions: generarClasificacion(usersArray, { tab: "champions" }),
      weekly: generarClasificacion(usersArray, { tab: "general", jornada: null }),
      value: generarClasificacion(usersArray, { porValor: true }),
    };
  }


  // ──────────────────────────────────────────────────────────
  // Exportar
  // ──────────────────────────────────────────────────────────

  exports.FantasyLogic = {
    calcularPuntosSofaScore,
    jugadorActivo,
    procesarSustituciones,
    calcularPuntosUsuario,
    calcularValorPlantilla,
    calcularPuntosJornada,
    generarClasificacion,
    generarTodasClasificaciones,
    normPos,
  };

})(typeof window !== "undefined" ? window : module.exports);
