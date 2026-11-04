// Gera ícones/splash do Android + imagens da Play Store. O desenho vem de
// gen.html, que replica o SVG do favicon.html (ícone) e o renderLogo() do
// exportar-logo.html (wordmark "Vírgula, CONTÁBIL") — mude a arte lá.
//
// Uso (precisa de internet p/ as fontes do Google e de um Chrome):
//   npm i --no-save puppeteer-core
//   CHROME="C:/caminho/chrome.exe" node scripts/app-assets/gen-assets.cjs
// Saídas: android/app/src/main/res/{mipmap,drawable}-*/ e store-assets/google-play/.
// As capturas da loja saem de blog-screenshots/*-mobile.png (se existir).
const ROOT = require("path").resolve(__dirname, "../..");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const CHROME = process.env.CHROME || "C:/Users/lucas/.cache/puppeteer/chrome/win64-149.0.7827.22/chrome-win64/chrome.exe";
const RES = path.join(ROOT, "android/app/src/main/res");
const STORE = path.join(ROOT, "store-assets/google-play");
const SHOTS = path.join(ROOT, "blog-screenshots");
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

function write(file, dataUrl) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("  ✓", path.relative(ROOT, file).replace(/\\/g, "/"));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto("file:///" + path.join(__dirname, "gen.html").replace(/\\/g, "/"), { waitUntil: "networkidle0" });

  const fonts = await page.evaluate(async () => {
    await ensureFonts();
    return { fraunces: document.fonts.check("700 20px Fraunces"), inter: document.fonts.check("400 20px Inter") };
  });
  console.log("fontes:", fonts);
  if (!fonts.fraunces || !fonts.inter) throw new Error("Fontes do Google não carregaram");

  // Geometria da vírgula: maior distância do centro, para caber na zona segura
  // do ícone adaptativo (círculo de 66dp dentro dos 72dp visíveis).
  const geo = await page.evaluate(() => {
    const bbox = commaBBox();
    const p = document.getElementById("probe");
    p.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${comma("#000")}</svg>`;
    const path = p.querySelector("path"), m = path.getCTM(), L = path.getTotalLength();
    let maxD = 0;
    for (let i = 0; i <= 2000; i++) {
      const q = path.getPointAtLength((L * i) / 2000);
      const x = m.a * q.x + m.c * q.y + m.e, y = m.b * q.x + m.d * q.y + m.f;
      maxD = Math.max(maxD, Math.hypot(x - 256, y - 256));
    }
    p.innerHTML = "";
    return { bbox, maxD };
  });
  const safeR = (512 * 66 / 72) / 2;
  const fgScale = geo.maxD > safeR * 0.96 ? (safeR * 0.96) / geo.maxD : 1;
  console.log("vírgula:", geo, "raio seguro:", safeR.toFixed(1), "escala fg:", fgScale.toFixed(3));

  const gen = (fn, ...args) => page.evaluate(fn, ...args);

  console.log("\n# Ícones do launcher (mipmap)");
  for (const [d, k] of Object.entries(DENS)) {
    const dir = path.join(RES, `mipmap-${d}`);
    write(path.join(dir, "ic_launcher.png"), await gen((s) => iconPNG("squircle", s), Math.round(48 * k)));
    write(path.join(dir, "ic_launcher_round.png"), await gen((s) => iconPNG("circle", s), Math.round(48 * k)));
    const a = Math.round(108 * k);
    write(path.join(dir, "ic_launcher_background.png"), await gen((s) => iconPNG("adaptive-bg", s), a));
    write(path.join(dir, "ic_launcher_foreground.png"), await gen((s, sc) => iconPNG("adaptive-fg", s, s, { scale: sc }), a, fgScale));
    write(path.join(dir, "ic_launcher_monochrome.png"), await gen((s, sc) => iconPNG("mono", s, s, { scale: sc }), a, fgScale));
  }

  console.log("\n# Ícone de notificação + splash (drawable)");
  for (const [d, k] of Object.entries(DENS)) {
    const dir = path.join(RES, `drawable-${d}`);
    write(path.join(dir, "ic_stat_notify.png"), await gen((s, b) => iconPNG("notify", s, s, { bbox: b }), Math.round(24 * k), geo.bbox));
    write(path.join(dir, "splash_icon.png"), await gen((s) => iconPNG("splash", s), Math.round(288 * k)));
    write(path.join(dir, "splash_branding.png"),
      await gen((w, h) => logoPNG(w, h, { background: "transparent", padding: 6 }), Math.round(200 * k), Math.round(80 * k)));
  }

  console.log("\n# Play Store");
  write(path.join(STORE, "icone-512.png"), await gen(() => iconPNG("square", 512)));
  write(path.join(STORE, "grafico-de-recursos-1024x500.png"), await gen(() => featureGraphic()));
  write(path.join(STORE, "logo-wordmark-1024x400.png"),
    await gen(() => logoPNG(1024, 400, { background: "transparent", padding: 8 })));

  const shots = [
    ["01-visao-geral-mobile.png", "Tudo o que você deve, num só lugar", "Guias, vencimentos e situação da empresa"],
    ["02-atrasados-mobile.png", "Nenhuma guia vencida passa batido", "Recalcule e pague por PIX na hora"],
    ["03-cofre-digital-mobile.png", "O cofre digital da sua empresa", "Guias, folha e certidões sempre à mão"],
    ["04-meus-envios-mobile.png", "Envie extratos e comprovantes", "Direto do celular para o escritório"],
    ["05-nfse-emitidas-mobile.png", "Suas notas fiscais emitidas", "NFS-e organizadas por competência"],
    ["06-nfse-tomados-mobile.png", "Serviços tomados também", "Notas recebidas dos seus fornecedores"],
  ];
  if (!fs.existsSync(SHOTS)) console.log("  (sem blog-screenshots/ — capturas puladas)");
  else for (const [i, [file, title, sub]] of shots.entries()) {
    const src = "data:image/png;base64," + fs.readFileSync(path.join(SHOTS, file)).toString("base64");
    write(path.join(STORE, "capturas-celular", `${String(i + 1).padStart(2, "0")}.png`),
      await gen((s, t, u) => phoneShot(s, t, u), src, title, sub));
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
