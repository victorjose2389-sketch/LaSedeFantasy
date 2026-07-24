const puppeteer = require("puppeteer");
const fs = require("fs");
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

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  const fixtures = [];
  let count = 0;

  for (const team of TEAMS) {
    process.stdout.write(`${team.name}... `);
    const data = await fetchRaw(page, `${BASE_URL}/team/${team.id}/events/next/0`);

    if (!data || !data.events || data.events.length === 0) {
      console.log("SKIP (no events)");
      await new Promise(r => setTimeout(r, 300));
      continue;
    }

    const ev = data.events[0];
    const home = ev.homeTeam || {};
    const away = ev.awayTeam || {};
    const tournament = ev.tournament || {};
    const leagueName = tournament.name || tournament.uniqueName || "";
    const season = tournament.season?.name || "";

    fixtures.push({
      teamCode: team.code,
      teamName: team.name,
      opponentCode: (home.id === team.id ? away : home).code || (home.id === team.id ? away : home).id?.toString() || "",
      opponentName: (home.id === team.id ? away.name : home.name),
      isHome: home.id === team.id,
      date: formatDate(ev.startTimestamp),
      time: formatTime(ev.startTimestamp),
      timestamp: ev.startTimestamp,
      competition: leagueName,
      season: season,
      status: ev.status?.type || "notstarted",
    });

    count++;
    console.log(`OK → ${home.name} vs ${away.name} (${leagueName})`);
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\nTotal: ${count} fixtures`);

  const jsOutput = `// Auto-generated from SofaScore - Next fixtures\n// Generated: ${new Date().toISOString()}\n// Total: ${count} teams\nvar NEXT_FIXTURES = ${JSON.stringify(fixtures, null, 2)};\n`;
  fs.writeFileSync("fixtures-ucl.js", jsOutput, "utf8");
  console.log("Saved to fixtures-ucl.js");

  await browser.close();
})();
