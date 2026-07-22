const puppeteer = require("puppeteer");

const BASE_URL = "https://api.sofascore.com/api/v1";

/**
 * Obtiene las calificaciones de los jugadores de un partido desde SofaScore.
 * Usa Puppeteer para evitar el bloqueo de Cloudflare.
 * @param {number} matchId - ID del evento/partido en SofaScore.
 * @returns {Promise<Array<{playerId: number, name: string, rating: number, substitute: boolean, position: string}>|string>}
 */
async function getMatchPlayerRatings(matchId) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    );

    const url = `${BASE_URL}/event/${matchId}/lineups`;

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    const statusCode = response.status();

    if (statusCode !== 200) {
      await browser.close();
      return `Error HTTP ${statusCode}: El matchId "${matchId}" podría no ser válido o el partido aún no tiene alineaciones.`;
    }

    const bodyText = await page.evaluate(() => document.body.innerText);
    const data = JSON.parse(bodyText);
    const players = [];

    const teams = [data.home, data.away];

    for (const team of teams) {
      if (!team || !team.players) continue;

      for (const entry of team.players) {
        const player = entry.player;
        const stats = entry.statistics || {};

        players.push({
          playerId: player.id,
          name: player.name,
          rating: typeof stats.rating === "number" ? stats.rating : 0,
          substitute: entry.substitute || false,
          position: entry.position || "Unknown",
        });
      }
    }

    await browser.close();
    return players;
  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    return `Error: ${error.message}`;
  }
}

module.exports = { getMatchPlayerRatings };

// --- CLI test ---
if (require.main === module) {
  const matchId = process.argv[2];
  if (!matchId) {
    console.log("Uso: node sofascore.js <matchId>");
    console.log("Ejemplo: node sofascore.js 12578498");
    process.exit(1);
  }

  console.log(`Obteniendo alineaciones del partido ${matchId}...`);
  getMatchPlayerRatings(Number(matchId)).then((result) => {
    if (typeof result === "string") {
      console.log(result);
    } else {
      console.log(`\nJugadores encontrados: ${result.length}\n`);
      console.log(JSON.stringify(result, null, 2));
    }
  });
}
