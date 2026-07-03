import jsQR from "jsqr";
import { exec } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const execAsync = promisify(exec);

// Configurações centralizadas
const CONFIG = {
  POPPLER_DPI: 450,
  MAX_PAGES: 3,
  TEXT_EXTRACT_TIMEOUT: 5000,
  TEXT_EXTRACT_MAX_BUFFER: 10 * 1024 * 1024,
  PDF_CONVERT_MAX_BUFFER: 50 * 1024 * 1024,
  QR_SCALES: [1, 2, 4],
  THRESHOLDS: [100, 128, 150, 180, 210, 220], // Mais opções para bancos diferentes
  CROPS: [
    { x1: 0.02, y1: 0.08, x2: 0.4, y2: 0.45 },
    { x1: 0.03, y1: 0.13, x2: 0.25, y2: 0.38 },
    { x1: 0.05, y1: 0.21, x2: 0.32, y2: 0.43 },
    { x1: 0.82, y1: 0.86, x2: 0.93, y2: 0.94 },
    { x1: 0.35, y1: 0.75, x2: 0.65, y2: 0.98 },
  ],
};

// ==================== UTILITÁRIOS ====================

function normalizePixPayload(value: string | null | undefined): string | null {
  if (!value) return null;

  // Remove quebras de linha, tabs e caracteres não-ASCII, preservando espaços normais
  let cleaned = value
    .replace(/[\r\n\t]+/g, "")
    .replace(/[^\x20-\x7E]/g, "") // Remove caracteres não-ASCII
    .trim();
  
  if (!cleaned.startsWith("000201")) return null;

  // Verifica se contém o identificador PIX (case insensitive)
  const upper = cleaned.toUpperCase();
  if (!upper.includes("BCB.PIX") && !upper.includes("FGTS")) {
    return null;
  }

  // Extrai o CRC final (últimos 4 dígitos)
  const crcMatches = [...cleaned.matchAll(/6304[A-Fa-f0-9]{4}/gi)];
  if (crcMatches.length === 0) return null;

  // Pega a última ocorrência (mais confiável)
  const lastMatch = crcMatches[crcMatches.length - 1];
  const endIndex = lastMatch.index! + lastMatch[0].length;
  
  return cleaned.substring(0, endIndex);
}

function extractPixFromText(text: string): string | null {
  if (!text || text.length < 20) return null;

  // Regex mais flexível
  const regexes = [
    /000201(?:[0-9]{2}[^0-9]{1,}[0-9]{2})*?BCB\.PIX(?:[0-9]{2}[^0-9]{1,}[0-9]{2})*?6304[A-Fa-f0-9]{4}/i,
    /000201[\s\S]+?(?:BR\.GOV\.BCB\.PIX|BCB\.PIX)[\s\S]+?6304[A-Fa-f0-9]{4}/i,
  ];

  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) {
      const normalized = normalizePixPayload(match[0]);
      if (normalized) return normalized;
    }
  }

  // Busca manual por 000201
  const cleaned = text.replace(/[\r\n\t]+/g, "");
  const start = cleaned.indexOf("000201");
  if (start === -1) return null;
  
  const candidate = cleaned.substring(start, start + 300);
  return normalizePixPayload(candidate);
}

// ==================== POPPLER CHECKS ====================

async function checkPopplerInstalled(): Promise<boolean> {
  try {
    await execAsync("which pdftoppm");
    return true;
  } catch {
    return false;
  }
}

// ==================== TEMP DIR ====================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "pix-"));
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Ignora erros de limpeza
  }
}

// ==================== EXTRAÇÃO DE TEXTO ====================

async function extractTextFromPdf(
  pdfPath: string, 
  maxPages: number = CONFIG.MAX_PAGES
): Promise<string> {
  const strategies = [
    // -raw preserva melhor o payload PIX
    async () => {
      const { stdout } = await execAsync(
        `pdftotext -raw -f 1 -l ${maxPages} "${pdfPath}" -`,
        {
          maxBuffer: CONFIG.TEXT_EXTRACT_MAX_BUFFER,
          timeout: CONFIG.TEXT_EXTRACT_TIMEOUT,
        }
      );
      return stdout;
    },
    // -layout para tabelas
    async () => {
      const { stdout } = await execAsync(
        `pdftotext -layout -f 1 -l ${maxPages} "${pdfPath}" -`,
        {
          maxBuffer: CONFIG.TEXT_EXTRACT_MAX_BUFFER,
          timeout: CONFIG.TEXT_EXTRACT_TIMEOUT,
        }
      );
      return stdout;
    },
    // Sem opções especiais
    async () => {
      const { stdout } = await execAsync(
        `pdftotext -f 1 -l ${maxPages} "${pdfPath}" -`,
        {
          maxBuffer: CONFIG.TEXT_EXTRACT_MAX_BUFFER,
          timeout: CONFIG.TEXT_EXTRACT_TIMEOUT,
        }
      );
      return stdout;
    }
  ];

  for (const strategy of strategies) {
    try {
      const text = await strategy();
      if (text && text.length > 10) {
        return text;
      }
    } catch (error) {
      continue;
    }
  }

  return '';
}

