<img width="646" height="215" alt="image" src="https://github.com/user-attachments/assets/aa9755e1-2c4f-416d-87cb-79f758db2b80" />

# Bitbucket Contributions

Gere um gráfico de contribuições (estilo GitHub) a partir dos seus commits no
Bitbucket e exporte como imagem PNG.

O app é **self-service**: você mesmo informa suas credenciais do Bitbucket (API
Token), o app busca seus commits, monta o heatmap e permite exportar.

> As credenciais **nunca são salvas**. Elas ficam apenas na memória do navegador
> (sessão atual) e são usadas pelo backend apenas como proxy para a API do
> Bitbucket — recebidas, usadas na requisição e descartadas.

## Estrutura

```
.
├── server/   # backend Node + Express (proxy para a API do Bitbucket)
└── client/   # frontend React (Vite) com o heatmap e export PNG
```

## Como rodar

### Opção A — tudo de uma vez (recomendado)

Na raiz do projeto:

```bash
npm run install:all   # instala deps da raiz, do server e do client
npm run dev           # sobe backend (:3001) e frontend (:5173) juntos
```

Abra http://localhost:5173 no navegador.

### Opção B — separado

```bash
# Backend
cd server
npm install
npm run dev        # sobe em http://localhost:3001

# Frontend (em outro terminal)
cd client
npm install
npm run dev        # sobe em http://localhost:5173
```

## Como pegar suas credenciais no Bitbucket

1. **API Token** ⚠️
   - Os **App Passwords foram descontinuados** pela Atlassian (deixaram de
     funcionar em 9 de junho de 2026). Use um **API Token**.
   - Acesse: conta Atlassian → _Security_ → _API tokens_ → _Create API token_
   - Link direto: https://id.atlassian.com/manage-profile/security/api-tokens
   - Use a opção **Create API token with scopes**, selecione o app
     **Bitbucket** e marque os escopos de **leitura**:
     **Repositories → Read** e **User → Read**
   - Copie o token gerado (ele só aparece uma vez)

2. **E-mail da conta Atlassian**
   - É o e-mail com que você entra na Atlassian/Bitbucket.
   - Com API Token, ele é usado como **usuário** no Basic Auth
     (o username do Bitbucket **não** funciona mais para a API).
   - É também usado para **filtrar os seus commits** dentro dos repositórios.

3. **URL do Bitbucket**
   - Cole a URL de um **repositório** para gerar o gráfico só dele:
     `https://bitbucket.org/{workspace}/{repositorio}`
   - Ou a URL do **workspace** para incluir todos os repositórios:
     `https://bitbucket.org/{workspace}`
   - O workspace e o repositório são extraídos automaticamente da URL.

4. **Ano**
   - Escolha o ano civil (1º de janeiro a 31 de dezembro) a ser exibido no
     gráfico.

## Observações

- O Bitbucket não possui um endpoint pronto de "contribuições". Quando você
  informa a URL de um repositório, o app percorre os commits dele; quando
  informa a URL do workspace, ele lista todos os repositórios e agrega a
  contagem por dia.
- Se você apontar para um workspace com muitos repositórios, a primeira busca
  pode demorar um pouco.
