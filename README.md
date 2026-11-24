# 🎬 SerieWeb — Tu plataforma privada de series

Web estilo Netflix para ver con tus amigos la serie que hicisteis.
Solo quien tú apruebes puede entrar.

---

## 🚀 Cómo arrancarla

```bash
npm install    # solo la primera vez (instala las librerías)
npm start      # arranca el servidor
```

Luego abre **http://localhost:3000**

> El **primer usuario** que se registre será el **administrador** (el dueño).
> Regístrate tú primero en `/registro` con el nombre que quieras.

---

## 📄 Páginas

| Ruta | Qué es |
|---|---|
| `/` | Inicio estilo Netflix: banner destacado + filas de capítulos |
| `/capitulos` | Catálogo con buscador y filtro por temporada |
| `/capitulo/:id` | Reproductor + ficha + botón "siguiente episodio" |
| `/login` | Iniciar sesión |
| `/registro` | Crear cuenta (queda **pendiente** hasta que la apruebes) |
| `/esperando` | Pantalla que ven tus amigos mientras esperan tu aprobación |
| `/panel` | **Solo tú**: aprobar usuarios y subir/borrar capítulos |

### Rutas de acción (formularios)

| Ruta | Quién puede | Qué hace |
|---|---|---|
| `POST /auth/registro` | cualquiera | Crea la cuenta (como *pendiente*) |
| `POST /auth/login` | cualquiera | Inicia sesión |
| `POST /auth/logout` | quien tenga sesión | Cierra sesión |
| `POST /auth/volver-a-pedir` | el propio usuario | Un rechazado vuelve a la cola |
| `POST /auth/aprobar` | **solo admin** | Aprueba a cualquier usuario |
| `POST /auth/rechazar` | **solo admin** | Rechaza o revoca el acceso |
| `POST /admin/subir` | **solo admin** | Sube un capítulo (vídeo + miniatura) |
| `POST /admin/borrar` | **solo admin** | Borra un capítulo y sus archivos |
| `GET /videos/:id` | aprobados | Sirve el MP4 (con seek) |
| `GET /miniaturas/:archivo` | aprobados | Sirve la imagen de portada |

---

## 🗂 Estructura del proyecto

```
HortelanoWeb/
├── servidor.js          → Arranque, sesión, middlewares
├── base-datos.js        → Tablas y consultas SQLite
├── datos.db             → La base de datos (se crea sola)
│
├── rutas/
│   ├── auth.js          → Registro, login, aprobar/rechazar
│   ├── paginas.js       → Sirve cada página HTML
│   ├── admin.js         → Subida y borrado de capítulos
│   └── videos.js        → Sirve los MP4 (protegido + seek)
│
├── public/
│   ├── css/estilos.css  → Todo el aspecto visual
│   └── paginas/         → Los HTML de cada vista
│
├── videos/              → Los MP4 que subas
└── miniaturas/          → Las imágenes de portada
```

---

## 🧠 Cómo funciona cada cosa

### 1. Base de datos (`base-datos.js`)

Usamos **SQLite**: una base de datos que es **un solo archivo** (`datos.db`).
No hay que instalar nada. Tiene dos tablas:

- **`usuarios`** → nombre, email, contraseña cifrada, y `estado`
  (`pendiente` / `aprobado` / `rechazado`)
- **`capitulos`** → título, temporada, episodio, sinopsis, duración,
  y los nombres de los archivos de vídeo y miniatura

### 2. Contraseñas (`bcryptjs`)

La contraseña **nunca se guarda tal cual**. `bcrypt` la mezcla con ruido
aleatorio y guarda un hash ilegible. Si alguien roba `datos.db`, no puede
leer las contraseñas. Al entrar, se comprueba con `bcrypt.compareSync`.

### 3. Sesiones (`cookie-session`)

Cuando te logueas, el navegador recibe una **cookie firmada** con tu ID.
En cada petición el servidor la lee y sabe quién eres. La cookie está marcada
como `httpOnly`, así que el JavaScript no puede leerla (protección contra robos).

### 4. Control de acceso (lo más importante)

```
Se registra tu amigo → estado 'pendiente' → NO ve nada
        ↓
Tú entras a /panel → pulsas "Aprobar"
        ↓
estado 'aprobado' → ya puede entrar cuando quiera
```

