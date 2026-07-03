import React, { useState, useEffect } from "react";
import { Copy, Check, QrCode } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import jsQR from "jsqr";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const pdfLoadOptions = {
  standardFontDataUrl: "/pdfjs/standard_fonts/",
};

interface PixScannerButtonProps {
  docId: number;
  fileUrl: string;
}

export function PixScannerButton({ docId, fileUrl }: PixScannerButtonProps) {
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Automatically try to scan in background when component mounts to hide button if no PIX
    let mounted = true;

    const preScan = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ url: fileUrl, ...pdfLoadOptions });
        const pdf = await loadingTask.promise;

        let foundCode: string | null = null;

        for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
          if (!mounted) break;

          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();

          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(" ");

          const normalized = textContent.items
            .map((item: any) => item.str)
            .join("")
            .replace(/\s+/g, "");

          const isFGTSDigital =
            pageText.includes("GFD - Guia do FGTS Digital") ||
            pageText.includes("FGTS Digital");

          if (isFGTSDigital) {
            const start = normalized.indexOf("000201");

            if (start !== -1) {
              const payload = normalized.substring(start);

              // Find the LAST occurrence of 6304 + 4 hex chars
              const crcRegex = /6304[A-Fa-f0-9]{4}/gi;
              let lastMatch = null;
              let match;
              while ((match = crcRegex.exec(payload)) !== null) {
                lastMatch = match;
              }

              if (lastMatch) {
                const end = lastMatch.index + lastMatch[0].length;

                foundCode = payload.substring(0, end);

                console.log("[FGTS DIGITAL] PIX encontrado:", foundCode);

                break;
              }
            }
          }

          if (!foundCode) {
            try {
              const ops = await page.getOperatorList();
              for (let j = 0; j < ops.fnArray.length; j++) {
                if (ops.fnArray[j] === pdfjsLib.OPS.paintImageXObject) {
                  const objId = ops.argsArray[j][0];
                  try {
                    const imgObj = page.objs.get(objId) as any;
                    if (imgObj) {
                      let canvas;
                      if (imgObj.bitmap) {
                        canvas = document.createElement("canvas");
                        canvas.width = imgObj.bitmap.width;
                        canvas.height = imgObj.bitmap.height;
                        const ctx = canvas.getContext("2d");
                        ctx?.drawImage(imgObj.bitmap, 0, 0);
                      } else if (imgObj.data && imgObj.width && imgObj.height) {
                        canvas = document.createElement("canvas");
                        canvas.width = imgObj.width;
                        canvas.height = imgObj.height;
                        const ctx = canvas.getContext("2d");
                        let rgbaData;

                        if (
                          imgObj.data.length ===
                          imgObj.width * imgObj.height * 3
                        ) {
                          rgbaData = new Uint8ClampedArray(
                            imgObj.width * imgObj.height * 4,
                          );
                          for (
                            let k = 0, l = 0;
                            k < imgObj.data.length;
                            k += 3, l += 4
                          ) {
                            rgbaData[l] = imgObj.data[k];
                            rgbaData[l + 1] = imgObj.data[k + 1];
                            rgbaData[l + 2] = imgObj.data[k + 2];
                            rgbaData[l + 3] = 255;
                          }
                        } else if (
                          imgObj.data.length ===
                          imgObj.width * imgObj.height * 4
                        ) {
                          rgbaData = new Uint8ClampedArray(imgObj.data);
                        } else if (
                          imgObj.data.length ===
                          imgObj.width * imgObj.height
                        ) {
                          rgbaData = new Uint8ClampedArray(
                            imgObj.width * imgObj.height * 4,
                          );
                          for (
                            let k = 0, l = 0;
                            k < imgObj.data.length;
                            k++, l += 4
                          ) {
                            rgbaData[l] = imgObj.data[k];
                            rgbaData[l + 1] = imgObj.data[k];
                            rgbaData[l + 2] = imgObj.data[k];
                            rgbaData[l + 3] = 255;
                          }
                        }

                        if (rgbaData && ctx) {
                          const idata = new ImageData(
                            rgbaData,
                            imgObj.width,
                            imgObj.height,
                          );
                          ctx.putImageData(idata, 0, 0);
                        }
                      }

                      if (canvas) {
                        const ctx = canvas.getContext("2d", {
                          willReadFrequently: true,
                        });
                        const imageData = ctx?.getImageData(
                          0,
                          0,
                          canvas.width,
                          canvas.height,
                        );
                        if (imageData) {
                          const code = jsQR(
                            imageData.data,
                            imageData.width,
                            imageData.height,
                            { inversionAttempts: "attemptBoth" },
                          );
                          if (
                            code &&
                            code.data &&
                            code.data.toLowerCase().includes("br.gov.bcb.pix")
                          ) {
                            console.log(
                              "Found PIX QR via native image extraction!",
                            );
                            foundCode = code.data;
                            break;
                          }
                        }
                      }
                    }
                  } catch (e) {
                    console.warn("Failed to extract image object", e);
                  }
                }
              }
            } catch (e) {
              console.warn("Failed operator list processing", e);
            }
          }

          if (!foundCode) {
            const pixRegex =
              /000201[\s\S]+?(?:BR\.GOV\.BCB\.PIX|br\.gov\.bcb\.pix)[\s\S]+5802BR[\s\S]+6304[A-Fa-f0-9]{4}/i;
            const fullMatch = pageText.match(pixRegex);
            if (fullMatch) {
              foundCode = fullMatch[0].replace(/\s+/g, "");
              break;
            }
            const normalizedMatch = normalized.match(pixRegex);
            if (normalizedMatch) {
              foundCode = normalizedMatch[0];
              break;
            }
          }
        }

        if (!foundCode) {
          for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
            if (!mounted) break;

            const page = await pdf.getPage(i);

            const crops = [
              { scale: 4.0, x1: 0.02, y1: 0.08, x2: 0.40, y2: 0.45 }, // Banco Inter / Standard Top-Left QR Code (Wide Area)
              { scale: 4.0, x1: 0.03, y1: 0.13, x2: 0.25, y2: 0.38 }, // Banco Inter precise area (x: 3-25%, y: 13-38%)
              { scale: 4.0, x1: 0.05, y1: 0.21, x2: 0.32, y2: 0.43 }, // Inter 1
              { scale: 4.0, x1: 0.06, y1: 0.23, x2: 0.31, y2: 0.41 }, // Inter 2
              { scale: 4.0, x1: 0.82, y1: 0.86, x2: 0.93, y2: 0.94 }, // DAS
              { scale: 3.0, x1: 0.35, y1: 0.75, x2: 0.65, y2: 0.98 }, // FGTS
              { scale: 4.0, x1: 0, y1: 0, x2: 1, y2: 1 }, // Fallback full page very high res
              { scale: 2.5, x1: 0, y1: 0, x2: 1, y2: 1 }, // Fallback full page high res
              { scale: 1.5, x1: 0, y1: 0, x2: 1, y2: 1 }, // Fallback full page low res
            ];

            for (const crop of crops) {
              const viewport = page.getViewport({
                scale: crop.scale,
              });

              const cropX = viewport.width * crop.x1;
              const cropY = viewport.height * crop.y1;
              const cropW = viewport.width * (crop.x2 - crop.x1);
              const cropH = viewport.height * (crop.y2 - crop.y1);

              const canvas = document.createElement("canvas");

              const context = canvas.getContext("2d", {
                willReadFrequently: true,
              });

              if (!context) continue;

              canvas.width = cropW;
              canvas.height = cropH;

              await page.render({
                canvasContext: context,
                viewport,
                transform: [1, 0, 0, 1, -cropX, -cropY],
              } as any).promise;

              const imageData = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              );

              const code = jsQR(
                imageData.data,
                imageData.width,
                imageData.height,
                {
                  inversionAttempts: "attemptBoth",
                },
              );

              if (code && code.data) {
                const qrText = code.data.trim();
                const upperText = qrText.toUpperCase();
                if (
                  upperText.startsWith("000201") &&
                  upperText.includes("BR.GOV.BCB.PIX")
                ) {
                  foundCode = qrText;
                  break;
                }
              }
            }

            if (foundCode) break;
          }
        }

        if (mounted) {
          setScanned(true);

          if (foundCode) {
            setPixCode(foundCode);
          }
        }
      } catch (err) {
        console.error(err);

        if (mounted) {
          setScanned(true);
        }
      }
    };

    preScan();
    return () => {
      mounted = false;
    };
  }, [fileUrl]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyClick = () => {
    if (pixCode) {
      copyToClipboard(pixCode);
    }
  };

  // hide if scanned and no pix code found, or if scanning isn't done yet hide to avoid flicker of wrong state
  if (!scanned || (scanned && !pixCode)) {
    return null;
  }

  return (
    <button
      onClick={handleCopyClick}
      className={`h-10 px-3 w-full sm:w-auto border text-xs font-bold rounded-xl transition-all flex items-center justify-center min-w-[100px] ${
        copied
          ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800/50 dark:text-emerald-400"
          : "bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border-indigo-100 dark:border-indigo-800/50 text-indigo-700 dark:text-indigo-300"
      }`}
    >
      {copied ? (
        <span className="font-bold flex items-center gap-1">
          <Check className="w-3.5 h-3.5" /> Pix Copiado!
        </span>
      ) : (
        <span className="flex items-center gap-1 font-bold">
          <Copy className="w-3 h-3 text-indigo-400" /> Copiar QrCode Pix
        </span>
      )}
    </button>
  );
}
