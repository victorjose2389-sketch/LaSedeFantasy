/**
 * auto-update.js — Actualización automática de datos desde SofaScore
 *
 * Ejecuta: node auto-update.js
 *
 * Actualiza:
 *   1. Próximos fixtures de cada equipo (fixtures-ucl.js)
 *   2. Ratings y stats de jugadores (players-ucl.js)
 *
 * Opcional: programar con Windows Task Scheduler para ejecución automática.
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const BASE_URL = "https://api.sofascore.com/api/v1";

const TEAMS = [
  { id: 42, name: "Arsenal", code: "ars" },
  { id: 2672, name: "Bayern Munich", code: "bay" },
  { id: 44, name: "Liverpool", code: "liv" },
  { id: 2817, name: "Barcelona", code: "bar" },
  { id: 17, name: "Manchester City", code: "mci" },
  { id: 2829, name: "Real Madrid", code: "rma" },
  { id: 2697, name: "Inter Milan", code: "int" },
  { id: 1644, name: "Paris Saint-Germain", code: "psg" },
  { id: 2836, name: "Atlético Madrid", code: "atm" },
  { id: 2673, name: "Borussia Dortmund", code: "bvb" },
  { id: 2819, name: "Villarreal", code: "vil" },
  { id: 3001, name: "Sporting CP", code: "scp" },
  { id: 2714, name: "Napoli", code: "nap" },
  { id: 2888, name: "Club Brugge", code: "bru" },
  { id: 3061, name: "Galatasaray", code: "gal" },
  { id: 3006, name: "Benfica", code: "ben" },
  { id: 2687, name: "Juventus", code: "juv" },
  { id: 2686, name: "Atalanta", code: "ata" },
  { id: 2681, name: "Bayer Leverkusen", code: "lev" },
  { id: 1653, name: "AS Monaco", code: "mon" },
  { id: 2952, name: "PSV Eindhoven", code: "psv" },
  { id: 2825, name: "Athletic Club", code: "ath" },
  { id: 2953, name: "Ajax", code: "aja" },
  { id: 2674, name: "Eintracht Frankfurt", code: "sge" },
  { id: 2216, name: "SK Slavia Praha", code: "sla" },
  { id: 39, name: "Newcastle United", code: "new" },
  { id: 38, name: "Chelsea", code: "che" },
  { id: 33, name: "Tottenham Hotspur", code: "tot" },
  { id: 656, name: "Bodø/Glimt", code: "bod" },
  { id: 1641, name: "Olympique Marseille", code: "mar" },
];

async function fetchRaw(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  if (response.status() !== 200) return null;
  const bodyText = await page.evaluate(() => document.body.innerText);
  try { return JSON.parse(bodyText); } catch { return null; }
}

function formatDate(ts) {
  const d = new Date(ts * 1000);
  return d.toISOString().split("T")[0];
}

function formatTime(ts) {
  const d = new Date(ts * 1000);
  return d.toTimeString().slice(0, 5);
}

function posMap(position, positionsDetailed) {
  const p = (position || "").toUpperCase();
  const pd = Array.isArray(positionsDetailed) ? positionsDetailed.join(",").toUpperCase() : (positionsDetailed || "").toUpperCase();
  const all = `${p} ${pd}`;
  if (p === "G" || all.includes("GK")) return "GK";
  if (p === "D" || all.includes("DF") || all.includes("CB") || all.includes("LB") || all.includes("RB")) return "DF";
  if (p === "F" || all.includes("FW") || all.includes("CF") || all.includes("LW") || all.includes("RW") || all.includes("ST") || all.includes("SS")) return "FW";
  if (p === "M" || all.includes("MF") || all.includes("DM") || all.includes("CM") || all.includes("AM") || all.includes("LM") || all.includes("RM")) return "MF";
  return "MF";
}

function getMarketValue(player) {
  const raw = player.proposedMarketValueRaw;
  if (raw && typeof raw === "object" && raw.value) return raw.value;
  if (typeof raw === "number") return raw;
  const mv = player.proposedMarketValue;
  if (typeof mv === "number") return mv;
  return 0;
}

function estimateRating(marketValueEur) {
  if (marketValueEur >= 120000000) return 9.2;
  if (marketValueEur >= 90000000) return 8.9;
  if (marketValueEur >= 70000000) return 8.6;
  if (marketValueEur >= 50000000) return 8.3;
  if (marketValueEur >= 35000000) return 8.0;
  if (marketValueEur >= 25000000) return 7.7;
  if (marketValueEur >= 15000000) return 7.4;
  if (marketValueEur >= 8000000) return 7.1;
  if (marketValueEur >= 4000000) return 6.8;
  if (marketValueEur >= 1500000) return 6.5;
  return 6.2;
}

function estimateValue(marketValueEur) {
  return Math.round(marketValueEur / 1000000 * 10) / 10 || 3.0;
}

function getInitials(name) {
  return name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
}

(async () => {
  const startTime = Date.now();
  console.log("=== AUTO-UPDATE SOFASCORE ===");
  console.log(`Fecha: ${new Date().toLocaleString("es-ES")}\n`);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  // ═══════════════════════════════════════════════
  // 1. ACTUALIZAR FIXTURES (próximos partidos)
  // ═══════════════════════════════════════════════
  console.log("--- FASE 1: Fixtures ---");
  const fixtures = [];
  let fixtureCount = 0;

  for (const team of TEAMS) {
    process.stdout.write(`  ${team.name}... `);
    const data = await fetchRaw(page, `${BASE_URL}/team/${team.id}/events/next/0`);

    if (!data || !data.events || data.events.length === 0) {
      console.log("SKIP");
      await new Promise(r => setTimeout(r, 300));
      continue;
    }

    const ev = data.events[0];
    const home = ev.homeTeam || {};
    const away = ev.awayTeam || {};
    const tournament = ev.tournament || {};

    fixtures.push({
      teamCode: team.code,
      teamName: team.name,
      opponentName: (home.id === team.id ? away.name : home.name),
      isHome: home.id === team.id,
      date: formatDate(ev.startTimestamp),
      time: formatTime(ev.startTimestamp),
      timestamp: ev.startTimestamp,
      competition: tournament.name || tournament.uniqueName || "",
      season: tournament.season?.name || "",
      status: ev.status?.type || "notstarted",
    });

    fixtureCount++;
    console.log(`OK → ${home.name} vs ${away.name}`);
    await new Promise(r => setTimeout(r, 400));
  }

  const fixtureOutput = `// Auto-generated from SofaScore\n// Generated: ${new Date().toISOString()}\n// Total: ${fixtureCount} teams\nvar NEXT_FIXTURES = ${JSON.stringify(fixtures, null, 2)};\n`;
  fs.writeFileSync(path.join(__dirname, "fixtures-ucl.js"), fixtureOutput, "utf8");
  console.log(`\n  Fixtures guardados: ${fixtureCount} equipos\n`);

  // ═══════════════════════════════════════════════
  // 2. ACTUALIZAR RATINGS DE JUGADORES
  // ═══════════════════════════════════════════════
  console.log("--- FASE 2: Ratings de jugadores ---");
  const allPlayers = [];
  let playerId = 1;

  for (const team of TEAMS) {
    process.stdout.write(`  ${team.name}... `);
    const data = await fetchRaw(page, `${BASE_URL}/team/${team.id}/players`);

    if (!data || !data.players) { console.log("SKIP"); continue; }

    let count = 0;
    for (const entry of data.players) {
      const p = entry.player;
      if (!p || !p.name) continue;

      const pos = posMap(p.position, p.positionsDetailed);
      const mktVal = getMarketValue(p);
      const val = estimateValue(mktVal);
      const rating = estimateRating(mktVal);
      const initials = getInitials(p.name);

      let ptsBase;
      if (pos === "GK") ptsBase = 80;
      else if (pos === "FW") ptsBase = 75;
      else if (pos === "MF") ptsBase = 65;
      else ptsBase = 55;

      allPlayers.push({
        id: `p${playerId}`,
        sofaId: p.id,
        name: p.name,
        initials: initials,
        teamId: team.code,
        teamName: team.name,
        pos: pos,
        rating: rating,
        val: val,
        pts: Math.round(ptsBase * rating / 8),
        ptsUcl: Math.round(ptsBase * rating / 8 * 0.6),
        ptsLiga: Math.round(ptsBase * rating / 8 * 0.4),
        owner: "Libre",
        status: "libre",
        jersey: p.jerseyNumber || p.shirtNumber || "",
        nationality: p.country?.name || "",
      });
      playerId++;
      count++;
    }

    console.log(`${count} players`);
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n  Total jugadores: ${allPlayers.length}`);

  const playersOutput = `// Auto-generated from SofaScore\n// Generated: ${new Date().toISOString()}\n// Total: ${allPlayers.length} players\nvar STAR_PLAYERS_POOL = ${JSON.stringify(allPlayers)};\n`;
  fs.writeFileSync(path.join(__dirname, "players-ucl.js"), playersOutput, "utf8");
  console.log("  Players guardados en players-ucl.js\n");

  // ═══════════════════════════════════════════════
  // 3. GUARDAR TIMESTAMP DE ACTUALIZACIÓN
  // ═══════════════════════════════════════════════
  const updateMeta = {
    lastUpdate: new Date().toISOString(),
    fixturesCount: fixtureCount,
    playersCount: allPlayers.length,
  };
  fs.writeFileSync(path.join(__dirname, "update-meta.json"), JSON.stringify(updateMeta, null, 2), "utf8");

  await browser.close();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("=== ACTUALIZACIÓN COMPLETADA ===");
  console.log(`Duración: ${elapsed}s`);
  console.log(`Fixtures: ${fixtureCount} | Jugadores: ${allPlayers.length}`);
  console.log(`Próxima ejecución sugerida: después de cada jornada`);
})();
