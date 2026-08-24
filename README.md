# Gerenciador de Placas — Página Pública

Esta pasta é o site estático publicado no GitHub Pages.  
O arquivo `data.json` é gerado automaticamente pelo botão **"Publicar para Web"** dentro do app.

---

## Configuração inicial (uma única vez)

### 1. Crie o repositório no GitHub
- Acesse github.com → **New repository**
- Nome sugerido: `gerenciador-placas-public`
- Pode ser público ou privado (GitHub Pages requer plano pago para repositórios privados)

### 2. Configure esta pasta como repositório git

Abra o **Prompt de Comando** ou **Git Bash** e execute (substituindo a URL pelo seu repositório):

```
cd "C:\Users\LOG20\Desktop\PROGRAMAS\gerenciador-placas\web-public"
git init
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/gerenciador-placas-public.git
```

### 3. Faça a primeira publicação

No app, clique em **⬆ Publicar agora** na aba Importar.  
Ou pela linha de comando:

```
git add .
git commit -m "Primeira publicação"
git push -u origin main
```

### 4. Ative o GitHub Pages

No repositório do GitHub:
- Vá em **Settings → Pages**
- Source: **Deploy from a branch** → branch `main`, pasta `/` (root)
- Clique em **Save**

A URL do site aparecerá em alguns instantes (formato: `https://SEU_USUARIO.github.io/gerenciador-placas-public`).

---

## Como atualizar

Sempre que importar novos dados no app, clique em **⬆ Publicar agora**.  
O site público atualiza automaticamente em ~30 segundos após o push.
