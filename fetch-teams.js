const puppeteer = require("puppeteer");
const fs = require("fs");
const BASE_URL = "https://api.sofascore.com/api/v1";

const TEAMS = [
  { id: 42, name: "Arsenal", code: "ars" },
  { id: 2672, name: "Bayern Munich", code: "bay" },
  { id: 44, name: "Liverpool", code: "liv" },
  { id: 33, name: "Tottenham Hotspur", code: "tot" },
  { id: 2817, name: "Barcelona", code: "bar" },
  { id: 38, name: "Chelsea", code: "che" },
  { id: 3001, name: "Sporting CP", code: "scp" },
  { id: 17, name: "Manchester City", code: "mci" },
  { id: 2829, name: "Real Madrid", code: "rma" },
  { id: 2697, name: "Inter Milan", code: "int" },
  { id: 1644, name: "Paris Saint-Germain", code: "psg" },
  { id: 39, name: "Newcastle United", code: "new" },
  { id: 2687, name: "Juventus", code: "juv" },
  { id: 2836, name: "Atlético Madrid", code: "atm" },
  { id: 2686, name: "Atalanta", code: "ata" },
  { id: 2681, name: "Bayer Leverkusen", code: "lev" },
  { id: 2673, name: "Borussia Dortmund", code: "bvb" },
  { id: 3245, name: "Olympiacos", code: "oly" },
  { id: 2888, name: "Club Brugge", code: "bru" },
  { id: 3061, name: "Galatasaray", code: "gal" },
  { id: 1653, name: "AS Monaco", code: "mon" },
  { id: 5962, name: "Qarabag FK", code: "qar" },
  { id: 656, name: "Bodø/Glimt", code: "bod" },
  { id: 3006, name: "Benfica", code: "ben" },
  { id: 1641, name: "Olympique Marseille", code: "mar" },
  { id: 171626, name: "Pafos FC", code: "paf" },
  { id: 4860, name: "Royale Union SG", code: "usg" },
  { id: 2952, name: "PSV Eindhoven", code: "psv" },
  { id: 2825, name: "Athletic Club", code: "ath" },
  { id: 2714, name: "Napoli", code: "nap" },
  { id: 1284, name: "FC København", code: "fck" },
  { id: 2953, name: "Ajax", code: "aja" },
  { id: 2674, name: "Eintracht Frankfurt", code: "sge" },
  { id: 2216, name: "SK Slavia Praha", code: "sla" },
  { id: 2819, name: "Villarreal", code: "vil" },
  { id: 5172, name: "Kairat Almaty", code: "kai" },
];

async function fetchRaw(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  if (response.status() !== 200) return null;
  const bodyText = await page.evaluate(() => document.body.innerText);
  try { return JSON.parse(bodyText); } catch { return null; }
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
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  const allPlayers = [];
  let playerId = 1;

  for (const team of TEAMS) {
    process.stdout.write(`${team.name}... `);
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

    console.log(`${count} players (total: ${allPlayers.length})`);
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\nTotal: ${allPlayers.length} players`);

  const jsOutput = `// Auto-generated from SofaScore - UCL 25/26\n// Generated: ${new Date().toISOString()}\n// Total: ${allPlayers.length} players\nvar STAR_PLAYERS_POOL = ${JSON.stringify(allPlayers)};\n`;
  fs.writeFileSync("players-ucl.js", jsOutput, "utf8");
  console.log("Saved to players-ucl.js");

  const teamsJs = TEAMS.map(t => `{ id: "${t.code}", name: "${t.name}", league: "UCL" }`).join(",\n");
  const teamsFile = `var DIRECT_QUALIFIED_TEAMS = [\n${teamsJs}\n];`;
  fs.writeFileSync("teams-ucl.js", teamsFile, "utf8");
  console.log("Saved to teams-ucl.js");

  await browser.close();
})();
