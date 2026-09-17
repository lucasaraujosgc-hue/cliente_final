import { Link } from "react-router-dom";
import { ShieldCheck, Trash2, Clock, Mail } from "lucide-react";
import { Logo } from "../components/Logo";

// Página PÚBLICA de exclusão de conta. É a URL que a App Store e o Google Play
// pedem no cadastro do app ("Account deletion URL"), e precisa abrir sem login.
// O caminho de verdade é dentro do app (Minha conta → Excluir minha conta);
// aqui explicamos o processo e a retenção legal.
export function DeleteAccountInfo() {
  return (
    <div className="min-h-screen bg-ground px-4 py-10 text-ink sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <Logo size="sm" />

        <h1 className="mt-8 font-serif text-[1.75rem] font-semibold leading-tight">
          Excluir sua conta do Portal do Cliente
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Você pode pedir a exclusão da sua conta e dos seus dados pessoais a qualquer momento,
          direto pelo aplicativo ou pelo portal.
        </p>

        <section className="mt-8 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <h2 className="font-serif text-lg font-semibold">Como pedir</h2>
          <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted">
            <li>
              <span className="font-semibold text-ink">1.</span> Entre no app ou no portal com o
              CNPJ e a senha da sua empresa.
            </li>
            <li>
              <span className="font-semibold text-ink">2.</span> Abra <strong>Minha conta</strong>{" "}
              (na barra lateral no computador, ou no ícone de engrenagem na tela Visão Geral do
              celular).
            </li>
            <li>
              <span className="font-semibold text-ink">3.</span> Toque em{" "}
              <strong>Excluir minha conta</strong> e confirme.
            </li>
          </ol>
          <Link
            to="/login"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            Entrar no portal
          </Link>
        </section>

        <section className="mt-5 space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-danger-wash text-danger">
              <Trash2 className="size-[18px]" strokeWidth={1.9} />
            </span>
            <div>
              <p className="text-sm font-semibold">O que é apagado</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Seu acesso ao portal, e-mail e telefone de contato, preferências de notificação,
                dispositivos cadastrados para receber avisos e as mensagens trocadas com o
                escritório.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warn-wash text-warn">
              <Clock className="size-[18px]" strokeWidth={1.9} />
            </span>
            <div>
              <p className="text-sm font-semibold">O que precisa ser guardado, e por quê</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Guias de tributos, notas fiscais e documentos contábeis têm guarda obrigatória por
                lei (em geral 5 anos). Por isso a exclusão não é imediata: o escritório encerra as
                obrigações fiscais do período e só então apaga a conta. Enquanto isso você
                continua com acesso normal e pode cancelar o pedido.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-wash text-brand-fg">
              <ShieldCheck className="size-[18px]" strokeWidth={1.9} />
            </span>
            <div>
              <p className="text-sm font-semibold">Nada é vendido nem compartilhado</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Os dados são usados só para a prestação do serviço contábil. O portal não usa
                rastreamento entre aplicativos.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-5 flex items-start gap-3 rounded-xl border border-line bg-sunken p-4">
          <Mail className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.9} />
          <p className="text-xs leading-relaxed text-muted">
            Não consegue entrar?{" "}
            <a
              href="mailto:contato@virgulacontabil.com.br?subject=Exclus%C3%A3o%20de%20conta%20-%20Portal%20do%20Cliente"
              className="font-semibold text-brand-fg hover:underline"
            >
              contato@virgulacontabil.com.br
            </a>
            . Precisamos do CNPJ da empresa para localizar a conta.
          </p>
        </section>

        <p className="mt-10 text-center text-xs text-faint">
          Vírgula Contábil · Portal do Cliente
        </p>
      </div>
    </div>
  );
}
