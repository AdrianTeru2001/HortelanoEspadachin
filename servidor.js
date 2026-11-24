// ============================================================
// servidor.js — El punto de arranque de toda la web
// ------------------------------------------------------------
// Este archivo:
//   1. Levanta el servidor web en el puerto 3000
//   2. Monta las "rutas" (las URLs de la web)
//   3. Sirve los archivos estáticos (CSS, JS, imágenes)
//   4. Protege las rutas de vídeo para que solo los
//      usuarios aprobados puedan verlos
//
// Para arrancarlo desde una terminal:  npm start
// ============================================================

const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const fs = require('fs');

const { contarAdmins } = require('./base-datos');

const app = express();
const PUERTO = process.env.PUERTO || 3000;

// ------------------------------------------------------------
// 1. Configuración general
// ------------------------------------------------------------

// Le decimos a Express que puede leer el cuerpo de las peticiones
// (lo necesario para que los formularios de login/registro funcionen)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ------------------------------------------------------------
// 2. Sesiones (cómo recordamos quién ha iniciado sesión)
// ------------------------------------------------------------
// Una "sesión" es como un pulsera invisible: cuando te logueas,
// el servidor te da una cookie firmada, y en cada petición
// comprueba esa cookie para saber quién eres.
//
// - cookies se guardan en el navegador del usuario
// - secret es la clave con la que firmamos para que nadie
//   pueda inventarse una cookie falsa
// - maxAge: 30 días de sesión antes de tener que entrar otra vez
// ------------------------------------------------------------
const CLAVE_SESION = process.env.CLAVE_SESION || 'clave-secreta-cambiala-en-produccion';

app.use(
  cookieSession({
    name: 'sesion',
    secret: CLAVE_SESION,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
    httpOnly: true,   // el JS del navegador no puede leer la cookie (más seguro)
    sameSite: 'lax',  // algo de protección contra ataques CSRF
  })
);

// Hacemos que "req.session" esté siempre disponible (aunque vacío)
app.use((req, res, next) => {
  if (!req.session) req.session = {};
  next();
});

// ------------------------------------------------------------
// 3. Archivos estáticos (CSS, JS de frontend, imágenes)
// ------------------------------------------------------------
// Cualquier archivo dentro de /public se puede cargar desde
// el navegador escribiendo su ruta. Ejemplo:
//   public/css/estilos.css  →  http://localhost:3000/css/estilos.css
// ------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------
// 4. Middleware global: quien es el usuario actual
// ------------------------------------------------------------
// Cada petición pasa por aquí. Miramos la sesión y dejamos
// guardado en `req.usuario` el objeto del usuario (o null).
// ------------------------------------------------------------
const { consultas } = require('./base-datos');

app.use((req, res, next) => {
  req.usuario = null;
  if (req.session.usuarioId) {
    const usuario = consultas.usuarioPorId.get(req.session.usuarioId);
    // Si el usuario fue borrado, cerramos su sesión
    if (usuario && usuario.estado === 'aprobado') {
      req.usuario = usuario;
    } else if (usuario && (usuario.estado === 'pendiente' || usuario.estado === 'rechazado')) {
      // Mantenemos la sesión viva para que pueda ver la pantalla
      // de espera / la de rechazo con su botón de "pedir acceso otra vez"
      req.usuarioPendiente = usuario;
    } else {
      delete req.session.usuarioId;
    }
  }
  next();
});

// ------------------------------------------------------------
// 5. Rutas de la API y páginas
// ------------------------------------------------------------
app.use('/auth', require('./rutas/auth'));
app.use('/admin', require('./rutas/admin'));
app.use('/', require('./rutas/paginas'));
app.use('/videos', require('./rutas/videos'));

// ------------------------------------------------------------
// 6. Manejo de errores (si algo falla, no mostramos la pila
//    técnica al usuario, sino un mensaje limpio)
// ------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).send('Algo ha ido mal. Mira la consola del servidor.');
});

// ------------------------------------------------------------
// 7. Arrancamos el servidor
// ------------------------------------------------------------
app.listen(PUERTO, () => {
  console.log('');
  console.log('🎬  SerieWeb arrancada correctamente');
  console.log('    Local:    http://localhost:' + PUERTO);
  console.log('');

  // Si todavía no existe ningún administrador, avisamos:
  if (contarAdmins() === 0) {
    console.log('    ⚠️  Aún no hay administrador.');
    console.log('    👉  Entra a http://localhost:' + PUERTO + '/registro');
    console.log('        y regístrate con el nombre "admin" para ser el dueño.');
    console.log('');
  }
});
