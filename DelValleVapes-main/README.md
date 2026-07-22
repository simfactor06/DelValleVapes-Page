# Del Valle Vapes — sitio + admin

Todo el código ya está listo y con Git inicializado. Te faltan 3 cosas, y las 3 las hacés
vos porque necesitan tu cuenta (no se pueden hacer desde acá):

1. Subir esto a GitHub
2. Conectar Netlify
3. Configurar el panel de admin (una sola vez) para que tu amigo pueda cargar productos

---

## 1) Subir a GitHub

Si todavía no tenés el repo creado:

1. Andá a https://github.com/new
2. Nombre: `delvallevapes` (o el que quieras)
3. Dejalo **privado** si preferís (no es obligatorio, pero es un buen default para esto)
4. NO marques "Add a README" (ya tenemos uno)
5. Creá el repo

Después, en una terminal parada en esta carpeta:

```bash
git remote add origin https://github.com/TU-USUARIO/delvallevapes.git
git add -A
git commit -m "Sitio inicial: catálogo + carrito + admin"
git push -u origin main
```

(Si Git te pide login, usá tu usuario de GitHub y un Personal Access Token como
contraseña — GitHub ya no acepta la contraseña normal para esto.)

---

## 2) Conectar Netlify

1. Entrá a https://app.netlify.com
2. "Add new site" → "Import an existing project" → GitHub
3. Elegí el repo `delvallevapes`
4. Build settings: **dejalo todo vacío** (no hay build step, es HTML/JS plano).
   - Build command: (vacío)
   - Publish directory: `.` (la raíz)
5. "Deploy site"

A los 30-60 segundos ya tenés una URL tipo `random-name-123.netlify.app`. Podés
cambiarle el nombre en Site settings → Change site name, o conectarle un dominio propio.

Desde acá en adelante: **cada vez que se hace un cambio y se sube a GitHub (por vos
o por el panel de admin), Netlify lo publica solo, automático, en 1-2 minutos.**

---

## 3) Configurar el panel de admin (primera vez)

El panel está en `tusitio.netlify.app/admin/`. La primera vez que alguien entra ahí
tiene que completar un formulario de configuración:

- **Usuario/organización de GitHub**: tu usuario (el dueño del repo)
- **Repositorio**: `delvallevapes` (el nombre exacto)
- **Rama**: `main`
- **Personal Access Token de GitHub**: hay que generarlo (ver abajo)
- **Clave del panel**: una clave que inventen ustedes, para entrar al panel en ese
  dispositivo. Esta clave NO se manda a ningún lado — solo sirve para desbloquear el
  token de GitHub que queda guardado (encriptado) en ese navegador.

### Cómo generar el Personal Access Token

1. Andá a https://github.com/settings/personal-access-tokens/new (fine-grained token)
2. Nombre: algo como "Admin Del Valle Vapes"
3. Repository access: "Only select repositories" → elegí `delvallevapes`
4. Permissions → Repository permissions → **Contents: Read and write**
   (todo lo demás puede quedar en "No access")
5. Generá el token y copialo — GitHub lo muestra **una sola vez**, si lo perdés hay
   que generar uno nuevo.
6. Pegalo en el formulario de setup del panel.

⚠️ Ese token es como una contraseña: quien lo tenga puede escribir en el repo.
Si en algún momento se pierde o cambian de admin, se puede revocar desde
GitHub → Settings → Developer settings → Personal access tokens, y generar uno nuevo.

Cada persona/dispositivo que use el panel necesita hacer este setup una vez (con el
mismo token o uno propio). Después de configurado, solo pide la clave para desbloquear.

---

## Cómo se usa el panel día a día

- Entrar a `tusitio.netlify.app/admin/`, poner la clave.
- Pestaña **Productos**: buscar, editar precio/sabor/foto, agregar nuevo, eliminar.
- Pestaña **Secciones**: editar el texto de las tiles de la portada (Elfbar TE30K,
  Ignite, etc.)
- Botón **💾 Publicar cambios**: sube todo a GitHub de una. Netlify lo publica solo
  en 1-2 minutos.
- Los cambios NO se ven en el sitio hasta que se aprieta "Publicar cambios".

---

## Estructura del proyecto

```
index.html          → sitio público
app.js               → lógica del catálogo/carrito (lee data/*.json)
style.css
data/
  products.json       → los 43 productos (fuente de verdad)
  sections.json        → las 6 tiles de la portada
  config.json           → número de WhatsApp, nombre del sitio
assets/
  products/            → fotos de cada sabor
  sections/             → fotos grandes de cada línea (portada)
  brand/logo.png
admin/
  index.html            → panel de admin
  admin.js               → toda la lógica (cifrado + integración con GitHub)
  admin.css
```
