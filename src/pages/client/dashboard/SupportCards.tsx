interface SupportCardsProps {
  whatsappSupport: string;
}

export function SupportCards({ whatsappSupport }: SupportCardsProps) {
  return (
    <div className="space-y-6">
      {/* PLANTÃO CONTÁBIL */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 relative overflow-hidden shadow-md">
        <div className="absolute top-0 right-0 p-12 bg-white/5 rounded-full translate-x-8 -translate-y-8 pointer-events-none"></div>
        <h4 className="font-extrabold text-sm tracking-tight mb-2">Suporte e Plantão Contábil 📞</h4>
        <p className="text-slate-300 text-xs leading-relaxed mb-4">
          Dúvidas na declaração do faturamento ou na conciliação bancária do seu extrato? Fale direto em nosso chat.
        </p>
        <a
          href={`https://wa.me/${whatsappSupport.replace(/\D/g, '')}`}
          target="_blank"
          rel="noreferrer"
          className="w-full inline-block text-center py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-xs rounded-xl transition-all"
        >
          Iniciar Chat de Plantão
        </a>
      </div>

      {/* SISTEMA FINANCEIRO */}
      <div className="bg-gradient-to-br from-indigo-900 to-purple-900 text-white rounded-3xl p-6 relative overflow-hidden shadow-md mt-6">
        <div className="absolute top-0 right-0 p-12 bg-white/5 rounded-full translate-x-8 -translate-y-8 pointer-events-none"></div>
        <h4 className="font-extrabold text-sm tracking-tight mb-2">Gestão Financeira Completa 💼</h4>
        <p className="text-indigo-200 text-xs leading-relaxed mb-4">
          Tenha acesso a um sistema financeiro completo para gerenciar sua empresa. Controle de caixa, emissão de boletos e mais.
        </p>
        <a
          href="https://financeiro.virgulacontabil.com.br"
          target="_blank"
          rel="noreferrer"
          className="w-full inline-block text-center py-2 bg-white/20 hover:bg-white/30 text-white font-extrabold text-xs rounded-xl transition-all backdrop-blur-sm"
        >
          Acessar Sistema Financeiro
        </a>
      </div>
    </div>
  );
}
