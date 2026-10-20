import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Ban, Trash2 } from "lucide-react";
import { Logo } from "../components/Logo";

// Página PÚBLICA da política de privacidade. É a URL pedida pelo Google Play e
// pela App Store ("Privacy policy URL") e o Google exige que ela também seja
// acessível de dentro do app — por isso há link no login e em Minha conta.
// Precisa abrir sem login.
//
// O texto descreve o que o sistema faz de fato (ver src/server/schema.ts e a
// declaração de Segurança dos dados do Play Console). Se o portal passar a
// coletar algo novo, atualize aqui, a declaração do Play e UPDATED_AT.

// Dados do controlador. `cnpj` só aparece na página quando preenchido
// (ex.: "12.345.678/0001-90").
const CONTROLLER = {
  name: "Vírgula Contábil",
  cnpj: "",
  email: "contato@virgulacontabil.com.br",
};
const UPDATED_AT = "29 de setembro de 2026";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-2.5 space-y-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-brand/60" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-ink">{children}</strong>;

export function PrivacyPolicy() {
  const navigate = useNavigate();
  // Chegou por um link do próprio portal/app → volta para onde estava;
  // abriu a URL direto (loja, navegador) → vai para o login.
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate("/login"));
  const mail = (
    <a href={`mailto:${CONTROLLER.email}`} className="font-semibold text-brand-fg hover:underline">
      {CONTROLLER.email}
    </a>
  );

  return (
    <div className="min-h-screen bg-ground px-4 py-10 text-ink sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <Logo size="sm" />
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <ArrowLeft className="size-4" strokeWidth={1.9} /> Voltar
          </button>
        </div>

        <h1 className="mt-8 font-serif text-[1.75rem] font-semibold leading-tight">Política de privacidade</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Portal do Cliente — site <B>cliente.virgulacontabil.com.br</B> e aplicativo para Android e iOS.
          Última atualização: {UPDATED_AT}.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, text: "Usamos seus dados só para o serviço contábil." },
            { icon: Ban, text: "Sem anúncios, sem rastreamento e nada é vendido." },
            { icon: Trash2, text: "Você pode pedir a exclusão da conta pelo próprio app." },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-wash text-brand-fg">
                <Icon className="size-4" strokeWidth={1.9} />
              </span>
              <p className="text-xs leading-relaxed text-muted">{text}</p>
            </div>
          ))}
        </div>

        <article className="mt-6 space-y-6 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-7">
          <Section id="quem-somos" title="1. Quem somos">
            <p>
              O Portal do Cliente é mantido pela <B>{CONTROLLER.name}</B>
              {CONTROLLER.cnpj ? <> (CNPJ {CONTROLLER.cnpj})</> : null}, escritório de contabilidade que
              é o <B>controlador</B> dos dados pessoais tratados aqui, nos termos da Lei Geral de Proteção
              de Dados (LGPD — Lei nº 13.709/2018).
            </p>
            <p>
              O portal é exclusivo para as empresas clientes do escritório: as contas são criadas pelo
              escritório e não há cadastro público. Contato e encarregado de dados: {mail}.
            </p>
          </Section>

          <Section id="dados" title="2. Quais dados tratamos">
            <Bullets
              items={[
                <>
                  <B>Identificação e acesso:</B> nome ou razão social, CNPJ/CPF usado no login, e-mail de
                  contato e senha — a senha é guardada apenas de forma cifrada (hash), nunca em texto.
                </>,
                <>
                  <B>Informações fiscais e contábeis:</B> guias de tributos, valores e vencimentos, situação
                  de regularidade da empresa, faturamento informado por você e as notas fiscais de serviço
                  (NFS-e) emitidas e recebidas — inclusive os dados dos tomadores que você informa ao emitir
                  uma nota (nome, CPF/CNPJ e, quando informados, contato e endereço).
                </>,
                <>
                  <B>Arquivos que você envia:</B> extratos, comprovantes, planilhas e imagens.
                </>,
                <>
                  <B>Mensagens</B> trocadas com o escritório e o histórico de avisos enviados a você.
                </>,
                <>
                  <B>Registros de uso e segurança:</B> ações como abrir uma guia ou copiar o código PIX (para
                  o escritório saber que a guia chegou até você), registros de login e de alterações na
                  conta e o tipo de navegador ou aparelho de cada sessão ativa.
                </>,
                <>
                  <B>Notificações:</B> se você permitir, o identificador de notificações do aparelho ou do
                  navegador e o nome do aparelho.
                </>,
              ]}
            />
            <p>
              <B>Não coletamos</B> sua localização, seus contatos, o ID de publicidade do aparelho nem
              dados de navegação fora do portal. O portal não exibe anúncios e não usa ferramentas de
              análise ou rastreamento de terceiros.
            </p>
          </Section>

          <Section id="finalidades" title="3. Para que usamos">
            <Bullets
              items={[
                <>
                  <B>Prestar o serviço contábil contratado</B> — mostrar guias, documentos e notas, receber
                  seus envios e conversar com você (execução de contrato, art. 7º, V, da LGPD).
                </>,
                <>
                  <B>Cumprir obrigações legais e regulatórias</B> — apuração de tributos, emissão de guias e
                  notas fiscais e guarda de documentos fiscais (art. 7º, II).
                </>,
                <>
                  <B>Proteger sua conta</B> — autenticação, verificação de sessões, registro de ações
                  sensíveis e prevenção de fraude (legítimo interesse, art. 7º, IX).
                </>,
                <>
                  <B>Avisar você</B> — lembretes de vencimento, comunicados do escritório e e-mails
                  necessários, como o código para redefinir a senha. Notificações no aparelho só com a sua
                  permissão, que pode ser retirada a qualquer momento nas configurações do aparelho.
                </>,
              ]}
            />
          </Section>

          <Section id="compartilhamento" title="4. Com quem compartilhamos">
            <p>Não vendemos nem alugamos dados pessoais. Eles só são repassados a:</p>
            <Bullets
              items={[
                <>
                  <B>Órgãos públicos, quando a obrigação fiscal exige:</B> Receita Federal, por meio do
                  SERPRO (Integra Contador), para gerar guias e consultar a situação fiscal; e o Sistema
                  Nacional da NFS-e, para emitir e consultar notas fiscais de serviço.
                </>,
                <>
                  <B>Fornecedores que operam o serviço em nosso nome:</B> hospedagem e banco de dados, envio
                  de e-mails e Google Firebase (entrega das notificações no celular). Eles só podem usar os
                  dados para essa finalidade.
                </>,
                <>
                  <B>Autoridades,</B> quando houver ordem judicial ou exigência legal.
                </>,
              ]}
            />
            <p>
              Alguns desses fornecedores, como o Google Firebase e o serviço de e-mail, podem processar dados
              fora do Brasil. Escolhemos fornecedores com garantias contratuais de proteção de dados, nos
              termos do art. 33 da LGPD.
            </p>
          </Section>

          <Section id="seguranca" title="5. Como protegemos">
            <Bullets
              items={[
                "Toda a comunicação com o portal e o app é criptografada (HTTPS).",
                "Senhas guardadas apenas como hash; credenciais de integração cifradas no servidor.",
                "Cada documento só pode ser aberto com login, pela empresa a que pertence e pelo escritório.",
                "Sessões expiram automaticamente e são todas encerradas quando a senha é redefinida; o acesso do escritório tem verificação em duas etapas.",
              ]}
            />
          </Section>

          <Section id="retencao" title="6. Por quanto tempo guardamos">
            <p>
              Enquanto sua empresa for cliente do escritório. Depois disso, guias, notas fiscais e documentos
              contábeis são mantidos pelo prazo exigido pela legislação (em geral, 5 anos); dados de acesso,
              preferências, dispositivos de notificação e mensagens são apagados com a exclusão da conta.
            </p>
          </Section>

          <Section id="direitos" title="7. Seus direitos">
            <p>
              Pela LGPD (art. 18) você pode pedir: confirmação de que tratamos seus dados e acesso a eles;
              correção de dados incompletos ou desatualizados; anonimização, bloqueio ou eliminação de dados
              desnecessários; portabilidade; informação sobre com quem compartilhamos; e revogação de
              consentimentos, como o das notificações.
            </p>
            <p>
              E-mail e senha você altera direto em <B>Minha conta</B>, no portal ou no app. Para os demais
              pedidos, escreva para {mail} — respondemos em até 15 dias. Você também pode reclamar à
              Autoridade Nacional de Proteção de Dados (ANPD).
            </p>
          </Section>

          <Section id="exclusao" title="8. Exclusão da conta">
            <p>
              Você pode pedir a exclusão da conta a qualquer momento em <B>Minha conta → Excluir minha
              conta</B>. O passo a passo e o que é mantido por obrigação legal estão em{" "}
              <Link to="/excluir-conta" className="font-semibold text-brand-fg hover:underline">
                cliente.virgulacontabil.com.br/excluir-conta
              </Link>
              .
            </p>
          </Section>

          <Section id="aparelho" title="9. Dados guardados no seu aparelho">
            <p>
              Para manter você conectado, o portal e o app guardam no armazenamento local do aparelho a sua
              sessão e preferências de uso (como o tema claro ou escuro). Sair da conta apaga a sessão. Não
              usamos cookies de publicidade ou de rastreamento.
            </p>
          </Section>

          <Section id="menores" title="10. Menores de idade">
            <p>
              O portal é destinado a empresas e aos seus responsáveis. Não é voltado a menores de 18 anos.
            </p>
          </Section>

          <Section id="alteracoes" title="11. Alterações nesta política">
            <p>
              Se esta política mudar, a nova versão será publicada nesta página, com a data de atualização
              no topo.
            </p>
          </Section>
        </article>

        <p className="mt-10 text-center text-xs text-faint">{CONTROLLER.name} · Portal do Cliente</p>
      </div>
    </div>
  );
}
