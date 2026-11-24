// ============================================================
// rutas/paginas.js — Sirve las páginas HTML de la web
// ------------------------------------------------------------
// Esta ruta va al final de todas y decide QUÉ página le
// toca a cada visitante:
//
//   - Si no está logueado → login / registro
//   - Si está pendiente  → pantalla "esperando aprobación"
//   - Si está aprobado   → home, catálogo, capítulo...
//   - Si es admin        → además, el panel
// ============================================================

const express = require('express');
const path = require('path');
const fs = require('fs');

const { consultas, contarAdmins } = require('../base-datos');

const router = express.Router();

const CARPETA_PAGINAS = path.join(__dirname, '..', 'public', 'paginas');

// Convierte texto "peligroso" (<, >, &, ") en entidades seguras
// para meterlo dentro del HTML sin riesgo de inyección de código
function escapar(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------------------------------------------------------------
// Función auxiliar: envía un HTML con variables sustituidas
// ------------------------------------------------------------
// Leemos el archivo .html y cambiamos {{nombre}} por el valor
// real. Así no necesitamos un motor de plantillas externo
// (menos dependencias = más fácil de entender).
// ------------------------------------------------------------
function pintar(res, archivo, variables = {}) {
  let html = fsRead(archivo);

  // El enlace al panel de admin solo se muestra si es admin.
  // Así evitamos necesitar bloques condicionales en el HTML.
  const todos = {
    enlaceAdmin: res.locals.esAdmin
      ? '<a href="/panel" class="ocultar-movil">⚙️ Admin</a>'
      : '',
    ...variables,
  };

  for (const [clave, valor] of Object.entries(todos)) {
    // Las variables que terminan en "JSON" son trozos de código
    // que generamos nosotros (arrays/objetos). Van tal cual.
    // Sustituimos "<" para que nadie pueda cerrar el script.
    if (clave.endsWith('JSON')) {
      html = html.replaceAll(`{{${clave}}}`, String(valor).replace(/</g, '\\u003c'));
      continue;
    }
    // Las variables terminadas en "HTML" son trozos de HTML que
    // genera el propio servidor: van tal cual, sin escapar.
    if (clave.endsWith('HTML')) {
      html = html.replaceAll(`{{${clave}}}`, String(valor));
      continue;
    }
    // El enlace al admin es HTML de confianza que generamos
    // nosotros: lo insertamos tal cual, sin escapar.
    if (clave === 'enlaceAdmin') {
      html = html.replaceAll(`{{${clave}}}`, valor);
      continue;
    }
    // Escapamos para que nadie inyecte código en el HTML
    const seguro = String(valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    html = html.replaceAll(`{{${clave}}}`, seguro);
  }

  // Quitamos cualquier {{variable}} que no se haya rellenado
  html = html.replace(/\{\{[^}]+\}\}/g, '');

  res.send(html);
}

function fsRead(archivo) {
  return fs.readFileSync(path.join(CARPETA_PAGINAS, archivo), 'utf8');
}

// ------------------------------------------------------------
// Guarda en res.locals lo que TODAS las páginas necesitan
// (nombre del usuario, si es admin, mensajes de la URL...)
// ------------------------------------------------------------
router.use((req, res, next) => {
  res.locals.usuario = req.usuario || null;
  res.locals.esAdmin = !!(req.usuario && req.usuario.es_admin);
  res.locals.error = req.query.error || '';
  res.locals.exito = req.query.exito || '';
  next();
});

// ------------------------------------------------------------
// Middleware: ¿está aprobado este usuario?
// ------------------------------------------------------------
function requiereAprobado(req, res, next) {
  // Sin sesión → login
  if (!req.usuario && !req.usuarioPendiente) return res.redirect('/login');
  // Sesión pero aún no aprobado → pantalla de espera
  if (!req.usuario) return res.redirect('/esperando');
  next();
}

// ------------------------------------------------------------
// RUTA RAÍZ → HOME (estilo Netflix)
// ------------------------------------------------------------
router.get('/', requiereAprobado, (req, res) => {
  const capitulos = consultas.todosLosCapitulos.all();
  const destacado = consultas.ultimoCapitulo.get();

  pintar(res, 'inicio.html', {
    usuario: req.usuario.nombre,
    totalCapitulos: capitulos.length,
    capitulosJSON: JSON.stringify(capitulos.map(formatearParaUI)),
    destacadoJSON: JSON.stringify(
      destacado
        ? {
            id: destacado.id,
            titulo: destacado.titulo,
            sinopsis: destacado.sinopsis || '',
            miniatura: destacado.ruta_miniatura
              ? `/miniaturas/${destacado.ruta_miniatura}`
              : '',
          }
        : { id: 0, titulo: '', sinopsis: '', miniatura: '' }
    ),
  });
});

// ------------------------------------------------------------
// CATÁLOGO → todos los capítulos
// ------------------------------------------------------------
router.get('/capitulos', requiereAprobado, (req, res) => {
  const capitulos = consultas.todosLosCapitulos.all();

  pintar(res, 'catalogo.html', {
    usuario: req.usuario.nombre,
    esAdmin: req.usuario.es_admin ? '1' : '',
    totalCapitulos: capitulos.length,
    capitulosJSON: JSON.stringify(capitulos.map(formatearParaUI)),
  });
});

// ------------------------------------------------------------
// PÁGINA DE UN CAPÍTULO → reproductor
// ------------------------------------------------------------
router.get('/capitulo/:id', requiereAprobado, (req, res) => {
  const capitulo = consultas.capituloPorId.get(Number(req.params.id));
  if (!capitulo) return res.redirect('/capitulos');

  const siguiente = consultas.siguienteCapitulo.get({
    temporada: capitulo.temporada,
    episodio: capitulo.episodio,
  });

  // Miniatura (si tiene). Se sirve por /miniaturas, protegida
  // también para que nadie sin permiso vea las imágenes.
  const miniatura = capitulo.ruta_miniatura
    ? `/miniaturas/${capitulo.ruta_miniatura}`
    : '';

  // Duración solo si nos la dieron al subir
  const duracionMetaHTML = capitulo.duracion
    ? `<span>⏱ ${escapar(capitulo.duracion)}</span>`
    : '';

  // Bloque del "siguiente episodio": solo si existe
  const bloqueSiguienteHTML = siguiente
    ? `
      <div class="siguiente-episodio">
        <div class="siguiente-info">
          <div class="etiqueta">A continuación</div>
          <div class="titulo">T${siguiente.temporada} · E${siguiente.episodio} — ${escapar(siguiente.titulo)}</div>
        </div>
        <a href="/capitulo/${siguiente.id}" class="btn btn-rojo">
          ▶ Reproducir siguiente
        </a>
      </div>`
    : `
      <div class="siguiente-episodio">
        <div class="siguiente-info">
          <div class="etiqueta">Fin de lo disponible</div>
          <div class="titulo">Has llegado al último capítulo subido</div>
        </div>
        <a href="/capitulos" class="btn btn-gris">Ver el catálogo</a>
      </div>`;

  pintar(res, 'capitulo.html', {
    usuario: req.usuario.nombre,
    id: capitulo.id,
    titulo: capitulo.titulo,
    sinopsis: capitulo.sinopsis || 'Sin sinopsis.',
    temporada: capitulo.temporada,
    episodio: capitulo.episodio,
    etiqueta: `T${capitulo.temporada} · E${capitulo.episodio}`,
    miniatura,
    duracionMetaHTML,
    bloqueSiguienteHTML,
    // El "siguiente" se usa desde JS: lo pasamos como JSON
    siguienteId: siguiente ? String(siguiente.id) : '',
  });
});

// ------------------------------------------------------------
// PANTALLAS DE ACCESO
// ------------------------------------------------------------
router.get('/login', (req, res) => {
  // Si ya está dentro, que no vea el login
  if (req.usuario) return res.redirect('/');
  pintar(res, 'login.html', {});
});

router.get('/registro', (req, res) => {
  if (req.usuario) return res.redirect('/');
  // ¿Ya hay admin? → para saber si mostrar el aviso "primer usuario = admin"
  const hayAdmin = contarAdmins() > 0;
  pintar(res, 'registro.html', { esPrimerUsuario: hayAdmin ? '' : '1' });
});

// ------------------------------------------------------------
// ESPERANDO APROBACIÓN
// ------------------------------------------------------------
router.get('/esperando', (req, res) => {
  if (!req.usuario && !req.usuarioPendiente) return res.redirect('/login');
  const usuario = req.usuario || req.usuarioPendiente;

  if (usuario.estado === 'aprobado') return res.redirect('/');
  if (usuario.estado === 'rechazado') {
    return pintar(res, 'rechazado.html', { usuario: usuario.nombre });
  }
  pintar(res, 'esperando.html', {
    usuario: usuario.nombre,
    // Mensaje de confirmación tras pulsar "volver a pedir acceso"
    avisoHTML:
      req.query.aviso === 'solicitud-enviada'
        ? `<div class="aviso aviso-exito" style="text-align:left">
             ✅ Solicitud enviada de nuevo. El administrador ya la ve en su panel.
           </div>`
        : '',
  });
});

// ------------------------------------------------------------
// PANEL DE ADMINISTRACIÓN
// ------------------------------------------------------------
router.get('/panel', (req, res) => {
  if (!req.usuario) return res.redirect('/login');
  if (!req.usuario.es_admin) return res.redirect('/');
  if (req.usuario.estado !== 'aprobado') return res.redirect('/esperando');

  const pendientes = consultas.usuariosPendientes.all();
  const todosUsuarios = consultas.todosLosUsuarios.all();
  const capitulos = consultas.todosLosCapitulos.all();

  pintar(res, 'panel.html', {
    usuario: req.usuario.nombre,
    adminId: req.usuario.id,
    totalCapitulos: capitulos.length,
    pendientesJSON: JSON.stringify(pendientes),
    usuariosJSON: JSON.stringify(todosUsuarios),
    capitulosJSON: JSON.stringify(capitulos.map(formatearParaUI)),
    bienvenida: req.query.bienvenida ? '1' : '',
  });
});

// ------------------------------------------------------------
// GET /miniaturas/:archivo — sirve las imágenes de portada
// ------------------------------------------------------------
// Igual que los vídeos: solo para usuarios aprobados, así
// nadie puede ver nada de la web sin permiso.
// ------------------------------------------------------------
const CARPETA_MINIATURAS = path.join(__dirname, '..', 'miniaturas');

router.get('/miniaturas/:archivo', requiereAprobadoMiniatura, (req, res) => {
  // path.basename() elimina intentos de salirse de la carpeta
  // con rutas como "../../etc/passwd" (ataque "path traversal")
  const nombreSeguro = path.basename(req.params.archivo);
  const rutaCompleta = path.join(CARPETA_MINIATURAS, nombreSeguro);

  if (!fs.existsSync(rutaCompleta)) {
    return res.status(404).send('Imagen no encontrada.');
  }
  res.sendFile(rutaCompleta);
});

function requiereAprobadoMiniatura(req, res, next) {
  if (!req.usuario || req.usuario.estado !== 'aprobado') {
    return res.status(403).send('No autorizado.');
  }
  next();
}

// ------------------------------------------------------------
// Convierte una fila de la BD en el objeto que usará el
// frontend (con rutas de imagen/vídeo ya montadas)
// ------------------------------------------------------------
function formatearParaUI(c) {
  return {
    id: c.id,
    titulo: c.titulo,
    temporada: c.temporada,
    episodio: c.episodio,
    sinopsis: c.sinopsis,
    duracion: c.duracion,
    etiqueta: `T${c.temporada} · E${c.episodio}`,
    miniatura: c.ruta_miniatura ? `/miniaturas/${c.ruta_miniatura}` : '',
    // NOTA: el vídeo NO se sirve de /public, sino por la ruta protegida
    video: `/videos/${c.id}`,
  };
}

module.exports = router;