// ==================== EXTRAÇÃO DE IMAGENS COM pdfimages ====================

async function extractImagesFromPdf(
  pdfPath: string,
  tempDir: string,
  maxPages: number = CONFIG.MAX_PAGES
): Promise<string[]> {
  try {
    const outputPrefix = path.join(tempDir, 'img');
    const cmd = `pdfimages -png -f 1 -l ${maxPages} "${pdfPath}" "${outputPrefix}"`;
    
    await execAsync(cmd, {
      maxBuffer: CONFIG.PDF_CONVERT_MAX_BUFFER,
    });

    // Lista as imagens extraídas
    const files = await fs.readdir(tempDir);
    const imageFiles = files
      .filter(f => f.startsWith('img-') && (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')))
      .sort()
      .map(f => path.join(tempDir, f));

    return imageFiles;
  } catch (error) {
    // pdfimages pode falhar em alguns PDFs, retorna array vazio
    return [];
  }
}

// ==================== CONVERSÃO DE PÁGINA INDIVIDUAL ====================

async function convertPdfPageToImage(
  pdfPath: string,
  tempDir: string,
  pageNumber: number,
  dpi: number = CONFIG.POPPLER_DPI
): Promise<string | null> {
  const outputPath = path.join(tempDir, `page-${pageNumber}.png`);
  const cmd = `pdftoppm -png -r ${dpi} -f ${pageNumber} -l ${pageNumber} "${pdfPath}" "${path.join(tempDir, 'page')}"`;

  try {
    await execAsync(cmd, {
      maxBuffer: CONFIG.PDF_CONVERT_MAX_BUFFER,
    });

    // Verifica se o arquivo foi gerado
    const files = await fs.readdir(tempDir);
    const generatedFile = files.find(f => f.startsWith('page-') && f.endsWith('.png'));
    
    if (generatedFile) {
      return path.join(tempDir, generatedFile);
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// ==================== PRÉ-PROCESSAMENTO DE IMAGENS ====================

function applyBinarization(
  data: Uint8ClampedArray,
  threshold: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const value = gray > threshold ? 255 : 0;
    result[i] = value;
    result[i + 1] = value;
    result[i + 2] = value;
    result[i + 3] = data[i + 3];
  }
  
  return result;
}

function toGrayscale(data: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    result[i] = gray;
    result[i + 1] = gray;
    result[i + 2] = gray;
    result[i + 3] = data[i + 3];
  }
  
  return result;
}

function scaleNearest(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  if (scale <= 1) return { data, width, height };

  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);
  const scaled = new Uint8ClampedArray(scaledWidth * scaledHeight * 4);

  for (let y = 0; y < scaledHeight; y++) {
    const sourceY = Math.floor(y / scale);
    for (let x = 0; x < scaledWidth; x++) {
      const sourceX = Math.floor(x / scale);
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const targetIndex = (y * scaledWidth + x) * 4;
      scaled[targetIndex] = data[sourceIndex];
      scaled[targetIndex + 1] = data[sourceIndex + 1];
      scaled[targetIndex + 2] = data[sourceIndex + 2];
      scaled[targetIndex + 3] = data[sourceIndex + 3];
    }
  }

  return { data: scaled, width: scaledWidth, height: scaledHeight };
}

// ==================== DECODIFICAÇÃO DE QR CODE ====================

async function decodeQRFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Promise<string | null> {
  // Prepara diferentes transformações
  const transformations: Array<{ data: Uint8ClampedArray; label: string }> = [
    { data, label: 'original' },
    { data: toGrayscale(data), label: 'grayscale' },
  ];

  // Adiciona binarização com diferentes thresholds
  for (const threshold of CONFIG.THRESHOLDS) {
    transformations.push({
      data: applyBinarization(data, threshold),
      label: `binary_${threshold}`
    });
  }

  // Tenta cada transformação
  for (const transform of transformations) {
    const scales = width < 200 || height < 200 ? CONFIG.QR_SCALES : [1];
    
    for (const scale of scales) {
      let targetData = transform.data;
      let targetWidth = width;
      let targetHeight = height;

      if (scale > 1) {
        const scaled = scaleNearest(transform.data, width, height, scale);
        targetData = scaled.data;
        targetWidth = scaled.width;
        targetHeight = scaled.height;
      }

      const code = jsQR(targetData, targetWidth, targetHeight, {
        inversionAttempts: "attemptBoth",
      });

      if (code?.data) {
        const pixCode = normalizePixPayload(code.data);
        if (pixCode) return pixCode;
      }
    }
  }

  return null;
}

async function decodeQRFromImage(
  imagePath: string,
  crops?: Array<{ x1: number; y1: number; x2: number; y2: number }>
): Promise<string | null> {
  try {
    const image = await loadImage(imagePath);
    const width = image.width;
    const height = image.height;

    // Se não houver crops, usa a imagem inteira
    const regions = crops && crops.length > 0 
      ? crops.map(crop => ({
          x: Math.round(width * crop.x1),
          y: Math.round(height * crop.y1),
          w: Math.round(width * (crop.x2 - crop.x1)),
          h: Math.round(height * (crop.y2 - crop.y1)),
        }))
      : [{ x: 0, y: 0, w: width, h: height }];

    // Processa crops em paralelo
    const results = await Promise.all(
      regions.map(async (region) => {
        // Valida região
        const rx = Math.max(0, Math.min(region.x, width - 1));
        const ry = Math.max(0, Math.min(region.y, height - 1));
        const rw = Math.min(region.w, width - rx);
        const rh = Math.min(region.h, height - ry);

        if (rw < 10 || rh < 10) return null;

        // Cria canvas apenas para a região (economiza memória)
        const canvas = createCanvas(rw, rh);
        const ctx = canvas.getContext('2d');
        
        // Desenha apenas a região recortada
        ctx.drawImage(image, rx, ry, rw, rh, 0, 0, rw, rh);
        
        const imageData = ctx.getImageData(0, 0, rw, rh);
        const data = new Uint8ClampedArray(imageData.data);

        return await decodeQRFromImageData(data, rw, rh);
      })
    );

    // Retorna o primeiro resultado encontrado
    for (const result of results) {
      if (result) return result;
    }

    return null;
  } catch (error) {
    console.warn(`Erro ao decodificar QR da imagem ${imagePath}:`, error);
    return null;
  }
}

// ==================== FUNÇÃO PRINCIPAL ====================

export async function extractPixCodeFromPdf(buffer: Buffer): Promise<string | null> {
  let tempDir: string | null = null;
  
  try {
    // Verifica Poppler
    const hasPoppler = await checkPopplerInstalled();
    if (!hasPoppler) {
      console.warn('Poppler não está instalado. Execute: apt-get install poppler-utils');
      return null;
    }

    // Cria diretório temporário
    tempDir = await createTempDir();
    const pdfPath = path.join(tempDir, 'input.pdf');
    await fs.writeFile(pdfPath, buffer);

    // PASSO 1: Tenta extrair do texto
    const fullText = await extractTextFromPdf(pdfPath);
    if (fullText) {
      const textPix = extractPixFromText(fullText);
      if (textPix) return textPix;
    }

    // PASSO 2: Tenta extrair imagens com pdfimages
    const imageFiles = await extractImagesFromPdf(pdfPath, tempDir);
    for (const imagePath of imageFiles) {
      // Primeiro com crops
      let pixCode = await decodeQRFromImage(imagePath, CONFIG.CROPS);
      if (pixCode) return pixCode;
      
      // Depois imagem inteira
      pixCode = await decodeQRFromImage(imagePath);
      if (pixCode) return pixCode;
    }

    // PASSO 3: Renderiza páginas uma por uma (economiza recursos)
    for (let page = 1; page <= CONFIG.MAX_PAGES; page++) {
      const imagePath = await convertPdfPageToImage(pdfPath, tempDir, page);
      if (!imagePath) continue;

      // Primeiro com crops
      let pixCode = await decodeQRFromImage(imagePath, CONFIG.CROPS);
      if (pixCode) return pixCode;
      
      // Depois imagem inteira
      pixCode = await decodeQRFromImage(imagePath);
      if (pixCode) return pixCode;
    }

    return null;

  } catch (error) {
    console.error('Erro ao extrair PIX do PDF:', error);
    return null;
  } finally {
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  }
}

// ==================== EXTRAÇÃO DE VALOR ====================

export async function extractValueFromPdfBuffer(buffer: Buffer, category: string): Promise<number | null> {
  let tempDir: string | null = null;
  try {
    const hasPoppler = await checkPopplerInstalled();
    if (!hasPoppler) return null;

    tempDir = await createTempDir();
    const pdfPath = path.join(tempDir, 'input.pdf');
    await fs.writeFile(pdfPath, buffer);

    const fullText = await extractTextFromPdf(pdfPath);
    if (!fullText) return null;

    const catUpper = category.toUpperCase();
    let regex = null;

    if (catUpper.includes('SIMPLES') || catUpper.includes('INSS') || catUpper.includes('DCTFWEB')) {
      // Valor Total do Documento
      regex = /Valor Total do Documento[\s\S]*?(?:R\$)?\s*([\d\.,]+)/i;
    } else if (catUpper.includes('FGTS')) {
      // Valor a recolher
      regex = /Valor a recolher[\s\S]*?(?:R\$)?\s*([\d\.,]+)/i;
    } else if (catUpper.includes('HONOR')) {
      // Valor do Documento
      regex = /Valor do Documento[\s\S]*?(?:R\$)?\s*([\d\.,]+)/i;
    }

    if (regex) {
      const match = fullText.match(regex);
      if (match && match[1]) {
        let valStr = match[1].trim();
        if (valStr.includes(',') && valStr.includes('.')) {
            valStr = valStr.replace(/\./g, '').replace(',', '.');
        } else if (valStr.includes(',')) {
            valStr = valStr.replace(',', '.');
        }
        const val = parseFloat(valStr);
        if (!isNaN(val)) return val;
      }
    }

    return null;
  } catch (err) {
    console.error('Erro ao extrair valor do PDF:', err);
    return null;
  } finally {
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  }
}