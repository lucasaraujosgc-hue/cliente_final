import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "src", "pages", "client", "Dashboard.tsx");
let content = fs.readFileSync(filePath, "utf-8");

const targetPart = `                {hasBankStatement ? (
                  <div className="flex-1 min-w-[200px] flex justify-center items-center text-virgula-green font-bold bg-virgula-green/10 p-3 rounded-xl border border-virgula-green/20 text-sm">
                    <FileCheck className="w-5 h-5 mr-2" /> Extrato anexado
                  </div>`;

const originalBlock = `                {hasBankStatement ? (
                  <div className="flex-1 min-w-[200px] flex justify-center items-center text-virgula-green font-bold bg-virgula-green/10 p-3 rounded-xl border border-virgula-green/20 text-sm">
                    <FileCheck className="w-5 h-5 mr-2" /> Extrato anexado
                  </div>
                ) : (
                  <div className="flex-1 min-w-[200px]">
                    <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.ofx" onChange={handleUploadBankStatement}/>
                    <button disabled={isUploading} onClick={() => fileInputRef.current?.click()} className="w-full px-4 py-3 bg-slate-900 dark:bg-slate-700 text-white text-sm font-bold rounded-xl shadow-md hover:bg-slate-800 transition-colors flex items-center justify-center disabled:opacity-50">
                      <Upload className="w-4 h-4 mr-2" /> {isUploading ? "Enviando..." : "Extrato Bancário"}
                    </button>
                  </div>
                )}`;

// We know the broken block ends at 'Extrato Bancário"}\n                    </button>\n                  </div>\n                )}'
const brokenBlockEndPattern = `</button>
                  </div>
                )}`;

// Locate index from targetPart
const startPos = content.indexOf(targetPart);
const endPos = content.indexOf(brokenBlockEndPattern, startPos);

if (startPos !== -1 && endPos !== -1) {
  const fullEndPos = endPos + brokenBlockEndPattern.length;
  const partToReplace = content.substring(startPos, fullEndPos);
  
  // Replace partToReplace with originalBlock (with correct CRLF if needed)
  const isCRLF = content.includes("\r\n");
  const blockToInsert = isCRLF ? originalBlock.replace(/\n/g, "\r\n") : originalBlock;
  
  content = content.replace(partToReplace, blockToInsert);
  console.log("Successfully restored broken upload block using string locator!");
} else {
  console.log("Not found with LF line endings. Trying CRLF...");
  const targetPartCRLF = targetPart.replace(/\n/g, "\r\n");
  const brokenBlockEndPatternCRLF = brokenBlockEndPattern.replace(/\n/g, "\r\n");
  
  const startPosCRLF = content.indexOf(targetPartCRLF);
  const endPosCRLF = content.indexOf(brokenBlockEndPatternCRLF, startPosCRLF);
  if (startPosCRLF !== -1 && endPosCRLF !== -1) {
    const fullEndPosCRLF = endPosCRLF + brokenBlockEndPatternCRLF.length;
    const partToReplaceCRLF = content.substring(startPosCRLF, fullEndPosCRLF);
    
    content = content.replace(partToReplaceCRLF, originalBlock.replace(/\n/g, "\r\n"));
    console.log("Successfully restored broken upload block using CRLF locator!");
  } else {
    console.log("Could not locate indices for restoration.");
  }
}

fs.writeFileSync(filePath, content, "utf-8");
console.log("Completed!");
