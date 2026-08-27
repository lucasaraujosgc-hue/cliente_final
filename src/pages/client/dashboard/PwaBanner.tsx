import { Smartphone, X } from "lucide-react";

interface PwaBannerProps {
  onDismiss: () => void;
}

export function PwaBanner({ onDismiss }: PwaBannerProps) {
  return (
    <div className="relative bg-gradient-to-r from-emerald-600 to-teal-700 text-white p-5 rounded-3xl shadow-lg border border-emerald-500/20 flex flex-col sm:flex-row items-center sm:justify-between gap-4 overflow-hidden transform duration-250 hover:shadow-xl mt-3">
      <div className="absolute top-0 right-0 p-16 bg-white/5 rounded-full translate-x-12 -translate-y-12 pointer-events-none"></div>
      <div className="flex items-center gap-4 z-10">
        <div className="p-3 bg-white/15 backdrop-blur-md rounded-2xl text-emerald-100 animate-bounce shrink-0">
          <Smartphone className="w-6 h-6" />
        </div>
        <div>
          <h4 className="font-extrabold text-sm sm:text-base tracking-tight">Dica de Aplicativo PWA 📱</h4>
          <p className="text-emerald-100 text-xs mt-1 leading-relaxed max-w-xl">
            Acesse como aplicativo nativo! No iOS, <strong className="text-white">esta ação deve ser feita obrigatoriamente através do navegador Safari</strong>: toque no botão de <strong className="text-white hover:underline cursor-pointer">"Compartilhar"</strong> (ícone de quadrado com uma seta para cima) e selecione <strong className="text-white">"Adicionar à Tela de Início"</strong>. No Android, basta tocar nas opções do Chrome e escolher <strong className="text-white">"Instalar aplicativo"</strong>.
          </p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0 z-10 self-end sm:self-center">
        <button
          onClick={onDismiss}
          className="p-2 bg-black/10 hover:bg-black/25 rounded-xl text-white transition-all"
          title="Dispensar sugestão"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
