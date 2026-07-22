const puppeteer = require("puppeteer");
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  const response = await page.goto("https://api.sofascore.com/api/v1/team/42/players", { waitUntil: "domcontentloaded", timeout: 15000 });
  const bodyText = await page.evaluate(() => document.body.innerText);
  const data = JSON.parse(bodyText);
  for (const entry of data.players.slice(0, 5)) {
    const p = entry.player;
    console.log(`${p.name} | pos=${p.position} pd=${p.positionsDetailed} | mktRaw=${p.proposedMarketValueRaw} mkt=${p.proposedMarketValue} value=${JSON.stringify(p.proposedMarketValueRaw)}`);
  }
  await browser.close();
})();