**Desde "Todos los usuarios" en tu panel puedes cambiar el estado cuando quieras:**

| Estado | Botones que ves |
|---|---|
| ⏳ Pendiente | ✅ Aprobar · ❌ Rechazar |
| 🚫 Rechazado | ✅ **Aprobar** (para corregir un error) |
| ✅ Aprobado | 🚫 **Revocar** (quitarle el acceso) |
| 👑 Administrador | Ninguno (no puedes bloquearte a ti mismo) |

**Si rechazas a alguien sin querer** no pasa nada: esa persona puede iniciar
sesión, verá su pantalla de rechazo y tendrá un botón **"🙋 Volver a pedir
acceso"**. Al pulsarlo, vuelve a aparecer en tu lista de pendientes.

Las rutas de vídeo e imagen comprueban el estado **en el servidor**.
Si alguien copia la dirección de un vídeo y no está aprobado, recibe **403**.

### 5. Reproducción de vídeo (`rutas/videos.js`)

Los vídeos **no** están en la carpeta pública. Se sirven por `/videos/:id`
con comprobación de permisos.

Soportan **Range Requests**: el navegador pide "dame los bytes del minuto 2
al 4" y el servidor responde con código **260/206**. Eso es lo que permite
adelantar y retroceder en el reproductor.

### 6. Plantillas HTML (sin dependencias)

En vez de usar un motor de plantillas (EJS, Handlebars...), hay una función
llamada `pintar()` que lee el `.html` y sustituye `{{variable}}` por el valor.

- `{{algo}}` → se **escapa** (seguro para texto del usuario)
- `{{algoJSON}}` → se inserta tal cual (JSON generado por nosotros)
- `{{algoHTML}}` → se inserta tal cual (HTML generado por nosotros)

### 7. Subida de capítulos (`multer`)

`multer` recibe los archivos del formulario. Los guarda con nombre **UUID**
(ej. `a3f8c2...mp4`) para que no haya colisiones ni problemas con tildes.
Límite: **2 GB** por archivo.

---

## 🔒 Seguridad implementada

- Contraseñas con hash (bcrypt)
- Cookies de sesión firmadas y `httpOnly`
- Rutas de vídeo e imagen protegidas (403 sin aprobación)
- Comprobación de admin en cada acción administrativa
- Protección contra **path traversal** (`path.basename`)
- Escape de HTML en todas las variables de plantilla
- Sin nombres/emails repetidos
- Mensajes de login genéricos (no revelan si el usuario existe)

---

## 🌐 Cloudflare Tunnel (acceso desde fuera de casa)

Esto va **fuera del código**: es solo para que tus amigos entren por internet.

1. Crea una cuenta gratis en [dash.cloudflare.com](https://dash.cloudflare.com)
2. Añade un dominio (comprado en Cloudflare o que ya tengas)
3. Instala `cloudflared` desde [developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
4. En una terminal:
   ```bash
   cloudflared login
   cloudflared tunnel create serie
   ```
5. Crea el archivo de configuración `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <ID-que-te-dio-el-comando>
   ingress:
     - hostname: series.tudominio.com
       service: http://localhost:3000
     - service: http_status:404
   ```
6. Registra el enlace DNS y arranca:
   ```bash
   cloudflared tunnel route dns serie series.tudominio.com
   cloudflared tunnel run serie
   ```
7. Tus amigos entran a `https://series.tudominio.com`

> **Importante:** tu PC debe estar encendida y con `npm start` + `cloudflared`
> funcionando.

---

## ⚙️ Comandos útiles

```bash
npm start          # arrancar
npm run dev        # arrancar con recarga automática al guardar archivos
```

### Variables de entorno (opcionales)

| Variable | Para qué | Por defecto |
|---|---|---|
| `PUERTO` | Cambiar el puerto | `3000` |
| `CLAVE_SESION` | **Cambiar la clave de las cookies** | una de prueba |

> ⚠️ Antes de abrir la web a internet, cambia `CLAVE_SESION`:
> ```bash
> set CLAVE_SESION=una-clave-larga-y-secreta-aqui
> npm start
> ```
